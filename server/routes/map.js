import fs from 'node:fs/promises';
import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { requireAuth, requireGM } from '../lib/auth.js';
import { config, paths } from '../config.js';
import {
  createCalibration,
  deleteHex,
  getCalibration,
  getCalibrationRow,
  getActiveCalibration,
  listCalibrations,
  listHexes,
  setActiveCalibration,
  updateCalibration,
  upsertHex,
} from '../lib/store.js';
import {
  derivativePath,
  ensureDirs,
  generateDerivatives,
  readImageMeta,
} from '../lib/images.js';
import { DEFAULT_CALIBRATION } from '../../shared/hexMath.js';
import { REGION_TYPES } from '../../shared/journey.js';
import { broadcast, broadcastSnapshot } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

const upload = multer({
  dest: paths.originals,
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await ensureDirs();
      cb(null, paths.originals);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `${Date.now()}-${safe}`);
    },
  }),
  limits: { fileSize: 80 * 1024 * 1024 },
});

router.get('/defaults', requireAuth, (_req, res) => {
  res.json({ defaults: DEFAULT_CALIBRATION, regionTypes: REGION_TYPES });
});

router.get(
  '/calibrations',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ calibrations: await listCalibrations(), active: await getActiveCalibration() });
  }),
);

/** GM uploads a map image; web-sized derivatives are generated immediately. */
router.post(
  '/calibrations',
  requireGM,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });
    const meta = await readImageMeta(req.file.path);
    const calibration = await createCalibration({
      name: req.body?.name || path.parse(req.file.originalname).name,
      originalFile: req.file.filename,
      originalWidth: meta.width,
      originalHeight: meta.height,
      tiers: [],
    });
    const tiers = await generateDerivatives(req.file.path, calibration.id);
    const row = await getCalibrationRow(calibration.id);
    const { db, schema } = await import('../db/index.js');
    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.mapCalibrations)
      .set({ tiers: JSON.stringify(tiers) })
      .where(eq(schema.mapCalibrations.id, row.id));
    const updated = await getCalibration(calibration.id);
    broadcast('map:calibration', updated);
    await broadcastSnapshot();
    return res.status(201).json({ calibration: updated });
  }),
);

/**
 * Build a calibration from an image already sitting in uploads/seed — used by
 * `npm run seed:map` and the "use the seeded Wilderland map" button, so the GM
 * doesn't have to re-upload a multi-MB file through the browser.
 */
router.post(
  '/calibrations/from-seed',
  requireGM,
  asyncHandler(async (req, res) => {
    await ensureDirs();
    const wanted = req.body?.file;
    const files = (await fs.readdir(paths.seed)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
    const file = wanted && files.includes(wanted) ? wanted : files[0];
    if (!file) {
      return res.status(404).json({
        error: 'No seed image found. Put a map image in uploads/seed/ (see npm run seed:map).',
      });
    }
    const seedPath = path.join(paths.seed, file);
    const meta = await readImageMeta(seedPath);
    const calibration = await createCalibration({
      name: req.body?.name || path.parse(file).name,
      originalFile: `seed/${file}`,
      originalWidth: meta.width,
      originalHeight: meta.height,
      tiers: [],
    });
    const tiers = await generateDerivatives(seedPath, calibration.id);
    const { db, schema } = await import('../db/index.js');
    const { eq } = await import('drizzle-orm');
    await db
      .update(schema.mapCalibrations)
      .set({ tiers: JSON.stringify(tiers) })
      .where(eq(schema.mapCalibrations.id, calibration.id));
    const updated = await getCalibration(calibration.id);
    broadcast('map:calibration', updated);
    await broadcastSnapshot();
    return res.status(201).json({ calibration: updated });
  }),
);

router.patch(
  '/calibrations/:id',
  requireGM,
  asyncHandler(async (req, res) => {
    const calibration = await updateCalibration(req.params.id, req.body ?? {});
    if (!calibration) return res.status(404).json({ error: 'Calibration not found.' });
    broadcast('map:calibration', calibration);
    await broadcastSnapshot();
    return res.json({ calibration });
  }),
);

router.post(
  '/calibrations/:id/activate',
  requireGM,
  asyncHandler(async (req, res) => {
    const calibration = await setActiveCalibration(req.params.id);
    broadcast('map:calibration', calibration);
    await broadcastSnapshot();
    res.json({ calibration });
  }),
);

/**
 * The ONLY route that serves map pixels, and it can only ever read from the
 * derivatives directory — the multi-MB original is never reachable over HTTP.
 */
router.get(
  '/calibrations/:id/image/:tier',
  requireAuth,
  asyncHandler(async (req, res) => {
    const row = await getCalibrationRow(req.params.id);
    if (!row) return res.status(404).json({ error: 'Calibration not found.' });
    const resolved = derivativePath(row.tiers, req.params.tier);
    if (!resolved) return res.status(404).json({ error: 'No derivative available for that tier.' });
    res.setHeader('Cache-Control', 'public, max-age=86400');
    return res.sendFile(resolved.path);
  }),
);

router.get(
  '/calibrations/:id/hexes',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ hexes: await listHexes(req.params.id) });
  }),
);

function normaliseTags(body = {}) {
  const regionType = REGION_TYPES.some((r) => r.key === body.regionType) ? body.regionType : 'wild';
  return {
    regionType,
    hardTerrain: Boolean(body.hardTerrain),
    road: Boolean(body.road),
    perilous: Boolean(body.perilous),
    perilRating: Math.max(0, Number(body.perilRating) || 0),
    label: body.label != null ? String(body.label) : '',
    // Optional link to a Compendium Location; '' clears it.
    linkedLocationId: body.linkedLocationId ? String(body.linkedLocationId) : null,
  };
}

router.put(
  '/calibrations/:id/hexes/:col/:row',
  requireGM,
  asyncHandler(async (req, res) => {
    const col = Number(req.params.col);
    const row = Number(req.params.row);
    const hex = await upsertHex(req.params.id, { col, row, ...normaliseTags(req.body) });
    broadcast('map:hex', hex);
    return res.json({ hex });
  }),
);

/** Bulk tagging — the calibration UI paints several hexes at once. */
router.post(
  '/calibrations/:id/hexes/bulk',
  requireGM,
  asyncHandler(async (req, res) => {
    const list = Array.isArray(req.body?.hexes) ? req.body.hexes : [];
    const saved = [];
    for (const item of list) {
      saved.push(
        await upsertHex(req.params.id, {
          col: Number(item.col),
          row: Number(item.row),
          ...normaliseTags(item),
        }),
      );
    }
    broadcast('map:hexes', saved);
    await broadcastSnapshot();
    return res.json({ hexes: saved });
  }),
);

router.delete(
  '/calibrations/:id/hexes/:col/:row',
  requireGM,
  asyncHandler(async (req, res) => {
    await deleteHex(req.params.id, Number(req.params.col), Number(req.params.row));
    broadcast('map:hexDeleted', { col: Number(req.params.col), row: Number(req.params.row) });
    res.json({ ok: true });
  }),
);

export default router;


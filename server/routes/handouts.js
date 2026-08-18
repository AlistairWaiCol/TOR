/**
 * Handouts — an image plus notes, tagged to a campaign Year + Season.
 *
 * Two things this route is careful about:
 *
 * 1. **Hidden is enforced here, not in the UI.** A player's list, single-read
 *    and image requests all 404 on a hidden handout, so "hidden" survives
 *    someone poking at /api directly. The GM can flip it either way at any
 *    time — it is a visibility toggle, not a one-way reveal.
 *
 * 2. **Uploads go through the same discipline as the campaign map.** The stored
 *    original is never addressable over HTTP; sharp re-reads the file to get
 *    its real dimensions (nothing the client claimed is trusted) and generates
 *    WebP derivatives, and only those named tiers can be served.
 *
 * Writes are GM-only, unlike the Compendium's player-level writes: the whole
 * point of a handout is that the GM decides when the table sees it.
 */

import path from 'node:path';
import express from 'express';
import multer from 'multer';
import { requireAuth, requireGM } from '../lib/auth.js';
import { paths } from '../config.js';
import {
  createHandout,
  deleteHandout,
  getHandout,
  getHandoutRow,
  listHandouts,
  updateHandout,
} from '../lib/store.js';
import {
  HANDOUT_TIER_DEFS,
  derivativePath,
  ensureDirs,
  generateDerivatives,
  readImageMeta,
  removeFiles,
} from '../lib/images.js';
import { SEASONS } from '../../shared/journey.js';
import { broadcast } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

const upload = multer({
  storage: multer.diskStorage({
    destination: async (_req, _file, cb) => {
      await ensureDirs();
      cb(null, paths.originals);
    },
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      cb(null, `handout-${Date.now()}-${safe}`);
    },
  }),
  // A hard ceiling multer enforces as bytes actually arrive — a claimed
  // Content-Length is not what is being trusted here.
  limits: { fileSize: 25 * 1024 * 1024, files: 1 },
});

function cleanSeason(value, fallback = 'Spring') {
  return SEASONS.includes(value) ? value : fallback;
}

/** Delete an upload and every derivative belonging to one handout. */
async function removeHandoutFiles(row) {
  if (!row) return;
  const files = [];
  if (row.originalFile) files.push(path.join(paths.originals, row.originalFile));
  for (const tier of row.tiers ?? []) files.push(path.join(paths.derivatives, tier.file));
  await removeFiles(files);
}

router.get(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const entries = await listHandouts({ includeHidden: req.isGM });
    res.json({ handouts: entries, seasons: SEASONS });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const handout = await getHandout(req.params.id);
    if (!handout || (handout.hidden && !req.isGM)) {
      return res.status(404).json({ error: 'Handout not found.' });
    }
    return res.json({ handout });
  }),
);

/**
 * The ONLY route that serves handout pixels. It can read nothing but the
 * derivatives directory, and a hidden handout's image is unreachable to
 * players even with the id in hand.
 */
router.get(
  '/:id/image/:tier',
  requireAuth,
  asyncHandler(async (req, res) => {
    const handout = await getHandout(req.params.id);
    if (!handout || (handout.hidden && !req.isGM)) {
      return res.status(404).json({ error: 'Handout not found.' });
    }
    const resolved = derivativePath(handout.tiers, req.params.tier, { defs: HANDOUT_TIER_DEFS });
    if (!resolved) return res.status(404).json({ error: 'No image for that tier.' });
    // Private: a revealed handout can be hidden again, so this must not sit in
    // a shared cache. The browser may still keep it for the session.
    res.setHeader('Cache-Control', 'private, max-age=300');
    return res.sendFile(resolved.path);
  }),
);

/** GM creates a handout. Hidden unless the form explicitly says otherwise. */
router.post(
  '/',
  requireGM,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    let meta = { width: 0, height: 0 };
    if (req.file) {
      try {
        meta = await readImageMeta(req.file.path);
      } catch {
        await removeFiles([req.file.path]);
        return res.status(400).json({ error: 'That file is not an image sharp can read.' });
      }
    }

    const handout = await createHandout({
      title: body.title || '',
      notes: body.notes || '',
      year: Number(body.year) || 0,
      season: cleanSeason(body.season),
      // Multipart bodies are strings, so an explicit 'false' is the only way
      // to create a handout already visible.
      hidden: body.hidden === undefined ? true : body.hidden !== 'false' && body.hidden !== false,
      originalFile: req.file?.filename ?? '',
      imageWidth: meta.width ?? 0,
      imageHeight: meta.height ?? 0,
      tiers: [],
    });

    if (req.file) {
      const tiers = await generateDerivatives(req.file.path, `handout-${handout.id}`, {
        tiers: HANDOUT_TIER_DEFS,
        skipOversized: false,
      });
      await updateHandout(handout.id, { tiers });
    }

    const saved = await getHandout(handout.id);
    broadcast('handouts:changed', { id: saved.id });
    return res.status(201).json({ handout: saved });
  }),
);

/** Notes, Year, Season, title — and the hidden toggle, both directions. */
router.patch(
  '/:id',
  requireGM,
  asyncHandler(async (req, res) => {
    const patch = { ...(req.body ?? {}) };
    // An unrecognised Season is dropped rather than coerced to Spring — better
    // to leave the stored value alone than to silently retag the handout.
    if ('season' in patch && !SEASONS.includes(patch.season)) delete patch.season;
    // Nothing about the stored image is client-settable.
    delete patch.tiers;
    delete patch.originalFile;
    delete patch.imageWidth;
    delete patch.imageHeight;
    const handout = await updateHandout(req.params.id, patch);
    if (!handout) return res.status(404).json({ error: 'Handout not found.' });
    broadcast('handouts:changed', { id: handout.id });
    return res.json({ handout });
  }),
);

/** Replace the image on an existing handout. */
router.put(
  '/:id/image',
  requireGM,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    const existing = await getHandoutRow(req.params.id);
    if (!existing) {
      if (req.file) await removeFiles([req.file.path]);
      return res.status(404).json({ error: 'Handout not found.' });
    }
    if (!req.file) return res.status(400).json({ error: 'No image uploaded.' });

    let meta;
    try {
      meta = await readImageMeta(req.file.path);
    } catch {
      await removeFiles([req.file.path]);
      return res.status(400).json({ error: 'That file is not an image sharp can read.' });
    }

    await removeHandoutFiles(existing);
    const tiers = await generateDerivatives(req.file.path, `handout-${existing.id}`, {
      tiers: HANDOUT_TIER_DEFS,
      skipOversized: false,
    });
    const handout = await updateHandout(existing.id, {
      originalFile: req.file.filename,
      imageWidth: meta.width ?? 0,
      imageHeight: meta.height ?? 0,
      tiers,
    });
    broadcast('handouts:changed', { id: handout.id });
    return res.json({ handout });
  }),
);

router.delete(
  '/:id',
  requireGM,
  asyncHandler(async (req, res) => {
    const existing = await getHandoutRow(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Handout not found.' });
    await removeHandoutFiles(existing);
    await deleteHandout(existing.id);
    broadcast('handouts:changed', { id: existing.id, deleted: true });
    return res.json({ ok: true });
  }),
);

export default router;

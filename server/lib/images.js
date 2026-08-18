/**
 * Uploaded-image handling — the campaign map (spec §6a) and Handouts.
 *
 * Source maps run tens of MB (e.g. the Wilderland Adventurer's Map is ~19MB at
 * 6600x5100). The original is kept on disk for calibration reference only and is
 * NEVER exposed on an HTTP route. On upload we generate web-sized derivatives and
 * those are the only things players' browsers ever download.
 *
 * The 'full' tier is deliberately NOT downscaled — re-encoding a hand-drawn map
 * to WebP at the source resolution still cuts file size roughly in half to
 * two-thirds with no visible quality loss, and downscaling would blur the small
 * place-name text once a player zooms in. 'web' and 'thumb' are downscaled
 * because they're for zoomed-out overview use, where that detail isn't visible
 * anyway.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { paths } from '../config.js';

/**
 * Tiers, widest first. `width: null` means "full resolution, re-encode only".
 * Tiers wider than the original (other than 'full') are skipped.
 */
export const TIER_DEFS = [
  { name: 'full', width: null, quality: 90 },
  { name: 'high', width: 3200, quality: 78 },
  { name: 'web', width: 1800, quality: 80 },
  { name: 'thumb', width: 900, quality: 78 },
];

/**
 * Handout tiers. Handouts are letters, maps-within-the-map, sketches — nothing
 * like the 19-29MB campaign map — but they go through exactly the same
 * discipline: the upload is re-encoded server-side, the original is never
 * served, and only these named tiers are addressable over HTTP.
 *
 * No full-resolution tier: unlike the campaign map there is no zoom-in-and-read
 * -the-place-names case, so 1600px is the whole picture. `withoutEnlargement`
 * means a smaller upload simply stays its own size.
 */
export const HANDOUT_TIER_DEFS = [
  { name: 'view', width: 1600, quality: 82 },
  { name: 'thumb', width: 420, quality: 76 },
];

export async function ensureDirs() {
  await fs.mkdir(paths.originals, { recursive: true });
  await fs.mkdir(paths.derivatives, { recursive: true });
  await fs.mkdir(paths.seed, { recursive: true });
}

export async function readImageMeta(filePath) {
  const meta = await sharp(filePath, { limitInputPixels: false }).metadata();
  return { width: meta.width, height: meta.height, format: meta.format };
}

/**
 * Build the web-sized derivatives for one upload.
 *
 * The only numbers trusted here are the ones sharp reads back off the file —
 * never anything the client claimed about the upload.
 *
 * @param {string} originalPath   On-disk path of the stored original.
 * @param {string} key            Filename prefix, e.g. a calibration/handout id.
 * @param {object} [opts]
 * @param {Array}  [opts.tiers]   Tier definitions (defaults to the map tiers).
 * @param {boolean}[opts.skipOversized] Skip tiers wider than the source. True
 *   for the map (a 'high' tier of a small map is pointless); false for
 *   handouts, where the named tiers must always exist to be addressable.
 * @returns {Promise<Array<{name,width,height,file,bytes}>>}
 */
export async function generateDerivatives(
  originalPath,
  key,
  { tiers: tierDefs = TIER_DEFS, skipOversized = true } = {},
) {
  await ensureDirs();
  const { width: originalWidth } = await readImageMeta(originalPath);
  const out = [];

  for (const tier of tierDefs) {
    const isFullRes = tier.width == null;
    if (skipOversized && !isFullRes && tier.width > originalWidth && tier.name !== 'thumb') continue;
    const file = `${key}-${tier.name}.webp`;
    const dest = path.join(paths.derivatives, file);
    let pipeline = sharp(originalPath, { limitInputPixels: false });
    if (!isFullRes) {
      const targetWidth = Math.min(tier.width, originalWidth);
      pipeline = pipeline.resize({ width: targetWidth, withoutEnlargement: true });
    }
    const info = await pipeline.webp({ quality: tier.quality, effort: 4 }).toFile(dest);
    const stat = await fs.stat(dest);
    out.push({
      name: tier.name,
      width: info.width,
      height: info.height,
      file,
      bytes: stat.size,
    });
  }
  return out;
}

/**
 * Resolve a tier name to an absolute path inside the derivatives directory.
 * Rejects anything that escapes that directory, so the original (or any other
 * file on disk) can never be served through this route.
 */
export function derivativePath(tiers, tierName, { defs = TIER_DEFS } = {}) {
  // Only the known tier names are addressable, so a crafted :tier segment can
  // never turn into a filesystem path of the caller's choosing.
  if (!defs.some((t) => t.name === tierName)) return null;
  const tier = tiers.find((t) => t.name === tierName) || tiers.find((t) => t.name === 'web') || tiers[0];
  if (!tier) return null;
  const resolved = path.resolve(paths.derivatives, tier.file);
  if (!resolved.startsWith(path.resolve(paths.derivatives) + path.sep)) return null;
  return { path: resolved, tier };
}

export async function removeFiles(files = []) {
  await Promise.all(
    files.map((f) => fs.rm(f, { force: true }).catch(() => {})),
  );
}

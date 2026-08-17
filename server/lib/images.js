/**
 * Map image handling (spec §6a).
 *
 * northlands22.png is ~29MB at 5079x3189. The original is kept on disk for
 * calibration reference only and is NEVER exposed on an HTTP route. On upload we
 * generate three web-sized WebP tiers and those are the only things players'
 * browsers ever download.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { paths } from '../config.js';

/** Resolution tiers, widest first. Tiers wider than the original are skipped. */
export const TIER_DEFS = [
  { name: 'high', width: 3200, quality: 78 },
  { name: 'web', width: 1800, quality: 80 },
  { name: 'thumb', width: 900, quality: 78 },
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
 * Build the web-sized derivatives for one calibration.
 * @returns {Promise<Array<{name,width,height,file,bytes}>>}
 */
export async function generateDerivatives(originalPath, calibrationId) {
  await ensureDirs();
  const { width: originalWidth } = await readImageMeta(originalPath);
  const out = [];

  for (const tier of TIER_DEFS) {
    if (tier.width > originalWidth && tier.name !== 'thumb') continue;
    const targetWidth = Math.min(tier.width, originalWidth);
    const file = `${calibrationId}-${tier.name}.webp`;
    const dest = path.join(paths.derivatives, file);
    const info = await sharp(originalPath, { limitInputPixels: false })
      .resize({ width: targetWidth, withoutEnlargement: true })
      .webp({ quality: tier.quality, effort: 4 })
      .toFile(dest);
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
export function derivativePath(tiers, tierName) {
  // Only the known tier names are addressable, so a crafted :tier segment can
  // never turn into a filesystem path of the caller's choosing.
  if (!TIER_DEFS.some((t) => t.name === tierName)) return null;
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

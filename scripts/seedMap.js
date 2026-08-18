/**
 * Copy the campaign map into uploads/seed, then build the calibration row and
 * its web-sized derivatives.
 *
 * Usage:
 *   npm run seed:map                 # uses the default source path below
 *   npm run seed:map -- "C:\path\to\map.png"
 *
 * The original stays in uploads/seed and is never served over HTTP; only the
 * generated WebP tiers in uploads/derivatives are reachable by a browser.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { paths } from '../server/config.js';
import { db, schema } from '../server/db/index.js';
import { migrate } from '../server/db/migrate.js';
import { ensureDirs, generateDerivatives, readImageMeta } from '../server/lib/images.js';
import { createCalibration, listCalibrations } from '../server/lib/store.js';

const DEFAULT_SOURCE = "D:\\Downloads\\Wilderland Adventurer's Map_page-0001.jpg";

const source = process.argv[2] || DEFAULT_SOURCE;

migrate();
await ensureDirs();

if (!fs.existsSync(source)) {
  console.error(`Source map not found: ${source}`);
  console.error('Pass a path: npm run seed:map -- "C:\\path\\to\\map.png"');
  process.exit(1);
}

const base = path.basename(source);
const dest = path.join(paths.seed, base);
if (!fs.existsSync(dest)) {
  console.log(`Copying ${base} into uploads/seed …`);
  await fsp.copyFile(source, dest);
} else {
  console.log(`uploads/seed/${base} already present.`);
}

const meta = await readImageMeta(dest);
const stat = await fsp.stat(dest);
console.log(
  `Original: ${meta.width}x${meta.height} ${meta.format}, ${(stat.size / 1024 / 1024).toFixed(1)}MB`,
);

const existing = (await listCalibrations()).find((c) => c.name === path.parse(base).name);
let calibration = existing;
if (!calibration) {
  calibration = await createCalibration({
    name: path.parse(base).name,
    originalFile: `seed/${base}`,
    originalWidth: meta.width,
    originalHeight: meta.height,
    tiers: [],
  });
  console.log(`Created calibration ${calibration.id} with the spec's measured grid defaults.`);
} else {
  console.log(`Reusing calibration ${calibration.id}.`);
}

console.log('Generating web-sized derivatives (this takes a few seconds for a large source) …');
const tiers = await generateDerivatives(dest, calibration.id);
await db
  .update(schema.mapCalibrations)
  .set({ tiers: JSON.stringify(tiers) })
  .where(eq(schema.mapCalibrations.id, calibration.id));

for (const t of tiers) {
  console.log(
    `  ${t.name.padEnd(6)} ${String(t.width).padStart(5)}x${String(t.height).padEnd(5)} ${(t.bytes / 1024 / 1024).toFixed(2)}MB  ${t.file}`,
  );
}
console.log(
  `\nDone. Total served bytes ${(tiers.reduce((n, t) => n + t.bytes, 0) / 1024 / 1024).toFixed(2)}MB vs ${(stat.size / 1024 / 1024).toFixed(1)}MB original.`,
);
process.exit(0);

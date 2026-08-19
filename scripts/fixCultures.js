/**
 * One-off fix: bring stored Culture values onto the character sheet's new
 * Culture dropdown.
 *
 * Culture used to be free text. Matching it against the Cultural Virtues was
 * already forgiving (`culturalVirtuesFor()` is case-insensitive and falls back
 * to the whole list), but a strict `<select>` needs an exact option match or it
 * shows nothing — and the sheet's ten options are now derived from
 * `CULTURAL_VIRTUE_CULTURES`, so anything spelled differently reads as blank.
 *
 * Three corrections, matched by character NAME (this is the campaign's own
 * roster, not a general-purpose renamer):
 *
 *   Grimfast the Goodarm  "Beorning"           -> "Beornings"
 *   Srixon son of Lofar   "Dwarves of Durin"   -> "Dwarves of Durin's Folk"
 *   Avery Littlechild     "Hobbit of Bree"     -> "Bree Hobbits"      (see below)
 *
 * The first two are unambiguous — a plural and a truncation. **The third is a
 * judgment call, not a certainty.** "Bree Hobbits" is the closest canonical
 * culture and is explicitly the hybrid Men-of-Bree / Hobbit-of-the-Shire
 * culture in its own Cultural Virtue text, which fits "Hobbit of Bree" — but it
 * is not a 1:1 rename, and if the intended culture was "Hobbits of the Shire"
 * living in Bree, that is two clicks to change on the sheet.
 *
 * Idempotent and conservative: a character is only touched if the name matches
 * AND the stored value is still the exact old spelling. Runs against whichever
 * database DB_CLIENT / DATABASE_URL point at, like every other script here —
 * but it exists for the LOCAL dev database, and production is the owner's to
 * run when they deploy.
 *
 *   node scripts/fixCultures.js            apply
 *   node scripts/fixCultures.js --dry-run  report only
 */

import { CULTURAL_VIRTUE_CULTURES } from '../shared/culturalVirtues.js';
import { migrate } from '../server/db/migrate.js';
import { listCharacters, updateCharacter } from '../server/lib/store.js';

const CORRECTIONS = [
  { name: 'Grimfast the Goodarm', from: 'Beorning', to: 'Beornings' },
  { name: 'Srixon son of Lofar', from: 'Dwarves of Durin', to: "Dwarves of Durin's Folk" },
  { name: 'Avery Littlechild', from: 'Hobbit of Bree', to: 'Bree Hobbits', uncertain: true },
];

const dryRun = process.argv.includes('--dry-run');

// A typo in the table above would write a value the dropdown cannot show, which
// is the exact failure this script exists to fix. Check it before touching a row.
for (const c of CORRECTIONS) {
  if (!CULTURAL_VIRTUE_CULTURES.includes(c.to)) {
    console.error(`"${c.to}" is not one of the ten cultures — refusing to write it.`);
    process.exit(1);
  }
}

await migrate();

const roster = await listCharacters();
let changed = 0;
let already = 0;

for (const { name, from, to, uncertain } of CORRECTIONS) {
  const character = roster.find((c) => c.name === name);
  if (!character) {
    console.log(`- no character named "${name}" in this database, skipping.`);
    continue;
  }
  const stored = character.sheet?.general?.culture ?? '';
  if (stored === to) {
    console.log(`- ${name}: already "${to}".`);
    already += 1;
    continue;
  }
  if (stored !== from) {
    console.log(`- ${name}: Culture is "${stored}", not the expected "${from}" — left alone.`);
    continue;
  }
  console.log(
    `${dryRun ? '[dry run] ' : ''}${name}: "${stored}" -> "${to}"${uncertain ? '  (judgment call — check this one)' : ''}`,
  );
  if (!dryRun) {
    // Both the sheet document and the scalar `culture` column: the column feeds
    // the character list and the Socket.IO snapshot, so leaving it behind would
    // have the two disagree.
    await updateCharacter(character.id, {
      culture: to,
      sheet: { general: { ...character.sheet.general, culture: to } },
    });
  }
  changed += 1;
}

console.log(
  `\n${dryRun ? 'Would change' : 'Changed'} ${changed}, ${already} already correct.` +
    (dryRun ? ' Nothing was written.' : ''),
);
// process.exit() terminates immediately regardless of open handles — no need to
// await a graceful pool shutdown, which can hang against a remote proxy.
process.exit(0);

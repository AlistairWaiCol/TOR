/**
 * Import a party roster from a JSON file into the characters table — works
 * against either dialect (reads DB_CLIENT/DATABASE_URL the same way the
 * server does, same as seedMap.js and seedCompendium.js).
 *
 * Usage:
 *   npm run seed:characters -- "D:\path\to\characters_seed.json"
 *
 * The source JSON is an array of character objects in the shape the GM's
 * campaign-tracking export already uses (see the field-by-field mapping
 * below) — NOT the app's internal sheet shape. Existing characters are
 * matched by name and left untouched with a warning, so this is safe to
 * re-run against a database that already has some of the roster in it; it
 * only ever adds characters that aren't there yet.
 *
 * Two mapping decisions worth knowing about, both settled the first time this
 * roster was imported (see README's "Judgment calls"):
 *   - Fell/Grievous/Keen/Close-fitting/Cunning Make/Reinforced/Reinforced come
 *     in as plain values ("+1", "9+", true) rather than the app's tier enum.
 *     Anything present maps to the tier's BASE ("standard") value — there is
 *     no signal in the source data for which enhanced/crafting variant (if
 *     any) applies, so enhanced tiers are never guessed.
 *   - The source's `attributes.wits.shield` field is NOT copied into the
 *     sheet's `parryShield` — the Shield row's own `parry` field already
 *     feeds Total Parry automatically (see `totalParry()` in
 *     shared/character.js), so copying it too would double-count it. This
 *     was a real bug the first time this data was imported by hand; this
 *     script gets it right by construction.
 */

import fs from 'node:fs';
import { migrate } from '../server/db/migrate.js';
import { getPgPool } from '../server/db/index.js';
import { config } from '../server/config.js';
import { createCharacter, listCharacters } from '../server/lib/store.js';

const SOURCE = process.argv[2];
if (!SOURCE) {
  console.error('Usage: npm run seed:characters -- "C:\\path\\to\\characters_seed.json"');
  process.exit(1);
}
if (!fs.existsSync(SOURCE)) {
  console.error(`Source file not found: ${SOURCE}`);
  process.exit(1);
}

await migrate();

const raw = JSON.parse(fs.readFileSync(SOURCE, 'utf8'));
if (!Array.isArray(raw)) {
  console.error('Expected the source file to be a JSON array of characters.');
  process.exit(1);
}

const joinList = (v) => (Array.isArray(v) ? v.filter(Boolean).join(', ') : v || '');
const str = (v) => (v === null || v === undefined ? '' : String(v));
const num = (v) => Number(v) || 0;

function mapSkills(seedGroup = {}, names) {
  const out = {};
  for (const name of names) {
    const s = seedGroup[name.toLowerCase()] || {};
    out[name] = { favoured: Boolean(s.favoured), rating: num(s.rating) };
  }
  return out;
}

function mapProficiencies(seedCombat = {}, groups) {
  const out = {};
  for (const g of groups) {
    const p = seedCombat[g.toLowerCase()] || {};
    out[g] = { favoured: Boolean(p.favoured), rating: num(p.rating) };
  }
  return out;
}

/** Base-tier text ("+1", "9+") maps to 'standard' — see the module doc comment. */
function mapWeaponQuality(v) {
  return v ? 'standard' : 'none';
}

/** closeFitting / cunningMake / reinforced come in as booleans, not tiers. */
function mapBoolQuality(v) {
  return v ? 'standard' : 'none';
}

function mapWeapon(w) {
  return {
    equipped: w.equipped !== false, // source weapons don't carry `equipped`; a listed weapon is carried
    name: str(w.name),
    type: str(w.type),
    proficiency: str(w.type),
    damage: num(w.damage),
    injury: num(w.injury),
    injuryTwoHanded: num(w.injuryTwoHanded), // 0 unless the source explicitly provides a two-handed rating
    grip: str(w.grip),
    load: num(w.load),
    notes: str(w.notes),
    fell: mapWeaponQuality(w.fell),
    grievous: mapWeaponQuality(w.grievous),
    keen: mapWeaponQuality(w.keen),
  };
}

function mapArmour(a) {
  return {
    equipped: a.equipped !== false,
    name: str(a.name),
    protection: num(a.protection),
    load: num(a.load),
    closeFitting: mapBoolQuality(a.closeFitting),
    cunningMake: mapBoolQuality(a.cunningMake),
  };
}

function mapShield(s) {
  if (!s) return { equipped: false, name: '', parry: 0, load: 0, reinforced: 'none', cunningMake: 'none' };
  return {
    equipped: s.equipped !== false,
    name: str(s.name),
    parry: num(s.parry),
    load: num(s.load),
    reinforced: mapBoolQuality(s.reinforced),
    cunningMake: mapBoolQuality(s.cunningMake),
  };
}

const STRENGTH_SKILLS = ['Awe', 'Athletics', 'Awareness', 'Hunting', 'Song', 'Craft'];
const HEART_SKILLS = ['Enhearten', 'Travel', 'Insight', 'Healing', 'Courtesy', 'Battle'];
const WITS_SKILLS = ['Persuade', 'Stealth', 'Scan', 'Explore', 'Riddle', 'Lore'];
const PROFICIENCY_GROUPS = ['Axes', 'Bows', 'Spears', 'Swords', 'Brawling'];

function mapCharacter(c) {
  const sheet = {
    general: {
      name: str(c.name),
      culture: str(c.culture),
      calling: str(c.calling),
      livingStandard: str(c.livingStandard),
      weakness: str(c.weakness),
      patron: str(c.patron),
      fellowshipFocus: str(c.fellowshipFocus),
      age: str(c.age),
      blessing: str(c.blessing),
      distinctiveFeatures: joinList(c.distinctiveFeatures),
      flaws: joinList(c.flaws),
    },
    rewards: {
      valourChecked: Boolean(c.rewards?.valourChecked),
      valour: num(c.rewards?.valourRating),
      rewardTraits: str(c.rewards?.text),
    },
    virtues: {
      wisdomChecked: Boolean(c.virtues?.wisdomChecked),
      wisdom: num(c.virtues?.wisdomRating),
      virtueList: str(c.virtues?.text),
    },
    usefulItems: {
      useTable: true,
      items: (c.usefulItems || []).map((it) => ({
        name: str(it.name),
        bonus: num(String(it.bonus ?? 0).replace('+', '')),
        skill1: str(it.skill1),
        skill2: str(it.skill2),
      })),
      gearText: '',
    },
    conditions: {
      favourState: c.conditions?.state || 'Normal',
      weary: Boolean(c.conditions?.weary),
      miserable: Boolean(c.conditions?.miserable),
      wounded: Boolean(c.conditions?.wounded),
      inspired: false,
      injury: str(c.conditions?.injury),
    },
    attributes: {
      strength: {
        rating: num(c.attributes?.strength?.rating),
        skills: mapSkills(c.skills?.strength, STRENGTH_SKILLS),
        endurance: num(c.attributes?.strength?.endurance?.current),
        enduranceMax: num(c.attributes?.strength?.endurance?.max),
        load: num(c.attributes?.strength?.load),
        treasure: num(c.attributes?.strength?.treasure),
        fatigue: num(c.attributes?.strength?.fatigue),
      },
      heart: {
        rating: num(c.attributes?.heart?.rating),
        skills: mapSkills(c.skills?.heart, HEART_SKILLS),
        hope: num(c.attributes?.heart?.hope?.current),
        hopeMax: num(c.attributes?.heart?.hope?.max),
        shadow: num(c.attributes?.heart?.shadow),
        taint: num(c.attributes?.heart?.taint),
        scars: num(c.attributes?.heart?.scars),
      },
      wits: {
        rating: num(c.attributes?.wits?.rating),
        skills: mapSkills(c.skills?.wits, WITS_SKILLS),
        parryBase: num(c.attributes?.wits?.parryBase),
        // Deliberately NOT c.attributes.wits.shield — see the module doc comment.
        parryShield: 0,
        parryOther: num(c.attributes?.wits?.other),
        parryStance: num(c.attributes?.wits?.stance),
      },
    },
    experience: {
      adventurePoints: num(c.experience?.adventurePoints),
      skillPoints: num(c.experience?.skillPoints),
      fellowship: num(c.experience?.fellowship),
      adventureTotal: num(c.experience?.adventureTotal),
      skillTotal: num(c.experience?.skillTotal),
      treasureRating: num(c.experience?.treasureRating),
    },
    mount: c.mount
      ? { name: str(c.mount.name), vigour: num(c.mount.vigour), treasure: num(c.mount.treasure) }
      : { name: '', vigour: 0, treasure: 0 },
    combat: {
      proficiencies: mapProficiencies(c.combat, PROFICIENCY_GROUPS),
      stance: c.combat?.stance || 'Open',
      opponentsEngaging: 0,
      attackModifier: num(c.combat?.attackMod),
      stanceDamageEnabled: Boolean(c.combat?.stanceDamage?.active),
      stanceDamage: num(c.combat?.stanceDamage?.value),
    },
    weapons: (c.weapons || []).map(mapWeapon),
    armour: (c.armour || []).map(mapArmour),
    shield: mapShield(c.shield),
  };

  return { name: sheet.general.name, culture: sheet.general.culture, sheet };
}

const existingNames = new Set((await listCharacters()).map((c) => c.name));

let imported = 0;
let skipped = 0;
for (const entry of raw) {
  const { name, culture, sheet } = mapCharacter(entry);
  if (existingNames.has(name)) {
    console.log(`Skipping "${name}" — a character with that name already exists.`);
    skipped += 1;
    continue;
  }
  const created = await createCharacter({ name, culture, sheet, player: '' });
  console.log(`Imported ${created.name} (${created.id})`);
  imported += 1;
}

console.log(`\nDone — imported ${imported}, skipped ${skipped} (already present).`);
if (config.dbClient === 'pg') await getPgPool().end();
process.exit(0);

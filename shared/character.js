/**
 * Canonical character sheet shape (spec §5).
 *
 * Data-model note: the scalar identity of a character lives in real DB columns
 * (id, name, player, timestamps); the sheet itself is stored as one JSON
 * document because it is a large, mostly-static form with nested tables. That
 * keeps the Postgres swap trivial (text/jsonb column either way) and keeps this
 * file as the single source of truth for the field list.
 */

import { computeTargetNumber, DEFAULT_TN_BASE } from './dice.js';
import { effectiveArmour, effectiveShield, effectiveWeapon } from './rewards.js';

export const ATTRIBUTES = [
  {
    key: 'strength',
    label: 'Strength',
    skills: ['Awe', 'Athletics', 'Awareness', 'Hunting', 'Song', 'Craft'],
  },
  {
    key: 'heart',
    label: 'Heart',
    skills: ['Enhearten', 'Travel', 'Insight', 'Healing', 'Courtesy', 'Battle'],
  },
  {
    key: 'wits',
    label: 'Wits',
    skills: ['Persuade', 'Stealth', 'Scan', 'Explore', 'Riddle', 'Lore'],
  },
];

export const ALL_SKILLS = ATTRIBUTES.flatMap((a) => a.skills.map((s) => ({ skill: s, attribute: a.key })));

export const PROFICIENCY_GROUPS = ['Axes', 'Bows', 'Spears', 'Swords', 'Brawling'];

export const STANCES = ['Forward', 'Open', 'Defensive', 'Rear'];

export const CONDITIONS = ['weary', 'miserable', 'wounded'];

export const FAVOUR_STATES = ['Normal', 'Favoured', 'Ill-Favoured'];

/** Which attribute governs a named skill (drives the TN for a skill roll). */
export function attributeForSkill(skillName) {
  const entry = ALL_SKILLS.find((s) => s.skill.toLowerCase() === String(skillName).toLowerCase());
  return entry ? entry.attribute : null;
}

export function emptyWeapon() {
  return {
    id: cryptoId(),
    equipped: false,
    type: '',
    damage: 0,
    injury: 0,
    load: 0,
    notes: '',
    proficiency: '',
    fell: 'none',
    grievous: 'none',
    keen: 'none',
  };
}

export function emptyArmour() {
  return {
    id: cryptoId(),
    equipped: false,
    name: '',
    protection: 0,
    load: 0,
    closeFitting: 'none',
    cunningMake: 'none',
  };
}

export function emptyUsefulItem() {
  return { id: cryptoId(), name: '', bonus: 0, skill1: '', skill2: '' };
}

function cryptoId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Math.random().toString(36).slice(2, 10)}`;
}

/** A complete, empty sheet. Every field named in spec §5 appears here. */
export function emptyCharacterSheet() {
  return {
    general: {
      name: '',
      culture: '',
      calling: '',
      livingStandard: '',
      weakness: '',
      patron: '',
      fellowshipFocus: '',
      age: '',
      blessing: '',
      distinctiveFeatures: '',
      flaws: '',
    },
    rewards: { valourChecked: false, valour: 0, rewardTraits: '' },
    virtues: { wisdomChecked: false, wisdom: 0, virtueList: '' },
    usefulItems: { useTable: true, items: [], gearText: '' },
    conditions: {
      favourState: 'Normal', // Normal | Favoured | Ill-Favoured
      weary: false,
      miserable: false,
      wounded: false,
      inspired: false, // not on the reference sheet; needed for the Hope-spend bonus
      injury: '',
    },
    customRoller: {
      label: '',
      whisperTo: 'public', // public | gm | me | <character name>
      featModifier: 'Normal', // Normal | Favoured | Ill-Favoured
      successDice: 0,
      targetNumber: 14,
    },
    attributes: {
      strength: {
        rating: 0,
        skills: skillDefaults('strength'),
        endurance: 0,
        enduranceMax: 0,
        load: 0,
        treasure: 0,
        fatigue: 0,
      },
      heart: {
        rating: 0,
        skills: skillDefaults('heart'),
        hope: 0,
        hopeMax: 0,
        shadow: 0,
        taint: 0,
        scars: 0,
      },
      wits: {
        rating: 0,
        skills: skillDefaults('wits'),
        parryBase: 0,
        parryShield: 0,
        parryOther: 0,
        parryStance: 0,
      },
    },
    experience: {
      adventurePoints: 0,
      skillPoints: 0,
      fellowship: 0,
      adventureTotal: 0,
      skillTotal: 0,
      treasureRating: 0,
    },
    mount: { name: '', vigour: 0, treasure: 0 },
    combat: {
      proficiencies: Object.fromEntries(
        PROFICIENCY_GROUPS.map((g) => [g, { favoured: false, rating: 0 }]),
      ),
      stance: 'Open',
      attackModifier: 0,
      stanceDamageEnabled: false,
      stanceDamage: 0,
    },
    weapons: [],
    armour: [],
    shield: { equipped: false, name: '', parry: 0, load: 0, reinforced: 'none', cunningMake: 'none' },
  };
}

function skillDefaults(attributeKey) {
  const attr = ATTRIBUTES.find((a) => a.key === attributeKey);
  return Object.fromEntries(attr.skills.map((s) => [s, { favoured: false, rating: 0 }]));
}

/**
 * Deep-merge a stored sheet over the empty template so sheets written by an
 * older version of the app still open cleanly after fields are added.
 */
export function hydrateSheet(stored) {
  return mergeDeep(emptyCharacterSheet(), stored || {});
}

function mergeDeep(base, override) {
  if (Array.isArray(base)) return Array.isArray(override) ? override : base;
  if (base && typeof base === 'object') {
    if (!override || typeof override !== 'object') return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(override)) {
      out[k] = k in base ? mergeDeep(base[k], v) : v;
    }
    return out;
  }
  return override === undefined ? base : override;
}

/* --- derived values -------------------------------------------------------- */

export function skillEntry(sheet, skillName) {
  for (const attr of ATTRIBUTES) {
    const s = sheet?.attributes?.[attr.key]?.skills?.[skillName];
    if (s) return { ...s, attribute: attr.key, attributeRating: sheet.attributes[attr.key].rating };
  }
  // Weapon proficiencies are rolled the same way.
  const prof = sheet?.combat?.proficiencies?.[skillName];
  if (prof) {
    return {
      ...prof,
      attribute: 'strength',
      attributeRating: sheet?.attributes?.strength?.rating ?? 0,
    };
  }
  return null;
}

/**
 * Everything the dice engine needs to roll a named skill for this hero,
 * with the sheet's current Favoured/Ill-favoured selection and Weary/Miserable
 * state applied automatically (spec §5).
 */
export function rollContextForSkill(sheet, skillName, { tnBase = DEFAULT_TN_BASE } = {}) {
  const entry = skillEntry(sheet, skillName);
  const rating = entry?.rating ?? 0;
  const attributeRating = entry?.attributeRating ?? 0;
  const c = sheet?.conditions ?? {};
  const sheetFavoured = c.favourState === 'Favoured';
  const sheetIllFavoured = c.favourState === 'Ill-Favoured';
  return {
    rating,
    attribute: attributeRating,
    tnBase,
    targetNumber: computeTargetNumber(attributeRating, tnBase),
    favoured: Boolean(entry?.favoured) || sheetFavoured,
    illFavoured: sheetIllFavoured,
    weary: Boolean(c.weary),
    miserable: Boolean(c.miserable),
    inspired: Boolean(c.inspired),
    hope: sheet?.attributes?.heart?.hope ?? 0,
  };
}

export function totalParry(sheet) {
  const w = sheet?.attributes?.wits ?? {};
  const valour = sheet?.rewards?.valour ?? 0;
  const shieldBonus = sheet?.shield?.equipped ? effectiveShield(sheet.shield, { valour }).parry : 0;
  return (
    (Number(w.parryBase) || 0) +
    (Number(w.parryShield) || 0) +
    (Number(w.parryOther) || 0) +
    (Number(w.parryStance) || 0) +
    shieldBonus
  );
}

/** Combined Protection roll rating: equipped armour protection + CF bonuses. */
export function totalProtection(sheet) {
  const valour = sheet?.rewards?.valour ?? 0;
  let protection = 0;
  let bonus = 0;
  for (const a of sheet?.armour ?? []) {
    if (!a.equipped) continue;
    const eff = effectiveArmour(a, { valour });
    protection += eff.protection;
    bonus += eff.protectionBonus;
  }
  return { protection, bonus, total: protection + bonus };
}

/** Total Load from equipped weapons, armour and shield, after Cunning Make. */
export function totalLoad(sheet) {
  const valour = sheet?.rewards?.valour ?? 0;
  let load = 0;
  for (const w of sheet?.weapons ?? []) if (w.equipped) load += effectiveWeapon(w, { valour }).load;
  for (const a of sheet?.armour ?? []) if (a.equipped) load += effectiveArmour(a, { valour }).load;
  if (sheet?.shield?.equipped) load += effectiveShield(sheet.shield, { valour }).load;
  return load;
}

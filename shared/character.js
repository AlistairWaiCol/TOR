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

/** The one proficiency group that is a ranged weapon — the Rearward stance's requirement. */
export const RANGED_PROFICIENCY = 'Bows';

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
    name: '',
    type: '',
    damage: 0,
    injury: 0,
    // Long Sword / Spear / Long-hafted Axe have a second Injury rating for the
    // two-handed grip. 0 means "one Injury rating", which is every other weapon,
    // and then `grip` stays '' and the sheet shows no grip control.
    injuryTwoHanded: 0,
    grip: '',
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
      // Defensive stance costs 1 Success Die per opponent engaging this hero.
      opponentsEngaging: 0,
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
export function rollContextForSkill(
  sheet,
  skillName,
  { tnBase = DEFAULT_TN_BASE, travelling = false } = {},
) {
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
    weary: computeWeary(sheet, { travelling }),
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

/**
 * Total Load: equipped weapons, armour and shield (after Cunning Make) plus the
 * hero's carried Treasure. This is the hero's Load — the sheet displays it
 * read-only and derives it on every render, so equipping a piece of gear or
 * changing a quality tier updates it immediately and nothing stale is stored.
 */
export function totalLoad(sheet) {
  const valour = sheet?.rewards?.valour ?? 0;
  let load = 0;
  for (const w of sheet?.weapons ?? []) if (w.equipped) load += effectiveWeapon(w, { valour }).load;
  for (const a of sheet?.armour ?? []) if (a.equipped) load += effectiveArmour(a, { valour }).load;
  if (sheet?.shield?.equipped) load += effectiveShield(sheet.shield, { valour }).load;
  load += Number(sheet?.attributes?.strength?.treasure) || 0;
  return load;
}

/**
 * Load for the purposes of the Weary test.
 *
 * While a hero is actively travelling, accumulated Fatigue temporarily counts
 * on top of Load (§6). That is a comparison-time adjustment only — it never
 * touches the stored sheet, which is why Load itself stays derived from gear.
 */
export function effectiveLoad(sheet, { travelling = false } = {}) {
  const fatigue = Number(sheet?.attributes?.strength?.fatigue) || 0;
  return totalLoad(sheet) + (travelling ? fatigue : 0);
}

/**
 * Weary is not a switch the player flips: a hero is Weary whenever their
 * current Endurance has dropped to or below their effective Load.
 *
 * One implementation, called from both the client (to render the state) and
 * the server (so the dice engine actually rolls it) — see rollContextForSkill()
 * and performRoll().
 */
export function computeWeary(sheet, { travelling = false } = {}) {
  const endurance = Number(sheet?.attributes?.strength?.endurance) || 0;
  return endurance <= effectiveLoad(sheet, { travelling });
}

/* --- combat --------------------------------------------------------------- */

/**
 * Success-Dice modifier this hero's Combat Stance applies to their OWN attacks:
 *   Forward    +1
 *   Open        0
 *   Defensive  −1 per opponent currently engaging them
 *   Rearward    0 (ranged weapons only — see stanceAttackWarning)
 */
export function stanceAttackDice(sheet) {
  const combat = sheet?.combat ?? {};
  if (combat.stance === 'Forward') return 1;
  if (combat.stance === 'Defensive') {
    const engaging = Math.max(0, Number(combat.opponentsEngaging) || 0);
    return engaging > 0 ? -engaging : 0; // never -0
  }
  return 0;
}

/** Human-readable reason for the stance modifier, for the roll dialog. */
export function stanceAttackNote(sheet) {
  const combat = sheet?.combat ?? {};
  const dice = stanceAttackDice(sheet);
  if (combat.stance === 'Forward') return 'Forward stance: +1 Success Die.';
  if (combat.stance === 'Defensive') {
    const n = Math.max(0, Number(combat.opponentsEngaging) || 0);
    return `Defensive stance: ${dice} Success Dice (−1 per engaging opponent, ${n} engaging).`;
  }
  if (combat.stance === 'Rear') return 'Rearward stance: no dice modifier, ranged weapons only.';
  return 'Open stance: no dice modifier.';
}

/**
 * RAW, a hero in the Rearward stance attacks only with a ranged weapon. This
 * warns rather than blocks — the same "say so, then let the table decide"
 * treatment mounted travel over hard terrain gets.
 */
export function stanceAttackWarning(sheet, weapon = {}) {
  if (sheet?.combat?.stance !== 'Rear') return '';
  const proficiency = weapon.proficiency || '';
  if (proficiency === RANGED_PROFICIENCY) return '';
  const what = weapon.name || weapon.type || proficiency || 'this weapon';
  return (
    `Rearward stance is for ranged weapons only, and ${what} is not a ${RANGED_PROFICIENCY} attack. ` +
    'Not valid by the book — the roll is allowed anyway, so agree it with the GM first.'
  );
}

/**
 * The Target Number of an attack = the attacker's STRENGTH TN, raised by the
 * target's Parry rating. Targets are almost always NPCs with no sheet in this
 * app, so the Parry is typed in rather than looked up.
 */
export function attackTargetNumber(sheet, targetParry = 0, tnBase = DEFAULT_TN_BASE) {
  const strengthTN = computeTargetNumber(sheet?.attributes?.strength?.rating ?? 0, tnBase);
  return strengthTN + (Number(targetParry) || 0);
}

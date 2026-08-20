/**
 * Compendium seed data and shape.
 *
 * The Compendium is the campaign's shared reference shelf: Virtues, Rewards,
 * a Weapons & Armour catalogue a character sheet can pick from, and Locations
 * that map hexes link to. Sections are declared here as data so adding NPCs or
 * a Bestiary later means adding a row to COMPENDIUM_SECTIONS, a table, and a
 * store function — no routing or page rewrite.
 *
 * Rules text is written in the same terse mechanical style as shared/rewards.js
 * ("+2 Injury", "−2 Load") rather than transcribed from the rulebook.
 */

import { ARMOUR_QUALITIES, SHIELD_QUALITIES, WEAPON_QUALITIES } from './rewards.js';

export const COMPENDIUM_SECTIONS = [
  { key: 'virtues', label: 'General Virtues', singular: 'Virtue' },
  { key: 'culturalVirtues', label: 'Cultural Virtues', singular: 'Cultural Virtue' },
  { key: 'rewards', label: 'Rewards', singular: 'Reward' },
  { key: 'items', label: 'Weapons & Armour', singular: 'Item' },
  { key: 'locations', label: 'Locations', singular: 'Location' },
  { key: 'adversaries', label: 'Adversaries', singular: 'Adversary' },
];

export const SECTION_KEYS = COMPENDIUM_SECTIONS.map((s) => s.key);

/** Catalogue entries are one of the three gear shapes a character sheet holds. */
export const ITEM_KINDS = ['weapon', 'armour', 'shield'];

/**
 * Standards of Living, poorest first. Only used to *rank* two values so the
 * gear pickers can say "this normally needs a better Standard of Living than
 * yours" — it is a hint, never a block, and a hero's `general.livingStandard`
 * stays free text.
 */
export const STANDARDS_OF_LIVING = ['Poor', 'Frugal', 'Common', 'Prosperous', 'Rich', 'Very Rich'];

/** Position on that ladder, or -1 for '' / anything home-brew. */
export function livingStandardRank(value) {
  const wanted = String(value ?? '').trim().toLowerCase();
  if (!wanted) return -1;
  return STANDARDS_OF_LIVING.findIndex((s) => s.toLowerCase() === wanted);
}

/**
 * Soft warning for equipping a catalogue item, or '' if there is nothing to
 * say. Returns prose, not a boolean, because nothing acts on it — the sheet
 * shows the line and the player equips the item anyway if they want to.
 */
export function standardOfLivingWarning(item = {}, livingStandard = '') {
  const need = String(item.minStandard ?? '').trim();
  if (!need) return '';
  const needRank = livingStandardRank(need);
  if (needRank < 0) return '';
  const haveRank = livingStandardRank(livingStandard);
  const what = item.name || 'That item';
  if (haveRank < 0) {
    return `${what} normally calls for a ${need} Standard of Living — this sheet has none recorded.`;
  }
  if (haveRank >= needRank) return '';
  return `${what} normally calls for a ${need} Standard of Living, and this hero is ${STANDARDS_OF_LIVING[haveRank]}.`;
}

/**
 * Long Sword, Spear and Long-hafted Axe each have TWO Injury ratings, one per
 * grip; Damage is a single flat value for all three. `injuryTwoHanded` of 0
 * means the weapon has only the one Injury rating, like everything else.
 */
export const WEAPON_GRIPS = [
  { value: '1h', label: '1-handed' },
  { value: '2h', label: '2-handed' },
];

export function isVersatileWeapon(weapon = {}) {
  return (Number(weapon.injuryTwoHanded) || 0) > 0;
}

/**
 * The six Virtues every hero may take from the core rulebook, regardless of
 * culture. Effects are summarised, not quoted.
 */
export const CORE_VIRTUES = [
  {
    name: 'Confidence',
    effect: '+2 Hope — raise both your Hope score and your maximum Hope rating by 2.',
  },
  {
    name: 'Dour-handed',
    effect: '+1 Damage when you strike a Heavy Blow.',
  },
  {
    name: 'Hardiness',
    effect: '+2 Endurance — raise both your Endurance score and your maximum Endurance by 2.',
  },
  {
    name: 'Mastery',
    effect: 'Choose 2 additional Favoured skills.',
  },
  {
    name: 'Nimbleness',
    effect: '+1 Parry rating.',
  },
  {
    name: 'Prowess',
    effect:
      'Reduce the Target Number of one Attribute by 1. The TN only — you gain none of the other ' +
      'benefits of a higher Attribute rating.',
  },
];

/**
 * The six core Rewards, built from the quality tables the character sheet
 * already uses, so the tier text and values cannot drift apart from the sheet's
 * dropdowns. Cunning Make appears on both armour and shields, so it is listed
 * once with both.
 */
export function coreRewardDefinitions() {
  const byName = new Map();

  const add = (appliesTo, quality) => {
    const existing = byName.get(quality.label);
    if (existing) {
      if (!existing.appliesTo.includes(appliesTo)) existing.appliesTo.push(appliesTo);
      return;
    }
    byName.set(quality.label, {
      name: quality.label,
      code: quality.code,
      appliesTo: [appliesTo],
      summary: quality.summary,
      // "None" is the absence of the Reward, not a tier of it.
      tiers: quality.options
        .filter((o) => o.value !== 'none')
        .map((o) => ({ value: o.value, label: o.label })),
    });
  };

  for (const quality of Object.values(WEAPON_QUALITIES)) add('weapon', quality);
  for (const quality of Object.values(ARMOUR_QUALITIES)) add('armour', quality);
  for (const quality of Object.values(SHIELD_QUALITIES)) add('shield', quality);

  return [...byName.values()];
}

/** A catalogue entry, filled out to the same field list the sheet's tables use. */
export function emptyCatalogueItem(kind = 'weapon') {
  return {
    kind,
    name: '',
    type: '',
    proficiency: '',
    damage: 0,
    injury: 0,
    // 0 = one Injury rating like every other weapon; see WEAPON_GRIPS.
    injuryTwoHanded: 0,
    protection: 0,
    parry: 0,
    load: 0,
    // '' = no requirement. Compendium-only; nothing is ever blocked by it.
    minStandard: '',
    notes: '',
    source: 'custom',
  };
}

/* --- the core-rulebook gear tables ------------------------------------------
 * Seeded on first run alongside the Virtues and Rewards, as `source: 'core'`.
 *
 * Weapons: Damage is one flat value even for the three weapons that have two
 * Injury ratings, so only Injury splits by grip.
 *
 * Armour: Protection is the plain number behind the rulebook's "1d"/"+1d"
 * notation. Helm's is additive by nature, but totalProtection() already sums
 * Protection across every equipped armour row, so no special stacking is
 * needed — a Helm is simply another row worth 1.
 *
 * Minimum Standard of Living is an explicit column here, NOT inferred from the
 * asterisk footnote markers in the source tables (which are inconsistent —
 * see the README's judgment-call log).
 */

const CORE_WEAPONS = [
  { name: 'Unarmed', damage: 1, injury: 0, load: 0, proficiency: 'Brawling', notes: 'Includes throwing stones. Cannot cause a Piercing Blow' },
  { name: 'Dagger', damage: 2, injury: 14, load: 0, proficiency: 'Brawling', notes: 'Can trigger Pierce as if it was a Sword (see page 99)' },
  { name: 'Cudgel', damage: 3, injury: 12, load: 0, proficiency: 'Brawling' },
  { name: 'Club', damage: 4, injury: 14, load: 1, proficiency: 'Brawling' },
  { name: 'Short Sword', damage: 3, injury: 16, load: 1, proficiency: 'Swords' },
  { name: 'Sword', damage: 4, injury: 16, load: 2, proficiency: 'Swords' },
  { name: 'Long Sword', damage: 5, injury: 16, injuryTwoHanded: 18, load: 3, proficiency: 'Swords', notes: 'Can be used 1 or 2-handed' },
  { name: 'Short Spear', damage: 3, injury: 14, load: 2, proficiency: 'Spears', notes: 'Can be thrown' },
  { name: 'Spear', damage: 4, injury: 14, injuryTwoHanded: 16, load: 3, proficiency: 'Spears', notes: 'Can be 1 or 2-handed. Can be thrown' },
  { name: 'Great Spear', damage: 5, injury: 16, load: 4, proficiency: 'Spears', notes: '2-handed' },
  { name: 'Axe', damage: 5, injury: 18, load: 2, proficiency: 'Axes' },
  { name: 'Long-hafted Axe', damage: 6, injury: 18, injuryTwoHanded: 20, load: 3, proficiency: 'Axes', notes: 'Can be used 1 or 2-handed' },
  { name: 'Great Axe', damage: 7, injury: 20, load: 4, proficiency: 'Axes', notes: '2-handed' },
  { name: 'Mattock', damage: 7, injury: 18, load: 3, proficiency: 'Axes', notes: '2-handed' },
  { name: 'Bow', damage: 3, injury: 14, load: 2, proficiency: 'Bows', notes: 'Ranged weapon. 2-handed' },
  { name: 'Great Bow', damage: 4, injury: 16, load: 4, proficiency: 'Bows', notes: 'Ranged weapon. 2-handed' },
];

const CORE_ARMOUR = [
  { name: 'Leather Shirt', protection: 1, load: 3, type: 'Leather armour' },
  { name: 'Leather Corslet', protection: 2, load: 6, type: 'Leather armour' },
  { name: 'Mail-shirt', protection: 3, load: 9, type: 'Mail armour', minStandard: 'Common' },
  { name: 'Coat of Mail', protection: 4, load: 12, type: 'Mail armour', minStandard: 'Prosperous' },
  {
    name: 'Helm',
    protection: 1,
    load: 4,
    type: 'Headgear',
    notes: 'Protection adds to whatever body armour is also worn',
  },
];

const CORE_SHIELDS = [
  { name: 'Buckler', parry: 1, load: 2 },
  { name: 'Shield', parry: 2, load: 4, minStandard: 'Common' },
  { name: 'Great Shield', parry: 3, load: 6, minStandard: 'Prosperous' },
];

/** Every core gear entry, as full catalogue rows ready to seed. */
export function coreCatalogueItems() {
  const build = (kind, rows) =>
    rows.map((row) => ({ ...emptyCatalogueItem(kind), ...row, kind, source: 'core' }));
  return [
    ...build('weapon', CORE_WEAPONS),
    ...build('armour', CORE_ARMOUR),
    ...build('shield', CORE_SHIELDS),
  ];
}

export function emptyLocation() {
  return { name: '', years: [], keyInfo: '' };
}

/* --- Adversary/NPC Bank ------------------------------------------------------
 * Reusable stat-block templates for the Combat Tracker. A combatant added to a
 * fight is an independent snapshot copy of one of these — see server/lib/store.js's
 * combat functions — so nothing here is ever mutated by a fight in progress.
 */

export const ADVERSARY_CATEGORIES = [
  'NPCs',
  'Evil Men',
  'Orcs',
  'Trolls',
  'Wolves',
  'Undead',
  'Spiders',
  'Monster',
  'Unique',
  'Other',
];

export const ADVERSARY_SIZES = [
  { value: 'human', label: 'Human-sized' },
  { value: 'large', label: 'Large' },
];

/**
 * Hate (minions of the Enemy — Orcs, Trolls, Wolves, Undead, Spiders, most
 * monsters — fight to the death) or Resolve (non-monstrous "Evil Men", who
 * may yield or flee) — one shared numeric field on the entry, labelled by its
 * category.
 *
 * `NPCs` is folded in with `Evil Men` under Resolve: both are non-monstrous,
 * even though the spec only names Evil Men explicitly — a judgment call, easy
 * to revisit if an NPC entry really should fight like a monster.
 */
export function hateResolveLabel(category) {
  return category === 'Evil Men' || category === 'NPCs' ? 'Resolve' : 'Hate';
}

/** One-line nudge on Resolve entries only — not a tracked system, just a reminder. */
export function misdeedReminder(category) {
  if (hateResolveLabel(category) !== 'Resolve') return '';
  return 'Attacking this foe may be a Misdeed — was the fight provoked or unavoidable?';
}

export function emptyCombatProficiency() {
  return { name: '', rating: 0, damage: 0, injury: 0, special: '' };
}

export function emptyFellAbility() {
  return { name: '', description: '' };
}

export function emptyAdversary() {
  return {
    name: '',
    category: 'Other',
    distinctiveFeatures: '',
    size: 'human',
    attributeLevel: 0,
    endurance: 0,
    might: 0,
    hateResolve: 0,
    parry: 0,
    armour: 0,
    combatProficiencies: [],
    fellAbilities: [],
    notes: '',
    source: 'custom',
  };
}

/** Turn a catalogue row into the weapon shape `sheet.weapons` holds. */
export function catalogueItemToWeapon(item = {}) {
  const injuryTwoHanded = Number(item.injuryTwoHanded) || 0;
  return {
    equipped: false,
    name: item.name ?? '',
    type: item.type ?? '',
    damage: Number(item.damage) || 0,
    injury: Number(item.injury) || 0,
    injuryTwoHanded,
    // A weapon with two Injury ratings arrives in the hero's hands one-handed;
    // a normal weapon carries no grip at all, so no dropdown appears for it.
    grip: injuryTwoHanded ? '1h' : '',
    load: Number(item.load) || 0,
    notes: item.notes ?? '',
    proficiency: item.proficiency ?? '',
    fell: 'none',
    grievous: 'none',
    keen: 'none',
  };
}

/** Turn a catalogue row into the armour shape `sheet.armour` holds. */
export function catalogueItemToArmour(item = {}) {
  return {
    equipped: false,
    name: item.name ?? '',
    protection: Number(item.protection) || 0,
    load: Number(item.load) || 0,
    closeFitting: 'none',
    cunningMake: 'none',
  };
}

/** Turn a catalogue row into the single shield slot on the sheet. */
export function catalogueItemToShield(item = {}) {
  return {
    equipped: false,
    name: item.name ?? '',
    parry: Number(item.parry) || 0,
    load: Number(item.load) || 0,
    reinforced: 'none',
    cunningMake: 'none',
  };
}

/** Years a Location was visited: free-form tags, stored as a de-duped list. */
export function normaliseYears(input) {
  const list = Array.isArray(input)
    ? input
    : String(input ?? '')
        .split(',')
        .map((s) => s.trim());
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const year = String(raw).trim();
    if (!year || seen.has(year)) continue;
    seen.add(year);
    out.push(year);
  }
  return out;
}

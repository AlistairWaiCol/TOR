/**
 * The six base Reward qualities from the TOR 2e core rulebook that the
 * reference sheet's F / G / K / CF / CM / RI columns represent.
 *
 * Each is a "None / standard / enhanced tier" dropdown; the enhanced tier
 * differs by crafting culture for some qualities, so those are separate options
 * rather than a single "enhanced" value.
 *
 * The full Enchanted Rewards system (Biting Dart, Cleaving, Foe-slaying, ...)
 * is out of scope for v1 — use the item's Notes field.
 */

export const WEAPON_QUALITIES = {
  fell: {
    code: 'F',
    label: 'Fell',
    summary: '+2 Injury',
    options: [
      { value: 'none', label: 'None', injury: 0 },
      { value: 'standard', label: 'Fell (+2 Injury)', injury: 2 },
      { value: 'enhanced_elven', label: 'Fell, Elven-crafted (+4 Injury)', injury: 4 },
      { value: 'enhanced_numenorean', label: 'Fell, Númenórean (+2 Injury)', injury: 2 },
    ],
  },
  grievous: {
    code: 'G',
    label: 'Grievous',
    summary: '+1 Damage',
    options: [
      { value: 'none', label: 'None', damage: 0 },
      { value: 'standard', label: 'Grievous (+1 Damage)', damage: 1 },
      { value: 'enhanced_dwarven', label: 'Grievous, Dwarven-crafted (+2 Damage)', damage: 2 },
      { value: 'enhanced_numenorean', label: 'Grievous, Númenórean (+1 Damage)', damage: 1 },
    ],
  },
  keen: {
    code: 'K',
    label: 'Keen',
    summary: 'Piercing Blow on a Feat Die of 9+',
    options: [
      { value: 'none', label: 'None', piercing: 10 },
      { value: 'standard', label: 'Keen (Piercing 9+)', piercing: 9 },
      { value: 'enhanced_dwarven', label: 'Keen, Dwarven-crafted (Piercing 8+)', piercing: 8 },
      { value: 'enhanced_elven', label: 'Keen, Elven-crafted (Piercing 9+)', piercing: 9 },
    ],
  },
};

export const ARMOUR_QUALITIES = {
  closeFitting: {
    code: 'CF',
    label: 'Close-fitting',
    summary: '+2 to PROTECTION rolls',
    options: [
      { value: 'none', label: 'None', protection: 0 },
      { value: 'standard', label: 'Close-fitting (+2)', protection: 2 },
      { value: 'enhanced', label: 'Close-fitting, enhanced (+3 or Valour)', protection: 3, useValourIfHigher: true },
    ],
  },
  cunningMake: {
    code: 'CM',
    label: 'Cunning Make',
    summary: '−2 Load',
    options: [
      { value: 'none', label: 'None', load: 0 },
      { value: 'standard', label: 'Cunning Make (−2 Load)', load: 2 },
      { value: 'enhanced', label: 'Cunning Make, enhanced (−3 or Valour)', load: 3, useValourIfHigher: true },
    ],
  },
};

export const SHIELD_QUALITIES = {
  reinforced: {
    code: 'RI',
    label: 'Reinforced',
    summary: '+1 Parry',
    options: [
      { value: 'none', label: 'None', parry: 0 },
      { value: 'standard', label: 'Reinforced (+1 Parry)', parry: 1 },
      { value: 'enhanced', label: 'Reinforced, enhanced (+2 Parry)', parry: 2 },
    ],
  },
  cunningMake: ARMOUR_QUALITIES.cunningMake,
};

function optionFor(quality, value) {
  return quality.options.find((o) => o.value === value) || quality.options[0];
}

/** Effective weapon numbers after Fell / Grievous / Keen are applied. */
export function effectiveWeapon(weapon = {}, { valour = 0 } = {}) {
  const fell = optionFor(WEAPON_QUALITIES.fell, weapon.fell);
  const grievous = optionFor(WEAPON_QUALITIES.grievous, weapon.grievous);
  const keen = optionFor(WEAPON_QUALITIES.keen, weapon.keen);
  return {
    damage: (Number(weapon.damage) || 0) + (grievous.damage || 0),
    injury: (Number(weapon.injury) || 0) + (fell.injury || 0),
    load: Number(weapon.load) || 0,
    piercingThreshold: keen.piercing ?? 10,
    bonuses: { damage: grievous.damage || 0, injury: fell.injury || 0 },
    valour: Number(valour) || 0,
  };
}

function reduction(option, valour) {
  if (!option) return 0;
  const base = option.load ?? option.protection ?? 0;
  if (!base) return 0;
  return option.useValourIfHigher ? Math.max(base, Number(valour) || 0) : base;
}

/** Effective armour numbers after Close-fitting / Cunning Make are applied. */
export function effectiveArmour(armour = {}, { valour = 0 } = {}) {
  const cf = optionFor(ARMOUR_QUALITIES.closeFitting, armour.closeFitting);
  const cm = optionFor(ARMOUR_QUALITIES.cunningMake, armour.cunningMake);
  const protectionBonus = reduction(cf, valour);
  const loadReduction = reduction(cm, valour);
  return {
    protection: Number(armour.protection) || 0,
    protectionBonus,
    load: Math.max(0, (Number(armour.load) || 0) - loadReduction),
    loadReduction,
  };
}

/** Effective shield numbers after Reinforced / Cunning Make are applied. */
export function effectiveShield(shield = {}, { valour = 0 } = {}) {
  const ri = optionFor(SHIELD_QUALITIES.reinforced, shield.reinforced);
  const cm = optionFor(SHIELD_QUALITIES.cunningMake, shield.cunningMake);
  const loadReduction = reduction(cm, valour);
  return {
    parry: (Number(shield.parry) || 0) + (ri.parry || 0),
    parryBonus: ri.parry || 0,
    load: Math.max(0, (Number(shield.load) || 0) - loadReduction),
    loadReduction,
  };
}

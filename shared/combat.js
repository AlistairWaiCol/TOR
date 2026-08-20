/**
 * Combat Tracker rules tables and pure maths (TOR 2e core rulebook, combat
 * chapter). Shared by server (authoritative) and client (labels, previews) —
 * same split as shared/journey.js: this module has no side effects, and the
 * server-side driver (server/routes/combat.js) is a thin caller over it.
 */

import { featFaceValue } from './dice.js';

/** Turns open strictly in this order; same-stance players may go in any order. */
export const STANCE_ORDER = ['Forward', 'Open', 'Defensive', 'Rear'];

export const STANCE_LABELS = {
  Forward: 'Forward',
  Open: 'Open',
  Defensive: 'Defensive',
  Rear: 'Rearward',
};

/**
 * Rearward eligibility (from the stance wheel's own printed rule):
 *   - Total enemies must not exceed twice the Company's size.
 *   - Each hero in Rearward needs two OTHER heroes in a Close Combat stance
 *     (Forward/Open/Defensive).
 *
 * `rearwardCount` should include the hero being tested (i.e. "if this hero
 * joins Rearward, would the fight still qualify?").
 */
export function canEnterRearward({ totalEnemies, companySize, rearwardCount, closeCombatCount } = {}) {
  const enemies = Number(totalEnemies) || 0;
  const company = Number(companySize) || 0;
  const rearward = Math.max(0, Number(rearwardCount) || 0);
  const closeCombat = Math.max(0, Number(closeCombatCount) || 0);
  if (enemies > company * 2) return false;
  return closeCombat >= rearward * 2;
}

/**
 * Engagement limits by adversary Size — the CORRECT rulebook numbers (the
 * wheel reference image prints different, wrong ones; ignore it).
 */
export function engagementLimits(size) {
  return size === 'large'
    ? { maxAttackersOnFoe: 6, maxFoesOnHero: 2 }
    : { maxAttackersOnFoe: 3, maxFoesOnHero: 3 };
}

/**
 * Live "engaged: N" count per adversary, from the heroes' own engagement
 * picks (`{ characterId: combatantId }}`) — informational only, never
 * enforced, per spec.
 *
 * Note on scope: this app only records ONE engagement target per hero (their
 * own free pick), not a separate "which heroes is this adversary attacking"
 * relationship. So a hero's own "engaged by" count, under this simplified
 * model, is 1 if they have picked a target and 0 otherwise — several
 * adversaries piling onto one hero at once isn't automatically reflected.
 * The GM can still hand-set a hero's `opponentsEngaging` directly on their
 * character sheet's Combat panel for that case; nothing here overrides it
 * except the automatic 0/1 sync described in server/routes/combat.js.
 */
export function engagementCounts(engagements = {}) {
  const byCombatant = {};
  for (const combatantId of Object.values(engagements)) {
    if (!combatantId) continue;
    byCombatant[combatantId] = (byCombatant[combatantId] || 0) + 1;
  }
  return byCombatant;
}

/** A fresh round: stances stay put, but who has acted and the lock reset. */
export function nextRoundState(combat = {}) {
  return {
    round: (Number(combat.round) || 1) + 1,
    stanceLocked: false,
    actedPlayers: [],
  };
}

/** A combatant instance's per-round counters, reset at the start of a new round. */
export function resetCombatantForRound(combatant = {}) {
  return { ...combatant, attacksUsedThisRound: 0, hateResolveSpent: 0, weary: false };
}

/**
 * Did this attack roll score a Piercing Blow? `featFaceValue()` already
 * returns 11 for the Gandalf rune and 0 for the Eye, so a single numeric
 * comparison against the weapon's threshold (10 normally, 9 Keen, 8
 * Dwarven-crafted Keen — see `effectiveWeapon().piercingThreshold` in
 * shared/rewards.js) covers every case with no special-casing needed here.
 */
export function isPiercingBlow(featFace, piercingThreshold = 10) {
  return featFaceValue(featFace) >= (Number(piercingThreshold) || 10);
}

/**
 * Special Damage options for a Player-hero's attack, filtered by what's
 * actually in play — this is a genuinely different system from the
 * Journey/Event "Special Success" tags in shared/dice.js's
 * SPECIAL_SUCCESS_OPTIONS, not a variant of it.
 *
 * Heavy Blow: any weapon. Fend Off: any CLOSE COMBAT weapon (i.e. not Bows).
 * Pierce: Bows/Spears/Swords, plus the Dagger by name (core rulebook: "can
 * trigger Pierce as if it was a Sword" — Daggers are otherwise a Brawling
 * weapon). Shield Thrust: only with a shield equipped.
 */
export function pcSpecialDamageOptions(weapon = {}, hasShield = false) {
  const options = ['Heavy Blow'];
  const proficiency = weapon.proficiency || '';
  if (proficiency !== 'Bows') options.push('Fend Off');
  const pierceEligible = ['Bows', 'Spears', 'Swords'].includes(proficiency) || weapon.name === 'Dagger';
  if (pierceEligible) options.push('Pierce');
  if (hasShield) options.push('Shield Thrust');
  return options;
}

/**
 * Special Damage options for an adversary's attack: Heavy Blow is always
 * available, plus whatever that specific Combat Proficiency's `special`
 * free-tag field lists (e.g. "Break Shield, Seize").
 */
export function adversarySpecialDamageOptions(proficiency) {
  const extra = String(proficiency?.special ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return ['Heavy Blow', ...extra];
}

/**
 * Is it this hero's turn to act in Action Resolution right now? Mirrors
 * shared/journey.js's `promptedRollFor()` — pure, reads only state already
 * broadcast to every client, and drives the app-shell "it's your turn" nudge.
 *
 * Turns open strictly Forward -> Open -> Defensive -> Rear: a stance block
 * may not act at all until every hero in an earlier block has acted, but
 * within one block, any order is fine.
 */
export function promptedCombatActionFor({ combat, characterId } = {}) {
  if (!characterId || !combat?.active || !combat.stanceLocked) return null;
  const stances = combat.stances ?? {};
  const stance = stances[characterId];
  if (!stance) return null;
  const acted = new Set(combat.actedPlayers ?? []);
  if (acted.has(characterId)) return null;

  const myOrder = STANCE_ORDER.indexOf(stance);
  for (const [heroId, heroStance] of Object.entries(stances)) {
    if (heroId === characterId) continue;
    const order = STANCE_ORDER.indexOf(heroStance);
    if (order >= 0 && order < myOrder && !acted.has(heroId)) return null;
  }
  return { stance };
}

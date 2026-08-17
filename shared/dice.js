/**
 * The One Ring 2e dice engine.
 *
 * This module is deliberately dependency-free and side-effect-free so it can be
 * imported by the Express server, the React client, and the unit tests alike.
 * Every roll in the app goes through `rollDice()`.
 *
 * Rules implemented (TOR 2e core rulebook):
 *  1. 1 Feat Die (d12: faces 1-10, Gandalf rune, Eye of Sauron)
 *     + N Success Dice (d6: 1-3 outlined, 4-5 plain, 6 = Success icon).
 *  2. Favoured  -> roll 2 Feat Dice, keep the higher.
 *     Ill-favoured -> roll 2 Feat Dice, keep the lower.
 *     (Both at once cancel out to a normal roll.)
 *  3. Gandalf rune -> automatic success regardless of total.
 *  4. Eye of Sauron -> that die counts 0; if the hero is Miserable it is
 *     instead an automatic failure.
 *  5. Total = Feat Die value + Success Dice values. If Weary, Success Dice
 *     showing an outlined 1/2/3 count as 0.
 *  6. Compare total to the Target Number (tnBase - Attribute; tnBase is 20 by
 *     default, 18 for the short-campaign variant).
 *  7. Count Success icons (6s): 0 = success, 1 = great, 2+ = extraordinary.
 *  8. Hope spend: +1 Success Die, or +2 if the hero is Inspired.
 *  9. Special Successes are recorded as tags, not mechanically enforced.
 */

export const EYE = 'eye';
export const GANDALF = 'gandalf';

/**
 * The Gandalf rune is the highest face on the Feat Die. It is an automatic
 * success on its own, but it also needs an ordinal value for (a) picking the
 * higher/lower die on Favoured/Ill-favoured rolls and (b) Feat-Die thresholds
 * such as the Keen quality's Piercing Blow on 9+ / 10. 11 is the conventional
 * value and keeps both of those working naturally.
 */
export const GANDALF_NUMERIC = 11;

/** The 12 faces of a Feat Die, in ascending order of value. */
export const FEAT_DIE_FACES = [EYE, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, GANDALF];

export const SPECIAL_SUCCESS_OPTIONS = [
  'Cancel a Failure',
  'Score 1 Additional Success',
  'Gain Insight',
  'Go Quietly',
  'Make Haste',
  'Widen Influence',
];

export const DEFAULT_TN_BASE = 20;
export const SHORT_CAMPAIGN_TN_BASE = 18;

/** Target Number = tnBase - Attribute rating. */
export function computeTargetNumber(attribute, tnBase = DEFAULT_TN_BASE) {
  const attr = Number(attribute) || 0;
  const base = Number(tnBase) || DEFAULT_TN_BASE;
  return base - attr;
}

/** Numeric contribution of a Feat Die face to the roll total. */
export function featFaceValue(face) {
  if (face === EYE) return 0;
  if (face === GANDALF) return GANDALF_NUMERIC;
  return Number(face);
}

/** Ordinal rank used to compare Feat Die faces (Eye lowest, rune highest). */
export function featFaceRank(face) {
  if (face === EYE) return -1;
  if (face === GANDALF) return GANDALF_NUMERIC;
  return Number(face);
}

/** Favoured and Ill-favoured cancel each other out. */
export function resolveFavourState(favoured = false, illFavoured = false) {
  if (favoured && illFavoured) return 'normal';
  if (favoured) return 'favoured';
  if (illFavoured) return 'ill-favoured';
  return 'normal';
}

/**
 * How many Success Dice to roll.
 * rating + Hope bonus (+1, or +2 while Inspired) + situational modifiers,
 * never below zero (a 0-die roll is just the Feat Die).
 */
export function computeSuccessDiceCount({
  rating = 0,
  hopeSpent = false,
  inspired = false,
  extraDice = 0,
} = {}) {
  let n = Number(rating) || 0;
  if (hopeSpent) n += inspired ? 2 : 1;
  n += Number(extraDice) || 0;
  return Math.max(0, n);
}

/** Bonus Success Dice granted by spending a point of Hope. */
export function hopeBonusDice(inspired = false) {
  return inspired ? 2 : 1;
}

function successDieDetail(value, weary) {
  const v = Number(value);
  const outlined = v >= 1 && v <= 3;
  const icon = v === 6;
  const counted = weary && outlined ? 0 : v;
  return { value: v, outlined, icon, counted };
}

/**
 * Pure evaluation of an already-rolled set of dice. Separated from the random
 * roll so the unit tests can drive every branch deterministically.
 */
export function evaluateRoll({
  featFaces = [],
  successValues = [],
  targetNumber = 0,
  favoured = false,
  illFavoured = false,
  weary = false,
  miserable = false,
  bonus = 0,
} = {}) {
  const favourState = resolveFavourState(favoured, illFavoured);

  const faces = featFaces.slice();
  if (faces.length === 0) throw new Error('evaluateRoll requires at least one Feat Die face');

  let keptIndex = 0;
  if (faces.length > 1 && favourState !== 'normal') {
    keptIndex = faces.reduce((bestIdx, face, idx) => {
      const better =
        favourState === 'favoured'
          ? featFaceRank(face) > featFaceRank(faces[bestIdx])
          : featFaceRank(face) < featFaceRank(faces[bestIdx]);
      return better ? idx : bestIdx;
    }, 0);
  }

  const featDice = faces.map((face, idx) => ({
    face,
    value: featFaceValue(face),
    isGandalf: face === GANDALF,
    isEye: face === EYE,
    kept: idx === keptIndex,
  }));

  const keptFace = faces[keptIndex];
  const isGandalf = keptFace === GANDALF;
  const isEye = keptFace === EYE;
  const featValue = featFaceValue(keptFace);

  const successDice = successValues.map((v) => successDieDetail(v, weary));
  const successTotal = successDice.reduce((sum, d) => sum + d.counted, 0);
  // `bonus` is a flat modifier on the total, not a die: Useful Items' Bonus
  // column, Close-fitting's "+2 to PROTECTION rolls", ad-hoc GM modifiers.
  const flatBonus = Number(bonus) || 0;
  const total = featValue + successTotal + flatBonus;

  // The Eye is an automatic failure for a Miserable hero, and that beats
  // everything else. Otherwise the rune is an automatic success.
  const autoFail = isEye && miserable;
  const autoSuccess = !autoFail && isGandalf;

  let success;
  if (autoFail) success = false;
  else if (autoSuccess) success = true;
  else success = total >= Number(targetNumber);

  const icons = successDice.filter((d) => d.icon).length;

  let successLevel = 'failure';
  if (success) {
    if (icons >= 2) successLevel = 'extraordinary';
    else if (icons === 1) successLevel = 'great';
    else successLevel = 'success';
  }

  return {
    featDice,
    featFace: keptFace,
    featValue,
    isGandalf,
    isEye,
    successDice,
    successTotal,
    bonus: flatBonus,
    total,
    targetNumber: Number(targetNumber),
    success,
    autoSuccess,
    autoFail,
    icons,
    successLevel,
    favourState,
    weary,
    miserable,
  };
}

/** Roll a single Feat Die face using the supplied RNG. */
export function rollFeatFace(rng = Math.random) {
  return FEAT_DIE_FACES[Math.floor(rng() * FEAT_DIE_FACES.length)];
}

/** Roll a single Success Die (1-6) using the supplied RNG. */
export function rollSuccessValue(rng = Math.random) {
  return 1 + Math.floor(rng() * 6);
}

/**
 * The single entry point every roll in the app uses.
 *
 * @param {object} opts
 * @param {number} opts.rating          Skill / proficiency rating (N Success Dice).
 * @param {number} opts.targetNumber    Precomputed TN, or supply attribute + tnBase.
 * @param {number} [opts.attribute]     Attribute rating, used if targetNumber omitted.
 * @param {number} [opts.tnBase]        20, or 18 for the short-campaign variant.
 * @param {boolean} [opts.favoured]
 * @param {boolean} [opts.illFavoured]
 * @param {boolean} [opts.weary]
 * @param {boolean} [opts.miserable]
 * @param {boolean} [opts.inspired]
 * @param {boolean} [opts.hopeSpent]    Spend 1 Hope for bonus Success Dice.
 * @param {number} [opts.extraDice]     Situational Success Dice (+1 road, -1 hard terrain, ...).
 * @param {function} [rng]              Injectable RNG for tests.
 */
export function rollDice(opts = {}, rng = Math.random) {
  const {
    rating = 0,
    attribute,
    tnBase = DEFAULT_TN_BASE,
    favoured = false,
    illFavoured = false,
    weary = false,
    miserable = false,
    inspired = false,
    hopeSpent = false,
    extraDice = 0,
    bonus = 0,
  } = opts;

  const targetNumber =
    opts.targetNumber != null ? Number(opts.targetNumber) : computeTargetNumber(attribute, tnBase);

  const favourState = resolveFavourState(favoured, illFavoured);
  const featCount = favourState === 'normal' ? 1 : 2;

  const featFaces = [];
  for (let i = 0; i < featCount; i += 1) featFaces.push(rollFeatFace(rng));

  const diceCount = computeSuccessDiceCount({ rating, hopeSpent, inspired, extraDice });
  const successValues = [];
  for (let i = 0; i < diceCount; i += 1) successValues.push(rollSuccessValue(rng));

  const result = evaluateRoll({
    featFaces,
    successValues,
    targetNumber,
    favoured,
    illFavoured,
    weary,
    miserable,
    bonus,
  });

  return {
    ...result,
    rating: Number(rating) || 0,
    extraDice: Number(extraDice) || 0,
    hopeSpent: Boolean(hopeSpent),
    inspired: Boolean(inspired),
    hopeCost: hopeSpent ? 1 : 0,
    bonusDice: hopeSpent ? hopeBonusDice(inspired) : 0,
    successDiceRolled: diceCount,
    tnBase: Number(tnBase) || DEFAULT_TN_BASE,
  };
}

/** Short human-readable summary, used for Discord and the roll log. */
export function describeRoll(result, { label = 'Roll', actor = '' } = {}) {
  const who = actor ? `${actor} ` : '';
  const feat = result.isGandalf ? 'Gandalf rune' : result.isEye ? 'Eye of Sauron' : result.featValue;
  const parts = [];
  parts.push(`${who}rolls ${label} — ${result.total} vs TN ${result.targetNumber}`);
  const outcome = result.autoFail
    ? 'automatic failure (Eye while Miserable)'
    : result.autoSuccess
      ? 'automatic success (Gandalf rune)'
      : result.success
        ? 'success'
        : 'failure';
  const iconText =
    result.icons > 0
      ? `, ${result.icons} icon${result.icons === 1 ? '' : 's'} (${result.successLevel})`
      : '';
  parts.push(`${outcome}${iconText}`);
  const flags = [];
  if (result.favourState !== 'normal') flags.push(result.favourState);
  if (result.weary) flags.push('weary');
  if (result.miserable) flags.push('miserable');
  if (result.hopeSpent) flags.push(`hope spent +${result.bonusDice}d`);
  if (result.extraDice) flags.push(`${result.extraDice > 0 ? '+' : ''}${result.extraDice}d`);
  if (result.bonus) flags.push(`${result.bonus > 0 ? '+' : ''}${result.bonus} bonus`);
  const flagText = flags.length ? ` [${flags.join(', ')}]` : '';
  return `${parts[0]} — Feat ${feat}, ${parts[1]}${flagText}`;
}

/**
 * Journey / travel rules tables and pure maths (TOR 2e core rulebook, ch. 6).
 * Shared by server (authoritative) and client (labels, previews).
 */

import { EYE, GANDALF } from './dice.js';

export const SEASONS = ['Spring', 'Summer', 'Autumn', 'Winter'];

export const REGION_TYPES = [
  { key: 'border', label: 'Border Land', featMode: 'favoured' },
  { key: 'wild', label: 'Wild Land', featMode: 'normal' },
  { key: 'dark', label: 'Dark Land', featMode: 'ill-favoured' },
];

export const TRAVEL_ROLES = [
  { key: 'guide', label: 'Guide', skill: 'Travel' },
  { key: 'hunter', label: 'Hunter', skill: 'Hunting' },
  { key: 'lookout', label: 'Look-out', skill: 'Awareness' },
  { key: 'scout', label: 'Scout', skill: 'Explore' },
];

export const ROLE_KEYS = TRAVEL_ROLES.map((r) => r.key);

/** Travel phases in which no journey is underway. Everything else is "in progress". */
export const TERMINAL_TRAVEL_PHASES = ['idle', 'complete'];

/**
 * Is this hero actively travelling right now? Used by the Weary calculation,
 * where Fatigue only counts on top of Load while on the road.
 *
 * "The Company" is the same set used for event Fatigue/Shadow/Hope: the heroes
 * holding a travel role on this journey, falling back to everyone if nobody
 * has been assigned a role.
 */
export function isCharacterTravelling({ travel, journey, characterId } = {}) {
  if (!travel?.journeyId) return false;
  if (TERMINAL_TRAVEL_PHASES.includes(travel.phase)) return false;
  const roles = journey?.roles ?? {};
  if (Object.keys(roles).length === 0) return true;
  return Boolean(roles[characterId]);
}

/**
 * Which roll, if any, the travel engine is currently waiting on from ONE named
 * hero — the question the "your turn to roll" prompt asks.
 *
 * Reads only state that is already broadcast to every client: the travel
 * phase, the pending event, and the journey's role snapshot. Returns null when
 * it is nobody's turn, when it is somebody else's, or when no hero is selected.
 *
 * Pure, and here rather than in the component, so the branch table is testable.
 */
export function promptedRollFor({ travel, journey, characterId } = {}) {
  if (!characterId) return null;
  const phase = travel?.phase;
  if (!phase || TERMINAL_TRAVEL_PHASES.includes(phase)) return null;

  // Marching Test — the Guide's own TRAVEL roll.
  if (phase === 'awaiting_marching_test') {
    const roles = journey?.roles ?? {};
    if (roles[characterId] !== 'guide') return null;
    return { kind: 'marching_test', roleKey: 'guide', skill: roleSkill('guide') };
  }

  // Event Resolution step 3 — the targeted hero rolls for themselves.
  if (phase === 'awaiting_resolution') {
    const pending = travel?.state?.pendingEvent;
    if (!pending || pending.targetCharacterId !== characterId) return null;
    return {
      kind: 'resolution',
      roleKey: pending.roleKey,
      skill: pending.skill || roleSkill(pending.roleKey),
      eventId: pending.eventId ?? null,
    };
  }

  return null;
}

/** Feat Die variant rolled to determine an event, by the event hex's region. */
export function regionFeatMode(regionKey) {
  const region = REGION_TYPES.find((r) => r.key === regionKey);
  return region ? region.featMode : 'normal';
}

export function regionLabel(regionKey) {
  const region = REGION_TYPES.find((r) => r.key === regionKey);
  return region ? region.label : 'Wild Land';
}

/**
 * Event Resolution step 1 — Select Target.
 * 1 Success Die, numeric only (the icon on a 6 is ignored here).
 */
export function selectTargetRole(d6) {
  const v = Number(d6);
  if (v <= 2) return 'scout';
  if (v <= 4) return 'lookout';
  return 'hunter';
}

export function roleSkill(roleKey) {
  const role = TRAVEL_ROLES.find((r) => r.key === roleKey);
  return role ? role.skill : 'Travel';
}

export function roleLabel(roleKey) {
  const role = TRAVEL_ROLES.find((r) => r.key === roleKey);
  return role ? role.label : roleKey;
}

/**
 * Journey Events Table. `onSuccess: true` means the listed consequence only
 * applies when the targeted hero's resolution roll SUCCEEDS; otherwise the
 * consequence applies on failure. Company Fatigue is gained regardless of the
 * roll's outcome (except Chance-meeting, where success cancels it).
 */
export const JOURNEY_EVENTS = [
  {
    key: 'terrible_misfortune',
    name: 'Terrible Misfortune',
    match: EYE,
    consequence: 'Target is Wounded',
    onSuccess: false,
    fatigue: 3,
    effects: { woundTarget: true },
  },
  {
    key: 'despair',
    name: 'Despair',
    match: [1, 1],
    consequence: 'Everyone gains 1 Shadow point (Dread)',
    onSuccess: false,
    fatigue: 2,
    effects: { companyShadow: 1 },
  },
  {
    key: 'ill_choices',
    name: 'Ill Choices',
    match: [2, 3],
    consequence: 'Target gains 1 Shadow point (Dread)',
    onSuccess: false,
    fatigue: 2,
    effects: { targetShadow: 1 },
  },
  {
    key: 'mishap',
    name: 'Mishap',
    match: [4, 7],
    consequence: '+1 day to journey length, target gains 1 extra Fatigue',
    onSuccess: false,
    fatigue: 2,
    effects: { dayAdjustment: 1, targetFatigue: 1 },
  },
  {
    key: 'short_cut',
    name: 'Short Cut',
    match: [8, 9],
    consequence: 'Journey length −1 day',
    onSuccess: true,
    fatigue: 1,
    effects: { dayAdjustment: -1 },
  },
  {
    key: 'chance_meeting',
    name: 'Chance-meeting',
    match: [10, 10],
    consequence: 'No Fatigue; the GM improvises a favourable encounter',
    onSuccess: true,
    fatigue: 1,
    effects: { cancelFatigueOnSuccess: true },
  },
  {
    key: 'joyful_sight',
    name: 'Joyful Sight',
    match: GANDALF,
    consequence: 'Everyone regains 1 Hope',
    onSuccess: true,
    fatigue: 0,
    fatigueLabel: '—',
    effects: { companyHope: 1 },
  },
];

/** Look an event up from a Feat Die face (number | 'eye' | 'gandalf'). */
export function lookupJourneyEvent(featFace) {
  for (const event of JOURNEY_EVENTS) {
    if (Array.isArray(event.match)) {
      const v = Number(featFace);
      if (!Number.isNaN(v) && v >= event.match[0] && v <= event.match[1]) return event;
    } else if (event.match === featFace) {
      return event;
    }
  }
  // Should be unreachable — the table covers every face.
  return JOURNEY_EVENTS.find((e) => e.key === 'mishap');
}

/**
 * Marching Test outcome -> distance in hexes to the next event.
 * Success: 3 hexes, +1 per Success icon.
 * Failure: 2 hexes in Spring/Summer, 1 hex in Autumn/Winter.
 */
export function marchingTestDistance({ success, icons = 0, season = 'Summer' }) {
  if (success) return 3 + (Number(icons) || 0);
  const warm = season === 'Summer' || season === 'Spring';
  return warm ? 2 : 1;
}

/**
 * Situational Success Dice for an Event Resolution roll.
 * Hard terrain -1, road +1. A hex can be both; they intentionally cancel.
 */
export function terrainDiceModifier(hex = {}) {
  let mod = 0;
  if (hex.hardTerrain) mod -= 1;
  if (hex.road) mod += 1;
  return mod;
}

/**
 * Journey length in days (§6g).
 *
 *   base   = hexes traversed (Forced March legs count 1 day per 2 hexes)
 *   + 1 day per hard-terrain hex on the path
 *   + Mishap (+1) / Short Cut (-1) adjustments accumulated en route
 *   then, if the whole Company travelled mounted, halve the total (round up).
 *
 * Forced March also costs each Player-hero 1 extra Fatigue per forced-march day.
 */
export function computeJourneyDays({
  hexesTraversed = 0,
  hardTerrainHexes = 0,
  dayAdjustments = 0,
  forcedMarch = false,
  mounted = false,
} = {}) {
  const hexes = Math.max(0, Number(hexesTraversed) || 0);
  const marchDays = forcedMarch ? Math.ceil(hexes / 2) : hexes;
  const beforeMount = Math.max(
    0,
    marchDays + (Number(hardTerrainHexes) || 0) + (Number(dayAdjustments) || 0),
  );
  const total = mounted ? Math.ceil(beforeMount / 2) : beforeMount;
  return {
    marchDays,
    hardTerrainDays: Number(hardTerrainHexes) || 0,
    dayAdjustments: Number(dayAdjustments) || 0,
    beforeMount,
    totalDays: total,
    forcedMarchFatigue: forcedMarch ? marchDays : 0,
    mounted: Boolean(mounted),
    forcedMarch: Boolean(forcedMarch),
  };
}

/**
 * The day-by-day tick sequence for ONE leg of a journey, for the live travel
 * animation (the box that counts "Day 1 … Day 4 — Event" while the party token
 * walks the hexes).
 *
 * `computeJourneyDays()` above is the authoritative maths, but it only produces
 * AGGREGATES — total hexes, total hard-terrain hexes, one forced-march flag. It
 * cannot say *when* each day is spent, which is the whole point of an
 * animation. This is that per-hex breakdown, and the tests assert its day total
 * against `computeJourneyDays()` for the same inputs so the two cannot drift.
 *
 * Pacing, from the brief and §6g:
 *   normal hex        move + 1 day
 *   hard-terrain hex  move + 1 day, then a SECOND day with no movement
 *   Forced March      1 day per 2 hexes: move (no day), then move + 1 day
 *
 * **Judgment call — a hard-terrain hex inside a Forced March pair.** Neither
 * the rulebook nor the brief says which rule wins. The two are applied
 * independently and additively: the pair still increments once for its two
 * hexes of movement, and the hard-terrain hex still adds its own extra day on
 * top. That is what `computeJourneyDays()` already does with the aggregates
 * (`ceil(hexes / 2) + hardTerrainHexes`), so any other reading would make the
 * live counter disagree with the logged total.
 *
 * Deliberately NOT modelled here: the mounted halving. That is a final-total
 * adjustment applied once at the end of the journey, so on a mounted journey
 * the live counter legitimately runs ahead of the number that gets logged.
 *
 * A journey is animated one leg at a time, but the day counter and the Forced
 * March pairing are both JOURNEY-wide: `startDay` carries the running total in,
 * and `startHexIndex` carries how many hexes have already been walked, so a
 * pair is never restarted just because a leg boundary fell inside it. `finalLeg`
 * says this leg ends at the destination, which is what lets a lone trailing hex
 * still cost its day (`ceil(n / 2)`, not `floor(n / 2)`).
 *
 * @param {object} opts
 * @param {Array<{col:number,row:number}>} opts.path hexes ENTERED this leg, in order
 * @param {(hex: {col:number,row:number}, index: number) => boolean} [opts.isHardTerrain]
 *        `index` is the journey-wide hex index, not the index within this leg
 * @param {boolean} [opts.forcedMarch]
 * @param {number} [opts.startDay] the journey-wide day count so far
 * @param {number} [opts.startHexIndex] hexes already traversed on this journey
 * @param {boolean} [opts.finalLeg] this leg reaches the destination
 * @returns {Array<{hex: object, day: number, moved: boolean, hardTerrain: boolean}>}
 */
export function journeyTickSequence({
  path = [],
  isHardTerrain = () => false,
  forcedMarch = false,
  startDay = 0,
  startHexIndex = 0,
  finalLeg = true,
} = {}) {
  const steps = [];
  let day = Math.max(0, Number(startDay) || 0);
  const offset = Math.max(0, Number(startHexIndex) || 0);

  path.forEach((hex, i) => {
    const index = offset + i; // journey-wide, 0-based
    const hard = Boolean(isHardTerrain(hex, index));
    // Forced March spends its day on the SECOND hex of each pair — and on the
    // journey's final hex if that leaves a pair half-finished, which is what
    // makes the total ceil(n / 2) rather than floor(n / 2).
    const lastOfJourney = finalLeg && i === path.length - 1;
    const spendsMarchDay = !forcedMarch || index % 2 === 1 || lastOfJourney;
    if (spendsMarchDay) day += 1;
    steps.push({ hex, day, moved: true, hardTerrain: hard });
    if (hard) {
      day += 1;
      steps.push({ hex, day, moved: false, hardTerrain: true });
    }
  });

  return steps;
}

/**
 * End-of-journey Fatigue relief for one hero (§6g).
 * Mount Vigour reduces accumulated Fatigue first, then a TRAVEL roll reduces it
 * further (success = -1, and a further -1 per Success icon).
 */
export function computeFatigueRelief({
  fatigue = 0,
  mountVigour = 0,
  travelRoll = null, // { success, icons } or null if not rolled
} = {}) {
  const start = Math.max(0, Number(fatigue) || 0);
  const vigour = Math.max(0, Number(mountVigour) || 0);
  const afterMount = Math.max(0, start - vigour);
  let rollReduction = 0;
  if (travelRoll && travelRoll.success) {
    rollReduction = 1 + (Number(travelRoll.icons) || 0);
  }
  const finalFatigue = Math.max(0, afterMount - rollReduction);
  return {
    startingFatigue: start,
    mountReduction: Math.min(start, vigour),
    afterMount,
    rollReduction: Math.min(afterMount, rollReduction),
    finalFatigue,
  };
}

/**
 * Role assignment validity (§6c): exactly one Guide, all four roles covered,
 * doubling up allowed on everything except Guide.
 * @param {object} assignments map of characterId -> roleKey
 */
export function validateRoleAssignments(assignments = {}) {
  const counts = Object.fromEntries(ROLE_KEYS.map((k) => [k, 0]));
  for (const role of Object.values(assignments)) {
    if (counts[role] != null) counts[role] += 1;
  }
  const errors = [];
  if (counts.guide !== 1) {
    errors.push(
      counts.guide === 0 ? 'Exactly one Guide is required.' : 'Only one hero may be the Guide.',
    );
  }
  const missing = ROLE_KEYS.filter((k) => counts[k] === 0).map(roleLabel);
  if (missing.length) errors.push(`No hero assigned to: ${missing.join(', ')}.`);
  return { valid: errors.length === 0, errors, counts };
}

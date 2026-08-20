/**
 * The journey / travel sequence (spec §6d, §6g), implemented as an explicit
 * server-side state machine so every connected client sees the same step.
 *
 * Phases:
 *   idle                    - no journey underway
 *   awaiting_marching_test  - Guide's TRAVEL roll (or a GM manual event placement)
 *   awaiting_target         - Event Resolution step 1, Select Target (1 Success Die)
 *   awaiting_target_choice  - nobody holds the rolled role; flagged for the GM
 *   awaiting_event_die      - Event Resolution step 2, Determine Event (Feat Die by region)
 *   awaiting_resolution     - Event Resolution step 3, the targeted player's own roll
 *   journey_end             - destination reached; ready for the day/Fatigue maths
 *   awaiting_fatigue_relief - mounts applied; heroes may roll TRAVEL to shed Fatigue
 *   complete                - journey closed out
 */

import {
  EYE,
  GANDALF,
  evaluateRoll,
  featFaceRank,
  rollFeatFace,
  rollSuccessValue,
} from '../../shared/dice.js';
import {
  JOURNEY_EVENTS,
  computeFatigueRelief,
  computeJourneyDays,
  lookupJourneyEvent,
  marchingTestDistance,
  regionFeatMode,
  regionLabel,
  roleLabel,
  roleSkill,
  selectTargetRole,
  terrainDiceModifier,
  validateRoleAssignments,
} from '../../shared/journey.js';
import { hexKey } from '../../shared/hexMath.js';
import { performRoll } from './rollService.js';
import { boldName, formatMessage, postToDiscord } from './discord.js';
import { broadcastSnapshot } from '../realtime.js';
import {
  adjustCharacterPool,
  createJourney,
  createJourneyEvent,
  createRoll,
  getActiveCalibration,
  getCampaign,
  getCharacter,
  getJourney,
  getJourneyEvent,
  getParty,
  getTravelState,
  hexMap,
  listCharacters,
  listJourneyEvents,
  nextEventSeq,
  replaceCharacterSheet,
  setTravelState,
  updateJourney,
  updateJourneyEvent,
  updateParty,
} from './store.js';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

function defaultHexTags(col, row) {
  return {
    col,
    row,
    regionType: 'wild',
    hardTerrain: false,
    road: false,
    perilous: false,
    perilRating: 0,
    label: '',
  };
}

async function hexLookup() {
  const calibration = await getActiveCalibration();
  const map = calibration ? await hexMap(calibration.id) : new Map();
  return (col, row) => map.get(hexKey(col, row)) ?? defaultHexTags(col, row);
}

/** Heroes travelling in the Company = those with a travel role assigned. */
async function companyMembers(roles) {
  const all = await listCharacters();
  const ids = new Set(Object.keys(roles || {}));
  const members = all.filter((c) => ids.has(c.id));
  return members.length ? members : all;
}

function charactersWithRole(roles, roleKey) {
  return Object.entries(roles || {})
    .filter(([, r]) => r === roleKey)
    .map(([id]) => id);
}

/* --- reading the current step ---------------------------------------------- */

export async function travelSnapshot() {
  const travel = await getTravelState();
  const journey = travel.journeyId ? await getJourney(travel.journeyId) : null;
  const events = journey ? await listJourneyEvents(journey.id) : [];
  return { travel, journey, events };
}

async function saveState(patch) {
  const current = await getTravelState();
  const next = { ...current.state, ...patch.state };
  return setTravelState({
    journeyId: patch.journeyId !== undefined ? patch.journeyId : current.journeyId,
    phase: patch.phase !== undefined ? patch.phase : current.phase,
    state: next,
  });
}

async function requireActive() {
  const travel = await getTravelState();
  if (!travel.journeyId) fail('No journey is underway.');
  const journey = await getJourney(travel.journeyId);
  if (!journey) fail('Journey record missing.');
  return { travel, journey };
}

function hexesRemaining(journey) {
  return Math.max(0, journey.route.length - 1 - journey.routeIndex);
}

/* --- starting a journey ----------------------------------------------------- */

export async function startJourney({ fromLabel, toLabel, title } = {}) {
  const existing = await getTravelState();
  if (existing.journeyId && existing.phase !== 'complete' && existing.phase !== 'idle') {
    fail('A journey is already underway — close it out first.');
  }
  const [party, campaign] = await Promise.all([getParty(), getCampaign()]);
  const route = party.route || [];
  if (route.length < 2) fail('Draw a route of at least two hexes before starting a journey.');

  const roleCheck = validateRoleAssignments(party.roles);
  if (!roleCheck.valid) fail(`Roles are not ready: ${roleCheck.errors.join(' ')}`);

  const lookup = await hexLookup();
  const first = route[0];
  const last = route[route.length - 1];

  const journey = await createJourney({
    title: title || '',
    year: campaign.year,
    season: campaign.season,
    fromLabel: fromLabel || lookup(first.col, first.row).label || hexKey(first.col, first.row),
    toLabel: toLabel || lookup(last.col, last.row).label || hexKey(last.col, last.row),
    fromHex: hexKey(first.col, first.row),
    toHex: hexKey(last.col, last.row),
    route,
    drawnPath: party.drawnPath || [],
    mounted: party.mounted,
    forcedMarch: party.forcedMarch,
    roles: party.roles,
  });

  await updateParty({
    currentCol: first.col,
    currentRow: first.row,
    routeLocked: true,
  });

  await setTravelState({
    journeyId: journey.id,
    phase: 'awaiting_marching_test',
    state: { eventsRemainingHere: 0, manualPin: null, pendingEvent: null, fatigueRelief: {} },
  });

  await postToDiscord(
    formatMessage(
      '🧭',
      `Journey begins — ${journey.fromLabel} → ${journey.toLabel} (${campaign.season} ${campaign.year}, ${route.length - 1} hexes)` +
        `${journey.mounted ? ', mounted' : ''}${journey.forcedMarch ? ', forced march' : ''}.`,
    ),
  );
  await broadcastSnapshot();
  return travelSnapshot();
}

/* --- GM manual event placement --------------------------------------------- */

/** Pin the next event's hex; the following Marching Test uses it for distance. */
export async function pinEventHex({ col, row }) {
  const { journey } = await requireActive();
  const idx = journey.route.findIndex((h) => h.col === col && h.row === row);
  if (idx < 0) fail('That hex is not on the current route.');
  if (idx <= journey.routeIndex) fail('Pin a hex further along the route than the party.');
  await saveState({ state: { manualPin: { col, row, index: idx } } });
  await broadcastSnapshot();
  return travelSnapshot();
}

export async function clearPin() {
  await requireActive();
  await saveState({ state: { manualPin: null } });
  await broadcastSnapshot();
  return travelSnapshot();
}

/* --- Marching Test ---------------------------------------------------------- */

/**
 * Move the party along the route, accumulating traversal counters.
 *
 * §6d-i: if the leg would place the next event inside *or crossing* a Perilous
 * Area, "the Company stops as soon as it enters the area" — so by default we
 * halt on the FIRST perilous hex encountered, not at the rolled distance. That
 * also takes precedence over reaching the destination.
 */
async function advanceAlongRoute(journey, distance, lookup, { stopAtPerilous = true } = {}) {
  const remaining = hexesRemaining(journey);
  const wanted = Math.min(distance, remaining);
  let capped = wanted;
  let stoppedAtPerilous = false;

  if (stopAtPerilous) {
    for (let i = 1; i <= wanted; i += 1) {
      const step = journey.route[journey.routeIndex + i];
      if (lookup(step.col, step.row).perilous) {
        capped = i;
        stoppedAtPerilous = true;
        break;
      }
    }
  }

  let hardAdded = 0;
  for (let i = 1; i <= capped; i += 1) {
    const step = journey.route[journey.routeIndex + i];
    if (lookup(step.col, step.row).hardTerrain) hardAdded += 1;
  }

  const newIndex = journey.routeIndex + capped;
  const updated = await updateJourney(journey.id, {
    routeIndex: newIndex,
    hexesTraversed: journey.hexesTraversed + capped,
    hardTerrainHexes: journey.hardTerrainHexes + hardAdded,
  });
  const at = updated.route[newIndex];
  await updateParty({ currentCol: at.col, currentRow: at.row });
  return {
    journey: updated,
    hex: at,
    hexesMoved: capped,
    stoppedAtPerilous,
    reachedDestination: !stoppedAtPerilous && distance >= remaining,
  };
}

export async function rollMarchingTest({ hopeSpent = false } = {}) {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'awaiting_marching_test') {
    fail(`Not expecting a Marching Test right now (phase: ${travel.phase}).`);
  }
  const campaign = await getCampaign();
  const lookup = await hexLookup();

  const guideIds = charactersWithRole(journey.roles, 'guide');
  if (!guideIds.length) fail('No Guide assigned — assign exactly one Guide first.');
  const guide = await getCharacter(guideIds[0]);
  if (!guide) fail('The assigned Guide no longer exists.');

  const { result, roll } = await performRoll({
    characterId: guide.id,
    skill: 'Travel',
    kind: 'marching_test',
    label: 'TRAVEL (Marching Test)',
    journeyId: journey.id,
    hopeSpent,
  });

  const pin = travel.state.manualPin;
  const autoDistance = marchingTestDistance({
    success: result.success,
    icons: result.icons,
    season: campaign.season,
  });
  const distance = pin ? pin.index - journey.routeIndex : autoDistance;
  const remaining = hexesRemaining(journey);

  const moved = await advanceAlongRoute(journey, distance, lookup);

  const baseConsequence = pin
    ? `GM placed the event ${distance} hex${distance === 1 ? '' : 'es'} along the route.`
    : `Next event ${autoDistance} hex${autoDistance === 1 ? '' : 'es'} away (${campaign.season}).`;

  await createJourneyEvent({
    journeyId: journey.id,
    seq: await nextEventSeq(journey.id),
    kind: 'marching_test',
    col: moved.hex.col,
    row: moved.hex.row,
    outcome: result.success ? 'success' : 'failure',
    consequence: moved.stoppedAtPerilous
      ? `${baseConsequence} Stopped after ${moved.hexesMoved} on entering a Perilous Area.`
      : baseConsequence,
    detail: {
      distance,
      autoDistance,
      hexesMoved: moved.hexesMoved,
      stoppedAtPerilous: moved.stoppedAtPerilous,
      manualPin: Boolean(pin),
      season: campaign.season,
      icons: result.icons,
      rollId: roll.id,
      hexesRemainingBefore: remaining,
    },
  });

  await postToDiscord(
    formatMessage(
      '🗺️',
      `Marching Test → next event ${distance} hex${distance === 1 ? '' : 'es'} away` +
        `${pin ? ' (GM-placed)' : ''}` +
        `${moved.stoppedAtPerilous ? `, but the Company halts after ${moved.hexesMoved} on entering a Perilous Area` : ''}. ` +
        `${Math.max(0, remaining - moved.hexesMoved)} hexes left to ${journey.toLabel}.`,
    ),
  );

  if (moved.reachedDestination) {
    await saveState({ phase: 'journey_end', state: { manualPin: null, pendingEvent: null } });
    await postToDiscord(
      formatMessage('🏁', `The Company reaches ${journey.toLabel}. Time to tally the journey.`),
    );
    await broadcastSnapshot();
    return travelSnapshot();
  }

  const tags = lookup(moved.hex.col, moved.hex.row);
  const eventsHere = tags.perilous ? Math.max(1, tags.perilRating) : 1;
  if (tags.perilous) {
    await postToDiscord(
      formatMessage(
        '☠️',
        `The Company enters a Perilous Area${tags.label ? ` (${tags.label})` : ''} — ${eventsHere} event${eventsHere === 1 ? '' : 's'} back-to-back, no Marching Tests in between.`,
      ),
    );
  }

  await saveState({
    phase: 'awaiting_target',
    state: {
      manualPin: null,
      eventsRemainingHere: eventsHere,
      perilousArea: Boolean(tags.perilous),
      currentHex: tags,
      pendingEvent: null,
    },
  });
  await broadcastSnapshot();
  return travelSnapshot();
}

/**
 * GM override that skips the Marching Test entirely and drops the event on a
 * chosen hex ("I want this event exactly here").
 */
export async function placeEventDirectly({ col, row }) {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'awaiting_marching_test') {
    fail(`Cannot place an event during phase ${travel.phase}.`);
  }
  const idx = journey.route.findIndex((h) => h.col === col && h.row === row);
  if (idx < 0) fail('That hex is not on the current route.');
  if (idx <= journey.routeIndex) fail('Place the event further along the route than the party.');

  const lookup = await hexLookup();
  const distance = idx - journey.routeIndex;
  // An explicit GM placement is an override by definition, so it is NOT halted
  // by a Perilous Area on the way — the GM said "the event happens here".
  const moved = await advanceAlongRoute(journey, distance, lookup, { stopAtPerilous: false });
  const tags = lookup(moved.hex.col, moved.hex.row);
  const eventsHere = tags.perilous ? Math.max(1, tags.perilRating) : 1;

  await createJourneyEvent({
    journeyId: journey.id,
    seq: await nextEventSeq(journey.id),
    kind: 'marching_test',
    col: moved.hex.col,
    row: moved.hex.row,
    outcome: 'gm-placed',
    consequence: `GM placed the event ${distance} hex${distance === 1 ? '' : 'es'} along the route (no Marching Test).`,
    detail: { distance, manualPin: true, skippedMarchingTest: true },
  });

  await postToDiscord(
    formatMessage('📍', `GM places the next event ${distance} hex${distance === 1 ? '' : 'es'} ahead — no Marching Test.`),
  );

  if (moved.reachedDestination) {
    await saveState({ phase: 'journey_end', state: { manualPin: null } });
  } else {
    await saveState({
      phase: 'awaiting_target',
      state: {
        manualPin: null,
        eventsRemainingHere: eventsHere,
        perilousArea: Boolean(tags.perilous),
        currentHex: tags,
        pendingEvent: null,
      },
    });
  }
  await broadcastSnapshot();
  return travelSnapshot();
}

/* --- Event Resolution step 1: Select Target -------------------------------- */

export async function rollSelectTarget() {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'awaiting_target') {
    fail(`Not expecting a Select Target roll right now (phase: ${travel.phase}).`);
  }
  const d6 = rollSuccessValue();
  const roleKey = selectTargetRole(d6);
  const skill = roleSkill(roleKey);
  const hex = travel.state.currentHex ?? defaultHexTags(0, 0);

  const holders = charactersWithRole(journey.roles, roleKey);
  const characters = await listCharacters();
  const nameOf = (id) => characters.find((c) => c.id === id)?.name ?? 'unknown';

  const event = await createJourneyEvent({
    journeyId: journey.id,
    seq: await nextEventSeq(journey.id),
    kind: 'event',
    col: hex.col,
    row: hex.row,
    regionType: hex.regionType,
    hardTerrain: hex.hardTerrain,
    road: hex.road,
    perilous: hex.perilous,
    targetRole: roleKey,
    targetSkill: skill,
    outcome: 'pending',
    detail: { selectTargetDie: d6, hexLabel: hex.label, perilRating: hex.perilRating },
  });

  await createRoll({
    journeyId: journey.id,
    journeyEventId: event.id,
    kind: 'select_target',
    label: 'Select Target',
    result: { total: d6, targetNumber: 0, success: true, icons: 0, successDice: [{ value: d6 }] },
  });

  // Exactly one holder -> auto-target. None -> flag for the GM. Several -> the
  // GM picks which of them makes the roll (the rulebook targets "the Scouts",
  // but only one hero rolls).
  if (holders.length === 1) {
    await updateJourneyEvent(event.id, { targetCharacterId: holders[0] });
    await postToDiscord(
      formatMessage(
        '🎯',
        `Select Target: ${d6} → ${roleLabel(roleKey)} (${skill.toUpperCase()}) — ${boldName(nameOf(holders[0]))}.`,
      ),
    );
    await saveState({
      phase: 'awaiting_event_die',
      state: { pendingEvent: { eventId: event.id, roleKey, skill, targetCharacterId: holders[0] } },
    });
  } else {
    await postToDiscord(
      formatMessage(
        '🎯',
        holders.length === 0
          ? `Select Target: ${d6} → ${roleLabel(roleKey)} (${skill.toUpperCase()}) — nobody holds that role, GM to decide.`
          : `Select Target: ${d6} → ${roleLabel(roleKey)} (${skill.toUpperCase()}) — ${holders.length} heroes hold that role, GM to pick.`,
      ),
    );
    await saveState({
      phase: 'awaiting_target_choice',
      state: {
        pendingEvent: { eventId: event.id, roleKey, skill, targetCharacterId: null, candidates: holders },
      },
    });
  }
  await broadcastSnapshot();
  return travelSnapshot();
}

/** GM resolves an empty or ambiguous role by naming the targeted hero. */
export async function assignEventTarget({ characterId }) {
  const { travel } = await requireActive();
  if (travel.phase !== 'awaiting_target_choice') fail('No target choice is pending.');
  const pending = travel.state.pendingEvent;
  if (!pending) fail('No pending event.');
  const character = await getCharacter(characterId);
  if (!character) fail('Character not found.', 404);

  await updateJourneyEvent(pending.eventId, { targetCharacterId: characterId });
  await postToDiscord(
    formatMessage('🎯', `GM targets ${boldName(character.name)} (${pending.skill.toUpperCase()}).`),
  );
  await saveState({
    phase: 'awaiting_event_die',
    state: { pendingEvent: { ...pending, targetCharacterId: characterId } },
  });
  await broadcastSnapshot();
  return travelSnapshot();
}

/* --- Event Resolution step 2: Determine Event ------------------------------ */

export async function rollDetermineEvent() {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'awaiting_event_die') {
    fail(`Not expecting a Determine Event roll right now (phase: ${travel.phase}).`);
  }
  const pending = travel.state.pendingEvent;
  const hex = travel.state.currentHex ?? defaultHexTags(0, 0);
  const mode = regionFeatMode(hex.regionType);

  const faces = mode === 'normal' ? [rollFeatFace()] : [rollFeatFace(), rollFeatFace()];
  let kept = faces[0];
  if (faces.length > 1) {
    kept = faces.reduce((best, f) =>
      mode === 'favoured'
        ? featFaceRank(f) > featFaceRank(best)
          ? f
          : best
        : featFaceRank(f) < featFaceRank(best)
          ? f
          : best,
    );
  }

  const event = lookupJourneyEvent(kept);
  const faceLabel = kept === GANDALF ? 'Gandalf rune' : kept === EYE ? 'Eye of Sauron' : String(kept);

  await updateJourneyEvent(pending.eventId, {
    featFace: String(kept),
    eventKey: event.key,
    eventName: event.name,
    consequence: event.consequence,
  });

  await createRoll({
    journeyId: journey.id,
    journeyEventId: pending.eventId,
    kind: 'determine_event',
    label: `Determine Event (${regionLabel(hex.regionType)})`,
    result: {
      total: 0,
      targetNumber: 0,
      success: true,
      icons: 0,
      featDice: faces.map((f) => ({ face: f, kept: f === kept })),
      featFace: kept,
      mode,
      eventKey: event.key,
      eventName: event.name,
    },
  });

  await postToDiscord(
    formatMessage(
      '🎲',
      `Determine Event — ${regionLabel(hex.regionType)} (${mode} Feat Die): ${faceLabel} → **${event.name}**. ` +
        `${event.consequence} (Company Fatigue ${event.fatigueLabel ?? event.fatigue}).`,
    ),
  );

  await saveState({
    phase: 'awaiting_resolution',
    state: { pendingEvent: { ...pending, featFace: kept, eventKey: event.key } },
  });
  await broadcastSnapshot();
  return travelSnapshot();
}

/* --- Event Resolution step 3: the targeted player's roll ------------------- */

async function applyEventEffects({ event, applies, targetId, company, journey, fatigue }) {
  const applied = [];

  if (fatigue > 0) {
    for (const member of company) {
      await adjustCharacterPool(member.id, 'strength', 'fatigue', fatigue);
    }
    applied.push(`Company +${fatigue} Fatigue each`);
  }

  if (!applies) return { applied, dayAdjustment: 0 };

  const fx = event.effects || {};
  let dayAdjustment = 0;

  if (fx.woundTarget && targetId) {
    const target = await getCharacter(targetId);
    if (target) {
      target.sheet.conditions.wounded = true;
      await replaceCharacterSheet(targetId, target.sheet);
      applied.push(`${target.name} is Wounded`);
    }
  }
  if (fx.companyShadow) {
    for (const member of company) {
      await adjustCharacterPool(member.id, 'heart', 'shadow', fx.companyShadow);
    }
    applied.push(`Company +${fx.companyShadow} Shadow (Dread)`);
  }
  if (fx.targetShadow && targetId) {
    await adjustCharacterPool(targetId, 'heart', 'shadow', fx.targetShadow);
    const target = await getCharacter(targetId);
    applied.push(`${target?.name ?? 'Target'} +${fx.targetShadow} Shadow (Dread)`);
  }
  if (fx.targetFatigue && targetId) {
    await adjustCharacterPool(targetId, 'strength', 'fatigue', fx.targetFatigue);
    const target = await getCharacter(targetId);
    applied.push(`${target?.name ?? 'Target'} +${fx.targetFatigue} Fatigue`);
  }
  if (fx.companyHope) {
    for (const member of company) {
      const max = member.sheet.attributes.heart.hopeMax;
      const current = member.sheet.attributes.heart.hope;
      const room = max > 0 ? Math.max(0, max - current) : fx.companyHope;
      const gain = Math.min(fx.companyHope, room);
      if (gain > 0) await adjustCharacterPool(member.id, 'heart', 'hope', gain);
    }
    applied.push(`Company regains ${fx.companyHope} Hope`);
  }
  if (fx.dayAdjustment) {
    dayAdjustment = fx.dayAdjustment;
    await updateJourney(journey.id, { dayAdjustments: journey.dayAdjustments + dayAdjustment });
    applied.push(`Journey ${dayAdjustment > 0 ? '+' : ''}${dayAdjustment} day`);
  }

  return { applied, dayAdjustment };
}

export async function resolveEvent({ hopeSpent = false, note = '', characterId } = {}) {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'awaiting_resolution') {
    fail(`Not expecting a resolution roll right now (phase: ${travel.phase}).`);
  }
  const pending = travel.state.pendingEvent;
  const hex = travel.state.currentHex ?? defaultHexTags(0, 0);
  const targetId = characterId || pending.targetCharacterId;
  if (!targetId) fail('No targeted hero for this event.');

  const eventRow = await getJourneyEvent(pending.eventId);
  const eventDef =
    JOURNEY_EVENTS.find((e) => e.key === (pending.eventKey || eventRow.eventKey)) ??
    lookupJourneyEvent(pending.featFace);

  const extraDice = terrainDiceModifier(hex);
  const terrainNote = [];
  if (hex.hardTerrain) terrainNote.push('hard terrain −1d');
  if (hex.road) terrainNote.push('road +1d');

  const { result, roll } = await performRoll({
    characterId: targetId,
    skill: pending.skill,
    kind: 'resolution',
    label: `${pending.skill.toUpperCase()} (${eventDef.name})`,
    journeyId: journey.id,
    journeyEventId: pending.eventId,
    hopeSpent,
    extraDice,
    discordExtra: terrainNote.length ? `(${terrainNote.join(', ')})` : '',
  });

  // Consequence applies on failure, unless the table marks it as on-success.
  const applies = eventDef.onSuccess ? result.success : !result.success;

  // Company Fatigue is gained regardless of outcome — except Chance-meeting,
  // where a successful roll cancels it outright.
  let fatigue = eventDef.fatigue ?? 0;
  if (eventDef.effects?.cancelFatigueOnSuccess && result.success) fatigue = 0;

  const company = await companyMembers(journey.roles);
  const { applied, dayAdjustment } = await applyEventEffects({
    event: eventDef,
    applies,
    targetId,
    company,
    journey,
    fatigue,
  });

  const target = await getCharacter(targetId);
  await updateJourneyEvent(pending.eventId, {
    resolutionRollId: roll.id,
    outcome: result.success ? 'success' : 'failure',
    targetCharacterId: targetId,
    companyFatigue: fatigue,
    dayAdjustment,
    consequence: applies ? eventDef.consequence : 'No consequence (roll outcome avoided it)',
    notes: note || eventRow.notes,
    detail: {
      ...eventRow.detail,
      applied,
      extraDice,
      terrain: terrainNote,
      eventKey: eventDef.key,
      rollTotal: result.total,
      icons: result.icons,
    },
  });

  await postToDiscord(
    formatMessage(
      '📜',
      `${eventDef.name} resolved — ${boldName(target?.name ?? 'target')} ${result.success ? 'succeeds' : 'fails'}. ` +
        `${applied.length ? applied.join('; ') : 'No further effect'}.`,
    ),
  );

  // Perilous Areas run Peril-rating events back-to-back with no Marching Test.
  const remainingHere = Math.max(0, (travel.state.eventsRemainingHere ?? 1) - 1);
  if (remainingHere > 0) {
    await saveState({
      phase: 'awaiting_target',
      state: { eventsRemainingHere: remainingHere, pendingEvent: null },
    });
    await postToDiscord(
      formatMessage('☠️', `Still inside the Perilous Area — ${remainingHere} more event${remainingHere === 1 ? '' : 's'} to face.`),
    );
  } else {
    // Once the area's events are done, resume Marching Tests from the first hex
    // outside the Perilous Area along the route.
    let updatedJourney = await getJourney(journey.id);
    if (travel.state.perilousArea) {
      updatedJourney = await advancePastPerilousArea(updatedJourney);
    }
    const done = hexesRemaining(updatedJourney) === 0;
    await saveState({
      phase: done ? 'journey_end' : 'awaiting_marching_test',
      state: { eventsRemainingHere: 0, pendingEvent: null, perilousArea: false },
    });
  }

  await broadcastSnapshot();
  return travelSnapshot();
}

async function advancePastPerilousArea(journey) {
  const lookup = await hexLookup();
  let current = journey;
  let guard = 0;
  while (
    hexesRemaining(current) > 0 &&
    lookup(current.route[current.routeIndex].col, current.route[current.routeIndex].row).perilous &&
    guard < 100
  ) {
    const moved = await advanceAlongRoute(current, 1, lookup, { stopAtPerilous: false });
    current = moved.journey;
    guard += 1;
  }
  if (guard > 0) {
    await postToDiscord(
      formatMessage('🚶', `The Company leaves the Perilous Area after ${guard} more hex${guard === 1 ? '' : 'es'}.`),
    );
  }
  return current;
}

/* --- Ending the journey (§6g) ---------------------------------------------- */

export async function finishJourney() {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'journey_end' && travel.phase !== 'awaiting_marching_test') {
    fail(`Cannot end the journey during phase ${travel.phase}.`);
  }

  const days = computeJourneyDays({
    hexesTraversed: journey.hexesTraversed,
    hardTerrainHexes: journey.hardTerrainHexes,
    dayAdjustments: journey.dayAdjustments,
    forcedMarch: journey.forcedMarch,
    mounted: journey.mounted,
  });

  const company = await companyMembers(journey.roles);
  const relief = {};

  // Forced March costs each Player-hero 1 extra Fatigue per forced-march day.
  if (days.forcedMarchFatigue > 0) {
    for (const member of company) {
      await adjustCharacterPool(member.id, 'strength', 'fatigue', days.forcedMarchFatigue);
    }
  }

  // Then each hero with a mount reduces accumulated Fatigue by its Vigour.
  for (const member of company) {
    const fresh = await getCharacter(member.id);
    const vigour = fresh.sheet.mount?.vigour ?? 0;
    const step = computeFatigueRelief({
      fatigue: fresh.sheet.attributes.strength.fatigue,
      mountVigour: vigour,
      travelRoll: null,
    });
    if (step.mountReduction > 0) {
      await adjustCharacterPool(member.id, 'strength', 'fatigue', -step.mountReduction);
    }
    relief[member.id] = {
      name: fresh.name,
      mountName: fresh.sheet.mount?.name ?? '',
      mountVigour: vigour,
      startingFatigue: step.startingFatigue,
      mountReduction: step.mountReduction,
      afterMount: step.afterMount,
      travelRoll: null,
      rollReduction: 0,
      finalFatigue: step.afterMount,
    };
  }

  const summary = {
    days,
    forcedMarchFatigue: days.forcedMarchFatigue,
    relief,
    computedAt: new Date().toISOString(),
  };

  const updated = await updateJourney(journey.id, {
    totalDays: days.totalDays,
    status: 'complete',
    endedAt: new Date().toISOString(),
    summary,
  });

  await postToDiscord(
    formatMessage(
      '🏁',
      `Journey complete — ${updated.fromLabel} → ${updated.toLabel}. ` +
        `${updated.hexesTraversed} hexes${journey.forcedMarch ? ' (forced march)' : ''} + ` +
        `${updated.hardTerrainHexes} hard-terrain day${updated.hardTerrainHexes === 1 ? '' : 's'}` +
        `${updated.dayAdjustments ? ` ${updated.dayAdjustments > 0 ? '+' : ''}${updated.dayAdjustments} day adj.` : ''}` +
        `${journey.mounted ? ', halved for mounted travel' : ''} = **${days.totalDays} days**.`,
    ),
  );

  await saveState({ phase: 'awaiting_fatigue_relief', state: { fatigueRelief: relief } });
  await broadcastSnapshot();
  return travelSnapshot();
}

/** Each Player-hero may roll TRAVEL to shed more Fatigue (success -1, -1/icon). */
export async function rollFatigueRelief({ characterId, hopeSpent = false } = {}) {
  const { travel, journey } = await requireActive();
  if (travel.phase !== 'awaiting_fatigue_relief') fail('The journey is not at the Fatigue-relief step.');
  const character = await getCharacter(characterId);
  if (!character) fail('Character not found.', 404);

  const relief = { ...(travel.state.fatigueRelief ?? {}) };
  if (relief[characterId]?.travelRoll) fail(`${character.name} has already rolled TRAVEL for this journey.`);

  const { result } = await performRoll({
    characterId,
    skill: 'Travel',
    kind: 'travel_fatigue',
    label: 'TRAVEL (end-of-journey Fatigue)',
    journeyId: journey.id,
    hopeSpent,
  });

  const before = character.sheet.attributes.strength.fatigue;
  const step = computeFatigueRelief({
    fatigue: before,
    mountVigour: 0, // mount Vigour was already applied in finishJourney()
    travelRoll: { success: result.success, icons: result.icons },
  });
  if (step.rollReduction > 0) {
    await adjustCharacterPool(characterId, 'strength', 'fatigue', -step.rollReduction);
  }

  relief[characterId] = {
    ...(relief[characterId] ?? { name: character.name }),
    travelRoll: { success: result.success, icons: result.icons, total: result.total },
    rollReduction: step.rollReduction,
    finalFatigue: step.finalFatigue,
  };

  await updateJourney(journey.id, {
    summary: { ...(journey.summary ?? {}), relief },
  });
  await saveState({ state: { fatigueRelief: relief } });

  await postToDiscord(
    formatMessage(
      '💤',
      `${boldName(character.name)} rolls TRAVEL to shake off the road — ${result.success ? `−${step.rollReduction} Fatigue` : 'no relief'} (now ${step.finalFatigue}).`,
    ),
  );

  await broadcastSnapshot();
  return travelSnapshot();
}

/** Close the journey out and return the travel tool to idle. */
export async function closeJourney() {
  const travel = await getTravelState();
  if (travel.journeyId) {
    const journey = await getJourney(travel.journeyId);
    if (journey && journey.status === 'active') {
      await updateJourney(journey.id, { status: 'complete', endedAt: new Date().toISOString() });
    }
  }
  await updateParty({ route: [], routeLocked: false });
  await setTravelState({ journeyId: null, phase: 'idle', state: {} });
  await broadcastSnapshot();
  return travelSnapshot();
}

export async function abandonJourney() {
  const travel = await getTravelState();
  if (travel.journeyId) {
    await updateJourney(travel.journeyId, { status: 'abandoned', endedAt: new Date().toISOString() });
  }
  await updateParty({ route: [], routeLocked: false });
  await setTravelState({ journeyId: null, phase: 'idle', state: {} });
  await broadcastSnapshot();
  return travelSnapshot();
}

/** Preview of the end-of-journey maths, so the GM can see it before committing. */
export async function previewJourneyMaths() {
  const { journey } = await requireActive();
  return {
    journey,
    days: computeJourneyDays({
      hexesTraversed: journey.hexesTraversed,
      hardTerrainHexes: journey.hardTerrainHexes,
      dayAdjustments: journey.dayAdjustments,
      forcedMarch: journey.forcedMarch,
      mounted: journey.mounted,
    }),
    hexesRemaining: hexesRemaining(journey),
  };
}

export { evaluateRoll };

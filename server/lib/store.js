/**
 * Thin repository layer over Drizzle: JSON (de)serialisation, singleton rows,
 * and the handful of shaped reads the rest of the server needs.
 */

import { and, asc, desc, eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { hydrateSheet } from '../../shared/character.js';
import { DEFAULT_CALIBRATION, hexKey } from '../../shared/hexMath.js';

const {
  campaignState,
  characters,
  hexes,
  journeyEvents,
  journeys,
  mapCalibrations,
  partyState,
  rolls,
  travelState,
} = schema;

export const SINGLETON = 'singleton';

export function newId() {
  return crypto.randomUUID();
}

function parseJson(value, fallback) {
  if (value == null) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

/* --- campaign --------------------------------------------------------------- */

export async function getCampaign() {
  const rows = await db.select().from(campaignState).where(eq(campaignState.id, SINGLETON));
  const row = rows[0] ?? {
    id: SINGLETON,
    year: 2946,
    season: 'Spring',
    tnBase: 20,
    name: 'Darkening of Mirkwood',
    notes: '',
  };
  return { ...row };
}

export async function updateCampaign(patch) {
  const allowed = ['year', 'season', 'tnBase', 'name', 'notes'];
  const values = {};
  for (const key of allowed) if (key in patch) values[key] = patch[key];
  values.updatedAt = new Date().toISOString();
  await db.update(campaignState).set(values).where(eq(campaignState.id, SINGLETON));
  return getCampaign();
}

/* --- characters ------------------------------------------------------------- */

function toCharacter(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    player: row.player,
    culture: row.culture,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    sheet: hydrateSheet(parseJson(row.sheet, {})),
  };
}

export async function listCharacters() {
  const rows = await db.select().from(characters).orderBy(asc(characters.name));
  return rows.map(toCharacter);
}

export async function getCharacter(id) {
  const rows = await db.select().from(characters).where(eq(characters.id, id));
  return toCharacter(rows[0]);
}

export async function createCharacter({ name, player, culture, sheet } = {}) {
  const id = newId();
  const merged = hydrateSheet(sheet || {});
  if (name) merged.general.name = name;
  if (culture) merged.general.culture = culture;
  const nowIso = new Date().toISOString();
  await db.insert(characters).values({
    id,
    name: merged.general.name || name || 'New Hero',
    player: player || '',
    culture: merged.general.culture || culture || '',
    sheet: JSON.stringify(merged),
    createdAt: nowIso,
    updatedAt: nowIso,
  });
  return getCharacter(id);
}

export async function updateCharacter(id, { name, player, culture, sheet } = {}) {
  const existing = await getCharacter(id);
  if (!existing) return null;
  const merged = sheet ? hydrateSheet({ ...existing.sheet, ...sheet }) : existing.sheet;
  if (sheet) {
    // A partial sheet PATCH merges section-by-section rather than clobbering.
    for (const [section, value] of Object.entries(sheet)) {
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        merged[section] = { ...existing.sheet[section], ...value };
      } else {
        merged[section] = value;
      }
    }
  }
  await db
    .update(characters)
    .set({
      name: name ?? merged.general?.name ?? existing.name,
      player: player ?? existing.player,
      culture: culture ?? merged.general?.culture ?? existing.culture,
      sheet: JSON.stringify(merged),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(characters.id, id));
  return getCharacter(id);
}

/** Replace the whole sheet (used by the sheet editor's save). */
export async function replaceCharacterSheet(id, sheet, meta = {}) {
  const existing = await getCharacter(id);
  if (!existing) return null;
  const merged = hydrateSheet(sheet);
  await db
    .update(characters)
    .set({
      name: merged.general?.name || meta.name || existing.name,
      player: meta.player ?? existing.player,
      culture: merged.general?.culture ?? existing.culture,
      sheet: JSON.stringify(merged),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(characters.id, id));
  return getCharacter(id);
}

export async function deleteCharacter(id) {
  await db.delete(characters).where(eq(characters.id, id));
  return true;
}

/** Apply a numeric delta to a pool on a hero's sheet (Hope, Fatigue, Shadow...). */
export async function adjustCharacterPool(id, attributeKey, field, delta) {
  const character = await getCharacter(id);
  if (!character) return null;
  const pool = character.sheet.attributes[attributeKey];
  if (!pool || !(field in pool)) return character;
  pool[field] = Math.max(0, (Number(pool[field]) || 0) + delta);
  return replaceCharacterSheet(id, character.sheet);
}

export async function setCharacterCondition(id, condition, value) {
  const character = await getCharacter(id);
  if (!character) return null;
  character.sheet.conditions[condition] = Boolean(value);
  return replaceCharacterSheet(id, character.sheet);
}

/* --- map calibrations ------------------------------------------------------- */

function toCalibration(row) {
  if (!row) return null;
  const { originalFile, ...rest } = row;
  return {
    ...rest,
    // originalFile intentionally omitted from the client-facing shape.
    tiers: parseJson(row.tiers, []),
  };
}

export async function listCalibrations() {
  const rows = await db.select().from(mapCalibrations).orderBy(desc(mapCalibrations.createdAt));
  return rows.map(toCalibration);
}

export async function getCalibrationRow(id) {
  const rows = await db.select().from(mapCalibrations).where(eq(mapCalibrations.id, id));
  return rows[0] ? { ...rows[0], tiers: parseJson(rows[0].tiers, []) } : null;
}

export async function getCalibration(id) {
  return toCalibration(await getCalibrationRow(id));
}

export async function getActiveCalibration() {
  const rows = await db.select().from(mapCalibrations).where(eq(mapCalibrations.active, true));
  if (rows[0]) return toCalibration({ ...rows[0], tiers: parseJson(rows[0].tiers, []) });
  const all = await listCalibrations();
  return all[0] ?? null;
}

export async function getActiveCalibrationRow() {
  const rows = await db.select().from(mapCalibrations).where(eq(mapCalibrations.active, true));
  if (rows[0]) return { ...rows[0], tiers: parseJson(rows[0].tiers, []) };
  const all = await db.select().from(mapCalibrations).orderBy(desc(mapCalibrations.createdAt));
  return all[0] ? { ...all[0], tiers: parseJson(all[0].tiers, []) } : null;
}

export async function createCalibration({ name, originalFile, originalWidth, originalHeight, tiers }) {
  const id = newId();
  await db.insert(mapCalibrations).values({
    id,
    name: name || 'Wilderland',
    originalFile,
    originalWidth,
    originalHeight,
    tiers: JSON.stringify(tiers || []),
    ...DEFAULT_CALIBRATION,
    active: true,
  });
  // Only one active map at a time.
  await db.update(mapCalibrations).set({ active: false }).where(eq(mapCalibrations.active, true));
  await db.update(mapCalibrations).set({ active: true }).where(eq(mapCalibrations.id, id));
  return getCalibration(id);
}

const GRID_FIELDS = [
  'name',
  'orientation',
  'layout',
  'hexEdge',
  'hexWidth',
  'hexHeight',
  'colSpacing',
  'colOffset',
  'offsetX',
  'offsetY',
  'rotation',
];

export async function updateCalibration(id, patch) {
  const values = {};
  for (const key of GRID_FIELDS) if (key in patch) values[key] = patch[key];
  values.updatedAt = new Date().toISOString();
  await db.update(mapCalibrations).set(values).where(eq(mapCalibrations.id, id));
  return getCalibration(id);
}

export async function setActiveCalibration(id) {
  await db.update(mapCalibrations).set({ active: false });
  await db.update(mapCalibrations).set({ active: true }).where(eq(mapCalibrations.id, id));
  return getCalibration(id);
}

/* --- hexes ------------------------------------------------------------------ */

export function defaultHex(col, row) {
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

export async function listHexes(calibrationId) {
  if (!calibrationId) return [];
  const rows = await db.select().from(hexes).where(eq(hexes.calibrationId, calibrationId));
  return rows;
}

export async function hexMap(calibrationId) {
  const rows = await listHexes(calibrationId);
  const map = new Map();
  for (const row of rows) map.set(hexKey(row.col, row.row), row);
  return map;
}

export async function getHex(calibrationId, col, row) {
  const rows = await db
    .select()
    .from(hexes)
    .where(and(eq(hexes.calibrationId, calibrationId), eq(hexes.col, col), eq(hexes.row, row)));
  return rows[0] ?? { ...defaultHex(col, row), calibrationId, id: null };
}

export async function upsertHex(calibrationId, { col, row, ...tags }) {
  const existing = await db
    .select()
    .from(hexes)
    .where(and(eq(hexes.calibrationId, calibrationId), eq(hexes.col, col), eq(hexes.row, row)));
  const values = {
    regionType: tags.regionType ?? 'wild',
    hardTerrain: Boolean(tags.hardTerrain),
    road: Boolean(tags.road),
    perilous: Boolean(tags.perilous),
    perilRating: Number(tags.perilRating) || 0,
    label: tags.label ?? '',
    updatedAt: new Date().toISOString(),
  };
  if (existing[0]) {
    await db.update(hexes).set(values).where(eq(hexes.id, existing[0].id));
    return { ...existing[0], ...values };
  }
  const id = newId();
  await db.insert(hexes).values({ id, calibrationId, col, row, ...values });
  return { id, calibrationId, col, row, ...values };
}

export async function deleteHex(calibrationId, col, row) {
  await db
    .delete(hexes)
    .where(and(eq(hexes.calibrationId, calibrationId), eq(hexes.col, col), eq(hexes.row, row)));
  return true;
}

/* --- party state ------------------------------------------------------------ */

function toParty(row) {
  return {
    ...row,
    route: parseJson(row.route, []),
    roles: parseJson(row.roles, {}),
  };
}

export async function getParty() {
  const rows = await db.select().from(partyState).where(eq(partyState.id, SINGLETON));
  if (!rows[0]) {
    await db.insert(partyState).values({ id: SINGLETON });
    return getParty();
  }
  return toParty(rows[0]);
}

export async function updateParty(patch) {
  const values = {};
  if ('calibrationId' in patch) values.calibrationId = patch.calibrationId;
  if ('currentCol' in patch) values.currentCol = patch.currentCol;
  if ('currentRow' in patch) values.currentRow = patch.currentRow;
  if ('route' in patch) values.route = JSON.stringify(patch.route ?? []);
  if ('routeLocked' in patch) values.routeLocked = Boolean(patch.routeLocked);
  if ('mounted' in patch) values.mounted = Boolean(patch.mounted);
  if ('forcedMarch' in patch) values.forcedMarch = Boolean(patch.forcedMarch);
  if ('roles' in patch) values.roles = JSON.stringify(patch.roles ?? {});
  values.updatedAt = new Date().toISOString();
  await db.update(partyState).set(values).where(eq(partyState.id, SINGLETON));
  return getParty();
}

/* --- travel state ----------------------------------------------------------- */

export async function getTravelState() {
  const rows = await db.select().from(travelState).where(eq(travelState.id, SINGLETON));
  if (!rows[0]) {
    await db.insert(travelState).values({ id: SINGLETON, phase: 'idle' });
    return getTravelState();
  }
  return { ...rows[0], state: parseJson(rows[0].state, {}) };
}

export async function setTravelState({ journeyId, phase, state }) {
  const values = { updatedAt: new Date().toISOString() };
  if (journeyId !== undefined) values.journeyId = journeyId;
  if (phase !== undefined) values.phase = phase;
  if (state !== undefined) values.state = JSON.stringify(state ?? {});
  await db.update(travelState).set(values).where(eq(travelState.id, SINGLETON));
  return getTravelState();
}

/* --- journeys --------------------------------------------------------------- */

function toJourney(row) {
  if (!row) return null;
  return {
    ...row,
    route: parseJson(row.route, []),
    roles: parseJson(row.roles, {}),
    summary: parseJson(row.summary, {}),
  };
}

export async function listJourneys() {
  const rows = await db.select().from(journeys).orderBy(desc(journeys.createdAt));
  return rows.map(toJourney);
}

export async function getJourney(id) {
  const rows = await db.select().from(journeys).where(eq(journeys.id, id));
  return toJourney(rows[0]);
}

export async function createJourney(values) {
  const id = newId();
  await db.insert(journeys).values({
    id,
    title: values.title || '',
    year: values.year ?? 0,
    season: values.season || 'Spring',
    fromLabel: values.fromLabel || '',
    toLabel: values.toLabel || '',
    fromHex: values.fromHex || '',
    toHex: values.toHex || '',
    route: JSON.stringify(values.route || []),
    routeIndex: 0,
    status: 'active',
    mounted: Boolean(values.mounted),
    forcedMarch: Boolean(values.forcedMarch),
    roles: JSON.stringify(values.roles || {}),
    createdAt: new Date().toISOString(),
  });
  return getJourney(id);
}

const JOURNEY_FIELDS = [
  'title',
  'status',
  'routeIndex',
  'mounted',
  'forcedMarch',
  'hexesTraversed',
  'hardTerrainHexes',
  'dayAdjustments',
  'totalDays',
  'notes',
  'toLabel',
  'fromLabel',
  'toHex',
  'endedAt',
];

export async function updateJourney(id, patch) {
  const values = {};
  for (const key of JOURNEY_FIELDS) if (key in patch) values[key] = patch[key];
  if ('route' in patch) values.route = JSON.stringify(patch.route ?? []);
  if ('roles' in patch) values.roles = JSON.stringify(patch.roles ?? {});
  if ('summary' in patch) values.summary = JSON.stringify(patch.summary ?? {});
  if (Object.keys(values).length === 0) return getJourney(id);
  await db.update(journeys).set(values).where(eq(journeys.id, id));
  return getJourney(id);
}

export async function deleteJourney(id) {
  await db.delete(journeyEvents).where(eq(journeyEvents.journeyId, id));
  await db.delete(journeys).where(eq(journeys.id, id));
  return true;
}

/* --- journey events --------------------------------------------------------- */

function toEvent(row) {
  if (!row) return null;
  return { ...row, detail: parseJson(row.detail, {}) };
}

export async function listJourneyEvents(journeyId) {
  const rows = await db
    .select()
    .from(journeyEvents)
    .where(eq(journeyEvents.journeyId, journeyId))
    .orderBy(asc(journeyEvents.seq), asc(journeyEvents.createdAt));
  return rows.map(toEvent);
}

export async function getJourneyEvent(id) {
  const rows = await db.select().from(journeyEvents).where(eq(journeyEvents.id, id));
  return toEvent(rows[0]);
}

export async function createJourneyEvent(values) {
  const id = newId();
  await db.insert(journeyEvents).values({
    id,
    journeyId: values.journeyId,
    seq: values.seq ?? 1,
    kind: values.kind || 'event',
    col: values.col ?? null,
    row: values.row ?? null,
    regionType: values.regionType || 'wild',
    hardTerrain: Boolean(values.hardTerrain),
    road: Boolean(values.road),
    perilous: Boolean(values.perilous),
    targetRole: values.targetRole || '',
    targetCharacterId: values.targetCharacterId ?? null,
    targetSkill: values.targetSkill || '',
    featFace: values.featFace != null ? String(values.featFace) : '',
    eventKey: values.eventKey || '',
    eventName: values.eventName || '',
    resolutionRollId: values.resolutionRollId ?? null,
    outcome: values.outcome || 'pending',
    consequence: values.consequence || '',
    companyFatigue: values.companyFatigue ?? 0,
    dayAdjustment: values.dayAdjustment ?? 0,
    detail: JSON.stringify(values.detail || {}),
    notes: values.notes || '',
    createdAt: new Date().toISOString(),
  });
  return getJourneyEvent(id);
}

const EVENT_FIELDS = [
  'targetRole',
  'targetCharacterId',
  'targetSkill',
  'featFace',
  'eventKey',
  'eventName',
  'resolutionRollId',
  'outcome',
  'consequence',
  'companyFatigue',
  'dayAdjustment',
  'notes',
  'regionType',
  'hardTerrain',
  'road',
  'perilous',
  'col',
  'row',
];

export async function updateJourneyEvent(id, patch) {
  const values = {};
  for (const key of EVENT_FIELDS) if (key in patch) values[key] = patch[key];
  if ('featFace' in values && values.featFace != null) values.featFace = String(values.featFace);
  if ('detail' in patch) values.detail = JSON.stringify(patch.detail ?? {});
  if (Object.keys(values).length === 0) return getJourneyEvent(id);
  await db.update(journeyEvents).set(values).where(eq(journeyEvents.id, id));
  return getJourneyEvent(id);
}

export async function nextEventSeq(journeyId) {
  const rows = await listJourneyEvents(journeyId);
  return rows.reduce((max, r) => Math.max(max, r.seq), 0) + 1;
}

/* --- rolls ------------------------------------------------------------------ */

function toRoll(row) {
  if (!row) return null;
  return {
    ...row,
    result: parseJson(row.result, {}),
    specialSuccesses: parseJson(row.specialSuccesses, []),
  };
}

export async function createRoll(values) {
  const id = newId();
  await db.insert(rolls).values({
    id,
    characterId: values.characterId ?? null,
    characterName: values.characterName || '',
    journeyId: values.journeyId ?? null,
    journeyEventId: values.journeyEventId ?? null,
    kind: values.kind || 'skill',
    label: values.label || '',
    skill: values.skill || '',
    result: JSON.stringify(values.result || {}),
    total: values.result?.total ?? 0,
    targetNumber: values.result?.targetNumber ?? 0,
    success: Boolean(values.result?.success),
    icons: values.result?.icons ?? 0,
    hopeSpent: Boolean(values.result?.hopeSpent),
    specialSuccesses: JSON.stringify(values.specialSuccesses || []),
    whisperTo: values.whisperTo || 'public',
    note: values.note || '',
    createdAt: new Date().toISOString(),
  });
  return getRoll(id);
}

export async function getRoll(id) {
  const rows = await db.select().from(rolls).where(eq(rolls.id, id));
  return toRoll(rows[0]);
}

export async function updateRoll(id, patch) {
  const values = {};
  if ('specialSuccesses' in patch) values.specialSuccesses = JSON.stringify(patch.specialSuccesses);
  if ('note' in patch) values.note = patch.note;
  if (Object.keys(values).length === 0) return getRoll(id);
  await db.update(rolls).set(values).where(eq(rolls.id, id));
  return getRoll(id);
}

export async function recentRolls(limit = 40) {
  const rows = await db.select().from(rolls).orderBy(desc(rolls.createdAt)).limit(limit);
  return rows.map(toRoll);
}

export async function rollsForJourney(journeyId) {
  const rows = await db
    .select()
    .from(rolls)
    .where(eq(rolls.journeyId, journeyId))
    .orderBy(asc(rolls.createdAt));
  return rows.map(toRoll);
}

/**
 * Drizzle schema — Postgres dialect, for production (Railway).
 *
 * This is a field-for-field mirror of `schema.js` (the SQLite dialect used for
 * local dev), kept as a **separate file** rather than a single dialect-agnostic
 * one because Drizzle's `sqliteTable`/`pgTable` builders and column types
 * genuinely differ at the type level — trying to share one definition would
 * mean fighting the type system for no real benefit in a two-dialect app this
 * size. `server/db/index.js` picks whichever of these two files matches
 * `DB_CLIENT`, and every other file in the app (`server/lib/store.js` and
 * everything downstream) only ever imports `schema` from `index.js`, so this
 * file existing is invisible to the rest of the codebase.
 *
 * Translation rules from schema.js, applied consistently:
 *   - `sqliteTable` -> `pgTable`
 *   - `integer(col, { mode: 'boolean' })` -> `boolean(col)` (native type)
 *   - `text`/`real`/`integer` (non-boolean) map straight across
 *   - Timestamp columns STAY `text`, not `timestamp` — the app always writes
 *     `new Date().toISOString()` from JS and expects to read back a string;
 *     a native `timestamp` column would hand node-postgres a Date object
 *     instead, which is a real behavioural difference, not a style choice.
 *   - JSON documents stay `text` (app already does JSON.parse/stringify in
 *     the repo layer) rather than switching to native `jsonb` — that would be
 *     a genuine improvement later, but isn't needed for correctness now and
 *     touching every JSON.parse call site isn't worth the risk on a same-day
 *     production cutover.
 */

import { sql } from 'drizzle-orm';
import { boolean, index, integer, pgTable, real, text, uniqueIndex } from 'drizzle-orm/pg-core';

// A handful of insert sites (map calibrations, hexes, the party/travel
// singleton rows) don't pass created_at/updated_at explicitly and rely on the
// column default — same as the SQLite schema's `(CURRENT_TIMESTAMP)`. This
// produces the same ISO-8601-with-milliseconds shape as JS's
// `Date.prototype.toISOString()`, so a DB-defaulted row reads identically to
// an app-set one (matters for display and for sorting by these columns).
const now = sql`to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

export const campaignState = pgTable('campaign_state', {
  id: text('id').primaryKey(),
  year: integer('year').notNull().default(2946),
  season: text('season').notNull().default('Spring'),
  tnBase: integer('tn_base').notNull().default(20),
  name: text('name').notNull().default('Darkening of Mirkwood'),
  notes: text('notes').notNull().default(''),
  dayHoldSeconds: integer('day_hold_seconds').notNull().default(5),
  updatedAt: text('updated_at').notNull().default(now),
});

export const characters = pgTable('characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('New Hero'),
  player: text('player').notNull().default(''),
  culture: text('culture').notNull().default(''),
  sheet: text('sheet').notNull().default('{}'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const mapCalibrations = pgTable('map_calibrations', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('Wilderland'),
  active: boolean('active').notNull().default(false),
  originalFile: text('original_file').notNull(),
  originalWidth: integer('original_width').notNull(),
  originalHeight: integer('original_height').notNull(),
  tiers: text('tiers').notNull().default('[]'),
  orientation: text('orientation').notNull().default('flat-top'),
  layout: text('layout').notNull().default('offset-columns'),
  hexEdge: real('hex_edge').notNull().default(71),
  hexWidth: real('hex_width').notNull().default(142),
  hexHeight: real('hex_height').notNull().default(123),
  colSpacing: real('col_spacing').notNull().default(106),
  colOffset: real('col_offset').notNull().default(62),
  offsetX: real('offset_x').notNull().default(0),
  offsetY: real('offset_y').notNull().default(0),
  rotation: real('rotation').notNull().default(0),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const hexes = pgTable(
  'hexes',
  {
    id: text('id').primaryKey(),
    calibrationId: text('calibration_id').notNull(),
    col: integer('col').notNull(),
    row: integer('row').notNull(),
    regionType: text('region_type').notNull().default('wild'),
    hardTerrain: boolean('hard_terrain').notNull().default(false),
    road: boolean('road').notNull().default(false),
    perilous: boolean('perilous').notNull().default(false),
    perilRating: integer('peril_rating').notNull().default(0),
    label: text('label').notNull().default(''),
    linkedLocationId: text('linked_location_id'),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({
    uniqueHex: uniqueIndex('hexes_calibration_col_row_idx').on(t.calibrationId, t.col, t.row),
    byCalibration: index('hexes_calibration_idx').on(t.calibrationId),
  }),
);

export const partyState = pgTable('party_state', {
  id: text('id').primaryKey(),
  calibrationId: text('calibration_id'),
  currentCol: integer('current_col'),
  currentRow: integer('current_row'),
  route: text('route').notNull().default('[]'),
  drawnPath: text('drawn_path').notNull().default('[]'),
  routeLocked: boolean('route_locked').notNull().default(false),
  mounted: boolean('mounted').notNull().default(false),
  forcedMarch: boolean('forced_march').notNull().default(false),
  roles: text('roles').notNull().default('{}'),
  updatedAt: text('updated_at').notNull().default(now),
});

export const journeys = pgTable('journeys', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  year: integer('year').notNull().default(0),
  season: text('season').notNull().default('Spring'),
  fromLabel: text('from_label').notNull().default(''),
  toLabel: text('to_label').notNull().default(''),
  fromHex: text('from_hex').notNull().default(''),
  toHex: text('to_hex').notNull().default(''),
  route: text('route').notNull().default('[]'),
  drawnPath: text('drawn_path').notNull().default('[]'),
  routeIndex: integer('route_index').notNull().default(0),
  status: text('status').notNull().default('active'),
  mounted: boolean('mounted').notNull().default(false),
  forcedMarch: boolean('forced_march').notNull().default(false),
  hexesTraversed: integer('hexes_traversed').notNull().default(0),
  hardTerrainHexes: integer('hard_terrain_hexes').notNull().default(0),
  dayAdjustments: integer('day_adjustments').notNull().default(0),
  totalDays: integer('total_days').notNull().default(0),
  roles: text('roles').notNull().default('{}'),
  summary: text('summary').notNull().default('{}'),
  notes: text('notes').notNull().default(''),
  mapSnapshot: text('map_snapshot').notNull().default(''),
  createdAt: text('created_at').notNull().default(now),
  endedAt: text('ended_at'),
});

export const journeyEvents = pgTable(
  'journey_events',
  {
    id: text('id').primaryKey(),
    journeyId: text('journey_id').notNull(),
    seq: integer('seq').notNull().default(1),
    kind: text('kind').notNull().default('event'),
    col: integer('col'),
    row: integer('row'),
    regionType: text('region_type').notNull().default('wild'),
    hardTerrain: boolean('hard_terrain').notNull().default(false),
    road: boolean('road').notNull().default(false),
    perilous: boolean('perilous').notNull().default(false),
    targetRole: text('target_role').notNull().default(''),
    targetCharacterId: text('target_character_id'),
    targetSkill: text('target_skill').notNull().default(''),
    featFace: text('feat_face').notNull().default(''),
    eventKey: text('event_key').notNull().default(''),
    eventName: text('event_name').notNull().default(''),
    resolutionRollId: text('resolution_roll_id'),
    outcome: text('outcome').notNull().default(''),
    consequence: text('consequence').notNull().default(''),
    companyFatigue: integer('company_fatigue').notNull().default(0),
    dayAdjustment: integer('day_adjustment').notNull().default(0),
    detail: text('detail').notNull().default('{}'),
    notes: text('notes').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ byJourney: index('journey_events_journey_idx').on(t.journeyId) }),
);

export const rolls = pgTable(
  'rolls',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id'),
    characterName: text('character_name').notNull().default(''),
    journeyId: text('journey_id'),
    journeyEventId: text('journey_event_id'),
    kind: text('kind').notNull().default('skill'),
    label: text('label').notNull().default(''),
    skill: text('skill').notNull().default(''),
    result: text('result').notNull().default('{}'),
    total: integer('total').notNull().default(0),
    targetNumber: integer('target_number').notNull().default(0),
    success: boolean('success').notNull().default(false),
    icons: integer('icons').notNull().default(0),
    hopeSpent: boolean('hope_spent').notNull().default(false),
    specialSuccesses: text('special_successes').notNull().default('[]'),
    whisperTo: text('whisper_to').notNull().default('public'),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ byJourney: index('rolls_journey_idx').on(t.journeyId) }),
);

export const virtues = pgTable('virtues', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  effect: text('effect').notNull().default(''),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const rewardDefinitions = pgTable('reward_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  code: text('code').notNull().default(''),
  appliesTo: text('applies_to').notNull().default('[]'),
  summary: text('summary').notNull().default(''),
  tiers: text('tiers').notNull().default('[]'),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const itemsCatalogue = pgTable('items_catalogue', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().default('weapon'),
  name: text('name').notNull().default(''),
  type: text('type').notNull().default(''),
  proficiency: text('proficiency').notNull().default(''),
  damage: integer('damage').notNull().default(0),
  injury: integer('injury').notNull().default(0),
  injuryTwoHanded: integer('injury_two_handed').notNull().default(0),
  protection: integer('protection').notNull().default(0),
  parry: integer('parry').notNull().default(0),
  load: integer('load').notNull().default(0),
  minStandard: text('min_standard').notNull().default(''),
  notes: text('notes').notNull().default(''),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const culturalVirtues = pgTable('cultural_virtues', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  description: text('description').notNull().default(''),
  culture: text('culture').notNull().default(''),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const adversaries = pgTable('adversaries', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  category: text('category').notNull().default('Other'),
  distinctiveFeatures: text('distinctive_features').notNull().default(''),
  size: text('size').notNull().default('human'),
  attributeLevel: integer('attribute_level').notNull().default(0),
  endurance: integer('endurance').notNull().default(0),
  might: integer('might').notNull().default(0),
  hateResolve: integer('hate_resolve').notNull().default(0),
  parry: integer('parry').notNull().default(0),
  armour: integer('armour').notNull().default(0),
  combatProficiencies: text('combat_proficiencies').notNull().default('[]'),
  fellAbilities: text('fell_abilities').notNull().default('[]'),
  notes: text('notes').notNull().default(''),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const combatants = pgTable('combatants', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  adversaryId: text('adversary_id'),
  category: text('category').notNull().default('Other'),
  size: text('size').notNull().default('human'),
  attributeLevel: integer('attribute_level').notNull().default(0),
  parry: integer('parry').notNull().default(0),
  armour: integer('armour').notNull().default(0),
  might: integer('might').notNull().default(0),
  hateResolve: integer('hate_resolve').notNull().default(0),
  hateResolveSpent: integer('hate_resolve_spent').notNull().default(0),
  combatProficiencies: text('combat_proficiencies').notNull().default('[]'),
  fellAbilities: text('fell_abilities').notNull().default('[]'),
  currentEndurance: integer('current_endurance').notNull().default(0),
  maxEndurance: integer('max_endurance').notNull().default(0),
  woundThreshold: integer('wound_threshold').notNull().default(1),
  woundsTaken: integer('wounds_taken').notNull().default(0),
  status: text('status').notNull().default('active'),
  weary: boolean('weary').notNull().default(false),
  attacksUsedThisRound: integer('attacks_used_this_round').notNull().default(0),
  joinedRound: integer('joined_round').notNull().default(1),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull().default(now),
});

export const combatState = pgTable('combat_state', {
  id: text('id').primaryKey(),
  active: boolean('active').notNull().default(false),
  round: integer('round').notNull().default(1),
  stanceLocked: boolean('stance_locked').notNull().default(false),
  stances: text('stances').notNull().default('{}'),
  engagements: text('engagements').notNull().default('{}'),
  actedPlayers: text('acted_players').notNull().default('[]'),
  pendingModifiers: text('pending_modifiers').notNull().default('{}'),
  updatedAt: text('updated_at').notNull().default(now),
});

export const locations = pgTable('locations', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  years: text('years').notNull().default('[]'),
  keyInfo: text('key_info').notNull().default(''),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const handouts = pgTable(
  'handouts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    notes: text('notes').notNull().default(''),
    year: integer('year').notNull().default(0),
    season: text('season').notNull().default('Spring'),
    hidden: boolean('hidden').notNull().default(true),
    originalFile: text('original_file').notNull().default(''),
    imageWidth: integer('image_width').notNull().default(0),
    imageHeight: integer('image_height').notNull().default(0),
    tiers: text('tiers').notNull().default('[]'),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({ byWhen: index('handouts_year_season_idx').on(t.year, t.season) }),
);

/** One entry per Year + Season. See schema.js for why it is not a list. */
export const adventureNotes = pgTable(
  'adventure_notes',
  {
    id: text('id').primaryKey(),
    year: integer('year').notNull().default(0),
    season: text('season').notNull().default('Spring'),
    title: text('title').notNull().default(''),
    body: text('body').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({ onedPerWhen: uniqueIndex('adventure_notes_year_season_idx').on(t.year, t.season) }),
);

export const travelState = pgTable('travel_state', {
  id: text('id').primaryKey(),
  journeyId: text('journey_id'),
  phase: text('phase').notNull().default('idle'),
  state: text('state').notNull().default('{}'),
  updatedAt: text('updated_at').notNull().default(now),
});

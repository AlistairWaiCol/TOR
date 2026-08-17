/**
 * Drizzle schema (SQLite dialect for local dev).
 *
 * Postgres swap notes — this is deliberately the ONLY dialect-aware file:
 *   - `sqliteTable` -> `pgTable` (drizzle-orm/pg-core)
 *   - `integer(..., { mode: 'boolean' })` -> `boolean(...)`
 *   - `text` and `real` map straight across
 *   - JSON documents are stored as text and parsed in the repo layer, so they
 *     become `jsonb` with no query changes.
 * No raw SQLite-only SQL is used anywhere in the app.
 */

import { sql } from 'drizzle-orm';
import { index, integer, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

const now = sql`(CURRENT_TIMESTAMP)`;

export const campaignState = sqliteTable('campaign_state', {
  id: text('id').primaryKey(), // always 'singleton'
  year: integer('year').notNull().default(2946),
  season: text('season').notNull().default('Spring'),
  tnBase: integer('tn_base').notNull().default(20), // 18 = short-campaign variant
  name: text('name').notNull().default('Darkening of Mirkwood'),
  notes: text('notes').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(now),
});

export const characters = sqliteTable('characters', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('New Hero'),
  player: text('player').notNull().default(''),
  culture: text('culture').notNull().default(''),
  sheet: text('sheet').notNull().default('{}'), // JSON document, see shared/character.js
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const mapCalibrations = sqliteTable('map_calibrations', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default('Wilderland'),
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  originalFile: text('original_file').notNull(), // on-disk name, never served directly
  originalWidth: integer('original_width').notNull(),
  originalHeight: integer('original_height').notNull(),
  tiers: text('tiers').notNull().default('[]'), // JSON [{name,width,height,file,bytes}]
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

export const hexes = sqliteTable(
  'hexes',
  {
    id: text('id').primaryKey(),
    calibrationId: text('calibration_id').notNull(),
    col: integer('col').notNull(),
    row: integer('row').notNull(),
    regionType: text('region_type').notNull().default('wild'), // border | wild | dark
    hardTerrain: integer('hard_terrain', { mode: 'boolean' }).notNull().default(false),
    road: integer('road', { mode: 'boolean' }).notNull().default(false),
    perilous: integer('perilous', { mode: 'boolean' }).notNull().default(false),
    perilRating: integer('peril_rating').notNull().default(0),
    label: text('label').notNull().default(''),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({
    uniqueHex: uniqueIndex('hexes_calibration_col_row_idx').on(t.calibrationId, t.col, t.row),
    byCalibration: index('hexes_calibration_idx').on(t.calibrationId),
  }),
);

/** Live shared state for the map view: token, route, roles, travel toggles. */
export const partyState = sqliteTable('party_state', {
  id: text('id').primaryKey(), // always 'singleton'
  calibrationId: text('calibration_id'),
  currentCol: integer('current_col'),
  currentRow: integer('current_row'),
  route: text('route').notNull().default('[]'), // JSON [{col,row}]
  routeLocked: integer('route_locked', { mode: 'boolean' }).notNull().default(false),
  mounted: integer('mounted', { mode: 'boolean' }).notNull().default(false),
  forcedMarch: integer('forced_march', { mode: 'boolean' }).notNull().default(false),
  roles: text('roles').notNull().default('{}'), // JSON { characterId: roleKey }
  updatedAt: text('updated_at').notNull().default(now),
});

export const journeys = sqliteTable('journeys', {
  id: text('id').primaryKey(),
  title: text('title').notNull().default(''),
  year: integer('year').notNull().default(0),
  season: text('season').notNull().default('Spring'),
  fromLabel: text('from_label').notNull().default(''),
  toLabel: text('to_label').notNull().default(''),
  fromHex: text('from_hex').notNull().default(''),
  toHex: text('to_hex').notNull().default(''),
  route: text('route').notNull().default('[]'), // JSON [{col,row}]
  routeIndex: integer('route_index').notNull().default(0), // how far along the route the party is
  status: text('status').notNull().default('active'), // active | complete | abandoned
  mounted: integer('mounted', { mode: 'boolean' }).notNull().default(false),
  forcedMarch: integer('forced_march', { mode: 'boolean' }).notNull().default(false),
  hexesTraversed: integer('hexes_traversed').notNull().default(0),
  hardTerrainHexes: integer('hard_terrain_hexes').notNull().default(0),
  dayAdjustments: integer('day_adjustments').notNull().default(0),
  totalDays: integer('total_days').notNull().default(0),
  roles: text('roles').notNull().default('{}'), // JSON snapshot at journey start
  summary: text('summary').notNull().default('{}'), // JSON end-of-journey maths
  notes: text('notes').notNull().default(''), // whole-journey free text
  createdAt: text('created_at').notNull().default(now),
  endedAt: text('ended_at'),
});

export const journeyEvents = sqliteTable(
  'journey_events',
  {
    id: text('id').primaryKey(),
    journeyId: text('journey_id').notNull(),
    seq: integer('seq').notNull().default(1),
    kind: text('kind').notNull().default('event'), // event | marching_test | note
    col: integer('col'),
    row: integer('row'),
    regionType: text('region_type').notNull().default('wild'),
    hardTerrain: integer('hard_terrain', { mode: 'boolean' }).notNull().default(false),
    road: integer('road', { mode: 'boolean' }).notNull().default(false),
    perilous: integer('perilous', { mode: 'boolean' }).notNull().default(false),
    targetRole: text('target_role').notNull().default(''),
    targetCharacterId: text('target_character_id'),
    targetSkill: text('target_skill').notNull().default(''),
    featFace: text('feat_face').notNull().default(''),
    eventKey: text('event_key').notNull().default(''),
    eventName: text('event_name').notNull().default(''),
    resolutionRollId: text('resolution_roll_id'),
    outcome: text('outcome').notNull().default(''), // success | failure | pending
    consequence: text('consequence').notNull().default(''),
    companyFatigue: integer('company_fatigue').notNull().default(0),
    dayAdjustment: integer('day_adjustment').notNull().default(0),
    detail: text('detail').notNull().default('{}'), // JSON, everything else
    notes: text('notes').notNull().default(''), // per-event free text
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ byJourney: index('journey_events_journey_idx').on(t.journeyId) }),
);

export const rolls = sqliteTable(
  'rolls',
  {
    id: text('id').primaryKey(),
    characterId: text('character_id'),
    characterName: text('character_name').notNull().default(''),
    journeyId: text('journey_id'),
    journeyEventId: text('journey_event_id'),
    kind: text('kind').notNull().default('skill'), // skill | marching_test | select_target | determine_event | resolution | travel_fatigue | custom | attack | damage | protection | parry
    label: text('label').notNull().default(''),
    skill: text('skill').notNull().default(''),
    result: text('result').notNull().default('{}'), // full JSON result from the dice engine
    total: integer('total').notNull().default(0),
    targetNumber: integer('target_number').notNull().default(0),
    success: integer('success', { mode: 'boolean' }).notNull().default(false),
    icons: integer('icons').notNull().default(0),
    hopeSpent: integer('hope_spent', { mode: 'boolean' }).notNull().default(false),
    specialSuccesses: text('special_successes').notNull().default('[]'), // JSON string[]
    whisperTo: text('whisper_to').notNull().default('public'),
    note: text('note').notNull().default(''),
    createdAt: text('created_at').notNull().default(now),
  },
  (t) => ({ byJourney: index('rolls_journey_idx').on(t.journeyId) }),
);

/** The in-progress travel sequence state machine (spec §6d). */
export const travelState = sqliteTable('travel_state', {
  id: text('id').primaryKey(), // always 'singleton'
  journeyId: text('journey_id'),
  phase: text('phase').notNull().default('idle'),
  state: text('state').notNull().default('{}'), // JSON working memory for the sequence
  updatedAt: text('updated_at').notNull().default(now),
});

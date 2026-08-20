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
  // How long one day holds on screen during the live travel animation (§ TravelDayTicker).
  dayHoldSeconds: integer('day_hold_seconds').notNull().default(5),
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
    // Optional link to a Compendium Location (see `locations` below).
    linkedLocationId: text('linked_location_id'),
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
  // The raw freehand stroke behind the current route, in original-image pixel
  // coordinates — JSON [{x,y}]. Kept alongside the snapped hex `route` purely
  // for display: the player-side map draws this smooth line instead of the
  // hex-by-hex highlight, while every hex-based game rule keeps reading `route`.
  drawnPath: text('drawn_path').notNull().default('[]'),
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
  // Snapshot of party_state.drawnPath at the moment this journey started — see
  // partyState.drawnPath above.
  drawnPath: text('drawn_path').notNull().default('[]'),
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
  mapSnapshot: text('map_snapshot').notNull().default(''), // PNG data URL of the travelled route
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

/* --- Compendium -------------------------------------------------------------
 * The campaign's shared reference shelf. One table per section rather than a
 * single polymorphic table, because the sections have genuinely different
 * columns — and adding `npcs` / `bestiary` later is then just another table
 * plus a row in shared/compendium.js's COMPENDIUM_SECTIONS.
 *
 * `source` is 'core' for seeded rulebook entries and 'custom' for home-brew;
 * re-seeding only ever touches 'core' rows.
 */

export const virtues = sqliteTable('virtues', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  effect: text('effect').notNull().default(''),
  source: text('source').notNull().default('custom'), // core | custom
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

export const rewardDefinitions = sqliteTable('reward_definitions', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  code: text('code').notNull().default(''), // F / G / K / CF / CM / RI
  appliesTo: text('applies_to').notNull().default('[]'), // JSON ['weapon','armour','shield']
  summary: text('summary').notNull().default(''),
  tiers: text('tiers').notNull().default('[]'), // JSON [{value,label}] incl. enhanced tiers
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/** Weapons, armour and shields a character sheet can pick from. */
export const itemsCatalogue = sqliteTable('items_catalogue', {
  id: text('id').primaryKey(),
  kind: text('kind').notNull().default('weapon'), // weapon | armour | shield
  name: text('name').notNull().default(''),
  type: text('type').notNull().default(''),
  proficiency: text('proficiency').notNull().default(''),
  damage: integer('damage').notNull().default(0),
  injury: integer('injury').notNull().default(0),
  // Second Injury rating for the three weapons that have one per grip
  // (Long Sword / Spear / Long-hafted Axe). 0 = a single Injury, as usual.
  injuryTwoHanded: integer('injury_two_handed').notNull().default(0),
  protection: integer('protection').notNull().default(0),
  parry: integer('parry').notNull().default(0),
  load: integer('load').notNull().default(0),
  // Minimum Standard of Living. Compendium-only, and only ever a soft hint on
  // the character sheet's pickers — nothing is blocked by it.
  minStandard: text('min_standard').notNull().default(''),
  notes: text('notes').notNull().default(''),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/**
 * Cultural Virtues — a separate table from `virtues` (the culture-agnostic
 * core six) because they carry a Culture and are retrieved by it: a hero is
 * offered the Virtues of their own culture, not the whole list.
 */
export const culturalVirtues = sqliteTable('cultural_virtues', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  description: text('description').notNull().default(''),
  culture: text('culture').notNull().default(''),
  source: text('source').notNull().default('custom'), // core | custom
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/**
 * Adversary/NPC Bank — reusable stat-block templates for the Combat Tracker.
 * A `combatants` row (see below) is an independent snapshot copy taken from
 * one of these at the moment it is added to a fight; this table itself is
 * never touched by a fight in progress.
 */
export const adversaries = sqliteTable('adversaries', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  category: text('category').notNull().default('Other'), // NPCs|Evil Men|Orcs|Trolls|Wolves|Undead|Spiders|Other
  distinctiveFeatures: text('distinctive_features').notNull().default(''),
  size: text('size').notNull().default('human'), // human | large
  attributeLevel: integer('attribute_level').notNull().default(0),
  endurance: integer('endurance').notNull().default(0),
  might: integer('might').notNull().default(0),
  // Hate (minions of the Enemy) or Resolve (non-monstrous "Evil Men") — one
  // shared numeric field, labelled by category. See hateResolveLabel() in
  // shared/compendium.js.
  hateResolve: integer('hate_resolve').notNull().default(0),
  parry: integer('parry').notNull().default(0),
  armour: integer('armour').notNull().default(0),
  combatProficiencies: text('combat_proficiencies').notNull().default('[]'), // JSON [{name,rating,damage,injury,special}]
  fellAbilities: text('fell_abilities').notNull().default('[]'), // JSON [{name,description}]
  notes: text('notes').notNull().default(''),
  source: text('source').notNull().default('custom'),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/**
 * A single fight's adversary instances — independent copies of `adversaries`
 * rows, snapshotted at the moment the GM adds them to combat. Never written
 * back to the bank; a fight can freely damage/rename/remove these without
 * touching the reusable template they came from.
 */
export const combatants = sqliteTable('combatants', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''), // auto-numbered, e.g. "Orc Guard 2"
  adversaryId: text('adversary_id'), // informational only — the bank entry this came from
  category: text('category').notNull().default('Other'),
  size: text('size').notNull().default('human'),
  attributeLevel: integer('attribute_level').notNull().default(0),
  parry: integer('parry').notNull().default(0),
  armour: integer('armour').notNull().default(0),
  might: integer('might').notNull().default(0),
  hateResolve: integer('hate_resolve').notNull().default(0),
  hateResolveSpent: integer('hate_resolve_spent').notNull().default(0), // resets each round
  combatProficiencies: text('combat_proficiencies').notNull().default('[]'),
  fellAbilities: text('fell_abilities').notNull().default('[]'),
  currentEndurance: integer('current_endurance').notNull().default(0),
  maxEndurance: integer('max_endurance').notNull().default(0),
  // How many Wounds this creature can take before it's removed from the
  // fight — 1 for almost everything; the GM may raise it per creature.
  woundThreshold: integer('wound_threshold').notNull().default(1),
  woundsTaken: integer('wounds_taken').notNull().default(0),
  status: text('status').notNull().default('active'), // active | down | removed
  // Set by a successful Intimidate Foe for the rest of the round; cleared on
  // the next round's reset, same as attacksUsedThisRound/hateResolveSpent.
  weary: integer('weary', { mode: 'boolean' }).notNull().default(false),
  attacksUsedThisRound: integer('attacks_used_this_round').notNull().default(0),
  joinedRound: integer('joined_round').notNull().default(1),
  notes: text('notes').notNull().default(''),
  createdAt: text('created_at').notNull().default(now),
});

/** Live shared state for the Combat Tracker — round, stances, engagements. */
export const combatState = sqliteTable('combat_state', {
  id: text('id').primaryKey(), // always 'singleton'
  active: integer('active', { mode: 'boolean' }).notNull().default(false),
  round: integer('round').notNull().default(1),
  stanceLocked: integer('stance_locked', { mode: 'boolean' }).notNull().default(false),
  stances: text('stances').notNull().default('{}'), // JSON { characterId: 'Forward'|'Open'|'Defensive'|'Rear' }
  engagements: text('engagements').notNull().default('{}'), // JSON { characterId: combatantId }
  actedPlayers: text('acted_players').notNull().default('[]'), // JSON string[] of characterIds
  pendingModifiers: text('pending_modifiers').notNull().default('{}'), // JSON { characterId: {extraDice, note} }
  // A hit awaiting the HIT PLAYER's own decision (take it / Knockback), then
  // — if it was a Piercing Blow — their Protection roll, then the GM's Wound
  // Severity entry. JSON { characterId: { stage, enduranceLoss, source,
  // piercingBlow, weaponInjury, featFace } }. See CombatHitPrompt.jsx, which
  // is the only thing that ever shows this to a player, gated on their own
  // "Playing As" selection — never surfaced to the GM as a native popup.
  pendingHits: text('pending_hits').notNull().default('{}'),
  updatedAt: text('updated_at').notNull().default(now),
});

export const locations = sqliteTable('locations', {
  id: text('id').primaryKey(),
  name: text('name').notNull().default(''),
  years: text('years').notNull().default('[]'), // JSON string[] of years visited
  keyInfo: text('key_info').notNull().default(''),
  createdAt: text('created_at').notNull().default(now),
  updatedAt: text('updated_at').notNull().default(now),
});

/**
 * Handouts — an image plus notes, tagged to a campaign Year + Season.
 *
 * `hidden` defaults to TRUE: a handout is GM prep until the GM reveals it, and
 * the reveal is reversible in both directions. Hidden-ness is enforced on the
 * server (list, read and image routes all filter on it for players), not just
 * by not drawing it in the UI.
 *
 * Image handling mirrors map_calibrations: `originalFile` is on-disk only and
 * never served, `tiers` are the generated WebP derivatives, and those are the
 * only bytes a browser ever gets.
 */
export const handouts = sqliteTable(
  'handouts',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull().default(''),
    notes: text('notes').notNull().default(''),
    year: integer('year').notNull().default(0),
    season: text('season').notNull().default('Spring'),
    hidden: integer('hidden', { mode: 'boolean' }).notNull().default(true),
    originalFile: text('original_file').notNull().default(''),
    imageWidth: integer('image_width').notNull().default(0),
    imageHeight: integer('image_height').notNull().default(0),
    tiers: text('tiers').notNull().default('[]'), // JSON [{name,width,height,file,bytes}]
    createdAt: text('created_at').notNull().default(now),
    updatedAt: text('updated_at').notNull().default(now),
  },
  (t) => ({ byWhen: index('handouts_year_season_idx').on(t.year, t.season) }),
);

/**
 * Adventure Notes — the table's shared scratchpad, ONE entry per Year + Season.
 *
 * Not a list like `handouts`: a season has a single running note, so
 * (year, season) is the entry's identity and carries a unique index. The route
 * upserts on it rather than exposing create/update separately, which is what
 * makes "pick a season, start typing" work whether or not anything is there.
 *
 * No `hidden` column, deliberately — unlike a handout this is open to anyone
 * with the player passcode, the same access level as a character sheet.
 */
export const adventureNotes = sqliteTable(
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

/** The in-progress travel sequence state machine (spec §6d). */
export const travelState = sqliteTable('travel_state', {
  id: text('id').primaryKey(), // always 'singleton'
  journeyId: text('journey_id'),
  phase: text('phase').notNull().default('idle'),
  state: text('state').notNull().default('{}'), // JSON working memory for the sequence
  updatedAt: text('updated_at').notNull().default(now),
});

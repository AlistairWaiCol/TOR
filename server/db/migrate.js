/**
 * Idempotent schema creation. Run automatically at server start and via
 * `npm run db:migrate`.
 *
 * These are plain CREATE TABLE IF NOT EXISTS statements in portable SQL — no
 * SQLite-only syntax (no AUTOINCREMENT, no `WITHOUT ROWID`, all ids are text
 * UUIDs). When the project moves to Postgres this file is replaced by
 * `drizzle-kit generate` + the Drizzle migrator; nothing else changes.
 */

import { getSqlite } from './index.js';
import { seedCompendium } from './seedCompendium.js';

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS campaign_state (
     id TEXT PRIMARY KEY,
     year INTEGER NOT NULL DEFAULT 2946,
     season TEXT NOT NULL DEFAULT 'Spring',
     tn_base INTEGER NOT NULL DEFAULT 20,
     name TEXT NOT NULL DEFAULT 'Darkening of Mirkwood',
     notes TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS characters (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT 'New Hero',
     player TEXT NOT NULL DEFAULT '',
     culture TEXT NOT NULL DEFAULT '',
     sheet TEXT NOT NULL DEFAULT '{}',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS map_calibrations (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT 'Wilderland',
     active INTEGER NOT NULL DEFAULT 0,
     original_file TEXT NOT NULL,
     original_width INTEGER NOT NULL,
     original_height INTEGER NOT NULL,
     tiers TEXT NOT NULL DEFAULT '[]',
     orientation TEXT NOT NULL DEFAULT 'flat-top',
     layout TEXT NOT NULL DEFAULT 'offset-columns',
     hex_edge REAL NOT NULL DEFAULT 71,
     hex_width REAL NOT NULL DEFAULT 142,
     hex_height REAL NOT NULL DEFAULT 123,
     col_spacing REAL NOT NULL DEFAULT 106,
     col_offset REAL NOT NULL DEFAULT 62,
     offset_x REAL NOT NULL DEFAULT 0,
     offset_y REAL NOT NULL DEFAULT 0,
     rotation REAL NOT NULL DEFAULT 0,
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS hexes (
     id TEXT PRIMARY KEY,
     calibration_id TEXT NOT NULL,
     col INTEGER NOT NULL,
     row INTEGER NOT NULL,
     region_type TEXT NOT NULL DEFAULT 'wild',
     hard_terrain INTEGER NOT NULL DEFAULT 0,
     road INTEGER NOT NULL DEFAULT 0,
     perilous INTEGER NOT NULL DEFAULT 0,
     peril_rating INTEGER NOT NULL DEFAULT 0,
     label TEXT NOT NULL DEFAULT '',
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS hexes_calibration_col_row_idx
     ON hexes (calibration_id, col, row)`,
  `CREATE INDEX IF NOT EXISTS hexes_calibration_idx ON hexes (calibration_id)`,

  `CREATE TABLE IF NOT EXISTS party_state (
     id TEXT PRIMARY KEY,
     calibration_id TEXT,
     current_col INTEGER,
     current_row INTEGER,
     route TEXT NOT NULL DEFAULT '[]',
     route_locked INTEGER NOT NULL DEFAULT 0,
     mounted INTEGER NOT NULL DEFAULT 0,
     forced_march INTEGER NOT NULL DEFAULT 0,
     roles TEXT NOT NULL DEFAULT '{}',
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS journeys (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL DEFAULT '',
     year INTEGER NOT NULL DEFAULT 0,
     season TEXT NOT NULL DEFAULT 'Spring',
     from_label TEXT NOT NULL DEFAULT '',
     to_label TEXT NOT NULL DEFAULT '',
     from_hex TEXT NOT NULL DEFAULT '',
     to_hex TEXT NOT NULL DEFAULT '',
     route TEXT NOT NULL DEFAULT '[]',
     route_index INTEGER NOT NULL DEFAULT 0,
     status TEXT NOT NULL DEFAULT 'active',
     mounted INTEGER NOT NULL DEFAULT 0,
     forced_march INTEGER NOT NULL DEFAULT 0,
     hexes_traversed INTEGER NOT NULL DEFAULT 0,
     hard_terrain_hexes INTEGER NOT NULL DEFAULT 0,
     day_adjustments INTEGER NOT NULL DEFAULT 0,
     total_days INTEGER NOT NULL DEFAULT 0,
     roles TEXT NOT NULL DEFAULT '{}',
     summary TEXT NOT NULL DEFAULT '{}',
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     ended_at TEXT
   )`,

  `CREATE TABLE IF NOT EXISTS journey_events (
     id TEXT PRIMARY KEY,
     journey_id TEXT NOT NULL,
     seq INTEGER NOT NULL DEFAULT 1,
     kind TEXT NOT NULL DEFAULT 'event',
     col INTEGER,
     row INTEGER,
     region_type TEXT NOT NULL DEFAULT 'wild',
     hard_terrain INTEGER NOT NULL DEFAULT 0,
     road INTEGER NOT NULL DEFAULT 0,
     perilous INTEGER NOT NULL DEFAULT 0,
     target_role TEXT NOT NULL DEFAULT '',
     target_character_id TEXT,
     target_skill TEXT NOT NULL DEFAULT '',
     feat_face TEXT NOT NULL DEFAULT '',
     event_key TEXT NOT NULL DEFAULT '',
     event_name TEXT NOT NULL DEFAULT '',
     resolution_roll_id TEXT,
     outcome TEXT NOT NULL DEFAULT '',
     consequence TEXT NOT NULL DEFAULT '',
     company_fatigue INTEGER NOT NULL DEFAULT 0,
     day_adjustment INTEGER NOT NULL DEFAULT 0,
     detail TEXT NOT NULL DEFAULT '{}',
     notes TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE INDEX IF NOT EXISTS journey_events_journey_idx ON journey_events (journey_id)`,

  `CREATE TABLE IF NOT EXISTS rolls (
     id TEXT PRIMARY KEY,
     character_id TEXT,
     character_name TEXT NOT NULL DEFAULT '',
     journey_id TEXT,
     journey_event_id TEXT,
     kind TEXT NOT NULL DEFAULT 'skill',
     label TEXT NOT NULL DEFAULT '',
     skill TEXT NOT NULL DEFAULT '',
     result TEXT NOT NULL DEFAULT '{}',
     total INTEGER NOT NULL DEFAULT 0,
     target_number INTEGER NOT NULL DEFAULT 0,
     success INTEGER NOT NULL DEFAULT 0,
     icons INTEGER NOT NULL DEFAULT 0,
     hope_spent INTEGER NOT NULL DEFAULT 0,
     special_successes TEXT NOT NULL DEFAULT '[]',
     whisper_to TEXT NOT NULL DEFAULT 'public',
     note TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE INDEX IF NOT EXISTS rolls_journey_idx ON rolls (journey_id)`,

  `CREATE TABLE IF NOT EXISTS handouts (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     year INTEGER NOT NULL DEFAULT 0,
     season TEXT NOT NULL DEFAULT 'Spring',
     hidden INTEGER NOT NULL DEFAULT 1,
     original_file TEXT NOT NULL DEFAULT '',
     image_width INTEGER NOT NULL DEFAULT 0,
     image_height INTEGER NOT NULL DEFAULT 0,
     tiers TEXT NOT NULL DEFAULT '[]',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE INDEX IF NOT EXISTS handouts_year_season_idx ON handouts (year, season)`,

  `CREATE TABLE IF NOT EXISTS travel_state (
     id TEXT PRIMARY KEY,
     journey_id TEXT,
     phase TEXT NOT NULL DEFAULT 'idle',
     state TEXT NOT NULL DEFAULT '{}',
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  // --- Compendium ---
  `CREATE TABLE IF NOT EXISTS virtues (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT '',
     effect TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'custom',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS reward_definitions (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT '',
     code TEXT NOT NULL DEFAULT '',
     applies_to TEXT NOT NULL DEFAULT '[]',
     summary TEXT NOT NULL DEFAULT '',
     tiers TEXT NOT NULL DEFAULT '[]',
     source TEXT NOT NULL DEFAULT 'custom',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS items_catalogue (
     id TEXT PRIMARY KEY,
     kind TEXT NOT NULL DEFAULT 'weapon',
     name TEXT NOT NULL DEFAULT '',
     type TEXT NOT NULL DEFAULT '',
     proficiency TEXT NOT NULL DEFAULT '',
     damage INTEGER NOT NULL DEFAULT 0,
     injury INTEGER NOT NULL DEFAULT 0,
     injury_two_handed INTEGER NOT NULL DEFAULT 0,
     protection INTEGER NOT NULL DEFAULT 0,
     parry INTEGER NOT NULL DEFAULT 0,
     load INTEGER NOT NULL DEFAULT 0,
     min_standard TEXT NOT NULL DEFAULT '',
     notes TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'custom',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,

  `CREATE TABLE IF NOT EXISTS cultural_virtues (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT '',
     description TEXT NOT NULL DEFAULT '',
     culture TEXT NOT NULL DEFAULT '',
     source TEXT NOT NULL DEFAULT 'custom',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
  `CREATE INDEX IF NOT EXISTS cultural_virtues_culture_idx ON cultural_virtues (culture)`,

  `CREATE TABLE IF NOT EXISTS locations (
     id TEXT PRIMARY KEY,
     name TEXT NOT NULL DEFAULT '',
     years TEXT NOT NULL DEFAULT '[]',
     key_info TEXT NOT NULL DEFAULT '',
     created_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP),
     updated_at TEXT NOT NULL DEFAULT (CURRENT_TIMESTAMP)
   )`,
];

/**
 * Columns added to tables that already exist in the wild. SQLite has no
 * `ADD COLUMN IF NOT EXISTS`, so each is guarded by a table_info read. This is
 * the one place SQLite-specific SQL lives, and it is also the file that gets
 * replaced wholesale by drizzle-kit on the Postgres swap.
 */
const ADDED_COLUMNS = [
  ['hexes', 'linked_location_id', 'TEXT'],
  ['journeys', 'map_snapshot', "TEXT NOT NULL DEFAULT ''"],
  ['items_catalogue', 'injury_two_handed', 'INTEGER NOT NULL DEFAULT 0'],
  ['items_catalogue', 'min_standard', "TEXT NOT NULL DEFAULT ''"],
];

function addMissingColumns(sqlite) {
  for (const [table, column, ddl] of ADDED_COLUMNS) {
    const existing = sqlite.prepare(`PRAGMA table_info(${table})`).all();
    if (existing.some((c) => c.name === column)) continue;
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
}

const SEEDS = [
  `INSERT INTO campaign_state (id, year, season, tn_base)
     SELECT 'singleton', 2946, 'Spring', 20
     WHERE NOT EXISTS (SELECT 1 FROM campaign_state WHERE id = 'singleton')`,
  `INSERT INTO party_state (id) SELECT 'singleton'
     WHERE NOT EXISTS (SELECT 1 FROM party_state WHERE id = 'singleton')`,
  `INSERT INTO travel_state (id, phase) SELECT 'singleton', 'idle'
     WHERE NOT EXISTS (SELECT 1 FROM travel_state WHERE id = 'singleton')`,
];

export function migrate() {
  const sqlite = getSqlite();
  for (const stmt of STATEMENTS) sqlite.exec(stmt);
  addMissingColumns(sqlite);
  for (const stmt of SEEDS) sqlite.exec(stmt);
  seedCompendium(sqlite);
  return true;
}

if (import.meta.url === `file://${process.argv[1]?.replace(/\\/g, '/')}`) {
  migrate();
  console.log('Schema up to date.');
}

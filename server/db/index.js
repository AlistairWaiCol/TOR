/**
 * Database connection.
 *
 * Local dev = SQLite via better-sqlite3. Production (Railway) = Postgres via
 * `pg`. Which one is live is controlled entirely by `DB_CLIENT` (config.js) —
 * everything downstream (`server/lib/store.js` and every route) only ever
 * touches the `db` Drizzle instance and the `schema` objects exported from
 * here, so this file plus `schema.js` / `schema.pg.js` are the only
 * dialect-aware code in the app.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import pg from 'pg';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import * as sqliteSchema from './schema.js';
import * as pgSchema from './schema.pg.js';
import { config, projectRoot } from '../config.js';

const isPg = config.dbClient === 'pg';
export const schema = isPg ? pgSchema : sqliteSchema;

function resolveSqlitePath() {
  const url = config.databaseUrl || 'file:./data/one-ring.db';
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(file) ? file : path.join(projectRoot, file);
}

let sqlite;
let pgPool;
let dbInstance;

export function getSqlite() {
  if (isPg) throw new Error('getSqlite() called while DB_CLIENT=pg — use getPgPool() instead.');
  if (!sqlite) {
    const file = resolveSqlitePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sqlite = new Database(file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
  }
  return sqlite;
}

/**
 * Raw `pg` pool, for the one thing Drizzle's query builder can't do:
 * CREATE TABLE at migration time (see migrate.js). Everything else in the
 * app goes through the Drizzle `db` export below, never this directly.
 *
 * Railway's Postgres (like most managed Postgres) sits behind TLS with a
 * certificate chain `pg` won't validate out of the box from outside its own
 * network — `rejectUnauthorized: false` is the standard pragmatic choice for
 * this class of host, matching Heroku/Railway/Render's own connection
 * examples. It still encrypts the connection; it just doesn't verify the CA.
 */
export function getPgPool() {
  if (!isPg) throw new Error('getPgPool() called while DB_CLIENT=sqlite — use getSqlite() instead.');
  if (!pgPool) {
    pgPool = new pg.Pool({
      connectionString: config.databaseUrl,
      ssl: config.databaseUrl.includes('sslmode=disable') ? false : { rejectUnauthorized: false },
    });
  }
  return pgPool;
}

export function getDb() {
  if (!dbInstance) {
    dbInstance = isPg
      ? drizzlePg(getPgPool(), { schema })
      : drizzleSqlite(getSqlite(), { schema });
  }
  return dbInstance;
}

export const db = new Proxy(
  {},
  {
    get(_t, prop) {
      const real = getDb();
      const value = real[prop];
      return typeof value === 'function' ? value.bind(real) : value;
    },
  },
);

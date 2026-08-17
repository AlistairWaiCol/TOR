/**
 * Database connection.
 *
 * Local dev = SQLite via better-sqlite3. The rest of the app only ever touches
 * `db` (a Drizzle instance) and the schema objects, so swapping to Postgres is
 * confined to this file plus the dialect imports in schema.js.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema.js';
import { config, projectRoot } from '../config.js';

function resolveSqlitePath() {
  const url = config.databaseUrl || 'file:./data/one-ring.db';
  const file = url.startsWith('file:') ? url.slice('file:'.length) : url;
  return path.isAbsolute(file) ? file : path.join(projectRoot, file);
}

let sqlite;
let dbInstance;

export function getSqlite() {
  if (!sqlite) {
    const file = resolveSqlitePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    sqlite = new Database(file);
    sqlite.pragma('journal_mode = WAL');
    sqlite.pragma('foreign_keys = ON');
  }
  return sqlite;
}

export function getDb() {
  if (!dbInstance) dbInstance = drizzle(getSqlite(), { schema });
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

export { schema };

/**
 * Re-seed the Compendium's core-rulebook Virtues and Rewards.
 *
 * migrate() already does this at server start, so this script only exists for
 * when you want to force a refresh after editing shared/compendium.js. It is
 * idempotent and never touches home-brew (`source = 'custom'`) entries. Works
 * against either dialect — reads DB_CLIENT/DATABASE_URL the same way the
 * server does.
 *
 *   npm run seed:compendium
 */

import { eq } from 'drizzle-orm';
import { migrate } from '../server/db/migrate.js';
import { db, getPgPool, schema } from '../server/db/index.js';
import { config } from '../server/config.js';

await migrate();

const virtues = (await db.select().from(schema.virtues).where(eq(schema.virtues.source, 'core'))).length;
const rewards = (
  await db.select().from(schema.rewardDefinitions).where(eq(schema.rewardDefinitions.source, 'core'))
).length;
const items = (await db.select().from(schema.itemsCatalogue)).length;
const locations = (await db.select().from(schema.locations)).length;

console.log(
  `Compendium seeded — ${virtues} core Virtues, ${rewards} core Rewards. ` +
    `Catalogue holds ${items} item(s) and ${locations} location(s); both are yours to fill in.`,
);

if (config.dbClient === 'pg') await getPgPool().end();
process.exit(0);

/**
 * Re-seed the Compendium's core-rulebook Virtues and Rewards.
 *
 * migrate() already does this at server start, so this script only exists for
 * when you want to force a refresh after editing shared/compendium.js. It is
 * idempotent and never touches home-brew (`source = 'custom'`) entries.
 *
 *   npm run seed:compendium
 */

import { migrate } from '../server/db/migrate.js';
import { getSqlite } from '../server/db/index.js';

migrate();

const sqlite = getSqlite();
const virtues = sqlite.prepare("SELECT COUNT(*) AS n FROM virtues WHERE source = 'core'").get();
const rewards = sqlite
  .prepare("SELECT COUNT(*) AS n FROM reward_definitions WHERE source = 'core'")
  .get();
const items = sqlite.prepare('SELECT COUNT(*) AS n FROM items_catalogue').get();
const locations = sqlite.prepare('SELECT COUNT(*) AS n FROM locations').get();

console.log(
  `Compendium seeded — ${virtues.n} core Virtues, ${rewards.n} core Rewards. ` +
    `Catalogue holds ${items.n} item(s) and ${locations.n} location(s); both are yours to fill in.`,
);

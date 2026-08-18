/**
 * Seed the Compendium's core-rulebook entries.
 *
 * Runs as part of migrate(), so a fresh database comes up with the six general
 * Virtues, the 60 Cultural Virtues, the six Rewards and the core weapon /
 * armour / shield tables already on the shelf. Idempotent and non-destructive:
 * `source = 'core'` rows are inserted if missing and refreshed in place if the
 * seed text changes, and nothing ever touches a `source = 'custom'` row the
 * table has added itself.
 *
 * Cultural Virtues are keyed on (name, culture), not name alone — several
 * Virtue names appear under more than one culture (Bree Hobbits share four of
 * theirs with Men of Bree and two with Hobbits of the Shire), and catalogue
 * items are keyed on (kind, name) for the same reason.
 */

import { CORE_VIRTUES, coreCatalogueItems, coreRewardDefinitions } from '../../shared/compendium.js';
import { CULTURAL_VIRTUES } from '../../shared/culturalVirtues.js';

function newId() {
  return crypto.randomUUID();
}

export function seedCompendium(sqlite) {
  const nowIso = new Date().toISOString();

  const findVirtue = sqlite.prepare("SELECT id FROM virtues WHERE name = ? AND source = 'core'");
  const insertVirtue = sqlite.prepare(
    `INSERT INTO virtues (id, name, effect, source, created_at, updated_at)
       VALUES (?, ?, ?, 'core', ?, ?)`,
  );
  const updateVirtue = sqlite.prepare('UPDATE virtues SET effect = ?, updated_at = ? WHERE id = ?');

  for (const virtue of CORE_VIRTUES) {
    const existing = findVirtue.get(virtue.name);
    if (existing) updateVirtue.run(virtue.effect, nowIso, existing.id);
    else insertVirtue.run(newId(), virtue.name, virtue.effect, nowIso, nowIso);
  }

  const findReward = sqlite.prepare(
    "SELECT id FROM reward_definitions WHERE name = ? AND source = 'core'",
  );
  const insertReward = sqlite.prepare(
    `INSERT INTO reward_definitions (id, name, code, applies_to, summary, tiers, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'core', ?, ?)`,
  );
  const updateReward = sqlite.prepare(
    `UPDATE reward_definitions
        SET code = ?, applies_to = ?, summary = ?, tiers = ?, updated_at = ?
      WHERE id = ?`,
  );

  for (const reward of coreRewardDefinitions()) {
    const appliesTo = JSON.stringify(reward.appliesTo);
    const tiers = JSON.stringify(reward.tiers);
    const existing = findReward.get(reward.name);
    if (existing) {
      updateReward.run(reward.code, appliesTo, reward.summary, tiers, nowIso, existing.id);
    } else {
      insertReward.run(
        newId(),
        reward.name,
        reward.code,
        appliesTo,
        reward.summary,
        tiers,
        nowIso,
        nowIso,
      );
    }
  }

  seedCulturalVirtues(sqlite, nowIso);
  seedCatalogueItems(sqlite, nowIso);

  return true;
}

function seedCulturalVirtues(sqlite, nowIso) {
  const find = sqlite.prepare(
    "SELECT id FROM cultural_virtues WHERE name = ? AND culture = ? AND source = 'core'",
  );
  const insert = sqlite.prepare(
    `INSERT INTO cultural_virtues (id, name, description, culture, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'core', ?, ?)`,
  );
  const update = sqlite.prepare(
    'UPDATE cultural_virtues SET description = ?, updated_at = ? WHERE id = ?',
  );

  for (const virtue of CULTURAL_VIRTUES) {
    const existing = find.get(virtue.name, virtue.culture);
    if (existing) update.run(virtue.description, nowIso, existing.id);
    else insert.run(newId(), virtue.name, virtue.description, virtue.culture, nowIso, nowIso);
  }
}

function seedCatalogueItems(sqlite, nowIso) {
  const find = sqlite.prepare(
    "SELECT id FROM items_catalogue WHERE kind = ? AND name = ? AND source = 'core'",
  );
  const insert = sqlite.prepare(
    `INSERT INTO items_catalogue
       (id, kind, name, type, proficiency, damage, injury, injury_two_handed,
        protection, parry, load, min_standard, notes, source, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'core', ?, ?)`,
  );
  const update = sqlite.prepare(
    `UPDATE items_catalogue
        SET type = ?, proficiency = ?, damage = ?, injury = ?, injury_two_handed = ?,
            protection = ?, parry = ?, load = ?, min_standard = ?, notes = ?, updated_at = ?
      WHERE id = ?`,
  );

  for (const item of coreCatalogueItems()) {
    const existing = find.get(item.kind, item.name);
    if (existing) {
      update.run(
        item.type,
        item.proficiency,
        item.damage,
        item.injury,
        item.injuryTwoHanded,
        item.protection,
        item.parry,
        item.load,
        item.minStandard,
        item.notes,
        nowIso,
        existing.id,
      );
    } else {
      insert.run(
        newId(),
        item.kind,
        item.name,
        item.type,
        item.proficiency,
        item.damage,
        item.injury,
        item.injuryTwoHanded,
        item.protection,
        item.parry,
        item.load,
        item.minStandard,
        item.notes,
        nowIso,
        nowIso,
      );
    }
  }
}

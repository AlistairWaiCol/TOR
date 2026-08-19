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
 *
 * Written against the Drizzle query builder rather than raw SQL, so it runs
 * unchanged against either dialect — no `sqlite`/`pg` branch needed here.
 */

import { and, eq } from 'drizzle-orm';
import { db, schema } from './index.js';
import { CORE_VIRTUES, coreCatalogueItems, coreRewardDefinitions } from '../../shared/compendium.js';
import { CULTURAL_VIRTUES } from '../../shared/culturalVirtues.js';

function newId() {
  return crypto.randomUUID();
}

export async function seedCompendium() {
  const nowIso = new Date().toISOString();

  for (const virtue of CORE_VIRTUES) {
    const [existing] = await db
      .select({ id: schema.virtues.id })
      .from(schema.virtues)
      .where(and(eq(schema.virtues.name, virtue.name), eq(schema.virtues.source, 'core')));
    if (existing) {
      await db
        .update(schema.virtues)
        .set({ effect: virtue.effect, updatedAt: nowIso })
        .where(eq(schema.virtues.id, existing.id));
    } else {
      await db.insert(schema.virtues).values({
        id: newId(),
        name: virtue.name,
        effect: virtue.effect,
        source: 'core',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  for (const reward of coreRewardDefinitions()) {
    const appliesTo = JSON.stringify(reward.appliesTo);
    const tiers = JSON.stringify(reward.tiers);
    const [existing] = await db
      .select({ id: schema.rewardDefinitions.id })
      .from(schema.rewardDefinitions)
      .where(and(eq(schema.rewardDefinitions.name, reward.name), eq(schema.rewardDefinitions.source, 'core')));
    if (existing) {
      await db
        .update(schema.rewardDefinitions)
        .set({ code: reward.code, appliesTo, summary: reward.summary, tiers, updatedAt: nowIso })
        .where(eq(schema.rewardDefinitions.id, existing.id));
    } else {
      await db.insert(schema.rewardDefinitions).values({
        id: newId(),
        name: reward.name,
        code: reward.code,
        appliesTo,
        summary: reward.summary,
        tiers,
        source: 'core',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }

  await seedCulturalVirtues(nowIso);
  await seedCatalogueItems(nowIso);

  return true;
}

async function seedCulturalVirtues(nowIso) {
  for (const virtue of CULTURAL_VIRTUES) {
    const [existing] = await db
      .select({ id: schema.culturalVirtues.id })
      .from(schema.culturalVirtues)
      .where(
        and(
          eq(schema.culturalVirtues.name, virtue.name),
          eq(schema.culturalVirtues.culture, virtue.culture),
          eq(schema.culturalVirtues.source, 'core'),
        ),
      );
    if (existing) {
      await db
        .update(schema.culturalVirtues)
        .set({ description: virtue.description, updatedAt: nowIso })
        .where(eq(schema.culturalVirtues.id, existing.id));
    } else {
      await db.insert(schema.culturalVirtues).values({
        id: newId(),
        name: virtue.name,
        description: virtue.description,
        culture: virtue.culture,
        source: 'core',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }
}

async function seedCatalogueItems(nowIso) {
  for (const item of coreCatalogueItems()) {
    const [existing] = await db
      .select({ id: schema.itemsCatalogue.id })
      .from(schema.itemsCatalogue)
      .where(
        and(
          eq(schema.itemsCatalogue.kind, item.kind),
          eq(schema.itemsCatalogue.name, item.name),
          eq(schema.itemsCatalogue.source, 'core'),
        ),
      );
    const values = {
      type: item.type,
      proficiency: item.proficiency,
      damage: item.damage,
      injury: item.injury,
      injuryTwoHanded: item.injuryTwoHanded,
      protection: item.protection,
      parry: item.parry,
      load: item.load,
      minStandard: item.minStandard,
      notes: item.notes,
    };
    if (existing) {
      await db
        .update(schema.itemsCatalogue)
        .set({ ...values, updatedAt: nowIso })
        .where(eq(schema.itemsCatalogue.id, existing.id));
    } else {
      await db.insert(schema.itemsCatalogue).values({
        id: newId(),
        kind: item.kind,
        name: item.name,
        ...values,
        source: 'core',
        createdAt: nowIso,
        updatedAt: nowIso,
      });
    }
  }
}

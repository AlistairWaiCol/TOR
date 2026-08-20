/**
 * Compendium CRUD.
 *
 * One generic handler over the four sections declared in shared/compendium.js,
 * so adding NPCs or a Bestiary later means adding a table and a section entry,
 * not another route file.
 *
 * Writes need the player passcode, not the GM one: this app has no per-user
 * ownership (anyone may edit any character sheet), and home-brew gear is normal
 * at the table.
 */

import express from 'express';
import { requireAuth } from '../lib/auth.js';
import {
  COMPENDIUM_SECTION_KEYS,
  compendiumSnapshot,
  createCompendiumEntry,
  deleteCompendiumEntry,
  getCompendiumEntry,
  listCompendium,
  updateCompendiumEntry,
} from '../lib/store.js';
import {
  ADVERSARY_CATEGORIES,
  ADVERSARY_SIZES,
  COMPENDIUM_SECTIONS,
  ITEM_KINDS,
  STANDARDS_OF_LIVING,
  normaliseYears,
} from '../../shared/compendium.js';
import { CULTURAL_VIRTUE_CULTURES } from '../../shared/culturalVirtues.js';
import { PROFICIENCY_GROUPS } from '../../shared/character.js';
import { broadcast } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

function knownSection(req, res, next) {
  if (!COMPENDIUM_SECTION_KEYS.includes(req.params.section)) {
    return res.status(404).json({ error: `Unknown Compendium section "${req.params.section}".` });
  }
  return next();
}

/**
 * Per-section input tidying. Everything else is handled generically by the
 * store's field list, which silently drops anything it does not know about.
 */
function cleanBody(section, body = {}) {
  const out = { ...body };
  delete out.id;
  delete out.createdAt;
  delete out.updatedAt;
  if (section === 'locations' && 'years' in out) out.years = normaliseYears(out.years);
  if (section === 'items') {
    if ('kind' in out && !ITEM_KINDS.includes(out.kind)) out.kind = 'weapon';
    if ('proficiency' in out && out.proficiency && !PROFICIENCY_GROUPS.includes(out.proficiency)) {
      out.proficiency = '';
    }
    // Minimum Standard of Living is a hint, so an unrecognised value is simply
    // dropped rather than rejected — nothing downstream depends on it.
    if ('minStandard' in out && out.minStandard && !STANDARDS_OF_LIVING.includes(out.minStandard)) {
      out.minStandard = '';
    }
  }
  if (section === 'adversaries') {
    if ('category' in out && !ADVERSARY_CATEGORIES.includes(out.category)) out.category = 'Other';
    const sizeValues = ADVERSARY_SIZES.map((s) => s.value);
    if ('size' in out && !sizeValues.includes(out.size)) out.size = 'human';
  }
  // Only the seeder writes 'core'; anything the app creates is home-brew.
  if ('source' in out && out.source !== 'core') out.source = 'custom';
  return out;
}

/** Everything at once — the Compendium page and the character sheet pickers. */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({
      sections: COMPENDIUM_SECTIONS,
      itemKinds: ITEM_KINDS,
      proficiencyGroups: PROFICIENCY_GROUPS,
      standardsOfLiving: STANDARDS_OF_LIVING,
      cultures: CULTURAL_VIRTUE_CULTURES,
      ...(await compendiumSnapshot()),
    });
  }),
);

router.get(
  '/:section',
  requireAuth,
  knownSection,
  asyncHandler(async (req, res) => {
    res.json({ section: req.params.section, entries: await listCompendium(req.params.section) });
  }),
);

router.post(
  '/:section',
  requireAuth,
  knownSection,
  asyncHandler(async (req, res) => {
    const entry = await createCompendiumEntry(
      req.params.section,
      cleanBody(req.params.section, req.body ?? {}),
    );
    broadcast('compendium:update', { section: req.params.section, entry });
    res.status(201).json({ entry });
  }),
);

router.patch(
  '/:section/:id',
  requireAuth,
  knownSection,
  asyncHandler(async (req, res) => {
    const entry = await updateCompendiumEntry(
      req.params.section,
      req.params.id,
      cleanBody(req.params.section, req.body ?? {}),
    );
    if (!entry) return res.status(404).json({ error: 'Entry not found.' });
    broadcast('compendium:update', { section: req.params.section, entry });
    return res.json({ entry });
  }),
);

router.delete(
  '/:section/:id',
  requireAuth,
  knownSection,
  asyncHandler(async (req, res) => {
    const existing = await getCompendiumEntry(req.params.section, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Entry not found.' });
    await deleteCompendiumEntry(req.params.section, req.params.id);
    broadcast('compendium:deleted', { section: req.params.section, id: req.params.id });
    return res.json({ ok: true });
  }),
);

export default router;

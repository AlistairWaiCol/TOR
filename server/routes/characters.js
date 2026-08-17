import express from 'express';
import { requireAuth } from '../lib/auth.js';
import {
  createCharacter,
  deleteCharacter,
  getCharacter,
  listCharacters,
  replaceCharacterSheet,
  updateCharacter,
} from '../lib/store.js';
import { performRoll } from '../lib/rollService.js';
import { broadcast, broadcastSnapshot } from '../realtime.js';
import {
  ATTRIBUTES,
  CONDITIONS,
  FAVOUR_STATES,
  PROFICIENCY_GROUPS,
  STANCES,
  emptyCharacterSheet,
} from '../../shared/character.js';
import { ARMOUR_QUALITIES, SHIELD_QUALITIES, WEAPON_QUALITIES } from '../../shared/rewards.js';
import { SPECIAL_SUCCESS_OPTIONS } from '../../shared/dice.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

// Everything a client needs to render the sheet without hardcoding rules data.
router.get('/meta', requireAuth, (_req, res) => {
  res.json({
    attributes: ATTRIBUTES,
    proficiencyGroups: PROFICIENCY_GROUPS,
    stances: STANCES,
    conditions: CONDITIONS,
    favourStates: FAVOUR_STATES,
    weaponQualities: WEAPON_QUALITIES,
    armourQualities: ARMOUR_QUALITIES,
    shieldQualities: SHIELD_QUALITIES,
    specialSuccesses: SPECIAL_SUCCESS_OPTIONS,
    emptySheet: emptyCharacterSheet(),
  });
});

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ characters: await listCharacters() });
  }),
);

router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const character = await createCharacter({
      name: req.body?.name,
      player: req.body?.player,
      culture: req.body?.culture,
      sheet: req.body?.sheet,
    });
    broadcast('character:update', character);
    await broadcastSnapshot();
    res.status(201).json({ character });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const character = await getCharacter(req.params.id);
    if (!character) return res.status(404).json({ error: 'Character not found.' });
    return res.json({ character });
  }),
);

/** Partial update — merges section by section. */
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const character = await updateCharacter(req.params.id, req.body ?? {});
    if (!character) return res.status(404).json({ error: 'Character not found.' });
    broadcast('character:update', character);
    return res.json({ character });
  }),
);

/** Full sheet replace — what the sheet editor's Save button uses. */
router.put(
  '/:id/sheet',
  requireAuth,
  asyncHandler(async (req, res) => {
    const character = await replaceCharacterSheet(req.params.id, req.body?.sheet ?? {}, {
      player: req.body?.player,
    });
    if (!character) return res.status(404).json({ error: 'Character not found.' });
    broadcast('character:update', character);
    await broadcastSnapshot();
    return res.json({ character });
  }),
);

router.delete(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    await deleteCharacter(req.params.id);
    broadcast('character:deleted', { id: req.params.id });
    await broadcastSnapshot();
    res.json({ ok: true });
  }),
);

/**
 * Every roll icon on the sheet posts here. The sheet's current
 * Favoured/Ill-favoured selection and Weary/Miserable state are applied
 * automatically by the roll service unless explicitly overridden.
 */
router.post(
  '/:id/roll',
  requireAuth,
  asyncHandler(async (req, res) => {
    const outcome = await performRoll({ ...req.body, characterId: req.params.id });
    res.json({
      roll: outcome.roll,
      result: outcome.result,
      message: outcome.message,
      discord: outcome.discord,
      hopeError: outcome.hopeError,
      character: outcome.character ? await getCharacter(req.params.id) : null,
    });
  }),
);

export default router;


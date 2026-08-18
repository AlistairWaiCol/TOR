import express from 'express';
import { requireAuth, requireGM } from '../lib/auth.js';
import * as engine from '../lib/travelEngine.js';
import { JOURNEY_EVENTS, TRAVEL_ROLES } from '../../shared/journey.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const snapshot = await engine.travelSnapshot();
    res.json({ ...snapshot, eventTable: JOURNEY_EVENTS, roles: TRAVEL_ROLES });
  }),
);

router.get(
  '/preview',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await engine.previewJourneyMaths());
  }),
);

router.post(
  '/start',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.startJourney(req.body ?? {}));
  }),
);

/**
 * The Guide's own TRAVEL roll, and the Guide is a player — so this takes the
 * player passcode, the same as `/resolve` and `/fatigue-roll`. The GM's button
 * on the Map page still fires it too; nothing here is GM-gated any more.
 *
 * There is nothing to check the roller's identity against: this app has no
 * per-user accounts, and the "who am I playing" selector is a browser-local
 * preference, not a login. Which is the same footing every other player-level
 * write in the app already stands on.
 */
router.post(
  '/marching-test',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.rollMarchingTest(req.body ?? {}));
  }),
);

router.post(
  '/pin',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.pinEventHex({ col: Number(req.body?.col), row: Number(req.body?.row) }));
  }),
);

router.delete(
  '/pin',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.clearPin());
  }),
);

router.post(
  '/place-event',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(
      await engine.placeEventDirectly({ col: Number(req.body?.col), row: Number(req.body?.row) }),
    );
  }),
);

router.post(
  '/select-target',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.rollSelectTarget());
  }),
);

router.post(
  '/assign-target',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.assignEventTarget({ characterId: req.body?.characterId }));
  }),
);

router.post(
  '/determine-event',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.rollDetermineEvent());
  }),
);

/** The targeted PLAYER makes this roll (spec §2), so player passcode is enough. */
router.post(
  '/resolve',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.resolveEvent(req.body ?? {}));
  }),
);

router.post(
  '/finish',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.finishJourney());
  }),
);

/** Each hero rolls their own end-of-journey TRAVEL test. */
router.post(
  '/fatigue-roll',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.rollFatigueRelief(req.body ?? {}));
  }),
);

router.post(
  '/close',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.closeJourney());
  }),
);

router.post(
  '/abandon',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.abandonJourney());
  }),
);

export default router;


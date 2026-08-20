import express from 'express';
import { requireAuth, requireGM } from '../lib/auth.js';
import * as engine from '../lib/combatEngine.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json(await engine.combatSnapshot());
  }),
);

router.post(
  '/start',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.startCombat());
  }),
);

router.post(
  '/end',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.endCombat());
  }),
);

router.post(
  '/next-round',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.nextRound());
  }),
);

router.post(
  '/adversaries',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.addAdversaries(req.body ?? {}));
  }),
);

router.patch(
  '/combatants/:id',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.editCombatant(req.params.id, req.body ?? {}));
  }),
);

/** Any player may set a stance — same footing as party roles and route drawing. */
router.post(
  '/stance',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.setStance(req.body ?? {}));
  }),
);

router.post(
  '/lock-stances',
  requireGM,
  asyncHandler(async (_req, res) => {
    res.json(await engine.lockStances());
  }),
);

router.post(
  '/engage',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.setEngagement(req.body ?? {}));
  }),
);

router.post(
  '/attack',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.attack(req.body ?? {}));
  }),
);

/** GM-triggered: a combatant instance attacks a Player-hero. */
router.post(
  '/adversary-attack',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.adversaryAttack(req.body ?? {}));
  }),
);

/** The hit hero's own choice: take it, or spend the next main action on Knockback. */
router.post(
  '/resolve-hit',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.resolveHit(req.body ?? {}));
  }),
);

/** The hit player rolls PROTECTION themselves, from inside the same pop-up. */
router.post(
  '/protection-roll',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.protectionRoll(req.body ?? {}));
  }),
);

router.post(
  '/wound-severity',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.recordWoundSeverity(req.body ?? {}));
  }),
);

/** Intimidate Foe / Rally Comrades / Protect Companion / Prepare Shot / Battle. */
router.post(
  '/action',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.performTacticalAction(req.body ?? {}));
  }),
);

router.post(
  '/retreat',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json(await engine.retreat(req.body ?? {}));
  }),
);

/** Same Discord plumbing the journey engine uses (spec: Fell Ability speech-bubble). */
router.post(
  '/fell-ability-announce',
  requireGM,
  asyncHandler(async (req, res) => {
    res.json(await engine.announceFellAbility(req.body ?? {}));
  }),
);

export default router;

import express from 'express';
import { requireAuth, requireGM } from '../lib/auth.js';
import { getActiveCalibration, getParty, updateParty } from '../lib/store.js';
import { ROLE_KEYS, TRAVEL_ROLES, validateRoleAssignments } from '../../shared/journey.js';
import { broadcast, broadcastSnapshot } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const party = await getParty();
    const calibration = await getActiveCalibration();
    res.json({
      party,
      roles: TRAVEL_ROLES,
      calibrationId: calibration?.id ?? null,
      roleCheck: validateRoleAssignments(party.roles),
    });
  }),
);

/** Route drawing, mounted / forced-march toggles. Any player may do these. */
router.patch(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const party = await getParty();
    const patch = {};

    if (req.body.route != null) {
      if (party.routeLocked && !req.isGM) {
        return res.status(403).json({ error: 'The route is locked by the GM.' });
      }
      patch.route = (Array.isArray(req.body.route) ? req.body.route : []).map((h) => ({
        col: Number(h.col),
        row: Number(h.row),
      }));
    }
    if (req.body.mounted != null) patch.mounted = Boolean(req.body.mounted);
    if (req.body.forcedMarch != null) {
      // Forced March is a GM toggle (spec §6d: "the GM can toggle Forced March").
      if (!req.isGM) return res.status(403).json({ error: 'Forced March is a GM toggle.' });
      patch.forcedMarch = Boolean(req.body.forcedMarch);
    }
    if (req.body.routeLocked != null) {
      if (!req.isGM) return res.status(403).json({ error: 'Only the GM can lock the route.' });
      patch.routeLocked = Boolean(req.body.routeLocked);
    }
    if (req.body.currentCol != null || req.body.currentRow != null) {
      if (!req.isGM) return res.status(403).json({ error: 'Only the GM can move the party token.' });
      if (req.body.currentCol != null) patch.currentCol = Number(req.body.currentCol);
      if (req.body.currentRow != null) patch.currentRow = Number(req.body.currentRow);
    }
    if (req.body.calibrationId != null) {
      if (!req.isGM) return res.status(403).json({ error: 'GM only.' });
      patch.calibrationId = req.body.calibrationId;
    }

    const updated = await updateParty(patch);
    broadcast('party:update', updated);
    await broadcastSnapshot();
    return res.json({ party: updated, roleCheck: validateRoleAssignments(updated.roles) });
  }),
);

/**
 * Role assignment. Enforces exactly one Guide and all four roles covered
 * (spec §6c) — but only as a warning surfaced to the UI when incomplete, so
 * players can build the assignment up one hero at a time. The journey-start
 * check is the hard gate.
 */
router.put(
  '/roles',
  requireAuth,
  asyncHandler(async (req, res) => {
    const incoming = req.body?.roles ?? {};
    const roles = {};
    for (const [characterId, roleKey] of Object.entries(incoming)) {
      if (roleKey && ROLE_KEYS.includes(roleKey)) roles[characterId] = roleKey;
    }
    const guides = Object.values(roles).filter((r) => r === 'guide').length;
    if (guides > 1) {
      return res.status(400).json({ error: 'Only one hero may be the Guide.' });
    }
    const updated = await updateParty({ roles });
    broadcast('party:update', updated);
    await broadcastSnapshot();
    return res.json({ party: updated, roleCheck: validateRoleAssignments(roles) });
  }),
);

router.post(
  '/clear-route',
  requireGM,
  asyncHandler(async (_req, res) => {
    const updated = await updateParty({ route: [], routeLocked: false });
    broadcast('party:update', updated);
    await broadcastSnapshot();
    res.json({ party: updated });
  }),
);

export default router;


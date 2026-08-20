import express from 'express';
import { requireAuth } from '../lib/auth.js';
import { getActiveCalibration, getParty, updateParty } from '../lib/store.js';
import { ROLE_KEYS, TRAVEL_ROLES, validateRoleAssignments } from '../../shared/journey.js';
import { snapPathToHexes } from '../../shared/hexMath.js';
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
      // A route set this way (hex clicks, not a freehand stroke) has no drawn
      // line behind it — clear any stale one so the player map does not keep
      // showing an old freehand path over an unrelated new route.
      patch.drawnPath = [];
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

/**
 * Clearing the route is player-level, like drawing one — a player who has just
 * drawn a wrong line should not have to ask the GM to rub it out.
 *
 * A LOCKED route is the GM's, though, so a player clearing one is refused here
 * and not merely hidden in the UI: the same state check `PATCH /` already makes
 * before accepting a new route, for the same reason.
 */
router.post(
  '/clear-route',
  requireAuth,
  asyncHandler(async (req, res) => {
    const party = await getParty();
    if (party.routeLocked && !req.isGM) {
      return res.status(403).json({ error: 'The route is locked by the GM.' });
    }
    const updated = await updateParty({ route: [], drawnPath: [], routeLocked: false });
    broadcast('party:update', updated);
    await broadcastSnapshot();
    return res.json({ party: updated });
  }),
);

/**
 * The player-side freehand route tool: a drawn polyline in ORIGINAL-image pixel
 * coordinates becomes exactly the same `[{col,row}]` route the GM's click tool
 * produces (see snapPathToHexes in shared/hexMath.js).
 *
 * The snapping happens HERE rather than in the browser because the server owns
 * the calibration — the client sends only what the finger drew, and never has
 * to know where a hex boundary is. Same lock check as every other route write.
 */
router.post(
  '/draw-route',
  requireAuth,
  asyncHandler(async (req, res) => {
    const party = await getParty();
    if (party.routeLocked && !req.isGM) {
      return res.status(403).json({ error: 'The route is locked by the GM.' });
    }
    const calibration = await getActiveCalibration();
    if (!calibration) return res.status(400).json({ error: 'No map is calibrated yet.' });

    const points = (Array.isArray(req.body?.points) ? req.body.points : [])
      .map((p) => ({ x: Number(p?.x), y: Number(p?.y) }))
      .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
    if (points.length < 2) {
      return res.status(400).json({ error: 'A drawn route needs at least two points.' });
    }

    const route = snapPathToHexes(points, calibration);
    if (route.length < 1) return res.status(400).json({ error: 'That line did not cross any hex.' });

    // The raw trail is kept alongside the snapped route so the player-side map
    // can draw the smooth line the player actually traced, instead of the
    // hex-by-hex highlight — see HexMap.jsx's `drawnPath` handling.
    const updated = await updateParty({ route, drawnPath: points });
    broadcast('party:update', updated);
    await broadcastSnapshot();
    return res.json({ party: updated, route });
  }),
);

export default router;


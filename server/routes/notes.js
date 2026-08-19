/**
 * Adventure Notes — the table's shared scratchpad, one entry per Year + Season.
 *
 * Two deliberate differences from Handouts, the other Year/Season-scoped
 * feature:
 *
 * 1. **Writes are player-level, not GM-only.** A handout's whole point is that
 *    the GM decides when the table sees it; these are the table's own notes,
 *    the same access level a character sheet has. There is no hidden concept
 *    here at all, so nothing needs filtering per role.
 *
 * 2. **One entry per Year + Season, upserted.** There is no create step in the
 *    UI — you pick a season and start typing — so there is no POST/PATCH split
 *    either. `PUT /:year/:season` writes whichever it turns out to be.
 *
 * Mutations broadcast a bare `notes:changed` ping and the page refetches, the
 * same shape Handouts uses: notes are not in the Socket.IO snapshot, because
 * the snapshot is for the live map view and this is not that.
 */

import express from 'express';
import { requireAuth } from '../lib/auth.js';
import {
  deleteAdventureNote,
  getAdventureNote,
  listAdventureNotes,
  saveAdventureNote,
} from '../lib/store.js';
import { SEASONS } from '../../shared/journey.js';
import { broadcast } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

/** A Year/Season pair off the URL, or null if the Season is not one of the four. */
function whenFromParams(params) {
  const year = Number(params.year);
  if (!Number.isFinite(year)) return null;
  if (!SEASONS.includes(params.season)) return null;
  return { year, season: params.season };
}

/**
 * The whole set. Small by construction — four seasons a year for a campaign
 * measured in years — and the page wants to show which seasons hold anything,
 * so paginating or filtering server-side would buy nothing.
 */
router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const notes = await listAdventureNotes();
    res.json({ notes, seasons: SEASONS });
  }),
);

/** One season's note. 200 with `note: null` when nothing has been written yet — */
/* that is an empty page ready to type into, not a missing resource. */
router.get(
  '/:year/:season',
  requireAuth,
  asyncHandler(async (req, res) => {
    const when = whenFromParams(req.params);
    if (!when) return res.status(400).json({ error: 'Give a year and one of the four seasons.' });
    const note = await getAdventureNote(when.year, when.season);
    return res.json({ note: note ?? null, ...when });
  }),
);

router.put(
  '/:year/:season',
  requireAuth,
  asyncHandler(async (req, res) => {
    const when = whenFromParams(req.params);
    if (!when) return res.status(400).json({ error: 'Give a year and one of the four seasons.' });
    const note = await saveAdventureNote({
      ...when,
      title: req.body?.title ?? '',
      body: req.body?.body ?? '',
    });
    broadcast('notes:changed', { year: when.year, season: when.season });
    return res.json({ note });
  }),
);

router.delete(
  '/:year/:season',
  requireAuth,
  asyncHandler(async (req, res) => {
    const when = whenFromParams(req.params);
    if (!when) return res.status(400).json({ error: 'Give a year and one of the four seasons.' });
    await deleteAdventureNote(when.year, when.season);
    broadcast('notes:changed', { ...when, deleted: true });
    return res.json({ ok: true });
  }),
);

export default router;

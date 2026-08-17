import express from 'express';
import { requireAuth, requireGM } from '../lib/auth.js';
import {
  deleteJourney,
  getJourney,
  listCharacters,
  listJourneyEvents,
  listJourneys,
  rollsForJourney,
  updateJourney,
  updateJourneyEvent,
} from '../lib/store.js';
import { regionLabel, roleLabel } from '../../shared/journey.js';
import { broadcast } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ journeys: await listJourneys() });
  }),
);

router.get(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const journey = await getJourney(req.params.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found.' });
    const [events, rolls, characters] = await Promise.all([
      listJourneyEvents(journey.id),
      rollsForJourney(journey.id),
      listCharacters(),
    ]);
    return res.json({
      journey,
      events,
      rolls,
      characters: characters.map((c) => ({ id: c.id, name: c.name })),
    });
  }),
);

/** Whole-journey notes / title. */
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.notes != null) patch.notes = String(req.body.notes);
    if (req.body.title != null) patch.title = String(req.body.title);
    const journey = await updateJourney(req.params.id, patch);
    if (!journey) return res.status(404).json({ error: 'Journey not found.' });
    broadcast('journey:update', journey);
    return res.json({ journey });
  }),
);

/** Per-event notes. */
router.patch(
  '/:id/events/:eventId',
  requireAuth,
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.notes != null) patch.notes = String(req.body.notes);
    const event = await updateJourneyEvent(req.params.eventId, patch);
    if (!event) return res.status(404).json({ error: 'Event not found.' });
    broadcast('journey:event', event);
    return res.json({ event });
  }),
);

router.delete(
  '/:id',
  requireGM,
  asyncHandler(async (req, res) => {
    await deleteJourney(req.params.id);
    broadcast('journey:deleted', { id: req.params.id });
    res.json({ ok: true });
  }),
);

/**
 * Export. Markdown mirrors the paper Journey Log layout from spec §6f; this is
 * a travel-mechanics record only and is never written into the user's own
 * campaign documents.
 */
router.get(
  '/:id/export',
  requireAuth,
  asyncHandler(async (req, res) => {
    const journey = await getJourney(req.params.id);
    if (!journey) return res.status(404).json({ error: 'Journey not found.' });
    const [events, characters] = await Promise.all([
      listJourneyEvents(journey.id),
      listCharacters(),
    ]);
    const nameOf = (id) => characters.find((c) => c.id === id)?.name ?? 'unknown';

    if ((req.query.format || 'md') === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="journey-${journey.id}.json"`);
      return res.send(JSON.stringify({ journey, events }, null, 2));
    }

    const lines = [];
    lines.push(`# Journey Log — ${journey.fromLabel || journey.fromHex} → ${journey.toLabel || journey.toHex}`);
    lines.push('');
    lines.push(`- **Year / Season:** ${journey.year} · ${journey.season}`);
    lines.push(`- **Route:** ${journey.route.map((h) => `(${h.col},${h.row})`).join(' → ')}`);
    lines.push(`- **Hexes traversed:** ${journey.hexesTraversed} (of ${Math.max(0, journey.route.length - 1)})`);
    lines.push(`- **Hard-terrain days:** ${journey.hardTerrainHexes}`);
    lines.push(`- **Mishap / Short Cut day adjustments:** ${journey.dayAdjustments >= 0 ? '+' : ''}${journey.dayAdjustments}`);
    lines.push(`- **Forced March:** ${journey.forcedMarch ? 'yes' : 'no'} · **Mounted:** ${journey.mounted ? 'yes' : 'no'}`);
    lines.push(`- **Total days:** ${journey.totalDays}`);
    lines.push(`- **Status:** ${journey.status}`);
    lines.push('');

    const roleList = Object.entries(journey.roles || {})
      .map(([id, role]) => `${nameOf(id)} — ${roleLabel(role)}`)
      .join(', ');
    if (roleList) {
      lines.push(`**Roles:** ${roleList}`);
      lines.push('');
    }

    lines.push('## Events');
    lines.push('');
    let n = 0;
    for (const e of events) {
      if (e.kind === 'marching_test') {
        lines.push(`*Marching Test* — ${e.consequence} → hex (${e.col},${e.row})`);
        if (e.notes) lines.push(`  > ${e.notes}`);
        lines.push('');
        continue;
      }
      n += 1;
      const tags = [regionLabel(e.regionType)];
      if (e.hardTerrain) tags.push('hard terrain');
      if (e.road) tags.push('road');
      if (e.perilous) tags.push('perilous area');
      lines.push(
        `**Event ${n}** — Hex (${e.col},${e.row}) (${tags.join(', ')}) — ` +
          `Target: ${roleLabel(e.targetRole)}${e.targetCharacterId ? ` (${nameOf(e.targetCharacterId)})` : ''} — ` +
          `Feat Die ${e.featFace}: **${e.eventName}** — ` +
          `${e.targetSkill.toUpperCase()} roll: ${e.outcome === 'success' ? 'Succeeded' : e.outcome === 'failure' ? 'Failed' : e.outcome} — ` +
          `Consequence: ${e.consequence} — Company Fatigue: +${e.companyFatigue} each`,
      );
      if (e.detail?.applied?.length) lines.push(`  - Applied: ${e.detail.applied.join('; ')}`);
      lines.push(`  - *Notes:* ${e.notes || '_(none)_'}`);
      lines.push('');
    }

    if (journey.summary?.days) {
      const d = journey.summary.days;
      lines.push('## Ending the Journey');
      lines.push('');
      lines.push(`- March days: ${d.marchDays}${d.forcedMarch ? ' (forced march, 1 day per 2 hexes)' : ''}`);
      lines.push(`- Hard-terrain days: +${d.hardTerrainDays}`);
      lines.push(`- Day adjustments: ${d.dayAdjustments >= 0 ? '+' : ''}${d.dayAdjustments}`);
      lines.push(`- Subtotal: ${d.beforeMount}${d.mounted ? ` → halved for mounted travel = ${d.totalDays}` : ''}`);
      lines.push(`- **Total: ${d.totalDays} days**`);
      if (d.forcedMarchFatigue) lines.push(`- Forced March Fatigue: +${d.forcedMarchFatigue} each`);
      lines.push('');
      for (const entry of Object.values(journey.summary.relief ?? {})) {
        lines.push(
          `- ${entry.name}: Fatigue ${entry.startingFatigue}` +
            (entry.mountReduction ? ` −${entry.mountReduction} (mount ${entry.mountName || ''} Vigour ${entry.mountVigour})` : '') +
            (entry.rollReduction ? ` −${entry.rollReduction} (TRAVEL roll)` : '') +
            ` → ${entry.finalFatigue}`,
        );
      }
      lines.push('');
    }

    lines.push('## Journey Notes');
    lines.push('');
    lines.push(journey.notes || '_(none)_');
    lines.push('');

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="journey-${journey.id}.md"`);
    return res.send(lines.join('\n'));
  }),
);

export default router;


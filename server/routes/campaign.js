import express from 'express';
import { requireAuth, requireGM } from '../lib/auth.js';
import { getCampaign, listJourneys, updateCampaign } from '../lib/store.js';
import { SEASONS } from '../../shared/journey.js';
import { DEFAULT_TN_BASE, SHORT_CAMPAIGN_TN_BASE } from '../../shared/dice.js';
import { MAX_DAY_HOLD_SECONDS, MIN_DAY_HOLD_SECONDS } from '../../shared/journey.js';
import { broadcast, broadcastSnapshot } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

router.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    const [campaign, journeys] = await Promise.all([getCampaign(), listJourneys()]);
    res.json({
      campaign,
      seasons: SEASONS,
      tnBases: [DEFAULT_TN_BASE, SHORT_CAMPAIGN_TN_BASE],
      dayHoldSecondsRange: [MIN_DAY_HOLD_SECONDS, MAX_DAY_HOLD_SECONDS],
      journeys: journeys.map((j) => ({
        id: j.id,
        title: j.title,
        year: j.year,
        season: j.season,
        fromLabel: j.fromLabel,
        toLabel: j.toLabel,
        totalDays: j.totalDays,
        status: j.status,
        mounted: j.mounted,
        forcedMarch: j.forcedMarch,
        createdAt: j.createdAt,
        endedAt: j.endedAt,
      })),
    });
  }),
);

router.patch(
  '/',
  requireGM,
  asyncHandler(async (req, res) => {
    const patch = {};
    if (req.body.year != null) patch.year = Number(req.body.year);
    if (req.body.season != null) {
      if (!SEASONS.includes(req.body.season)) {
        return res.status(400).json({ error: `Season must be one of ${SEASONS.join(', ')}.` });
      }
      patch.season = req.body.season;
    }
    if (req.body.tnBase != null) {
      const base = Number(req.body.tnBase);
      if (base !== DEFAULT_TN_BASE && base !== SHORT_CAMPAIGN_TN_BASE) {
        return res.status(400).json({ error: 'Target Number base must be 20 or 18.' });
      }
      patch.tnBase = base;
    }
    if (req.body.dayHoldSeconds != null) {
      const seconds = Number(req.body.dayHoldSeconds);
      if (!Number.isFinite(seconds) || seconds < MIN_DAY_HOLD_SECONDS || seconds > MAX_DAY_HOLD_SECONDS) {
        return res.status(400).json({
          error: `Day-hold seconds must be between ${MIN_DAY_HOLD_SECONDS} and ${MAX_DAY_HOLD_SECONDS}.`,
        });
      }
      patch.dayHoldSeconds = Math.round(seconds);
    }
    if (req.body.name != null) patch.name = String(req.body.name);
    if (req.body.notes != null) patch.notes = String(req.body.notes);

    const campaign = await updateCampaign(patch);
    broadcast('campaign:update', campaign);
    await broadcastSnapshot();
    return res.json({ campaign });
  }),
);

export default router;


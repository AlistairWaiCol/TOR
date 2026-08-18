import express from 'express';
import { requireAuth, requireGM } from '../lib/auth.js';
import { getRoll, recentRolls, updateRoll } from '../lib/store.js';
import { performRoll } from '../lib/rollService.js';
import { formatMessage, isConfigured, postToDiscord, recentMessages } from '../lib/discord.js';
import { SPECIAL_SUCCESS_OPTIONS } from '../../shared/dice.js';
import { broadcast } from '../realtime.js';
import { asyncHandler } from '../lib/asyncHandler.js';

const router = express.Router();

router.get(
  '/recent',
  requireAuth,
  asyncHandler(async (req, res) => {
    const rolls = await recentRolls(Number(req.query.limit) || 40);
    // Whispered rolls stay out of the shared feed unless you're the GM.
    const visible = req.isGM ? rolls : rolls.filter((r) => r.whisperTo === 'public');
    res.json({ rolls: visible, specialSuccesses: SPECIAL_SUCCESS_OPTIONS });
  }),
);

/** Ad-hoc / custom roll builder, and any roll not tied to a character sheet. */
router.post(
  '/',
  requireAuth,
  asyncHandler(async (req, res) => {
    const outcome = await performRoll(req.body ?? {});
    res.json({
      roll: outcome.roll,
      result: outcome.result,
      message: outcome.message,
      discord: outcome.discord,
      hopeError: outcome.hopeError,
    });
  }),
);

/**
 * Which picks are new since the last PATCH, as a multiset difference. The roll
 * dialog saves on every dropdown change, so only the newly-spent icons are
 * worth announcing — re-posting the whole list each time would spam the channel.
 */
function newlySpent(picks, already) {
  const remaining = [...(already ?? [])];
  const added = [];
  for (const pick of picks) {
    const at = remaining.indexOf(pick);
    if (at >= 0) remaining.splice(at, 1);
    else added.push(pick);
  }
  return added;
}

/**
 * Record Special Success icon spends as tags on the roll. Purely a record —
 * the narrative effects are not mechanically enforced (spec §7.9) — but the
 * choice is announced to Discord as a follow-up to the roll's own post, under
 * the same whisper rule: a whispered roll's spends stay quiet too.
 */
router.patch(
  '/:id',
  requireAuth,
  asyncHandler(async (req, res) => {
    const existing = await getRoll(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Roll not found.' });
    const patch = {};
    if (req.body.specialSuccesses != null) {
      const picks = (Array.isArray(req.body.specialSuccesses) ? req.body.specialSuccesses : [])
        .filter((p) => SPECIAL_SUCCESS_OPTIONS.includes(p));
      if (picks.length > existing.icons) {
        return res
          .status(400)
          .json({ error: `Only ${existing.icons} Success icon(s) were rolled to spend.` });
      }
      if (picks.length && !existing.success) {
        return res
          .status(400)
          .json({ error: 'Special Successes can only be spent on a successful roll.' });
      }
      patch.specialSuccesses = picks;
    }
    if (req.body.note != null) patch.note = String(req.body.note);
    const roll = await updateRoll(req.params.id, patch);

    let discord = null;
    const added = patch.specialSuccesses
      ? newlySpent(patch.specialSuccesses, existing.specialSuccesses)
      : [];
    if (added.length) {
      const actor = roll.characterName || 'Someone';
      const label = roll.label || roll.skill || 'that roll';
      discord = await postToDiscord(
        formatMessage(
          '✨',
          `${actor} spends ${added.length === 1 ? 'a success icon' : `${added.length} success icons`}` +
            ` on ${label}: ${added.join(', ')}`,
        ),
        { whisperTo: roll.whisperTo },
      );
    }

    broadcast('roll:update', { roll });
    return res.json({ roll, discord });
  }),
);

router.get('/discord/status', requireGM, (_req, res) => {
  res.json({ configured: isConfigured(), recent: recentMessages() });
});

export default router;


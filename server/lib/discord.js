/**
 * Discord webhook posting (spec §6e).
 *
 * The URL lives server-side only and is never sent to the client. If
 * DISCORD_WEBHOOK_URL is unset or empty, posting is skipped silently — nothing
 * in the app depends on it being configured.
 *
 * Whispered rolls never post (spec §5: a whispered roll shouldn't reach the
 * public channel).
 */

import { config } from '../config.js';
import { describeRoll } from '../../shared/dice.js';

const recent = [];

export function isConfigured() {
  return Boolean(config.discordWebhookUrl);
}

/** Last few messages we tried to send — surfaced in the GM UI for debugging. */
export function recentMessages(limit = 20) {
  return recent.slice(-limit).reverse();
}

export async function postToDiscord(content, { whisperTo = 'public' } = {}) {
  if (!content) return { posted: false, reason: 'empty' };
  if (whisperTo && whisperTo !== 'public') {
    recent.push({ at: new Date().toISOString(), content, posted: false, reason: 'whispered' });
    return { posted: false, reason: 'whispered' };
  }
  if (!isConfigured()) {
    recent.push({ at: new Date().toISOString(), content, posted: false, reason: 'not-configured' });
    return { posted: false, reason: 'not-configured' };
  }
  try {
    const res = await fetch(config.discordWebhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: content.slice(0, 1900) }),
    });
    const ok = res.ok;
    recent.push({
      at: new Date().toISOString(),
      content,
      posted: ok,
      reason: ok ? 'ok' : `http ${res.status}`,
    });
    return { posted: ok, reason: ok ? 'ok' : `http ${res.status}` };
  } catch (err) {
    // Never let an outbound network failure break a roll.
    recent.push({ at: new Date().toISOString(), content, posted: false, reason: err.message });
    return { posted: false, reason: err.message };
  }
}

const KIND_ICONS = {
  marching_test: '🗺️',
  select_target: '🎯',
  determine_event: '🎲',
  resolution: '⚔️',
  travel_fatigue: '💤',
  skill: '🎲',
  custom: '🎲',
  attack: '🗡️',
  damage: '💥',
  protection: '🛡️',
  parry: '🛡️',
};

/** Short, readable one-liner for a roll — not a wall of JSON. */
export function formatRollMessage({ kind = 'skill', label, actor, result, extra }) {
  const icon = KIND_ICONS[kind] || '🎲';
  const body = describeRoll(result, { label: label || 'Roll', actor });
  return `${icon} ${body}${extra ? ` ${extra}` : ''}`;
}

export function formatMessage(icon, text) {
  return `${icon} ${text}`;
}

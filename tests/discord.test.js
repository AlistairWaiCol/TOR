/**
 * Discord message formatting.
 *
 * The point of these: the app's own roll feed and the Discord post are two
 * renderings of the same roll, and only one of them understands Markdown.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { bold, boldName, formatRollMessage, formatRollMessageForDiscord } from '../server/lib/discord.js';
import { evaluateRoll } from '../shared/dice.js';

/** A deterministic roll: Feat 6 + two dice, total 26 against TN 19. */
const result = evaluateRoll({
  featFaces: [6],
  successValues: [4, 5],
  targetNumber: 14,
});

describe('formatRollMessage (in-app, plain text)', () => {
  it('names the actor without any Markdown', () => {
    const msg = formatRollMessage({ kind: 'attack', label: 'Bow attack', actor: 'Círamdir', result });
    assert.match(msg, /^🗡️ Círamdir rolls Bow attack — /);
    assert.ok(!msg.includes('*'), 'the in-app line must not carry Markdown');
  });

  it('reads sensibly with no actor at all', () => {
    const msg = formatRollMessage({ kind: 'skill', label: 'AWARENESS', result });
    assert.match(msg, /^🎲 rolls AWARENESS — /);
  });
});

describe('formatRollMessageForDiscord', () => {
  it('leads with the rolling hero, in bold', () => {
    const msg = formatRollMessageForDiscord({
      kind: 'attack',
      label: 'Bow attack',
      actor: 'Círamdir',
      result,
    });
    assert.match(msg, /^🗡️ \*\*Círamdir\*\* rolls Bow attack — /);
    // The name must appear bolded exactly once, not doubled up by describeRoll.
    assert.equal(msg.split('Círamdir').length - 1, 1);
  });

  it('carries the same body as the plain form, name aside', () => {
    const args = { kind: 'skill', label: 'TRAVEL', actor: 'Grimfast the Goodarm', result };
    assert.equal(
      formatRollMessageForDiscord(args).replace('**Grimfast the Goodarm** ', ''),
      formatRollMessage(args).replace('Grimfast the Goodarm ', ''),
    );
  });

  it('keeps the trailing extra note', () => {
    const msg = formatRollMessageForDiscord({
      kind: 'resolution',
      label: 'AWARENESS',
      actor: 'Avery Littlechild',
      result,
      extra: '(hard terrain −1d)',
    });
    assert.match(msg, /\(hard terrain −1d\)$/);
  });

  it('degrades to no bold marker when there is no actor', () => {
    const msg = formatRollMessageForDiscord({ kind: 'skill', label: 'LORE', result });
    assert.ok(!msg.includes('**'));
    assert.match(msg, /^🎲 rolls LORE — /);
  });
});

describe('bold helpers', () => {
  it('bold() adds the trailing space a leading name needs', () => {
    assert.equal(bold('Srixon son of Lofar'), '**Srixon son of Lofar** ');
    assert.equal(bold(''), '');
    assert.equal(bold(undefined), '');
    assert.equal(bold('   '), '');
  });

  it('boldName() bolds in place, for names mid-sentence', () => {
    assert.equal(boldName('Avery Littlechild'), '**Avery Littlechild**');
    assert.equal(boldName(''), '');
    assert.equal(boldName(null), '');
  });
});

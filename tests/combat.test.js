/** Combat Tracker rules tables and maths. */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GANDALF, EYE } from '../shared/dice.js';
import {
  STANCE_ORDER,
  canEnterRearward,
  engagementCounts,
  engagementLimits,
  isPiercingBlow,
  nextRoundState,
  promptedCombatActionFor,
  resetCombatantForRound,
} from '../shared/combat.js';
import { ADVERSARY_CATEGORIES, hateResolveLabel, misdeedReminder } from '../shared/compendium.js';

describe('Rearward eligibility', () => {
  it('requires total enemies not to exceed twice the Company size', () => {
    assert.equal(
      canEnterRearward({ totalEnemies: 10, companySize: 5, rearwardCount: 1, closeCombatCount: 4 }),
      true,
    );
    assert.equal(
      canEnterRearward({ totalEnemies: 11, companySize: 5, rearwardCount: 1, closeCombatCount: 4 }),
      false,
    );
  });

  it('requires two Close Combat heroes per hero in Rearward', () => {
    assert.equal(
      canEnterRearward({ totalEnemies: 4, companySize: 5, rearwardCount: 2, closeCombatCount: 4 }),
      true,
    );
    assert.equal(
      canEnterRearward({ totalEnemies: 4, companySize: 5, rearwardCount: 2, closeCombatCount: 3 }),
      false,
    );
  });
});

describe('engagement limits', () => {
  it('is 3 attackers / 3 defenders for a human-sized foe', () => {
    assert.deepEqual(engagementLimits('human'), { maxAttackersOnFoe: 3, maxFoesOnHero: 3 });
  });

  it('is 6 attackers / 2 defenders for a Large foe — the CORRECT numbers, not the reference image', () => {
    assert.deepEqual(engagementLimits('large'), { maxAttackersOnFoe: 6, maxFoesOnHero: 2 });
  });
});

describe('engagementCounts', () => {
  it('counts how many heroes picked each adversary', () => {
    const counts = engagementCounts({ h1: 'orc-1', h2: 'orc-1', h3: 'orc-2' });
    assert.deepEqual(counts, { 'orc-1': 2, 'orc-2': 1 });
  });

  it('ignores unset engagements', () => {
    assert.deepEqual(engagementCounts({ h1: null, h2: undefined }), {});
    assert.deepEqual(engagementCounts({}), {});
  });
});

describe('round bookkeeping', () => {
  it('advances the round and clears the stance lock and acted list', () => {
    assert.deepEqual(nextRoundState({ round: 2, stanceLocked: true, actedPlayers: ['a', 'b'] }), {
      round: 3,
      stanceLocked: false,
      actedPlayers: [],
    });
  });

  it('resets a combatant instance for a new round', () => {
    const combatant = {
      id: 'orc-1',
      attacksUsedThisRound: 2,
      hateResolveSpent: 3,
      weary: true,
      currentEndurance: 5,
    };
    assert.deepEqual(resetCombatantForRound(combatant), {
      id: 'orc-1',
      attacksUsedThisRound: 0,
      hateResolveSpent: 0,
      weary: false,
      currentEndurance: 5,
    });
  });
});

describe('Piercing Blow', () => {
  it('triggers on a 10 with no Keen quality', () => {
    assert.equal(isPiercingBlow(10, 10), true);
    assert.equal(isPiercingBlow(9, 10), false);
  });

  it('triggers on 9+ with standard Keen', () => {
    assert.equal(isPiercingBlow(9, 9), true);
    assert.equal(isPiercingBlow(8, 9), false);
  });

  it('triggers on 8+ with Dwarven-crafted Keen', () => {
    assert.equal(isPiercingBlow(8, 8), true);
    assert.equal(isPiercingBlow(7, 8), false);
  });

  it('the Gandalf rune always triggers it, whatever the threshold', () => {
    assert.equal(isPiercingBlow(GANDALF, 10), true);
  });

  it('the Eye of Sauron never triggers it', () => {
    assert.equal(isPiercingBlow(EYE, 8), false);
  });
});

describe('Hate / Resolve labelling', () => {
  it('labels Evil Men and NPCs as Resolve, everything else as Hate', () => {
    assert.equal(hateResolveLabel('Evil Men'), 'Resolve');
    assert.equal(hateResolveLabel('NPCs'), 'Resolve');
    for (const category of ADVERSARY_CATEGORIES) {
      if (category === 'Evil Men' || category === 'NPCs') continue;
      assert.equal(hateResolveLabel(category), 'Hate');
    }
  });

  it('only shows the Misdeed reminder on Resolve categories', () => {
    assert.match(misdeedReminder('Evil Men'), /Misdeed/);
    assert.equal(misdeedReminder('Orcs'), '');
  });
});

describe('promptedCombatActionFor', () => {
  const stances = { forward1: 'Forward', open1: 'Open', rear1: 'Rear' };
  const locked = { active: true, stanceLocked: true, stances, actedPlayers: [] };

  it('asks nobody before stances are locked, or with no combat active', () => {
    assert.equal(promptedCombatActionFor({ combat: { ...locked, stanceLocked: false }, characterId: 'forward1' }), null);
    assert.equal(promptedCombatActionFor({ combat: { ...locked, active: false }, characterId: 'forward1' }), null);
  });

  it('lets a Forward hero act first', () => {
    assert.deepEqual(promptedCombatActionFor({ combat: locked, characterId: 'forward1' }), { stance: 'Forward' });
  });

  it('blocks a later-stance hero until every earlier stance has acted', () => {
    assert.equal(promptedCombatActionFor({ combat: locked, characterId: 'open1' }), null);
    assert.equal(promptedCombatActionFor({ combat: locked, characterId: 'rear1' }), null);
  });

  it('opens the next stance block once the earlier one is fully acted', () => {
    const afterForward = { ...locked, actedPlayers: ['forward1'] };
    assert.deepEqual(promptedCombatActionFor({ combat: afterForward, characterId: 'open1' }), { stance: 'Open' });
    assert.equal(promptedCombatActionFor({ combat: afterForward, characterId: 'rear1' }), null);
  });

  it('stays quiet for a hero who has already acted', () => {
    assert.equal(promptedCombatActionFor({ combat: { ...locked, actedPlayers: ['forward1'] }, characterId: 'forward1' }), null);
  });

  it('stays quiet for a hero with no stance recorded', () => {
    assert.equal(promptedCombatActionFor({ combat: locked, characterId: 'nobody' }), null);
  });
});

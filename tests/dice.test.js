/**
 * Dice engine unit tests (spec §7). `evaluateRoll` is pure, so every branch can
 * be driven deterministically; `rollDice` is exercised with a scripted RNG.
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_TN_BASE,
  EYE,
  FEAT_DIE_FACES,
  GANDALF,
  GANDALF_NUMERIC,
  SHORT_CAMPAIGN_TN_BASE,
  SPECIAL_SUCCESS_OPTIONS,
  computeSuccessDiceCount,
  computeTargetNumber,
  evaluateRoll,
  featFaceRank,
  featFaceValue,
  hopeBonusDice,
  resolveFavourState,
  rollDice,
} from '../shared/dice.js';

/** RNG that walks a scripted list of [0,1) values, then repeats the last one. */
function scriptedRng(values) {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)];
}
/** The RNG value that makes rollFeatFace return a given face. */
function featRng(face) {
  const idx = FEAT_DIE_FACES.indexOf(face);
  return (idx + 0.5) / FEAT_DIE_FACES.length;
}
/** The RNG value that makes rollSuccessValue return a given 1-6. */
function d6Rng(value) {
  return (value - 1 + 0.5) / 6;
}

describe('Feat Die faces', () => {
  it('has 12 faces: 1-10 plus the Gandalf rune and the Eye of Sauron', () => {
    assert.equal(FEAT_DIE_FACES.length, 12);
    assert.equal(FEAT_DIE_FACES.filter((f) => typeof f === 'number').length, 10);
    assert.ok(FEAT_DIE_FACES.includes(GANDALF));
    assert.ok(FEAT_DIE_FACES.includes(EYE));
  });

  it('scores the Eye as 0 and the rune as the highest value', () => {
    assert.equal(featFaceValue(EYE), 0);
    assert.equal(featFaceValue(GANDALF), GANDALF_NUMERIC);
    assert.equal(featFaceValue(7), 7);
    assert.ok(featFaceRank(GANDALF) > featFaceRank(10));
    assert.ok(featFaceRank(EYE) < featFaceRank(1));
  });
});

describe('Target Number', () => {
  it('is 20 − Attribute by default', () => {
    assert.equal(computeTargetNumber(4), 16);
    assert.equal(computeTargetNumber(7), 13);
    assert.equal(DEFAULT_TN_BASE, 20);
  });

  it('is 18 − Attribute for the short-campaign variant', () => {
    assert.equal(computeTargetNumber(4, SHORT_CAMPAIGN_TN_BASE), 14);
    assert.equal(SHORT_CAMPAIGN_TN_BASE, 18);
  });
});

describe('success dice count', () => {
  it('is the skill rating, and zero dice means Feat Die only', () => {
    assert.equal(computeSuccessDiceCount({ rating: 3 }), 3);
    assert.equal(computeSuccessDiceCount({ rating: 0 }), 0);
    const result = rollDice({ rating: 0, targetNumber: 10 }, scriptedRng([featRng(9)]));
    assert.equal(result.successDice.length, 0);
    assert.equal(result.total, 9);
  });

  it('adds 1 die for a Hope spend, or 2 while Inspired', () => {
    assert.equal(computeSuccessDiceCount({ rating: 2, hopeSpent: true }), 3);
    assert.equal(computeSuccessDiceCount({ rating: 2, hopeSpent: true, inspired: true }), 4);
    assert.equal(hopeBonusDice(false), 1);
    assert.equal(hopeBonusDice(true), 2);
  });

  it('applies situational modifiers and never goes below zero', () => {
    assert.equal(computeSuccessDiceCount({ rating: 2, extraDice: -1 }), 1);
    assert.equal(computeSuccessDiceCount({ rating: 2, extraDice: 1 }), 3);
    assert.equal(computeSuccessDiceCount({ rating: 0, extraDice: -3 }), 0);
  });
});

describe('Gandalf rune', () => {
  it('is an automatic success even when the total is hopeless', () => {
    const r = evaluateRoll({ featFaces: [GANDALF], successValues: [1], targetNumber: 99 });
    assert.equal(r.success, true);
    assert.equal(r.autoSuccess, true);
    assert.equal(r.autoFail, false);
  });

  it('still counts icons for the degree of success', () => {
    const r = evaluateRoll({ featFaces: [GANDALF], successValues: [6, 6], targetNumber: 99 });
    assert.equal(r.icons, 2);
    assert.equal(r.successLevel, 'extraordinary');
  });
});

describe('Eye of Sauron', () => {
  it('counts as 0 but does not by itself fail the roll', () => {
    const r = evaluateRoll({ featFaces: [EYE], successValues: [6, 6, 6], targetNumber: 14 });
    assert.equal(r.featValue, 0);
    assert.equal(r.total, 18);
    assert.equal(r.success, true);
    assert.equal(r.autoFail, false);
  });

  it('is an automatic failure for a Miserable hero, whatever the total', () => {
    const r = evaluateRoll({
      featFaces: [EYE],
      successValues: [6, 6, 6, 6],
      targetNumber: 14,
      miserable: true,
    });
    assert.equal(r.total, 24);
    assert.equal(r.success, false);
    assert.equal(r.autoFail, true);
    assert.equal(r.successLevel, 'failure');
  });

  it('does not auto-fail a Miserable hero when the kept die is not the Eye', () => {
    const r = evaluateRoll({
      featFaces: [EYE, GANDALF],
      successValues: [],
      targetNumber: 14,
      favoured: true,
      miserable: true,
    });
    assert.equal(r.featFace, GANDALF);
    assert.equal(r.autoFail, false);
    assert.equal(r.success, true);
  });
});

describe('Weary', () => {
  it('zeroes Success Dice showing an outlined 1, 2 or 3', () => {
    const r = evaluateRoll({
      featFaces: [8],
      successValues: [1, 2, 3, 4, 5, 6],
      targetNumber: 14,
      weary: true,
    });
    // 4 + 5 + 6 = 15 counted, 1/2/3 zeroed
    assert.equal(r.successTotal, 15);
    assert.equal(r.total, 23);
    assert.deepEqual(
      r.successDice.map((d) => d.counted),
      [0, 0, 0, 4, 5, 6],
    );
  });

  it('does not affect Success icons', () => {
    const r = evaluateRoll({ featFaces: [2], successValues: [1, 6], targetNumber: 14, weary: true });
    assert.equal(r.icons, 1);
    assert.equal(r.successTotal, 6);
  });

  it('can turn a success into a failure', () => {
    const dice = { featFaces: [8], successValues: [3, 3, 3], targetNumber: 14 };
    assert.equal(evaluateRoll(dice).success, true); // 8 + 9 = 17
    assert.equal(evaluateRoll({ ...dice, weary: true }).success, false); // 8 + 0 = 8
  });
});

describe('Favoured and Ill-favoured', () => {
  it('keeps the higher of two Feat Dice when Favoured', () => {
    const r = evaluateRoll({ featFaces: [3, 9], successValues: [], targetNumber: 5, favoured: true });
    assert.equal(r.featFace, 9);
    assert.equal(r.favourState, 'favoured');
    assert.deepEqual(
      r.featDice.map((d) => d.kept),
      [false, true],
    );
  });

  it('keeps the lower of two Feat Dice when Ill-favoured', () => {
    const r = evaluateRoll({ featFaces: [3, 9], successValues: [], targetNumber: 5, illFavoured: true });
    assert.equal(r.featFace, 3);
    assert.equal(r.favourState, 'ill-favoured');
  });

  it('ranks the rune highest and the Eye lowest when choosing', () => {
    assert.equal(
      evaluateRoll({ featFaces: [10, GANDALF], targetNumber: 5, favoured: true }).featFace,
      GANDALF,
    );
    assert.equal(evaluateRoll({ featFaces: [1, EYE], targetNumber: 5, illFavoured: true }).featFace, EYE);
    assert.equal(
      evaluateRoll({ featFaces: [EYE, GANDALF], targetNumber: 5, illFavoured: true }).featFace,
      EYE,
    );
  });

  it('cancels out when both apply, rolling a single Feat Die', () => {
    assert.equal(resolveFavourState(true, true), 'normal');
    const r = rollDice(
      { rating: 0, targetNumber: 10, favoured: true, illFavoured: true },
      scriptedRng([featRng(7)]),
    );
    assert.equal(r.featDice.length, 1);
    assert.equal(r.favourState, 'normal');
  });

  it('rolls two Feat Dice for a Favoured roll and one otherwise', () => {
    const fav = rollDice({ rating: 0, targetNumber: 10, favoured: true }, scriptedRng([featRng(2), featRng(9)]));
    assert.equal(fav.featDice.length, 2);
    assert.equal(fav.featFace, 9);

    const plain = rollDice({ rating: 0, targetNumber: 10 }, scriptedRng([featRng(2)]));
    assert.equal(plain.featDice.length, 1);
  });
});

describe('degrees of success', () => {
  it('reports success / great / extraordinary by icon count', () => {
    const base = { featFaces: [10], targetNumber: 10 };
    assert.equal(evaluateRoll({ ...base, successValues: [4] }).successLevel, 'success');
    assert.equal(evaluateRoll({ ...base, successValues: [6] }).successLevel, 'great');
    assert.equal(evaluateRoll({ ...base, successValues: [6, 6] }).successLevel, 'extraordinary');
    assert.equal(evaluateRoll({ ...base, successValues: [6, 6, 6] }).successLevel, 'extraordinary');
  });

  it('reports failure regardless of icons when the total misses the TN', () => {
    const r = evaluateRoll({ featFaces: [1], successValues: [6], targetNumber: 20 });
    assert.equal(r.icons, 1);
    assert.equal(r.success, false);
    assert.equal(r.successLevel, 'failure');
  });

  it('succeeds on exactly meeting the Target Number', () => {
    assert.equal(evaluateRoll({ featFaces: [10], successValues: [4], targetNumber: 14 }).success, true);
    assert.equal(evaluateRoll({ featFaces: [10], successValues: [3], targetNumber: 14 }).success, false);
  });
});

describe('flat bonus', () => {
  it('adds to the total without adding a die (Useful Items, Close-fitting)', () => {
    const r = evaluateRoll({ featFaces: [8], successValues: [4], targetNumber: 14, bonus: 2 });
    assert.equal(r.bonus, 2);
    assert.equal(r.total, 14);
    assert.equal(r.success, true);
    assert.equal(r.successDice.length, 1);
  });
});

describe('rollDice integration', () => {
  it('rolls 1 Feat Die + N Success Dice and reports the Hope cost', () => {
    const rng = scriptedRng([featRng(9), d6Rng(6), d6Rng(4), d6Rng(2)]);
    const r = rollDice({ rating: 2, targetNumber: 14, hopeSpent: true }, rng);
    assert.equal(r.featDice.length, 1);
    assert.equal(r.successDice.length, 3); // rating 2 + 1 Hope die
    assert.equal(r.bonusDice, 1);
    assert.equal(r.hopeCost, 1);
    assert.equal(r.total, 9 + 6 + 4 + 2);
    assert.equal(r.icons, 1);
    assert.equal(r.success, true);
  });

  it('grants 2 bonus dice for a Hope spend while Inspired', () => {
    const rng = scriptedRng([featRng(5), d6Rng(1), d6Rng(1), d6Rng(1)]);
    const r = rollDice({ rating: 1, targetNumber: 14, hopeSpent: true, inspired: true }, rng);
    assert.equal(r.successDice.length, 3);
    assert.equal(r.bonusDice, 2);
  });

  it('derives the TN from an attribute when none is given', () => {
    const r = rollDice({ rating: 0, attribute: 5 }, scriptedRng([featRng(10)]));
    assert.equal(r.targetNumber, 15);
    assert.equal(r.tnBase, 20);
  });

  it('derives the TN from the short-campaign base when asked', () => {
    const r = rollDice({ rating: 0, attribute: 5, tnBase: 18 }, scriptedRng([featRng(10)]));
    assert.equal(r.targetNumber, 13);
  });

  it('only ever produces legal faces over many rolls', () => {
    for (let i = 0; i < 400; i += 1) {
      const r = rollDice({ rating: 4, targetNumber: 14 });
      assert.ok(FEAT_DIE_FACES.includes(r.featFace));
      for (const d of r.successDice) {
        assert.ok(d.value >= 1 && d.value <= 6);
        assert.equal(d.icon, d.value === 6);
        assert.equal(d.outlined, d.value <= 3);
      }
    }
  });
});

describe('Special Successes', () => {
  it('offers exactly the six core options', () => {
    assert.deepEqual(SPECIAL_SUCCESS_OPTIONS, [
      'Cancel a Failure',
      'Score 1 Additional Success',
      'Gain Insight',
      'Go Quietly',
      'Make Haste',
      'Widen Influence',
    ]);
  });
});

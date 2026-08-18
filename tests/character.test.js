/**
 * Derived character-sheet values: attack Target Numbers, Combat Stance dice
 * modifiers, computed Load and computed Weary (spec §5, TOR 2e core rulebook).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RANGED_PROFICIENCY,
  attackTargetNumber,
  computeWeary,
  effectiveLoad,
  emptyCharacterSheet,
  hydrateSheet,
  rollContextForSkill,
  stanceAttackDice,
  stanceAttackWarning,
  totalLoad,
} from '../shared/character.js';
import { isCharacterTravelling } from '../shared/journey.js';
import { SHORT_CAMPAIGN_TN_BASE } from '../shared/dice.js';

function sheetWith(patch = {}) {
  return hydrateSheet(patch);
}

describe('attack Target Number', () => {
  it('is the attacker STRENGTH TN raised by the target Parry', () => {
    const sheet = sheetWith({ attributes: { strength: { rating: 5 } } });
    // Strength 5 -> TN 15 on the standard base of 20.
    assert.equal(attackTargetNumber(sheet, 0), 15);
    assert.equal(attackTargetNumber(sheet, 3), 18);
    assert.equal(attackTargetNumber(sheet, 12), 27);
  });

  it('respects the short-campaign TN base', () => {
    const sheet = sheetWith({ attributes: { strength: { rating: 5 } } });
    assert.equal(attackTargetNumber(sheet, 2, SHORT_CAMPAIGN_TN_BASE), 18 - 5 + 2);
  });

  it('treats a missing or junk Parry as zero', () => {
    const sheet = sheetWith({ attributes: { strength: { rating: 4 } } });
    assert.equal(attackTargetNumber(sheet), 16);
    assert.equal(attackTargetNumber(sheet, null), 16);
    assert.equal(attackTargetNumber(sheet, 'x'), 16);
  });
});

describe('Combat Stance modifiers on the hero own attack rolls', () => {
  it('gives Forward +1 Success Die', () => {
    assert.equal(stanceAttackDice(sheetWith({ combat: { stance: 'Forward' } })), 1);
  });

  it('leaves Open unchanged', () => {
    assert.equal(stanceAttackDice(sheetWith({ combat: { stance: 'Open' } })), 0);
  });

  it('costs Defensive one Success Die per engaging opponent', () => {
    const stance = 'Defensive';
    assert.equal(stanceAttackDice(sheetWith({ combat: { stance, opponentsEngaging: 0 } })), 0);
    assert.equal(stanceAttackDice(sheetWith({ combat: { stance, opponentsEngaging: 1 } })), -1);
    assert.equal(stanceAttackDice(sheetWith({ combat: { stance, opponentsEngaging: 3 } })), -3);
  });

  it('never turns a negative opponent count into a bonus', () => {
    const sheet = sheetWith({ combat: { stance: 'Defensive', opponentsEngaging: -4 } });
    assert.equal(stanceAttackDice(sheet), 0);
  });

  it('gives Rearward no dice modifier', () => {
    assert.equal(stanceAttackDice(sheetWith({ combat: { stance: 'Rear', opponentsEngaging: 2 } })), 0);
  });

  it('defaults a brand new sheet to Open with nobody engaging', () => {
    const sheet = emptyCharacterSheet();
    assert.equal(sheet.combat.stance, 'Open');
    assert.equal(sheet.combat.opponentsEngaging, 0);
    assert.equal(stanceAttackDice(sheet), 0);
  });
});

describe('Rearward stance weapon warning', () => {
  const rear = sheetWith({ combat: { stance: 'Rear' } });

  it('warns — but does not block — a melee weapon in Rearward stance', () => {
    const warning = stanceAttackWarning(rear, { name: 'Long sword', proficiency: 'Swords' });
    assert.match(warning, /Rearward/);
    assert.match(warning, /Long sword/);
  });

  it('stays silent for a ranged weapon', () => {
    assert.equal(stanceAttackWarning(rear, { name: 'Bow', proficiency: RANGED_PROFICIENCY }), '');
  });

  it('stays silent in every other stance', () => {
    for (const stance of ['Forward', 'Open', 'Defensive']) {
      const sheet = sheetWith({ combat: { stance } });
      assert.equal(stanceAttackWarning(sheet, { proficiency: 'Axes' }), '');
    }
  });
});

describe('computed Load', () => {
  it('counts only equipped gear', () => {
    const sheet = sheetWith({
      weapons: [
        { equipped: true, load: 3, fell: 'none', grievous: 'none', keen: 'none' },
        { equipped: false, load: 9, fell: 'none', grievous: 'none', keen: 'none' },
      ],
    });
    assert.equal(totalLoad(sheet), 3);
  });

  it('adds armour and shield after Cunning Make reduces them', () => {
    const sheet = sheetWith({
      armour: [{ equipped: true, load: 12, closeFitting: 'none', cunningMake: 'standard' }],
      shield: { equipped: true, load: 4, parry: 2, reinforced: 'none', cunningMake: 'none' },
    });
    // 12 − 2 Cunning Make + 4 shield.
    assert.equal(totalLoad(sheet), 14);
  });

  it('lets the enhanced Cunning Make tier use Valour when it is higher', () => {
    const sheet = sheetWith({
      rewards: { valour: 5 },
      armour: [{ equipped: true, load: 12, closeFitting: 'none', cunningMake: 'enhanced' }],
    });
    // Enhanced is −3 or Valour, whichever is higher: Valour 5 wins.
    assert.equal(totalLoad(sheet), 7);
  });

  it('includes carried Treasure', () => {
    const sheet = sheetWith({
      attributes: { strength: { treasure: 6 } },
      weapons: [{ equipped: true, load: 2, fell: 'none', grievous: 'none', keen: 'none' }],
    });
    assert.equal(totalLoad(sheet), 8);
  });

  it('recalculates when a piece of gear is unequipped', () => {
    const sheet = sheetWith({
      weapons: [{ equipped: true, load: 3, fell: 'none', grievous: 'none', keen: 'none' }],
    });
    assert.equal(totalLoad(sheet), 3);
    sheet.weapons[0].equipped = false;
    assert.equal(totalLoad(sheet), 0);
  });
});

describe('computed Weary', () => {
  it('is true when Endurance has dropped to or below Load', () => {
    const base = { attributes: { strength: { endurance: 10, treasure: 0 } } };
    assert.equal(computeWeary(sheetWith({ ...base })), false);

    const loaded = sheetWith({
      attributes: { strength: { endurance: 10, treasure: 0 } },
      armour: [{ equipped: true, load: 10, closeFitting: 'none', cunningMake: 'none' }],
    });
    assert.equal(computeWeary(loaded), true, 'equal counts as Weary');

    const overloaded = sheetWith({
      attributes: { strength: { endurance: 9, treasure: 0 } },
      armour: [{ equipped: true, load: 10, closeFitting: 'none', cunningMake: 'none' }],
    });
    assert.equal(computeWeary(overloaded), true);
  });

  it('adds Fatigue to the comparison only while travelling', () => {
    const sheet = sheetWith({
      attributes: { strength: { endurance: 14, treasure: 0, fatigue: 6 } },
      armour: [{ equipped: true, load: 10, closeFitting: 'none', cunningMake: 'none' }],
    });
    assert.equal(effectiveLoad(sheet, { travelling: false }), 10);
    assert.equal(effectiveLoad(sheet, { travelling: true }), 16);
    assert.equal(computeWeary(sheet, { travelling: false }), false);
    assert.equal(computeWeary(sheet, { travelling: true }), true);
  });

  it('never mutates the stored Load when travelling raises the effective one', () => {
    const sheet = sheetWith({
      attributes: { strength: { endurance: 14, treasure: 0, fatigue: 6 } },
      armour: [{ equipped: true, load: 10, closeFitting: 'none', cunningMake: 'none' }],
    });
    computeWeary(sheet, { travelling: true });
    assert.equal(totalLoad(sheet), 10);
    assert.equal(sheet.attributes.strength.fatigue, 6);
  });

  it('is what the dice engine sees, not the old stored checkbox', () => {
    const sheet = sheetWith({
      attributes: { strength: { rating: 3, endurance: 2, treasure: 0 }, heart: { rating: 4 } },
      // A stale stored value must not win over the computed one either way.
      conditions: { weary: false },
      armour: [{ equipped: true, load: 8, closeFitting: 'none', cunningMake: 'none' }],
    });
    assert.equal(rollContextForSkill(sheet, 'Travel').weary, true);

    const rested = sheetWith({
      attributes: { strength: { endurance: 20, treasure: 0 }, heart: { rating: 4 } },
      conditions: { weary: true },
    });
    assert.equal(rollContextForSkill(rested, 'Travel').weary, false);
  });
});

describe('who counts as actively travelling', () => {
  const journey = { roles: { a: 'guide', b: 'hunter' } };

  it('is nobody when no journey is underway', () => {
    assert.equal(isCharacterTravelling({ travel: { journeyId: null, phase: 'idle' }, characterId: 'a' }), false);
  });

  it('is nobody once the journey reaches a terminal phase', () => {
    for (const phase of ['idle', 'complete']) {
      const travel = { journeyId: 'j1', phase };
      assert.equal(isCharacterTravelling({ travel, journey, characterId: 'a' }), false);
    }
  });

  it('is the role-holders during every in-progress phase', () => {
    const phases = [
      'awaiting_marching_test',
      'awaiting_target',
      'awaiting_target_choice',
      'awaiting_event_die',
      'awaiting_resolution',
      'journey_end',
      'awaiting_fatigue_relief',
    ];
    for (const phase of phases) {
      const travel = { journeyId: 'j1', phase };
      assert.equal(isCharacterTravelling({ travel, journey, characterId: 'a' }), true, phase);
      assert.equal(isCharacterTravelling({ travel, journey, characterId: 'zz' }), false, phase);
    }
  });

  it('falls back to everyone when no roles were assigned', () => {
    const travel = { journeyId: 'j1', phase: 'awaiting_marching_test' };
    assert.equal(isCharacterTravelling({ travel, journey: { roles: {} }, characterId: 'zz' }), true);
  });
});

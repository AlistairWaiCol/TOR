/**
 * Derived character-sheet values: attack Target Numbers, Combat Stance dice
 * modifiers, computed Load and computed Weary (spec §5, TOR 2e core rulebook).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CALLINGS,
  LIVING_STANDARDS,
  RANGED_PROFICIENCY,
  attackTargetNumber,
  computeWeary,
  effectiveLoad,
  emptyCharacterSheet,
  hydrateSheet,
  rollContextForSkill,
  shieldParryBonus,
  stanceAttackDice,
  stanceAttackWarning,
  totalLoad,
  totalParry,
  usefulItemsForSkill,
} from '../shared/character.js';
import {
  CULTURAL_VIRTUES,
  CULTURAL_VIRTUE_CULTURES,
  culturalVirtuesFor,
} from '../shared/culturalVirtues.js';
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

/* --- Parry -------------------------------------------------------------------
 * The Wits panel's Shield sub-field used to be a manual box that was added to
 * the total ON TOP OF the equipped shield the sheet already knew about. The
 * field is computed now and the stored one is out of the sum entirely.
 */

describe('Total Parry', () => {
  const withShield = (shield, patch = {}) => sheetWith({ shield, ...patch });

  it('adds the equipped shield once, from the shield itself', () => {
    const sheet = withShield(
      { equipped: true, name: 'Shield', parry: 2, load: 4, reinforced: 'none', cunningMake: 'none' },
      { attributes: { wits: { parryBase: 19 } } },
    );
    assert.equal(shieldParryBonus(sheet), 2);
    assert.equal(totalParry(sheet), 21);
  });

  it('includes the Reinforced tier in the shield contribution', () => {
    const sheet = withShield({ equipped: true, parry: 2, reinforced: 'standard' });
    assert.equal(shieldParryBonus(sheet), 3);
    const enhanced = withShield({ equipped: true, parry: 2, reinforced: 'enhanced' });
    assert.equal(shieldParryBonus(enhanced), 4);
  });

  it('contributes nothing while the shield is unequipped', () => {
    const sheet = withShield(
      { equipped: false, parry: 2, reinforced: 'standard' },
      { attributes: { wits: { parryBase: 19 } } },
    );
    assert.equal(shieldParryBonus(sheet), 0);
    assert.equal(totalParry(sheet), 19);
  });

  it('ignores the vestigial parryShield field entirely — no double count', () => {
    const shield = { equipped: true, parry: 2, reinforced: 'none', cunningMake: 'none' };
    const clean = withShield(shield, { attributes: { wits: { parryBase: 19, parryShield: 0 } } });
    // An old sheet that still carries a hand-typed value must read the same.
    const legacy = withShield(shield, { attributes: { wits: { parryBase: 19, parryShield: 2 } } });
    assert.equal(totalParry(clean), 21);
    assert.equal(totalParry(legacy), 21, 'a stale parryShield must not be added again');
  });

  it('sums exactly what the panel displays: base + shield + other + stance', () => {
    const sheet = withShield(
      { equipped: true, parry: 1, reinforced: 'standard' },
      { attributes: { wits: { parryBase: 18, parryOther: 3, parryStance: -1 } } },
    );
    const w = sheet.attributes.wits;
    assert.equal(
      totalParry(sheet),
      w.parryBase + shieldParryBonus(sheet) + w.parryOther + w.parryStance,
    );
    assert.equal(totalParry(sheet), 22);
  });
});

/* --- Useful Items ------------------------------------------------------------
 * Reference data for the roll dialog only. Nothing in the dice engine reads it.
 */

describe('usefulItemsForSkill', () => {
  const withItems = (items, useTable = true) => sheetWith({ usefulItems: { useTable, items } });

  it('matches either of an item\'s two skill slots', () => {
    const sheet = withItems([
      { name: 'Fine pipe', bonus: 1, skill1: 'Insight', skill2: '' },
      { name: 'Whetstone', bonus: 2, skill1: 'Craft', skill2: 'Battle' },
    ]);
    assert.deepEqual(usefulItemsForSkill(sheet, 'Insight').map((i) => i.name), ['Fine pipe']);
    assert.deepEqual(usefulItemsForSkill(sheet, 'Battle').map((i) => i.name), ['Whetstone']);
    assert.deepEqual(usefulItemsForSkill(sheet, 'Craft').map((i) => i.name), ['Whetstone']);
  });

  it('matches the free-text skill names case- and space-insensitively', () => {
    const sheet = withItems([{ name: 'Rope', bonus: 1, skill1: '  athletics ', skill2: '' }]);
    assert.equal(usefulItemsForSkill(sheet, 'Athletics').length, 1);
    assert.equal(usefulItemsForSkill(sheet, 'ATHLETICS').length, 1);
  });

  it('returns every item that names the skill, not just the first', () => {
    const sheet = withItems([
      { name: 'Rope', bonus: 1, skill1: 'Athletics', skill2: '' },
      { name: 'Climbing irons', bonus: 2, skill1: 'Athletics', skill2: '' },
    ]);
    assert.equal(usefulItemsForSkill(sheet, 'Athletics').length, 2);
  });

  it('skips half-filled rows — no name, or no bonus to award', () => {
    const sheet = withItems([
      { name: '', bonus: 2, skill1: 'Lore', skill2: '' },
      { name: 'Blank ledger', bonus: 0, skill1: 'Lore', skill2: '' },
    ]);
    assert.deepEqual(usefulItemsForSkill(sheet, 'Lore'), []);
  });

  it('is empty for an unrelated skill, a blank skill, and the plain gear box', () => {
    const items = [{ name: 'Fine pipe', bonus: 1, skill1: 'Insight', skill2: '' }];
    assert.deepEqual(usefulItemsForSkill(withItems(items), 'Stealth'), []);
    assert.deepEqual(usefulItemsForSkill(withItems(items), ''), []);
    assert.deepEqual(usefulItemsForSkill(withItems(items, false), 'Insight'), []);
  });

  it('changes nothing about the roll context — it is reference data only', () => {
    const sheet = withItems([{ name: 'Fine pipe', bonus: 1, skill1: 'Insight', skill2: '' }]);
    const bare = sheetWith({});
    const ctx = rollContextForSkill(sheet, 'Insight');
    assert.deepEqual(ctx, rollContextForSkill(bare, 'Insight'));
  });
});

/* --- General panel dropdowns ------------------------------------------------- */

describe('Culture / Calling / Living Standard option lists', () => {
  it('offers the six Callings and six Standards of Living', () => {
    assert.equal(CALLINGS.length, 6);
    assert.ok(CALLINGS.includes('Treasure Hunter'));
    assert.equal(LIVING_STANDARDS.length, 6);
    assert.deepEqual(LIVING_STANDARDS, ['Poor', 'Frugal', 'Common', 'Prosperous', 'Rich', 'Very Rich']);
  });

  it('derives the ten cultures from the Cultural Virtues, not a second copy', () => {
    assert.equal(CULTURAL_VIRTUE_CULTURES.length, 10);
    assert.deepEqual(
      CULTURAL_VIRTUE_CULTURES,
      [...new Set(CULTURAL_VIRTUES.map((v) => v.culture))],
    );
  });

  it('gives every dropdown Culture a matching set of Cultural Virtues', () => {
    // The dropdown existing and the Virtue picker finding nothing would be the
    // exact drift deriving the list is meant to make impossible.
    for (const culture of CULTURAL_VIRTUE_CULTURES) {
      assert.ok(culturalVirtuesFor(culture).length > 0, culture);
    }
  });

  it('keeps the migrated roster values selectable', () => {
    // The three corrections scripts/fixCultures.js applies.
    for (const culture of ['Beornings', "Dwarves of Durin's Folk", 'Bree Hobbits', 'Elves of Mirkwood']) {
      assert.ok(CULTURAL_VIRTUE_CULTURES.includes(culture), culture);
    }
    // ...and the pre-migration spellings are NOT options, which is why the
    // migration is needed at all.
    for (const stale of ['Beorning', 'Dwarves of Durin', 'Hobbit of Bree']) {
      assert.equal(CULTURAL_VIRTUE_CULTURES.includes(stale), false, stale);
    }
  });
});

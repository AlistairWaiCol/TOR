/** Journey rules tables and maths (spec §6d, §6g). */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { EYE, GANDALF } from '../shared/dice.js';
import {
  JOURNEY_EVENTS,
  SEASONS,
  computeFatigueRelief,
  computeJourneyDays,
  journeyTickSequence,
  lookupJourneyEvent,
  marchingTestDistance,
  promptedRollFor,
  regionFeatMode,
  roleSkill,
  selectTargetRole,
  terrainDiceModifier,
  validateRoleAssignments,
} from '../shared/journey.js';
import { DEFAULT_CALIBRATION, hexDistance, hexNeighbours, hexPolygon, pixelToHex } from '../shared/hexMath.js';

describe('Marching Test distance', () => {
  it('is 3 hexes on a success, +1 per Success icon', () => {
    assert.equal(marchingTestDistance({ success: true, icons: 0, season: 'Summer' }), 3);
    assert.equal(marchingTestDistance({ success: true, icons: 1, season: 'Summer' }), 4);
    assert.equal(marchingTestDistance({ success: true, icons: 3, season: 'Winter' }), 6);
  });

  it('is 2 hexes on a failure in Spring or Summer', () => {
    assert.equal(marchingTestDistance({ success: false, season: 'Spring' }), 2);
    assert.equal(marchingTestDistance({ success: false, season: 'Summer' }), 2);
  });

  it('is 1 hex on a failure in Autumn or Winter', () => {
    assert.equal(marchingTestDistance({ success: false, season: 'Autumn' }), 1);
    assert.equal(marchingTestDistance({ success: false, season: 'Winter' }), 1);
  });

  it('covers all four seasons', () => {
    assert.deepEqual(SEASONS, ['Spring', 'Summer', 'Autumn', 'Winter']);
  });
});

describe('Select Target', () => {
  it('maps 1-2 to Scouts, 3-4 to Look-outs, 5-6 to Hunters', () => {
    assert.equal(selectTargetRole(1), 'scout');
    assert.equal(selectTargetRole(2), 'scout');
    assert.equal(selectTargetRole(3), 'lookout');
    assert.equal(selectTargetRole(4), 'lookout');
    assert.equal(selectTargetRole(5), 'hunter');
    assert.equal(selectTargetRole(6), 'hunter');
  });

  it('uses the right skill per role', () => {
    assert.equal(roleSkill('scout'), 'Explore');
    assert.equal(roleSkill('lookout'), 'Awareness');
    assert.equal(roleSkill('hunter'), 'Hunting');
    assert.equal(roleSkill('guide'), 'Travel');
  });
});

describe('Determine Event die by region type', () => {
  it('Border Land is Favoured, Wild Land plain, Dark Land Ill-favoured', () => {
    assert.equal(regionFeatMode('border'), 'favoured');
    assert.equal(regionFeatMode('wild'), 'normal');
    assert.equal(regionFeatMode('dark'), 'ill-favoured');
  });
});

describe('Journey Events Table', () => {
  const cases = [
    [EYE, 'terrible_misfortune', 3],
    [1, 'despair', 2],
    [2, 'ill_choices', 2],
    [3, 'ill_choices', 2],
    [4, 'mishap', 2],
    [5, 'mishap', 2],
    [6, 'mishap', 2],
    [7, 'mishap', 2],
    [8, 'short_cut', 1],
    [9, 'short_cut', 1],
    [10, 'chance_meeting', 1],
    [GANDALF, 'joyful_sight', 0],
  ];

  for (const [face, key, fatigue] of cases) {
    it(`Feat Die ${String(face)} → ${key} (Fatigue ${fatigue})`, () => {
      const event = lookupJourneyEvent(face);
      assert.equal(event.key, key);
      assert.equal(event.fatigue, fatigue);
    });
  }

  it('covers all 12 Feat Die faces with no gaps', () => {
    const faces = [EYE, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, GANDALF];
    for (const f of faces) assert.ok(lookupJourneyEvent(f), `no event for ${String(f)}`);
    assert.equal(JOURNEY_EVENTS.length, 7);
  });

  it('marks Short Cut, Chance-meeting and Joyful Sight as on-success entries', () => {
    assert.equal(lookupJourneyEvent(8).onSuccess, true);
    assert.equal(lookupJourneyEvent(10).onSuccess, true);
    assert.equal(lookupJourneyEvent(GANDALF).onSuccess, true);
    assert.equal(lookupJourneyEvent(4).onSuccess, false);
    assert.equal(lookupJourneyEvent(EYE).onSuccess, false);
  });

  it('gives Mishap +1 day and Short Cut −1 day', () => {
    assert.equal(lookupJourneyEvent(5).effects.dayAdjustment, 1);
    assert.equal(lookupJourneyEvent(8).effects.dayAdjustment, -1);
  });
});

describe('terrain dice modifier', () => {
  it('is −1 in hard terrain, +1 on a road, and cancels when both apply', () => {
    assert.equal(terrainDiceModifier({ hardTerrain: true, road: false }), -1);
    assert.equal(terrainDiceModifier({ hardTerrain: false, road: true }), 1);
    assert.equal(terrainDiceModifier({ hardTerrain: true, road: true }), 0);
    assert.equal(terrainDiceModifier({}), 0);
  });
});

describe('journey length in days', () => {
  it('is 1 day per hex plus 1 per hard-terrain hex', () => {
    const d = computeJourneyDays({ hexesTraversed: 9, hardTerrainHexes: 2 });
    assert.equal(d.marchDays, 9);
    assert.equal(d.totalDays, 11);
  });

  it('applies Mishap / Short Cut day adjustments', () => {
    assert.equal(computeJourneyDays({ hexesTraversed: 6, dayAdjustments: 2 }).totalDays, 8);
    assert.equal(computeJourneyDays({ hexesTraversed: 6, dayAdjustments: -1 }).totalDays, 5);
  });

  it('counts a Forced March at 1 day per 2 hexes, rounding up', () => {
    const d = computeJourneyDays({ hexesTraversed: 9, forcedMarch: true });
    assert.equal(d.marchDays, 5);
    assert.equal(d.totalDays, 5);
    assert.equal(d.forcedMarchFatigue, 5);
  });

  it('halves the total for mounted travel, rounding up', () => {
    assert.equal(computeJourneyDays({ hexesTraversed: 9, mounted: true }).totalDays, 5);
    assert.equal(computeJourneyDays({ hexesTraversed: 10, mounted: true }).totalDays, 5);
    assert.equal(computeJourneyDays({ hexesTraversed: 1, mounted: true }).totalDays, 1);
  });

  it('halves AFTER hard terrain and adjustments are added', () => {
    // 8 hexes + 3 hard terrain + 1 mishap = 12, halved = 6
    const d = computeJourneyDays({
      hexesTraversed: 8,
      hardTerrainHexes: 3,
      dayAdjustments: 1,
      mounted: true,
    });
    assert.equal(d.beforeMount, 12);
    assert.equal(d.totalDays, 6);
  });

  it('combines Forced March and mounted travel', () => {
    // 9 hexes forced-marched = 5 days, +1 hard terrain = 6, mounted halves to 3
    const d = computeJourneyDays({
      hexesTraversed: 9,
      hardTerrainHexes: 1,
      forcedMarch: true,
      mounted: true,
    });
    assert.equal(d.marchDays, 5);
    assert.equal(d.beforeMount, 6);
    assert.equal(d.totalDays, 3);
    assert.equal(d.forcedMarchFatigue, 5);
  });

  it('never returns a negative day count', () => {
    assert.equal(computeJourneyDays({ hexesTraversed: 1, dayAdjustments: -5 }).totalDays, 0);
  });
});

describe('end-of-journey Fatigue relief', () => {
  it('applies the mount Vigour first', () => {
    const r = computeFatigueRelief({ fatigue: 7, mountVigour: 3 });
    assert.equal(r.mountReduction, 3);
    assert.equal(r.afterMount, 4);
    assert.equal(r.finalFatigue, 4);
  });

  it('then reduces by 1 on a successful TRAVEL roll, +1 per icon', () => {
    const r = computeFatigueRelief({ fatigue: 7, mountVigour: 2, travelRoll: { success: true, icons: 2 } });
    assert.equal(r.afterMount, 5);
    assert.equal(r.rollReduction, 3);
    assert.equal(r.finalFatigue, 2);
  });

  it('gives no relief for a failed TRAVEL roll', () => {
    const r = computeFatigueRelief({ fatigue: 4, travelRoll: { success: false, icons: 2 } });
    assert.equal(r.rollReduction, 0);
    assert.equal(r.finalFatigue, 4);
  });

  it('never drops below zero', () => {
    const r = computeFatigueRelief({ fatigue: 1, mountVigour: 4, travelRoll: { success: true, icons: 5 } });
    assert.equal(r.finalFatigue, 0);
    assert.equal(r.mountReduction, 1);
  });
});

describe('role assignment rules', () => {
  const full = { a: 'guide', b: 'hunter', c: 'lookout', d: 'scout' };

  it('accepts exactly one Guide with all four roles covered', () => {
    assert.equal(validateRoleAssignments(full).valid, true);
  });

  it('allows doubling up on non-Guide roles', () => {
    assert.equal(validateRoleAssignments({ ...full, e: 'scout' }).valid, true);
  });

  it('rejects two Guides', () => {
    const r = validateRoleAssignments({ ...full, e: 'guide' });
    assert.equal(r.valid, false);
    assert.match(r.errors.join(' '), /one hero may be the Guide/);
  });

  it('rejects a missing Guide', () => {
    const { a, ...rest } = full;
    const r = validateRoleAssignments(rest);
    assert.equal(r.valid, false);
    assert.match(r.errors.join(' '), /Exactly one Guide/);
  });

  it('rejects an uncovered role', () => {
    const r = validateRoleAssignments({ a: 'guide', b: 'hunter', c: 'lookout' });
    assert.equal(r.valid, false);
    assert.match(r.errors.join(' '), /Scout/);
  });
});

describe('hex grid maths', () => {
  it("uses the spec-measured defaults for the Wilderland Adventurer's Map", () => {
    assert.equal(DEFAULT_CALIBRATION.hexEdge, 70);
    assert.equal(DEFAULT_CALIBRATION.hexWidth, 140);
    assert.equal(DEFAULT_CALIBRATION.hexHeight, 121);
    assert.equal(DEFAULT_CALIBRATION.colSpacing, 105);
    assert.equal(DEFAULT_CALIBRATION.colOffset, 60);
    assert.equal(DEFAULT_CALIBRATION.orientation, 'flat-top');
    assert.equal(DEFAULT_CALIBRATION.layout, 'offset-columns');
  });

  it('round-trips hex centres through pixelToHex', () => {
    const cal = { ...DEFAULT_CALIBRATION, offsetX: 200, offsetY: 150 };
    for (const col of [0, 1, 2, 7, 12, 31]) {
      for (const row of [0, 1, 4, 9]) {
        const poly = hexPolygon(col, row, cal);
        const cx = (poly[0].x + poly[3].x) / 2;
        const cy = (poly[1].y + poly[4].y) / 2;
        assert.deepEqual(pixelToHex(cx, cy, cal), { col, row });
      }
    }
  });

  it('round-trips under rotation too', () => {
    const cal = { ...DEFAULT_CALIBRATION, offsetX: 120, offsetY: 90, rotation: 2.5 };
    for (const [col, row] of [
      [3, 2],
      [8, 5],
      [15, 1],
    ]) {
      const poly = hexPolygon(col, row, cal);
      const cx = (poly[0].x + poly[3].x) / 2;
      const cy = (poly[1].y + poly[4].y) / 2;
      assert.deepEqual(pixelToHex(cx, cy, cal), { col, row });
    }
  });

  it('treats every neighbour as distance 1', () => {
    for (const [col, row] of [
      [4, 4],
      [5, 4],
    ]) {
      for (const n of hexNeighbours(col, row)) {
        assert.equal(hexDistance({ col, row }, n), 1, `${col},${row} -> ${n.col},${n.row}`);
      }
      assert.equal(new Set(hexNeighbours(col, row).map((n) => `${n.col},${n.row}`)).size, 6);
    }
  });
});

/* --- "your turn to roll" prompts -------------------------------------------- */

describe('promptedRollFor', () => {
  const GUIDE = 'guide-id';
  const LOOKOUT = 'lookout-id';
  const journey = { roles: { [GUIDE]: 'guide', [LOOKOUT]: 'lookout' }, routeIndex: 3 };

  const marching = { phase: 'awaiting_marching_test', state: {} };
  const resolving = {
    phase: 'awaiting_resolution',
    state: {
      pendingEvent: {
        eventId: 'evt-1',
        roleKey: 'lookout',
        skill: 'Awareness',
        targetCharacterId: LOOKOUT,
      },
    },
  };

  it('asks nobody when no hero is selected in this browser', () => {
    assert.equal(promptedRollFor({ travel: marching, journey, characterId: '' }), null);
    assert.equal(promptedRollFor({}), null);
  });

  it('asks the Guide for the Marching Test, and only the Guide', () => {
    const p = promptedRollFor({ travel: marching, journey, characterId: GUIDE });
    assert.deepEqual(p, { kind: 'marching_test', roleKey: 'guide', skill: 'Travel' });
    assert.equal(promptedRollFor({ travel: marching, journey, characterId: LOOKOUT }), null);
    assert.equal(promptedRollFor({ travel: marching, journey, characterId: 'nobody' }), null);
  });

  it('asks the targeted hero to resolve their own event, and only them', () => {
    const p = promptedRollFor({ travel: resolving, journey, characterId: LOOKOUT });
    assert.deepEqual(p, {
      kind: 'resolution',
      roleKey: 'lookout',
      skill: 'Awareness',
      eventId: 'evt-1',
    });
    assert.equal(promptedRollFor({ travel: resolving, journey, characterId: GUIDE }), null);
  });

  it('falls back to the role\'s skill if the pending event carries none', () => {
    const travel = {
      phase: 'awaiting_resolution',
      state: { pendingEvent: { roleKey: 'hunter', targetCharacterId: GUIDE } },
    };
    assert.equal(promptedRollFor({ travel, journey, characterId: GUIDE }).skill, 'Hunting');
  });

  it('stays quiet in every phase that is somebody else\'s move', () => {
    for (const phase of [
      'idle',
      'complete',
      'awaiting_target',
      'awaiting_target_choice',
      'awaiting_event_die',
      'journey_end',
      'awaiting_fatigue_relief',
    ]) {
      assert.equal(
        promptedRollFor({ travel: { phase, state: {} }, journey, characterId: GUIDE }),
        null,
        `phase ${phase} should not prompt`,
      );
    }
  });

  it('stays quiet when the resolution step has no pending event yet', () => {
    const travel = { phase: 'awaiting_resolution', state: {} };
    assert.equal(promptedRollFor({ travel, journey, characterId: LOOKOUT }), null);
  });
});

/* --- live travel animation --------------------------------------------------
 * The tick sequence is the per-hex breakdown computeJourneyDays() cannot give,
 * so the single most important property is that the two agree on the total.
 */

describe('journeyTickSequence', () => {
  const path = (n) => Array.from({ length: n }, (_, i) => ({ col: i + 1, row: 0 }));
  const hardAt = (...indices) => (_hex, i) => indices.includes(i);
  const lastDay = (steps) => (steps.length ? steps[steps.length - 1].day : 0);

  it('spends one day per hex on ordinary ground, moving on each', () => {
    const steps = journeyTickSequence({ path: path(3) });
    assert.equal(steps.length, 3);
    assert.deepEqual(
      steps.map((s) => [s.day, s.moved]),
      [
        [1, true],
        [2, true],
        [3, true],
      ],
    );
  });

  it('gives a hard-terrain hex a second day with no further movement', () => {
    const steps = journeyTickSequence({ path: path(3), isHardTerrain: hardAt(1) });
    assert.deepEqual(
      steps.map((s) => [s.day, s.moved]),
      [
        [1, true], // hex 1
        [2, true], // hex 2 — hard
        [3, false], // ...and its extra day, standing still
        [4, true], // hex 3
      ],
    );
  });

  it('under Forced March moves twice per day, spending the day on the second hex', () => {
    const steps = journeyTickSequence({ path: path(4), forcedMarch: true });
    assert.deepEqual(
      steps.map((s) => [s.day, s.moved]),
      [
        [0, true], // first of the pair — ground covered, no day yet
        [1, true], // second of the pair — the day is spent here
        [1, true],
        [2, true],
      ],
    );
  });

  it('still charges a day for a lone trailing hex at the end of the journey', () => {
    const steps = journeyTickSequence({ path: path(5), forcedMarch: true });
    assert.equal(lastDay(steps), 3); // ceil(5 / 2)
  });

  it('does not charge for that half-pair until the journey actually ends', () => {
    // Same 5 hexes, walked as two legs. The pairing must carry across the leg
    // boundary, or a journey split into legs would cost more days than one
    // walked in a single stretch.
    const legA = journeyTickSequence({
      path: path(3),
      forcedMarch: true,
      startHexIndex: 0,
      finalLeg: false,
    });
    assert.equal(lastDay(legA), 1); // floor(3 / 2) — mid-journey
    const legB = journeyTickSequence({
      path: path(2),
      forcedMarch: true,
      startDay: lastDay(legA),
      startHexIndex: 3,
      finalLeg: true,
    });
    assert.equal(lastDay(legB), 3); // ceil(5 / 2), same as the single-leg count
  });

  it('applies hard terrain and Forced March independently — the documented reading', () => {
    // Judgment call (see README): a hard-terrain hex inside a forced-march pair
    // still adds its own day; the pair still spends only one for its movement.
    const steps = journeyTickSequence({
      path: path(2),
      forcedMarch: true,
      isHardTerrain: hardAt(0),
    });
    assert.deepEqual(
      steps.map((s) => [s.day, s.moved]),
      [
        [0, true], // first of the pair
        [1, false], // its hard-terrain day
        [2, true], // second of the pair, spending the march day
      ],
    );
  });

  it('carries the running day count in from the previous leg', () => {
    const steps = journeyTickSequence({ path: path(2), startDay: 7 });
    assert.deepEqual(steps.map((s) => s.day), [8, 9]);
  });

  it('is empty for a leg that moved nowhere', () => {
    assert.deepEqual(journeyTickSequence({ path: [] }), []);
  });

  // The correctness check: whatever pacing the animation chooses, its total has
  // to be the number the journey actually gets logged with.
  it('totals exactly what computeJourneyDays() does, for every shape', () => {
    for (const hexes of [1, 2, 3, 4, 5, 8, 11]) {
      for (const forcedMarch of [false, true]) {
        for (const hardCount of [0, 1, 3]) {
          if (hardCount > hexes) continue;
          const hard = Array.from({ length: hardCount }, (_, i) => i);
          const steps = journeyTickSequence({
            path: path(hexes),
            isHardTerrain: hardAt(...hard),
            forcedMarch,
          });
          const authoritative = computeJourneyDays({
            hexesTraversed: hexes,
            hardTerrainHexes: hardCount,
            forcedMarch,
          });
          assert.equal(
            lastDay(steps),
            authoritative.beforeMount,
            `${hexes} hexes, ${hardCount} hard, forcedMarch=${forcedMarch}`,
          );
        }
      }
    }
  });

  it('deliberately ignores the mounted halving — that is a final-total adjustment', () => {
    const steps = journeyTickSequence({ path: path(6) });
    const mounted = computeJourneyDays({ hexesTraversed: 6, mounted: true });
    assert.equal(lastDay(steps), 6);
    assert.equal(mounted.totalDays, 3);
    // The live counter running ahead of the logged total on a mounted journey
    // is expected behaviour, not drift.
    assert.equal(lastDay(steps), mounted.beforeMount);
  });

  it('walks the hexes it was given, in order', () => {
    const steps = journeyTickSequence({ path: path(3), isHardTerrain: hardAt(2) });
    assert.deepEqual(
      steps.filter((s) => s.moved).map((s) => s.hex.col),
      [1, 2, 3],
    );
  });
});

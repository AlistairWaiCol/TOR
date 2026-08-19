/**
 * The freehand path tool's maths (shared/hexMath.js).
 *
 * The player-side map has no grid: a drawn line is resampled at a regular
 * interval, each sample matched to its containing hex, and any gap a coarse or
 * wobbly line left behind is filled by walking the shortest hex path. The
 * result has to be a route the travel engine can step along one hex at a time —
 * which means every consecutive pair adjacent — and identical in shape to what
 * the GM's click tool writes.
 *
 * Its own file rather than more of journey.test.js: the hex-grid tests there
 * are about the calibration geometry, this is a pipeline with its own failure
 * modes (boundary ties, skipped hexes, doubling back).
 */

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  DEFAULT_CALIBRATION,
  cubeToOffset,
  hexDistance,
  hexLine,
  hexNeighbours,
  hexPolygon,
  offsetToCube,
  resamplePolyline,
  snapPathToHexes,
} from '../shared/hexMath.js';

const CAL = { ...DEFAULT_CALIBRATION, offsetX: 400, offsetY: 300 };

/** Pixel centre of a hex under a calibration — where a finger would aim. */
function centreOf(col, row, cal = CAL) {
  const poly = hexPolygon(col, row, cal);
  return { x: (poly[0].x + poly[3].x) / 2, y: (poly[1].y + poly[4].y) / 2 };
}

/** The property the travel engine depends on: one hex step at a time. */
function isContiguous(route) {
  for (let i = 1; i < route.length; i += 1) {
    if (hexDistance(route[i - 1], route[i]) !== 1) return false;
  }
  return true;
}

describe('offset <-> cube', () => {
  it('round-trips both column parities, including negatives', () => {
    for (const col of [-5, -2, -1, 0, 1, 2, 7, 12]) {
      for (const row of [-3, 0, 1, 6]) {
        assert.deepEqual(cubeToOffset(offsetToCube(col, row)), { col, row });
      }
    }
  });

  it('keeps cube coordinates summing to zero', () => {
    for (const [col, row] of [[0, 0], [1, 3], [-4, 2], [9, -1]]) {
      const c = offsetToCube(col, row);
      assert.equal(c.x + c.y + c.z, 0);
    }
  });
});

describe('hexLine', () => {
  it('is just the hex itself when both ends are the same', () => {
    assert.deepEqual(hexLine({ col: 3, row: 2 }, { col: 3, row: 2 }), [{ col: 3, row: 2 }]);
  });

  it('is the two hexes when they are already adjacent', () => {
    for (const n of hexNeighbours(4, 4)) {
      const line = hexLine({ col: 4, row: 4 }, n);
      assert.equal(line.length, 2);
      assert.deepEqual(line[0], { col: 4, row: 4 });
      assert.deepEqual(line[1], { col: n.col, row: n.row });
    }
  });

  it('produces distance+1 hexes, every consecutive pair adjacent', () => {
    const pairs = [
      [{ col: 0, row: 0 }, { col: 6, row: 3 }],
      [{ col: 2, row: 7 }, { col: 9, row: 1 }],
      [{ col: 5, row: 5 }, { col: -3, row: 2 }],
      [{ col: -4, row: -2 }, { col: 3, row: 6 }],
    ];
    for (const [a, b] of pairs) {
      const line = hexLine(a, b);
      assert.equal(line.length, hexDistance(a, b) + 1);
      assert.deepEqual(line[0], { col: a.col, row: a.row });
      assert.deepEqual(line[line.length - 1], { col: b.col, row: b.row });
      assert.ok(isContiguous(line), JSON.stringify(line));
    }
  });

  it('is the same length in either direction', () => {
    const a = { col: 1, row: 1 };
    const b = { col: 7, row: 5 };
    assert.equal(hexLine(a, b).length, hexLine(b, a).length);
  });
});

describe('resamplePolyline', () => {
  it('keeps both ends and spaces the rest evenly', () => {
    const out = resamplePolyline([{ x: 0, y: 0 }, { x: 100, y: 0 }], 25);
    assert.deepEqual(out.map((p) => p.x), [0, 25, 50, 75, 100]);
  });

  it('keeps the final point even when it falls mid-interval', () => {
    const out = resamplePolyline([{ x: 0, y: 0 }, { x: 30, y: 0 }], 20);
    assert.deepEqual(out.map((p) => p.x), [0, 20, 30]);
  });

  it('carries leftover distance across a corner rather than restarting', () => {
    // 10 across then 10 down, sampled every 6: the second sample on the
    // vertical leg lands 2 past the corner, not 6 past it.
    const out = resamplePolyline([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }], 6);
    assert.deepEqual(out, [
      { x: 0, y: 0 },
      { x: 6, y: 0 },
      { x: 10, y: 2 },
      { x: 10, y: 8 },
      { x: 10, y: 10 },
    ]);
  });

  it('survives a stationary pointer, a single point and nothing at all', () => {
    assert.deepEqual(resamplePolyline([{ x: 4, y: 4 }, { x: 4, y: 4 }], 5), [{ x: 4, y: 4 }]);
    assert.deepEqual(resamplePolyline([{ x: 1, y: 2 }], 5), [{ x: 1, y: 2 }]);
    assert.deepEqual(resamplePolyline([], 5), []);
  });
});

describe('snapPathToHexes', () => {
  it('turns a straight drag along a row into that row of hexes', () => {
    const route = snapPathToHexes([centreOf(3, 4), centreOf(9, 4)], CAL);
    assert.deepEqual(route[0], { col: 3, row: 4 });
    assert.deepEqual(route[route.length - 1], { col: 9, row: 4 });
    assert.ok(isContiguous(route), JSON.stringify(route));
  });

  it('never repeats a hex back-to-back, however slowly the line was drawn', () => {
    const start = centreOf(2, 2);
    const points = [];
    for (let t = 0; t <= 200; t += 1) points.push({ x: start.x + t * 2, y: start.y });
    const route = snapPathToHexes(points, CAL);
    for (let i = 1; i < route.length; i += 1) assert.notDeepEqual(route[i], route[i - 1]);
    assert.ok(isContiguous(route));
  });

  it('fills the gap when a coarse sample skips straight past a hex', () => {
    // Two points six hexes apart with nothing sampled in between: without
    // gap-filling this is a two-entry "route" the travel engine cannot walk.
    const route = snapPathToHexes([centreOf(1, 1), centreOf(7, 4)], CAL, { spacing: 100000 });
    assert.deepEqual(route[0], { col: 1, row: 1 });
    assert.deepEqual(route[route.length - 1], { col: 7, row: 4 });
    assert.equal(route.length, hexDistance({ col: 1, row: 1 }, { col: 7, row: 4 }) + 1);
    assert.ok(isContiguous(route), JSON.stringify(route));
  });

  it('stays contiguous through a wobbly line that keeps crossing boundaries', () => {
    const start = centreOf(2, 5);
    const points = [];
    for (let t = 0; t <= 60; t += 1) {
      points.push({
        x: start.x + t * 9,
        // Most of a hex height of wobble, so the line repeatedly steps into the
        // neighbouring row and back.
        y: start.y + Math.sin(t / 2.5) * CAL.hexHeight * 0.8,
      });
    }
    const route = snapPathToHexes(points, CAL);
    assert.ok(route.length > 5);
    assert.ok(isContiguous(route), JSON.stringify(route));
  });

  it('records a line that doubles back rather than treating the route as a set', () => {
    const route = snapPathToHexes(
      [centreOf(4, 4), centreOf(8, 4), centreOf(4, 4)],
      CAL,
    );
    assert.deepEqual(route[0], { col: 4, row: 4 });
    assert.deepEqual(route[route.length - 1], { col: 4, row: 4 });
    assert.ok(route.some((h) => h.col === 8 && h.row === 4), 'the far hex was reached');
    assert.ok(route.length > hexDistance({ col: 4, row: 4 }, { col: 8, row: 4 }) + 1);
    assert.ok(isContiguous(route));
  });

  it('lands the right hexes on a line traced deliberately along a boundary', () => {
    // Straight down the shared edge between (5,3) and (6,3): every sample is a
    // near-tie between two centres, which is where a naive snap goes wrong.
    const a = centreOf(5, 3);
    const b = centreOf(6, 3);
    const points = [];
    for (let t = 0; t <= 40; t += 1) {
      const k = t / 40;
      points.push({ x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k });
    }
    const route = snapPathToHexes(points, CAL);
    assert.deepEqual(route[0], { col: 5, row: 3 });
    assert.deepEqual(route[route.length - 1], { col: 6, row: 3 });
    assert.ok(isContiguous(route), JSON.stringify(route));
  });

  it('works under a rotated calibration', () => {
    const rotated = { ...DEFAULT_CALIBRATION, offsetX: 150, offsetY: 90, rotation: 2.5 };
    const route = snapPathToHexes([centreOf(3, 2, rotated), centreOf(8, 5, rotated)], rotated);
    assert.deepEqual(route[0], { col: 3, row: 2 });
    assert.deepEqual(route[route.length - 1], { col: 8, row: 5 });
    assert.ok(isContiguous(route));
  });

  it('gives one hex for a tap and nothing for no input', () => {
    assert.deepEqual(snapPathToHexes([centreOf(6, 6)], CAL), [{ col: 6, row: 6 }]);
    assert.deepEqual(snapPathToHexes([], CAL), []);
  });

  it('produces exactly the shape of route entry the click tool writes', () => {
    const route = snapPathToHexes([centreOf(1, 1), centreOf(4, 1)], CAL);
    assert.ok(route.length > 1);
    for (const h of route) {
      assert.deepEqual(Object.keys(h).sort(), ['col', 'row']);
      assert.ok(Number.isInteger(h.col) && Number.isInteger(h.row));
    }
  });
});

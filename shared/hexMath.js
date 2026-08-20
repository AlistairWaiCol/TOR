/**
 * Flat-top hex grid maths for the map overlay (offset-column / "odd-q" layout:
 * odd-numbered columns are pushed down by half a hex height).
 *
 * All calibration values are in the ORIGINAL image's pixel space. The client
 * scales them by (displayedWidth / originalWidth) so the same calibration works
 * at every derivative resolution.
 */

/** Measured starting values for the Wilderland Adventurer's Map (6600x5100), per spec §6a. */
export const DEFAULT_CALIBRATION = {
  orientation: 'flat-top',
  layout: 'offset-columns',
  hexEdge: 70, // centre to vertex
  hexWidth: 140, // point-to-point, horizontal
  hexHeight: 121, // flat-to-flat, vertical
  colSpacing: 105, // column-to-column horizontal spacing
  colOffset: 60, // vertical offset of odd columns (half the height)
  offsetX: 0, // grid origin (centre of hex 0,0)
  offsetY: 0,
  rotation: 0, // degrees, clockwise, about the grid origin
};

export function hexKey(col, row) {
  return `${col},${row}`;
}

export function parseHexKey(key) {
  const [col, row] = String(key).split(',').map(Number);
  return { col, row };
}

function toRad(deg) {
  return ((Number(deg) || 0) * Math.PI) / 180;
}

function rotate(x, y, deg) {
  if (!deg) return { x, y };
  const a = toRad(deg);
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return { x: x * cos - y * sin, y: x * sin + y * cos };
}

function normalise(cal = {}) {
  const c = { ...DEFAULT_CALIBRATION, ...cal };
  c.hexEdge = Number(c.hexEdge) || DEFAULT_CALIBRATION.hexEdge;
  c.hexWidth = Number(c.hexWidth) || c.hexEdge * 2;
  c.hexHeight = Number(c.hexHeight) || Math.sqrt(3) * c.hexEdge;
  c.colSpacing = Number(c.colSpacing) || c.hexEdge * 1.5;
  c.colOffset = Number(c.colOffset) || c.hexHeight / 2;
  c.offsetX = Number(c.offsetX) || 0;
  c.offsetY = Number(c.offsetY) || 0;
  c.rotation = Number(c.rotation) || 0;
  return c;
}

/** Pixel centre of hex (col,row) in original-image coordinates. */
export function hexCenter(col, row, calibration) {
  const c = normalise(calibration);
  const localX = col * c.colSpacing;
  const localY = row * c.hexHeight + (Math.abs(col % 2) === 1 ? c.colOffset : 0);
  const r = rotate(localX, localY, c.rotation);
  return { x: r.x + c.offsetX, y: r.y + c.offsetY };
}

/** Polygon vertices for a hex, in original-image coordinates. */
export function hexPolygon(col, row, calibration) {
  const c = normalise(calibration);
  const { x: cx, y: cy } = hexCenter(col, row, c);
  const hw = c.hexWidth / 2;
  const qw = c.hexWidth / 4;
  const hh = c.hexHeight / 2;
  // Flat-top: points left/right, flat edges top/bottom.
  const local = [
    [-hw, 0],
    [-qw, -hh],
    [qw, -hh],
    [hw, 0],
    [qw, hh],
    [-qw, hh],
  ];
  return local.map(([lx, ly]) => {
    const r = rotate(lx, ly, c.rotation);
    return { x: cx + r.x, y: cy + r.y };
  });
}

/**
 * Which hex contains a pixel point? A hex tiling is exactly the Voronoi diagram
 * of its centre lattice, so "nearest centre" is not an approximation — it is
 * the containing hex. We only need to test the 3x3 candidate neighbourhood.
 */
export function pixelToHex(px, py, calibration) {
  const c = normalise(calibration);
  const un = rotate(px - c.offsetX, py - c.offsetY, -c.rotation);
  const approxCol = Math.round(un.x / c.colSpacing);

  let best = null;
  for (let col = approxCol - 1; col <= approxCol + 1; col += 1) {
    const shift = Math.abs(col % 2) === 1 ? c.colOffset : 0;
    const approxRow = Math.round((un.y - shift) / c.hexHeight);
    for (let row = approxRow - 1; row <= approxRow + 1; row += 1) {
      const localX = col * c.colSpacing;
      const localY = row * c.hexHeight + shift;
      const d = (un.x - localX) ** 2 + (un.y - localY) ** 2;
      if (!best || d < best.d) best = { col, row, d };
    }
  }
  return { col: best.col, row: best.row };
}

/** Every hex whose centre lies inside the image, for grid rendering. */
export function hexesInBounds(width, height, calibration, pad = 1) {
  const c = normalise(calibration);
  const corners = [
    [0, 0],
    [width, 0],
    [0, height],
    [width, height],
  ].map(([x, y]) => pixelToHex(x, y, c));
  const cols = corners.map((h) => h.col);
  const rows = corners.map((h) => h.row);
  const minCol = Math.min(...cols) - pad;
  const maxCol = Math.max(...cols) + pad;
  const minRow = Math.min(...rows) - pad;
  const maxRow = Math.max(...rows) + pad;
  const out = [];
  for (let col = minCol; col <= maxCol; col += 1) {
    for (let row = minRow; row <= maxRow; row += 1) out.push({ col, row });
  }
  return out;
}

/* --- offset <-> cube conversions, for adjacency and distance --------------- */

export function offsetToCube(col, row) {
  const x = col;
  const z = row - (col - (col & 1)) / 2;
  return { x, y: -x - z, z };
}

export function cubeToOffset({ x, z }) {
  return { col: x, row: z + (x - (x & 1)) / 2 };
}

/** Hex distance between two offset-column coordinates. */
export function hexDistance(a, b) {
  const ca = offsetToCube(a.col, a.row);
  const cb = offsetToCube(b.col, b.row);
  return (Math.abs(ca.x - cb.x) + Math.abs(ca.y - cb.y) + Math.abs(ca.z - cb.z)) / 2;
}

const NEIGHBOURS_EVEN = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, -1],
  [-1, 0],
  [0, 1],
];
const NEIGHBOURS_ODD = [
  [1, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export function hexNeighbours(col, row) {
  const dirs = Math.abs(col % 2) === 1 ? NEIGHBOURS_ODD : NEIGHBOURS_EVEN;
  return dirs.map(([dc, dr]) => ({ col: col + dc, row: row + dr }));
}

export function areAdjacent(a, b) {
  return hexDistance(a, b) === 1;
}

/* --- freehand path -> hex route --------------------------------------------
 *
 * The player-side map has no grid and no hex clicking: a player drags a line
 * across the map art and the SERVER turns that line into exactly the same
 * `[{col,row}, ...]` route the GM's click tool produces, so locking, clearing
 * and Marching Test distance counting are all input-method-agnostic.
 *
 * Three steps, each pure and each testable on its own:
 *   resamplePolyline() - even sampling, so a fast drag is not a straight jump
 *   pixelToHex()       - nearest centre IS the containing hex (see above)
 *   hexLine()          - fills any gap a coarse or wobbly sample left behind
 */

/** Round a fractional cube coordinate to the nearest whole hex. */
function cubeRound(x, y, z) {
  let rx = Math.round(x);
  let ry = Math.round(y);
  let rz = Math.round(z);
  const dx = Math.abs(rx - x);
  const dy = Math.abs(ry - y);
  const dz = Math.abs(rz - z);
  // Re-derive whichever axis moved furthest, so x + y + z stays 0.
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  return { x: rx, y: ry, z: rz };
}

/**
 * The shortest run of hexes from `a` to `b` inclusive — cube-coordinate
 * line interpolation, rounded back to whole hexes at each step.
 *
 * Every consecutive pair in the result is adjacent, which is the property the
 * gap-filling in snapPathToHexes() relies on.
 */
export function hexLine(a, b) {
  const steps = hexDistance(a, b);
  const start = { col: Number(a.col), row: Number(a.row) };
  if (steps === 0) return [start];
  const ca = offsetToCube(start.col, start.row);
  const cb = offsetToCube(Number(b.col), Number(b.row));
  // A lerp that lands exactly on an edge midpoint is a tie between two hexes;
  // nudging the three axes by different tiny amounts (summing to ~0) breaks it
  // the same way every time instead of leaving it to floating-point luck.
  const e = 1e-6;
  const out = [];
  for (let i = 0; i <= steps; i += 1) {
    const t = i / steps;
    out.push(
      cubeToOffset(
        cubeRound(
          ca.x + (cb.x - ca.x) * t + e,
          ca.y + (cb.y - ca.y) * t + 2 * e,
          ca.z + (cb.z - ca.z) * t - 3 * e,
        ),
      ),
    );
  }
  return out;
}

/**
 * Even samples along a polyline, `spacing` pixels apart. The first and last
 * points are always kept, so a drawn line never loses its ends.
 */
export function resamplePolyline(points = [], spacing = 1) {
  const pts = points
    .map((p) => ({ x: Number(p.x), y: Number(p.y) }))
    .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (pts.length === 0) return [];
  const step = Math.max(1e-6, Number(spacing) || 1);
  const out = [pts[0]];
  let carried = 0; // distance already walked since the last emitted sample

  for (let i = 1; i < pts.length; i += 1) {
    const from = pts[i - 1];
    const to = pts[i];
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len === 0) continue;
    let travelled = step - carried;
    while (travelled <= len) {
      const t = travelled / len;
      out.push({ x: from.x + dx * t, y: from.y + dy * t });
      travelled += step;
    }
    carried = len - (travelled - step);
  }

  const last = pts[pts.length - 1];
  const tail = out[out.length - 1];
  if (tail.x !== last.x || tail.y !== last.y) out.push({ x: last.x, y: last.y });
  return out;
}

/**
 * A drawn polyline (in ORIGINAL-image pixel space) -> a contiguous hex route.
 *
 * Consecutive samples that land in the same hex collapse to one entry. Where
 * two consecutive matched hexes are NOT adjacent — a wobbly line that cuts a
 * corner, or a fast drag sampled coarsely — the gap is filled by walking the
 * shortest hex path between them, so the result is always a route the travel
 * engine can step along one hex at a time.
 *
 * Hexes revisited later in the line are kept: doubling back is something the
 * player drew on purpose, and the route is an ordered path, not a set.
 *
 * @param {Array<{x:number,y:number}>} points raw pointer trail
 * @param {object} calibration same calibration object hexCenter()/pixelToHex() take
 * @param {object} [opts]
 * @param {number} [opts.spacing] sample spacing in px; defaults to a third of a hex
 */
/**
 * A hex snapped into a freehand route by only barely clipping its corner is
 * expected behaviour of point-to-nearest-centre snapping, not a bug to chase
 * out of the algorithm — this is the correction tool instead: the GM removes
 * the unwanted hex by hand, and the remaining path is re-bridged with the
 * same hexLine() gap-fill snapPathToHexes() uses, so it stays walkable one
 * hex at a time.
 *
 * Only the FIRST matching occurrence is removed — a route deliberately
 * doubling back over the same hex is rare enough that index-based removal
 * isn't worth the extra API surface here.
 */
export function removeHexFromRoute(route = [], target) {
  const idx = route.findIndex((h) => h.col === target.col && h.row === target.row);
  if (idx === -1) return route;
  const before = route.slice(0, idx);
  const after = route.slice(idx + 1);
  if (before.length === 0 || after.length === 0) return [...before, ...after];
  const prev = before[before.length - 1];
  const next = after[0];
  if (hexDistance(prev, next) <= 1) return [...before, ...after];
  // hexLine() includes both ends; both are already present in before/after.
  const bridge = hexLine(prev, next).slice(1, -1);
  return [...before, ...bridge, ...after];
}

export function snapPathToHexes(points = [], calibration, { spacing } = {}) {
  const c = normalise(calibration);
  const step = Number(spacing) > 0 ? Number(spacing) : c.hexHeight / 3;
  const samples = resamplePolyline(points, step);
  if (samples.length === 0) return [];

  const route = [];
  const push = (hx) => {
    const last = route[route.length - 1];
    if (last && last.col === hx.col && last.row === hx.row) return;
    if (last && hexDistance(last, hx) > 1) {
      // hexLine() includes both ends; the first is the hex we are already on.
      for (const fill of hexLine(last, hx).slice(1)) route.push(fill);
      return;
    }
    route.push({ col: hx.col, row: hx.row });
  };

  for (const s of samples) push(pixelToHex(s.x, s.y, c));
  return route;
}

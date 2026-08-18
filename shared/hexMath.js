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

function offsetToCube(col, row) {
  const x = col;
  const z = row - (col - (col & 1)) / 2;
  return { x, y: -x - z, z };
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

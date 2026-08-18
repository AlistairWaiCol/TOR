/**
 * Journey Log map snapshot.
 *
 * Renders the travelled stretch of the campaign map to an offscreen canvas —
 * cropped to the hexes the Company actually crossed, the path highlighted, and
 * one numbered pin per event matching the numbering in the Journey Log's event
 * list — and returns it as a PNG data URL to store on the journey record.
 *
 * Client-side on purpose: the browser already has the map image, the hex
 * geometry and the same canvas overlay code the live map draws with, so the
 * server needs no image pipeline for this.
 */

import { hexCenter, hexPolygon } from '@shared/hexMath.js';
import { mapImageUrl } from './api.js';

/** Hexes are padded out by this fraction of a hex before cropping. */
const PADDING_HEXES = 0.75;
/** Cap on the stored image's width — this lands in a database text column. */
const MAX_WIDTH = 900;

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not load the map image.'));
    img.src = src;
  });
}

/** Scale a saved calibration from original-image pixels into tier pixels. */
function scaleCalibration(calibration, s) {
  return {
    hexEdge: calibration.hexEdge * s,
    hexWidth: calibration.hexWidth * s,
    hexHeight: calibration.hexHeight * s,
    colSpacing: calibration.colSpacing * s,
    colOffset: calibration.colOffset * s,
    offsetX: calibration.offsetX * s,
    offsetY: calibration.offsetY * s,
    rotation: calibration.rotation,
  };
}

/**
 * @param {object} opts
 * @param {object} opts.calibration  Active map calibration (with its tiers).
 * @param {object} opts.journey      The journey record (route + routeIndex).
 * @param {object[]} opts.events     Journey events, in log order.
 * @param {string} [opts.tier]       Derivative tier to draw from.
 * @returns {Promise<string|null>}   PNG data URL, or null if there is nothing to draw.
 */
export async function renderJourneyMap({ calibration, journey, events = [], tier = 'web' }) {
  if (!calibration || !journey) return null;

  const tiers = calibration.tiers ?? [];
  const chosen = tiers.find((t) => t.name === tier) ?? tiers.find((t) => t.name === 'web') ?? tiers[0];
  if (!chosen) return null;

  // Only the part of the route actually walked. A journey abandoned on hex 3 of
  // 10 gets a map of those three hexes, not of the plan.
  const walked = (journey.route ?? []).slice(0, (journey.routeIndex ?? 0) + 1);
  if (walked.length === 0) return null;

  const eventHexes = events
    .filter((e) => e.kind === 'event' && e.col != null && e.row != null)
    .map((e) => ({ col: e.col, row: e.row }));

  const image = await loadImage(mapImageUrl(calibration.id, chosen.name));
  const s = chosen.width / calibration.originalWidth;
  const cal = scaleCalibration(calibration, s);

  // Bounding box of every hex that matters, in tier pixels.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const hx of [...walked, ...eventHexes]) {
    for (const p of hexPolygon(hx.col, hx.row, cal)) {
      minX = Math.min(minX, p.x);
      maxX = Math.max(maxX, p.x);
      minY = Math.min(minY, p.y);
      maxY = Math.max(maxY, p.y);
    }
  }
  const padX = cal.hexWidth * PADDING_HEXES;
  const padY = cal.hexHeight * PADDING_HEXES;
  const sx = Math.max(0, Math.floor(minX - padX));
  const sy = Math.max(0, Math.floor(minY - padY));
  const sw = Math.min(chosen.width - sx, Math.ceil(maxX - minX + padX * 2));
  const sh = Math.min(chosen.height - sy, Math.ceil(maxY - minY + padY * 2));
  if (sw <= 0 || sh <= 0) return null;

  const scale = Math.min(1, MAX_WIDTH / sw);
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * scale));
  canvas.height = Math.max(1, Math.round(sh * scale));

  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);

  // Everything below is drawn in crop space: subtract the crop origin, then
  // apply the same downscale the image got.
  const toLocal = (p) => ({ x: (p.x - sx) * scale, y: (p.y - sy) * scale });
  const centreOf = (hx) => toLocal(hexCenter(hx.col, hx.row, cal));

  const tracePoly = (hx) => {
    const pts = hexPolygon(hx.col, hx.row, cal).map(toLocal);
    ctx.beginPath();
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
    ctx.closePath();
  };

  // Travelled hexes.
  for (const hx of walked) {
    tracePoly(hx);
    ctx.fillStyle = 'rgba(200, 162, 74, 0.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(240, 214, 139, 0.75)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // The path itself, centre to centre.
  if (walked.length > 1) {
    ctx.beginPath();
    walked.forEach((hx, i) => {
      const c = centreOf(hx);
      if (i === 0) ctx.moveTo(c.x, c.y);
      else ctx.lineTo(c.x, c.y);
    });
    ctx.strokeStyle = 'rgba(240, 214, 139, 0.95)';
    ctx.lineWidth = Math.max(2, cal.hexHeight * scale * 0.08);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  // Start and end markers.
  const marker = (hx, fill) => {
    const c = centreOf(hx);
    const r = Math.max(4, cal.hexHeight * scale * 0.18);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = '#191510';
    ctx.lineWidth = 2;
    ctx.stroke();
  };
  marker(walked[0], '#6f9a5b');
  if (walked.length > 1) marker(walked[walked.length - 1], '#c8a24a');

  // Numbered event pins. The number is the event's position in the Journey
  // Log's own list, so pin 3 is "Event 3" there — Marching Tests are skipped.
  const pinRadius = Math.max(7, cal.hexHeight * scale * 0.24);
  const pinsOnHex = new Map();
  let n = 0;
  for (const event of events) {
    if (event.kind !== 'event' || event.col == null) continue;
    n += 1;
    const key = `${event.col},${event.row}`;
    // A Perilous Area runs several events on one hex — fan those pins apart.
    const seen = pinsOnHex.get(key) ?? 0;
    pinsOnHex.set(key, seen + 1);
    const c = centreOf({ col: event.col, row: event.row });
    const cx = c.x + (seen % 2 === 0 ? 1 : -1) * Math.ceil(seen / 2) * pinRadius * 1.1;
    const cy = c.y;

    ctx.beginPath();
    ctx.arc(cx, cy, pinRadius, 0, Math.PI * 2);
    ctx.fillStyle = event.outcome === 'success' ? 'rgba(111, 154, 91, 0.95)' : 'rgba(180, 85, 63, 0.95)';
    ctx.fill();
    ctx.strokeStyle = '#f4e6bd';
    ctx.lineWidth = 1.5;
    ctx.stroke();

    ctx.fillStyle = '#12100c';
    ctx.font = `bold ${Math.round(pinRadius * 1.2)}px serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), cx, cy + 1);
  }

  return canvas.toDataURL('image/png');
}

/**
 * Render and save the snapshot onto the journey record. Never throws — a map
 * that could not be drawn must not stop a journey being closed out.
 */
export async function saveJourneyMap(api, { calibration, journey, events }) {
  try {
    const dataUrl = await renderJourneyMap({ calibration, journey, events });
    if (!dataUrl) return null;
    await api.patch(`/journeys/${journey.id}`, { mapSnapshot: dataUrl });
    return dataUrl;
  } catch (err) {
    console.warn('Journey map snapshot skipped:', err.message);
    return null;
  }
}

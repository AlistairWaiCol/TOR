import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { hexKey, hexPolygon, hexesInBounds, pixelToHex } from '@shared/hexMath.js';
import { mapImageUrl } from '../lib/api.js';
import partyPinUrl from '../assets/party-pin.png';

const REGION_FILL = {
  border: 'rgba(95, 127, 158, 0.30)',
  wild: 'rgba(111, 154, 91, 0.24)',
  dark: 'rgba(138, 107, 156, 0.34)',
};

/**
 * Party token. The artwork is trimmed to its own bounding box, so the pin's
 * pointed tip IS the bottom edge of the file — anchoring is bottom-centre on
 * the hex centre, the way a map pin points at a place.
 *
 * Height is a multiple of the hex height so the token scales with the grid at
 * every zoom and derivative tier.
 */
const PIN_HEIGHT_IN_HEXES = 1.25;
const PIN_ASPECT = 154 / 256; // width / height of the trimmed artwork

/**
 * Loaded once for the module rather than per <HexMap>: the Map page and the
 * Calibration page both mount one, and it is a 22KB static asset either way.
 */
let pinImage = null;
let pinPromise = null;

function loadPartyPin() {
  if (pinImage) return Promise.resolve(pinImage);
  if (!pinPromise) {
    pinPromise = new Promise((resolve) => {
      const img = new Image();
      img.src = partyPinUrl;
      img.onload = () => {
        pinImage = img;
        resolve(img);
      };
      // Fall back to the plain gold dot rather than losing the party token.
      img.onerror = () => resolve(null);
    });
  }
  return pinPromise;
}

/**
 * Canvas map with a hex overlay. All calibration numbers are in the ORIGINAL
 * image's pixel space; we scale them by (canvas width / original width) so the
 * same saved calibration lines up at every derivative resolution.
 */
export default function HexMap({
  calibration,
  hexes = [],
  tier = 'web',
  zoom = 1,
  showGrid = true,
  showTags = true,
  route = [],
  currentHex = null,
  pinHex = null,
  selected = null,
  onHexClick,
  onHexHover,
  paintable = false,
  height = '74vh',
  // Freehand mode: drag a line across the map instead of clicking hexes. The
  // caller gets the raw trail in ORIGINAL-image pixel coordinates and sends it
  // to the server, which does the snapping — nothing here knows or shows where
  // a hex boundary is, which is the whole point on the player-side map.
  freehand = false,
  onFreehandPath,
}) {
  const canvasRef = useRef(null);
  const wrapRef = useRef(null);
  const [image, setImage] = useState(null);
  const [pin, setPin] = useState(pinImage);
  const [painting, setPainting] = useState(false);
  const lastPainted = useRef('');
  const lastHovered = useRef('');
  // The in-progress stroke, kept in refs rather than state: a pointermove fires
  // far more often than React should re-render, so the points are pushed to a
  // ref and a single rAF-scheduled redraw picks them up.
  const strokeRef = useRef(null); // [{ canvas: {x,y}, original: {x,y} }]
  const redrawHandle = useRef(0);

  const chosenTier = useMemo(() => {
    const tiers = calibration?.tiers ?? [];
    return tiers.find((t) => t.name === tier) ?? tiers.find((t) => t.name === 'web') ?? tiers[0] ?? null;
  }, [calibration, tier]);

  useEffect(() => {
    if (!calibration || !chosenTier) {
      setImage(null);
      return undefined;
    }
    const img = new Image();
    img.src = mapImageUrl(calibration.id, chosenTier.name);
    let alive = true;
    img.onload = () => alive && setImage(img);
    img.onerror = () => alive && setImage(null);
    return () => {
      alive = false;
    };
  }, [calibration?.id, chosenTier?.name]);

  useEffect(() => {
    if (pin) return undefined;
    let alive = true;
    loadPartyPin().then((img) => alive && img && setPin(img));
    return () => {
      alive = false;
    };
  }, [pin]);

  const hexIndex = useMemo(() => {
    const map = new Map();
    for (const h of hexes) map.set(hexKey(h.col, h.row), h);
    return map;
  }, [hexes]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !calibration) return;
    const baseW = chosenTier?.width ?? calibration.originalWidth;
    const baseH = chosenTier?.height ?? calibration.originalHeight;
    const w = Math.round(baseW * zoom);
    const h = Math.round(baseH * zoom);
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, w, h);
    if (image) ctx.drawImage(image, 0, 0, w, h);
    else {
      ctx.fillStyle = '#0d0b09';
      ctx.fillRect(0, 0, w, h);
    }

    const s = w / calibration.originalWidth;
    const cal = {
      hexEdge: calibration.hexEdge * s,
      hexWidth: calibration.hexWidth * s,
      hexHeight: calibration.hexHeight * s,
      colSpacing: calibration.colSpacing * s,
      colOffset: calibration.colOffset * s,
      offsetX: calibration.offsetX * s,
      offsetY: calibration.offsetY * s,
      rotation: calibration.rotation,
    };

    const tracePoly = (col, row) => {
      const pts = hexPolygon(col, row, cal);
      ctx.beginPath();
      pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
      ctx.closePath();
      return pts;
    };

    const cells = hexesInBounds(w, h, cal, 0);

    if (showTags) {
      for (const { col, row } of cells) {
        const tag = hexIndex.get(hexKey(col, row));
        if (!tag) continue;
        tracePoly(col, row);
        ctx.fillStyle = REGION_FILL[tag.regionType] ?? REGION_FILL.wild;
        ctx.fill();

        if (tag.hardTerrain) {
          ctx.save();
          ctx.clip();
          ctx.strokeStyle = 'rgba(232, 223, 208, 0.30)';
          ctx.lineWidth = Math.max(1, 1.2 * s * 6);
          const pts = hexPolygon(col, row, cal);
          const minX = Math.min(...pts.map((p) => p.x));
          const maxX = Math.max(...pts.map((p) => p.x));
          const minY = Math.min(...pts.map((p) => p.y));
          const maxY = Math.max(...pts.map((p) => p.y));
          const stepPx = Math.max(6, cal.hexHeight / 4);
          for (let d = minX - (maxY - minY); d < maxX; d += stepPx) {
            ctx.beginPath();
            ctx.moveTo(d, maxY);
            ctx.lineTo(d + (maxY - minY), minY);
            ctx.stroke();
          }
          ctx.restore();
        }

        if (tag.road) {
          const pts = hexPolygon(col, row, cal);
          ctx.strokeStyle = 'rgba(200, 162, 74, 0.95)';
          ctx.lineWidth = Math.max(1.5, cal.hexHeight * 0.06);
          ctx.beginPath();
          ctx.moveTo(pts[0].x, pts[0].y);
          ctx.lineTo(pts[3].x, pts[3].y);
          ctx.stroke();
        }

        if (tag.perilous) {
          tracePoly(col, row);
          ctx.strokeStyle = 'rgba(180, 85, 63, 0.95)';
          ctx.lineWidth = Math.max(2, cal.hexHeight * 0.05);
          ctx.stroke();
          if (cal.hexHeight > 30) {
            ctx.fillStyle = 'rgba(232, 183, 165, 0.95)';
            ctx.font = `${Math.round(cal.hexHeight * 0.26)}px serif`;
            ctx.textAlign = 'center';
            const pts = hexPolygon(col, row, cal);
            const cx = (pts[0].x + pts[3].x) / 2;
            const cy = (pts[1].y + pts[4].y) / 2;
            ctx.fillText(`☠${tag.perilRating}`, cx, cy + cal.hexHeight * 0.32);
          }
        }

        if (tag.label && cal.hexHeight > 34) {
          const pts = hexPolygon(col, row, cal);
          const cx = (pts[0].x + pts[3].x) / 2;
          const cy = (pts[1].y + pts[4].y) / 2;
          ctx.fillStyle = 'rgba(240, 232, 216, 0.95)';
          ctx.font = `${Math.round(cal.hexHeight * 0.19)}px serif`;
          ctx.textAlign = 'center';
          ctx.fillText(tag.label.slice(0, 16), cx, cy - cal.hexHeight * 0.16);
        }
      }
    }

    if (showGrid) {
      ctx.strokeStyle = 'rgba(200, 162, 74, 0.45)';
      ctx.lineWidth = 1;
      for (const { col, row } of cells) {
        tracePoly(col, row);
        ctx.stroke();
      }
    }

    // Route
    if (route.length) {
      route.forEach((hx, i) => {
        tracePoly(hx.col, hx.row);
        ctx.fillStyle = i === route.length - 1 ? 'rgba(200, 162, 74, 0.5)' : 'rgba(200, 162, 74, 0.28)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(240, 214, 139, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        if (cal.hexHeight > 26) {
          const pts = hexPolygon(hx.col, hx.row, cal);
          const cx = (pts[0].x + pts[3].x) / 2;
          const cy = (pts[1].y + pts[4].y) / 2;
          ctx.fillStyle = '#f4e6bd';
          ctx.font = `bold ${Math.round(cal.hexHeight * 0.28)}px serif`;
          ctx.textAlign = 'center';
          ctx.fillText(String(i), cx, cy + cal.hexHeight * 0.1);
        }
      });
    }

    if (pinHex) {
      tracePoly(pinHex.col, pinHex.row);
      ctx.strokeStyle = '#e0836a';
      ctx.lineWidth = 3;
      ctx.setLineDash([6, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    if (selected) {
      tracePoly(selected.col, selected.row);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2.5;
      ctx.stroke();
    }

    if (currentHex && currentHex.col != null) {
      const pts = hexPolygon(currentHex.col, currentHex.row, cal);
      const cx = (pts[0].x + pts[3].x) / 2;
      const cy = (pts[1].y + pts[4].y) / 2;
      if (pin) {
        const ph = Math.max(18, cal.hexHeight * PIN_HEIGHT_IN_HEXES);
        const pw = ph * PIN_ASPECT;
        ctx.save();
        // The pin is warm gold on warm-toned map art, so the shadow is doing
        // real legibility work over light regions — not decoration.
        ctx.shadowColor = 'rgba(0, 0, 0, 0.62)';
        ctx.shadowBlur = Math.max(3, ph * 0.09);
        ctx.shadowOffsetY = Math.max(1, ph * 0.045);
        // Bottom-centre anchor: the tip lands on the hex centre.
        ctx.drawImage(pin, cx - pw / 2, cy - ph, pw, ph);
        ctx.restore();
      } else {
        // Until the artwork loads (or if it fails), the original gold dot.
        const r = Math.max(5, cal.hexHeight * 0.24);
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.fillStyle = '#c8a24a';
        ctx.fill();
        ctx.strokeStyle = '#191510';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    // The line currently under the finger. Drawn last so it sits over
    // everything, and drawn exactly as it was traced — no snapping is shown.
    const stroke = strokeRef.current;
    if (stroke && stroke.length > 1) {
      ctx.save();
      ctx.strokeStyle = 'rgba(240, 214, 139, 0.95)';
      ctx.lineWidth = Math.max(2.5, cal.hexHeight * 0.12);
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
      ctx.shadowBlur = 4;
      ctx.beginPath();
      stroke.forEach((p, i) =>
        i === 0 ? ctx.moveTo(p.canvas.x, p.canvas.y) : ctx.lineTo(p.canvas.x, p.canvas.y),
      );
      ctx.stroke();
      ctx.restore();
    }
  }, [calibration, chosenTier, image, pin, zoom, showGrid, showTags, hexIndex, route, currentHex, pinHex, selected]);

  /** Coalesce stroke redraws to one per animation frame. */
  const scheduleRedraw = useCallback(() => {
    if (redrawHandle.current) return;
    redrawHandle.current = requestAnimationFrame(() => {
      redrawHandle.current = 0;
      draw();
    });
  }, [draw]);

  useEffect(() => {
    draw();
  }, [draw]);

  // A stroke redraw scheduled as the component goes away would run against a
  // canvas that no longer exists.
  useEffect(
    () => () => {
      if (redrawHandle.current) cancelAnimationFrame(redrawHandle.current);
    },
    [],
  );

  /**
   * A pointer event in both coordinate spaces: canvas pixels (what we draw in)
   * and original-image pixels (what the calibration and the server speak).
   */
  const pointAtEvent = (e) => {
    const canvas = canvasRef.current;
    if (!canvas || !calibration) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    const s = canvas.width / calibration.originalWidth;
    return { canvas: { x, y }, original: { x: x / s, y: y / s }, scale: s };
  };

  const hexAtEvent = (e) => {
    const p = pointAtEvent(e);
    if (!p) return null;
    const s = p.scale;
    const cal = {
      hexEdge: calibration.hexEdge * s,
      hexWidth: calibration.hexWidth * s,
      hexHeight: calibration.hexHeight * s,
      colSpacing: calibration.colSpacing * s,
      colOffset: calibration.colOffset * s,
      offsetX: calibration.offsetX * s,
      offsetY: calibration.offsetY * s,
      rotation: calibration.rotation,
    };
    return pixelToHex(p.canvas.x, p.canvas.y, cal);
  };

  /* --- freehand drawing --------------------------------------------------- */

  const startStroke = (e) => {
    const p = pointAtEvent(e);
    if (!p) return;
    strokeRef.current = [p];
    // Pointer capture keeps the trail coming even when the finger or cursor
    // wanders off the canvas mid-drag, so a line drawn to the edge of the map
    // does not simply stop being recorded.
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Not fatal — the stroke just ends early if the pointer leaves.
    }
    scheduleRedraw();
  };

  const extendStroke = (e) => {
    if (!strokeRef.current) return;
    const p = pointAtEvent(e);
    if (!p) return;
    const last = strokeRef.current[strokeRef.current.length - 1];
    // Drop sub-pixel jitter; the server resamples evenly anyway.
    if (Math.hypot(p.canvas.x - last.canvas.x, p.canvas.y - last.canvas.y) < 1.5) return;
    strokeRef.current.push(p);
    scheduleRedraw();
  };

  const endStroke = (e) => {
    const stroke = strokeRef.current;
    strokeRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Already released, or never captured.
    }
    scheduleRedraw();
    // A tap is not a drawn route — leave the existing one alone.
    if (!stroke || stroke.length < 2) return;
    onFreehandPath?.(stroke.map((p) => p.original));
  };

  if (!calibration) {
    return (
      <div className="map-canvas-wrap" style={{ height, display: 'grid', placeItems: 'center' }}>
        <p className="muted small" style={{ padding: 20, textAlign: 'center' }}>
          No map calibrated yet. A GM needs to upload a map on the Map Calibration screen.
        </p>
      </div>
    );
  }

  return (
    <div className="map-canvas-wrap" ref={wrapRef} style={{ maxHeight: height }}>
      <canvas
        ref={canvasRef}
        // Pointer events rather than mouse events, so a finger on a tablet at
        // the table is the same code path as a mouse — freehand drawing needs
        // it, and GM hex painting gets touch support for free.
        style={freehand ? { touchAction: 'none', cursor: 'crosshair' } : undefined}
        onPointerDown={(e) => {
          if (freehand) {
            startStroke(e);
            return;
          }
          const hx = hexAtEvent(e);
          if (!hx) return;
          lastPainted.current = hexKey(hx.col, hx.row);
          if (paintable) setPainting(true);
          onHexClick?.(hx, e);
        }}
        onPointerMove={(e) => {
          if (freehand) {
            // Mid-stroke the pointer is drawing, not pointing; the rest of the
            // time a player still gets the Location tooltip on hover.
            if (strokeRef.current) {
              extendStroke(e);
              return;
            }
            const over = hexAtEvent(e);
            if (!over || !onHexHover) return;
            const overKey = hexKey(over.col, over.row);
            if (overKey === lastHovered.current) return;
            lastHovered.current = overKey;
            onHexHover(over, { clientX: e.clientX, clientY: e.clientY });
            return;
          }
          const hx = hexAtEvent(e);
          if (!hx) return;
          const key = hexKey(hx.col, hx.row);

          // Hover is reported once per hex entered, so the caller can show a
          // popover without re-rendering on every pixel of mouse movement.
          if (onHexHover && key !== lastHovered.current) {
            lastHovered.current = key;
            onHexHover(hx, { clientX: e.clientX, clientY: e.clientY });
          }

          if (!painting) return;
          if (key === lastPainted.current) return;
          lastPainted.current = key;
          onHexClick?.(hx, e);
        }}
        onPointerUp={(e) => {
          if (freehand) {
            endStroke(e);
            return;
          }
          setPainting(false);
        }}
        // A cancelled pointer (the browser taking over the gesture, a stylus
        // lifted oddly) must not leave a half-drawn stroke on the canvas.
        onPointerCancel={(e) => {
          if (freehand) {
            strokeRef.current = null;
            scheduleRedraw();
            return;
          }
          setPainting(false);
        }}
        onPointerLeave={() => {
          // Pointer capture keeps a stroke in progress alive past the edge.
          if (freehand && strokeRef.current) return;
          setPainting(false);
          lastHovered.current = '';
          onHexHover?.(null);
        }}
      />
    </div>
  );
}

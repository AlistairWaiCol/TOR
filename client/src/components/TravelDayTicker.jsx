import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { journeyTickSequence } from '@shared/journey.js';
import { hexKey } from '@shared/hexMath.js';

/**
 * The live day-by-day travel animation.
 *
 * When the party moves a leg, the day counter ticks up one day at a time and
 * the party token walks the hexes in step with it, instead of both jumping
 * straight to the end. Entirely client-side: every input — the hexes of the
 * leg, which of them are hard terrain, whether Forced March is on, the running
 * day adjustments — is already in the travel snapshot.
 *
 * The pacing itself is `journeyTickSequence()` in shared/journey.js, a pure
 * function with its day total asserted against `computeJourneyDays()` in the
 * tests. This file is only the setTimeout driver, the same split the dice
 * engine has between `evaluateRoll()` and the UI that calls it.
 *
 * The counter is JOURNEY-wide — it carries across every leg and event of one
 * journey and resets only when a new journey starts.
 */

/** How long one day sits on screen before the next tick. */
export const DAY_HOLD_MS = 5000;

/** Mishap / Short Cut. Applied instantly, never animated. */
function adjustmentBanner(delta) {
  if (!delta) return '';
  return delta < 0
    ? `Short cut! ${-delta} day${delta === -1 ? '' : 's'} saved.`
    : `Mishap — ${delta} day${delta === 1 ? '' : 's'} lost.`;
}

/**
 * @param {object} opts
 * @param {object|null} opts.journey the live journey record from the snapshot
 * @param {Array} opts.hexes tagged hexes, for the hard-terrain lookup
 */
export function useTravelDayTicker({ journey, hexes = [] }) {
  // The march-day count only. Mishap / Short Cut adjustments are added on for
  // display straight from the journey record, so they land the instant the
  // event resolves without the animation having to know about them.
  const [marchDay, setMarchDay] = useState(0);
  const [hex, setHex] = useState(null);
  const [queue, setQueue] = useState([]); // steps still to play
  const [banner, setBanner] = useState('');

  const journeyId = journey?.id ?? null;
  const routeIndex = journey?.routeIndex ?? 0;
  const adjustments = journey?.dayAdjustments ?? 0;

  // How far along the route the animation itself has got, which lags the
  // server's routeIndex while a leg is playing out.
  const animatedIndex = useRef(0);
  const lastJourneyId = useRef(null);
  const lastAdjustments = useRef(0);

  const hardTerrain = useMemo(() => {
    const set = new Set();
    for (const h of hexes) if (h.hardTerrain) set.add(hexKey(h.col, h.row));
    return set;
  }, [hexes]);

  const isHard = useCallback((h) => hardTerrain.has(hexKey(h.col, h.row)), [hardTerrain]);

  /** Day count for a stretch of route, without animating it. */
  const dayAfter = useCallback(
    (route, upToIndex, forcedMarch) => {
      if (!route?.length || upToIndex <= 0) return 0;
      const steps = journeyTickSequence({
        path: route.slice(1, upToIndex + 1),
        isHardTerrain: isHard,
        forcedMarch,
        startDay: 0,
        startHexIndex: 0,
        finalLeg: upToIndex === route.length - 1,
      });
      return steps.length ? steps[steps.length - 1].day : 0;
    },
    [isHard],
  );

  // A journey appearing (or the page being opened part-way through one) snaps
  // straight to where the Company actually is. Only movement that happens while
  // you are watching gets animated.
  useEffect(() => {
    if (lastJourneyId.current === journeyId) return;
    lastJourneyId.current = journeyId;
    lastAdjustments.current = adjustments;
    setQueue([]);
    setBanner('');
    if (!journey) {
      animatedIndex.current = 0;
      setMarchDay(0);
      setHex(null);
      return;
    }
    animatedIndex.current = routeIndex;
    setMarchDay(dayAfter(journey.route, routeIndex, journey.forcedMarch));
    setHex(journey.route[routeIndex] ?? null);
  }, [journeyId, journey, routeIndex, adjustments, dayAfter]);

  // A leg was walked: queue up its ticks.
  useEffect(() => {
    if (!journey || journeyId !== lastJourneyId.current) return;
    if (routeIndex <= animatedIndex.current) {
      // The engine can also move the party backwards-in-index-terms never, but
      // a journey being re-read after a reset should still stay in sync.
      if (routeIndex < animatedIndex.current) {
        animatedIndex.current = routeIndex;
        setHex(journey.route[routeIndex] ?? null);
      }
      return;
    }
    const from = animatedIndex.current;
    const steps = journeyTickSequence({
      path: journey.route.slice(from + 1, routeIndex + 1),
      isHardTerrain: isHard,
      forcedMarch: journey.forcedMarch,
      startDay: dayAfter(journey.route, from, journey.forcedMarch),
      startHexIndex: from,
      finalLeg: routeIndex === journey.route.length - 1,
    });
    animatedIndex.current = routeIndex;
    setQueue((q) => [...q, ...steps]);
  }, [journey, journeyId, routeIndex, isHard, dayAfter]);

  // Mishap / Short Cut: the number jumps, a banner says why. Never animated —
  // a day gained or lost happens at the moment the event resolves.
  useEffect(() => {
    const delta = adjustments - lastAdjustments.current;
    lastAdjustments.current = adjustments;
    if (!delta || journeyId !== lastJourneyId.current) return;
    setBanner(adjustmentBanner(delta));
    const t = setTimeout(() => setBanner(''), 8000);
    return () => clearTimeout(t);
  }, [adjustments, journeyId]);

  // One tick at a time, holding between each.
  useEffect(() => {
    if (queue.length === 0) return undefined;
    const [next, ...rest] = queue;
    setMarchDay(next.day);
    if (next.moved) setHex(next.hex);
    const t = setTimeout(() => setQueue(rest), DAY_HOLD_MS);
    return () => clearTimeout(t);
  }, [queue]);

  /** Jump to the end of whatever is still queued. */
  const skip = useCallback(() => {
    setQueue((q) => {
      if (q.length === 0) return q;
      const last = q[q.length - 1];
      setMarchDay(last.day);
      const lastMoved = [...q].reverse().find((s) => s.moved);
      if (lastMoved) setHex(lastMoved.hex);
      return [];
    });
  }, []);

  return {
    day: marchDay + adjustments,
    hex,
    banner,
    playing: queue.length > 0,
    remaining: queue.length,
    // The current step's terrain, so the box can say why a day passed with no
    // movement rather than looking stuck.
    holdingForHardTerrain: queue.length > 0 && !queue[0].moved,
    skip,
  };
}

/**
 * The box itself. Journey-wide day count, what is happening this tick, and the
 * Mishap / Short Cut banner.
 */
export default function TravelDayTicker({ ticker, journey }) {
  if (!journey) return null;
  const { day, banner, playing, remaining, holdingForHardTerrain, skip } = ticker;
  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 6 }}>
        <h2 style={{ margin: 0 }}>Day {day}</h2>
        <div className="row">
          {journey.forcedMarch ? <span className="pill bad">forced march</span> : null}
          {journey.mounted ? <span className="pill">mounted</span> : null}
        </div>
      </div>

      {banner ? <div className="info-box">{banner}</div> : null}

      {playing ? (
        <div className="row">
          <span className="small muted">
            {holdingForHardTerrain
              ? 'Hard going — a whole day for no ground gained.'
              : 'On the road…'}{' '}
            {remaining} more day{remaining === 1 ? '' : 's'} to play out.
          </span>
          <div className="spacer" />
          <button className="small" onClick={skip}>
            skip ahead
          </button>
        </div>
      ) : (
        <p className="small muted" style={{ marginBottom: 0 }}>
          Days on the road so far this journey, counting 1 per hex, 1 extra per hard-terrain hex, and
          Mishap / Short Cut adjustments.
          {journey.mounted
            ? ' Mounted travel halves the total when the journey is tallied, so the final figure will be lower than this.'
            : ''}
        </p>
      )}
    </div>
  );
}

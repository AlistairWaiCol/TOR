import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  JOURNEY_EVENTS,
  TRAVEL_ROLES,
  computeJourneyDays,
  marchingTestDistance,
  regionLabel,
  roleLabel,
  terrainDiceModifier,
  validateRoleAssignments,
} from '@shared/journey.js';
import { hexKey, removeHexFromRoute } from '@shared/hexMath.js';
import { api } from '../lib/api.js';
import { saveJourneyMap } from '../lib/journeyMap.js';
import { getSocket } from '../lib/socket.js';
import { useApp } from '../state/AppContext.jsx';
import HexMap from '../components/HexMap.jsx';
import TravelDayTicker, { useTravelDayTicker } from '../components/TravelDayTicker.jsx';
import { CheckField, SelectField, TextField } from '../components/Fields.jsx';
import DiceResult from '../components/DiceResult.jsx';

const PHASE_STEPS = [
  { phase: 'awaiting_marching_test', label: 'Marching Test — the Guide rolls TRAVEL' },
  { phase: 'awaiting_target', label: 'Select Target — 1 Success Die picks the role' },
  { phase: 'awaiting_target_choice', label: 'Select Target — GM names the targeted hero' },
  { phase: 'awaiting_event_die', label: 'Determine Event — Feat Die by region type' },
  { phase: 'awaiting_resolution', label: 'Resolve — the targeted player rolls' },
  { phase: 'journey_end', label: 'Destination reached — tally the journey' },
  { phase: 'awaiting_fatigue_relief', label: 'Ending the Journey — Fatigue relief' },
];

export default function MapView() {
  const {
    isGM,
    calibration,
    hexes,
    locations,
    party,
    travel,
    journey,
    events,
    characters,
    campaign,
    rollFeed,
    refresh,
  } = useApp();
  const mapWrapRef = useRef(null);
  const [hoverLocation, setHoverLocation] = useState(null);
  const [tier, setTier] = useState('web');
  const [zoom, setZoom] = useState(0.9);
  const [showGrid, setShowGrid] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [fromLabel, setFromLabel] = useState('');
  const [toLabel, setToLabel] = useState('');
  const [note, setNote] = useState('');
  const [clickMode, setClickMode] = useState('route'); // route | inspect | pin
  const [inspect, setInspect] = useState(null);
  const [preview, setPreview] = useState(null);

  const route = party?.route ?? [];
  const roles = party?.roles ?? {};
  const roleCheck = useMemo(() => validateRoleAssignments(roles), [roles]);
  const phase = travel?.phase ?? 'idle';
  const tstate = travel?.state ?? {};
  const pending = tstate.pendingEvent ?? null;
  const currentHexTags = tstate.currentHex ?? null;

  const hexIndex = useMemo(() => {
    const m = new Map();
    for (const h of hexes) m.set(hexKey(h.col, h.row), h);
    return m;
  }, [hexes]);

  const locationIndex = useMemo(() => {
    const m = new Map();
    for (const l of locations) m.set(l.id, l);
    return m;
  }, [locations]);

  /** The Compendium Location a hex is tagged with, if any. */
  const locationForHex = (hx) => {
    const tag = hexIndex.get(hexKey(hx.col, hx.row));
    return tag?.linkedLocationId ? locationIndex.get(tag.linkedLocationId) ?? null : null;
  };

  const onHexHover = (hx, at) => {
    if (!hx) return setHoverLocation(null);
    const location = locationForHex(hx);
    if (!location) return setHoverLocation(null);
    const rect = mapWrapRef.current?.getBoundingClientRect();
    return setHoverLocation({
      location,
      x: rect ? at.clientX - rect.left : 0,
      y: rect ? at.clientY - rect.top : 0,
    });
  };

  const nameOf = (id) => characters.find((c) => c.id === id)?.name ?? 'unknown';
  const targetCharacter = pending?.targetCharacterId
    ? characters.find((c) => c.id === pending.targetCharacterId)
    : null;

  const eventDef = pending?.eventKey ? JOURNEY_EVENTS.find((e) => e.key === pending.eventKey) : null;

  useEffect(() => {
    if (phase === 'journey_end' || phase === 'awaiting_fatigue_relief') {
      api.get('/travel/preview').then(setPreview).catch(() => setPreview(null));
    } else {
      setPreview(null);
    }
  }, [phase, journey?.hexesTraversed, journey?.dayAdjustments]);

  const call = async (fn) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const setRoute = (next) => {
    const socket = getSocket();
    socket.emit('route:set', { route: next }, (res) => {
      if (res && !res.ok) setError(res.error);
    });
  };

  /**
   * A freehand line finished. The raw trail goes to the server in
   * original-image pixel coordinates and comes back as an ordinary hex route —
   * same data structure the click tool writes, so locking, clearing and
   * Marching Test distance counting all behave identically.
   */
  const drawFreehandRoute = (points) => {
    if (party?.routeLocked && !isGM) {
      setError('The route is locked by the GM.');
      return;
    }
    call(() => api.post('/party/draw-route', { points }));
  };

  const onHexClick = (hx) => {
    if (clickMode === 'inspect') {
      setInspect(hexIndex.get(hexKey(hx.col, hx.row)) ?? { ...hx, regionType: 'wild', untagged: true });
      return;
    }
    if (clickMode === 'pin') {
      call(() => api.post('/travel/pin', { col: hx.col, row: hx.row }));
      return;
    }
    if (party?.routeLocked && !isGM) {
      setError('The route is locked by the GM.');
      return;
    }
    const last = route[route.length - 1];
    if (last && last.col === hx.col && last.row === hx.row) {
      setRoute(route.slice(0, -1)); // click the tip again to undo
      return;
    }
    // A freehand line only barely clipping a hex's corner still snaps it in —
    // expected behaviour of point-to-nearest-centre snapping, not a bug. This
    // is the correction: clicking a hex already in the route removes it, and
    // the remaining path is re-bridged (removeHexFromRoute in shared/hexMath.js)
    // so it stays walkable one hex at a time.
    if (route.some((h) => h.col === hx.col && h.row === hx.row)) {
      setRoute(removeHexFromRoute(route, hx));
      return;
    }
    setRoute([...route, hx]);
  };

  const setRole = async (characterId, roleKey) => {
    const next = { ...roles };
    if (roleKey) next[characterId] = roleKey;
    else delete next[characterId];
    await call(() => api.put('/party/roles', { roles: next }));
  };

  const hexesRemaining = journey ? Math.max(0, journey.route.length - 1 - journey.routeIndex) : 0;
  const currentPos = journey
    ? journey.route[journey.routeIndex]
    : party?.currentCol != null
      ? { col: party.currentCol, row: party.currentRow }
      : null;

  // The live day-by-day animation. While a leg is playing out the token sits on
  // an intermediate hex rather than the leg's end — `animatedHex` is what the
  // map is fed, falling back to the real position when nothing is in flight.
  const ticker = useTravelDayTicker({ journey, hexes, dayHoldSeconds: campaign?.dayHoldSeconds });
  const animatedHex = ticker.playing ? ticker.hex : null;

  return (
    <>
      <div className="page-head">
        <h1>Map &amp; Travel</h1>
        <div className="row">
          <span className="pill gold">
            {campaign ? `${campaign.season} ${campaign.year}` : '—'}
          </span>
          {journey ? (
            <span className="pill blue">
              {journey.fromLabel} → {journey.toLabel} · {hexesRemaining} hexes left
            </span>
          ) : (
            <span className="pill">no journey underway</span>
          )}
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="map-shell">
        <div style={{ flex: '1 1 560px', minWidth: 320 }}>
          <div className="row" style={{ marginBottom: 8 }}>
            {/* Click modes are the GM's tool. A player draws freehand, on a map
                with no grid on it, so there is nothing to click and nothing to
                choose between. */}
            {isGM ? (
              <SelectField
                label=""
                value={clickMode}
                onChange={setClickMode}
                options={[
                  { value: 'route', label: 'Click: draw route' },
                  { value: 'inspect', label: 'Click: inspect hex' },
                  ...(journey ? [{ value: 'pin', label: 'Click: pin next event (GM)' }] : []),
                ]}
              />
            ) : (
              <span className="pill gold" title="Drag across the map to draw a route">
                drag to draw a route
              </span>
            )}
            <SelectField
              label=""
              value={tier}
              onChange={setTier}
              options={(calibration?.tiers ?? []).map((t) => ({
                value: t.name,
                label: `${t.name} (${t.width}px)`,
              }))}
            />
            <label className="field" style={{ width: 150 }}>
              <span>Zoom {zoom.toFixed(2)}×</span>
              <input type="range" min="0.35" max="2.2" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
            </label>
            {/* The grid is a GM affordance now: it exists so hexes can be
                clicked and tagged. Players draw freehand and never see it. */}
            {isGM ? <CheckField label="grid" checked={showGrid} onChange={setShowGrid} /> : null}
          </div>

          <div style={{ position: 'relative' }} ref={mapWrapRef}>
            <HexMap
              calibration={calibration}
              hexes={hexes}
              tier={tier}
              zoom={zoom}
              // Players get no grid at all — not a toggle they happen to have
              // switched off. Their route tool is freehand, so hex boundaries
              // are an implementation detail they should never have to see.
              showGrid={isGM ? showGrid : false}
              // Hex tagging (region colour, hard terrain, roads, Perilous
              // Areas, labels) is GM prep — players get the plain map art, the
              // party token and the route.
              showTags={isGM}
              route={route}
              drawnPath={party?.drawnPath ?? []}
              currentHex={animatedHex ?? currentPos}
              pinHex={tstate.manualPin ?? null}
              selected={inspect && !inspect.untagged ? inspect : null}
              onHexClick={isGM ? onHexClick : undefined}
              onHexHover={onHexHover}
              freehand={!isGM}
              onFreehandPath={drawFreehandRoute}
            />
            {hoverLocation ? (
              <div
                className="panel"
                style={{
                  position: 'absolute',
                  left: Math.max(0, hoverLocation.x + 14),
                  top: Math.max(0, hoverLocation.y + 14),
                  padding: '6px 10px',
                  margin: 0,
                  maxWidth: 240,
                  pointerEvents: 'none',
                  zIndex: 5,
                }}
              >
                <strong>{hoverLocation.location.name || '(unnamed location)'}</strong>
                {hoverLocation.location.years?.length ? (
                  <div className="small muted">{hoverLocation.location.years.join(', ')}</div>
                ) : null}
                <div className="small muted">click the hex in Inspect mode for details</div>
              </div>
            ) : null}
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <span className="small muted">
              {route.length
                ? `Route: ${route.length} hexes (${route.length - 1} legs).${isGM ? ' Click the last hex again to undo.' : ''}`
                : isGM
                  ? 'Click hexes to draw a proposed route — everyone sees it live.'
                  : 'Drag a line across the map to draw a proposed route — everyone sees it live.'}
            </span>
            {party?.routeLocked ? <span className="pill gold">locked by the GM</span> : null}
            <div className="spacer" />
            {isGM ? (
              <button
                className="small"
                onClick={() => call(() => api.patch('/party', { routeLocked: !party?.routeLocked }))}
              >
                {party?.routeLocked ? 'Unlock route' : 'Lock route'}
              </button>
            ) : null}
            {/* Clearing is player-level: whoever drew a wrong line can rub it
                out. Once the GM locks the route it stops being theirs to clear
                — and the server refuses it too, not just this button. */}
            <button
              className="small danger"
              disabled={busy || (!isGM && Boolean(party?.routeLocked)) || route.length === 0}
              title={
                !isGM && party?.routeLocked
                  ? 'The GM has locked this route.'
                  : 'Clear the proposed route for everyone'
              }
              onClick={() => call(() => api.post('/party/clear-route'))}
            >
              Clear route
            </button>
          </div>

          {inspect ? (
            <div className="panel" style={{ marginTop: 10 }}>
              <h3>
                Hex ({inspect.col},{inspect.row}) {inspect.label ? `— ${inspect.label}` : ''}
              </h3>
              <div className="row">
                <span className="pill">{regionLabel(inspect.regionType)}</span>
                {inspect.hardTerrain ? <span className="pill bad">hard terrain −1d</span> : null}
                {inspect.road ? <span className="pill gold">road +1d</span> : null}
                {inspect.perilous ? <span className="pill bad">perilous ☠{inspect.perilRating}</span> : null}
                {inspect.untagged ? <span className="pill">untagged (defaults to Wild Land)</span> : null}
                <span className="pill">event dice mod {terrainDiceModifier(inspect) >= 0 ? '+' : ''}{terrainDiceModifier(inspect)}</span>
              </div>
              {(() => {
                const location = inspect.linkedLocationId
                  ? locationIndex.get(inspect.linkedLocationId)
                  : null;
                if (!location) return null;
                return (
                  <div style={{ marginTop: 8 }}>
                    <strong>{location.name || '(unnamed location)'}</strong>{' '}
                    <Link className="small" to={`/compendium#location-${location.id}`}>
                      open in Compendium →
                    </Link>
                    {location.years?.length ? (
                      <div className="row" style={{ marginTop: 4 }}>
                        {location.years.map((y) => (
                          <span className="pill gold" key={y}>
                            {y}
                          </span>
                        ))}
                      </div>
                    ) : null}
                    {location.keyInfo ? (
                      <p className="small muted" style={{ marginBottom: 0, whiteSpace: 'pre-wrap' }}>
                        {location.keyInfo}
                      </p>
                    ) : null}
                  </div>
                );
              })()}
            </div>
          ) : null}
        </div>

        <div className="map-side">
          {/* ---------------- Roles ---------------- */}
          <div className="panel">
            <h2>Travel roles</h2>
            {characters.length === 0 ? (
              <p className="small muted">Create some character sheets first.</p>
            ) : (
              characters.map((c) => (
                <div className="row" key={c.id} style={{ marginBottom: 6 }}>
                  <span style={{ flex: 1, minWidth: 90 }}>{c.name}</span>
                  <select
                    value={roles[c.id] ?? ''}
                    disabled={Boolean(journey)}
                    onChange={(e) => setRole(c.id, e.target.value)}
                  >
                    <option value="">— not travelling —</option>
                    {TRAVEL_ROLES.map((r) => (
                      <option key={r.key} value={r.key}>
                        {r.label} ({r.skill})
                      </option>
                    ))}
                  </select>
                </div>
              ))
            )}
            <div className={roleCheck.valid ? 'info-box' : 'warn-box'} style={{ marginTop: 8 }}>
              {roleCheck.valid
                ? 'Roles are ready: exactly one Guide, all four roles covered.'
                : roleCheck.errors.join(' ')}
            </div>
            <div className="row">
              <CheckField
                label="Travelling mounted"
                checked={Boolean(party?.mounted)}
                onChange={(v) => call(() => api.patch('/party', { mounted: v }))}
              />
              {isGM ? (
                <CheckField
                  label="Forced March (GM)"
                  checked={Boolean(party?.forcedMarch)}
                  onChange={(v) => call(() => api.patch('/party', { forcedMarch: v }))}
                />
              ) : party?.forcedMarch ? (
                <span className="pill bad">Forced March on</span>
              ) : null}
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              Mounted halves the final day count (round up); Forced March counts 1 day per 2 hexes and
              costs each hero 1 Fatigue per forced-march day.
            </p>
          </div>

          {/* ---------------- Live day counter ---------------- */}
          <TravelDayTicker ticker={ticker} journey={journey} />

          {/* ---------------- Travel sequence ---------------- */}
          <div className="panel">
            <h2>Journey</h2>
            {phase === 'idle' ? (
              <>
                <p className="small muted">
                  Draw a route, assign roles, then the GM starts the journey. The first hex of the route
                  is the starting point.
                </p>
                {isGM ? (
                  <>
                    <TextField label="From (optional)" value={fromLabel} onChange={setFromLabel} />
                    <TextField label="To (optional)" value={toLabel} onChange={setToLabel} />
                    <button
                      className="primary"
                      disabled={busy || route.length < 2 || !roleCheck.valid}
                      onClick={() => call(() => api.post('/travel/start', { fromLabel, toLabel }))}
                    >
                      Start journey
                    </button>
                    {route.length < 2 ? <p className="small muted">Need at least 2 hexes of route.</p> : null}
                  </>
                ) : (
                  <p className="small muted">Waiting for the GM to start the journey.</p>
                )}
              </>
            ) : (
              <>
                <ol className="step-list">
                  {PHASE_STEPS.filter(
                    (s) => s.phase !== 'awaiting_target_choice' || phase === 'awaiting_target_choice',
                  ).map((s) => (
                    <li key={s.phase} className={phase === s.phase ? 'active' : ''}>
                      {s.label}
                    </li>
                  ))}
                </ol>

                {currentHexTags ? (
                  <div className="row" style={{ marginBottom: 8 }}>
                    <span className="pill">
                      at ({currentHexTags.col},{currentHexTags.row})
                    </span>
                    <span className="pill">{regionLabel(currentHexTags.regionType)}</span>
                    {currentHexTags.hardTerrain ? <span className="pill bad">hard terrain</span> : null}
                    {currentHexTags.road ? <span className="pill gold">road</span> : null}
                    {currentHexTags.perilous ? (
                      <span className="pill bad">
                        perilous ☠{currentHexTags.perilRating} · {tstate.eventsRemainingHere ?? 0} left
                      </span>
                    ) : null}
                  </div>
                ) : null}

                {/* Marching Test */}
                {phase === 'awaiting_marching_test' ? (
                  <>
                    <p className="small muted">
                      Guide:{' '}
                      {Object.entries(roles).find(([, r]) => r === 'guide')
                        ? nameOf(Object.entries(roles).find(([, r]) => r === 'guide')[0])
                        : 'none'}
                      . Success → event in {marchingTestDistance({ success: true, icons: 0 })}+ hexes;
                      failure → {marchingTestDistance({ success: false, season: campaign?.season })} hex
                      {marchingTestDistance({ success: false, season: campaign?.season }) === 1 ? '' : 'es'} in{' '}
                      {campaign?.season}.
                    </p>
                    {tstate.manualPin ? (
                      <div className="warn-box">
                        GM pin set at ({tstate.manualPin.col},{tstate.manualPin.row}) — the Marching Test
                        will use that distance instead of the dice.{' '}
                        {isGM ? (
                          <button className="small" onClick={() => call(() => api.del('/travel/pin'))}>
                            clear pin
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                    {isGM ? (
                      <div className="row">
                        <button className="primary" disabled={busy} onClick={() => call(() => api.post('/travel/marching-test'))}>
                          Roll Marching Test
                        </button>
                        {tstate.manualPin ? (
                          <button
                            disabled={busy}
                            onClick={() =>
                              call(() =>
                                api.post('/travel/place-event', {
                                  col: tstate.manualPin.col,
                                  row: tstate.manualPin.row,
                                }),
                              )
                            }
                          >
                            Place event, skip the test
                          </button>
                        ) : null}
                        <button disabled={busy} onClick={() => call(() => api.post('/travel/finish'))}>
                          End journey here
                        </button>
                      </div>
                    ) : (
                      <p className="small muted">The GM presses Roll.</p>
                    )}
                  </>
                ) : null}

                {/* Select Target */}
                {phase === 'awaiting_target' ? (
                  isGM ? (
                    <button className="primary" disabled={busy} onClick={() => call(() => api.post('/travel/select-target'))}>
                      Roll Select Target (1 Success Die)
                    </button>
                  ) : (
                    <p className="small muted">GM is rolling to select the target.</p>
                  )
                ) : null}

                {phase === 'awaiting_target_choice' ? (
                  <>
                    <div className="warn-box">
                      Rolled role: <strong>{roleLabel(pending?.roleKey)}</strong> ({pending?.skill}).{' '}
                      {pending?.candidates?.length
                        ? 'Several heroes hold that role — pick who rolls.'
                        : 'Nobody holds that role — the GM decides who is targeted.'}
                    </div>
                    {isGM ? (
                      <div className="row">
                        {(pending?.candidates?.length ? pending.candidates : characters.map((c) => c.id)).map((cid) => (
                          <button key={cid} disabled={busy} onClick={() => call(() => api.post('/travel/assign-target', { characterId: cid }))}>
                            {nameOf(cid)}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </>
                ) : null}

                {/* Determine Event */}
                {phase === 'awaiting_event_die' ? (
                  <>
                    <p className="small">
                      Target: <strong>{roleLabel(pending?.roleKey)}</strong> — {targetCharacter?.name ?? '?'} (
                      {pending?.skill}). Region {regionLabel(currentHexTags?.regionType)} →{' '}
                      {currentHexTags?.regionType === 'border'
                        ? 'Favoured'
                        : currentHexTags?.regionType === 'dark'
                          ? 'Ill-favoured'
                          : 'plain'}{' '}
                      Feat Die.
                    </p>
                    {isGM ? (
                      <button className="primary" disabled={busy} onClick={() => call(() => api.post('/travel/determine-event'))}>
                        Roll Determine Event
                      </button>
                    ) : (
                      <p className="small muted">GM is rolling the event die.</p>
                    )}
                  </>
                ) : null}

                {/* Resolve */}
                {phase === 'awaiting_resolution' ? (
                  <>
                    <div className="info-box">
                      <strong>{eventDef?.name ?? 'Event'}</strong> — {eventDef?.consequence}
                      <br />
                      Company Fatigue {eventDef?.fatigueLabel ?? eventDef?.fatigue}
                      {eventDef?.onSuccess ? ' · consequence applies on SUCCESS' : ' · consequence applies on FAILURE'}
                    </div>
                    <p className="small">
                      {targetCharacter?.name ?? 'Target'} rolls <strong>{pending?.skill?.toUpperCase()}</strong>
                      {currentHexTags
                        ? ` (${terrainDiceModifier(currentHexTags) >= 0 ? '+' : ''}${terrainDiceModifier(currentHexTags)} situational dice from terrain)`
                        : ''}
                      .
                    </p>
                    <TextField label="What happened (journey log note)" value={note} onChange={setNote} />
                    <button
                      className="primary"
                      disabled={busy}
                      onClick={() =>
                        call(async () => {
                          await api.post('/travel/resolve', { note });
                          setNote('');
                        })
                      }
                    >
                      Roll {pending?.skill?.toUpperCase()} for {targetCharacter?.name ?? 'target'}
                    </button>
                    <p className="small muted">
                      The targeted player presses this themselves — the player passcode is enough.
                    </p>
                  </>
                ) : null}

                {/* Journey end */}
                {phase === 'journey_end' ? (
                  <>
                    <div className="info-box">Destination reached. Tally the journey to work out days and Fatigue.</div>
                    {preview?.days ? <DaysBreakdown days={preview.days} /> : null}
                    {isGM ? (
                      <button className="primary" disabled={busy} onClick={() => call(() => api.post('/travel/finish'))}>
                        Tally the journey
                      </button>
                    ) : null}
                  </>
                ) : null}

                {phase === 'awaiting_fatigue_relief' ? (
                  <>
                    {journey?.summary?.days ? <DaysBreakdown days={journey.summary.days} /> : null}
                    <h3>Fatigue relief</h3>
                    <p className="small muted">
                      Mount Vigour has already been applied. Each hero may now roll TRAVEL: success −1
                      Fatigue, and −1 more per Success icon.
                    </p>
                    {Object.entries(tstate.fatigueRelief ?? {}).map(([cid, r]) => (
                      <div className="row" key={cid} style={{ marginBottom: 6 }}>
                        <span style={{ flex: 1 }}>{r.name}</span>
                        <span className="pill">
                          {r.startingFatigue}
                          {r.mountReduction ? ` −${r.mountReduction} mount` : ''}
                          {r.rollReduction ? ` −${r.rollReduction} roll` : ''} → {r.finalFatigue}
                        </span>
                        <button
                          className="small"
                          disabled={busy || Boolean(r.travelRoll)}
                          onClick={() => call(() => api.post('/travel/fatigue-roll', { characterId: cid }))}
                        >
                          {r.travelRoll ? 'rolled' : 'Roll TRAVEL'}
                        </button>
                      </div>
                    ))}
                    {isGM ? (
                      <div className="row" style={{ marginTop: 8 }}>
                        <button
                          className="primary"
                          disabled={busy}
                          onClick={() =>
                            call(async () => {
                              // Snapshot the travelled route for the Journey Log
                              // before closing out — after this the live travel
                              // state is gone.
                              await saveJourneyMap(api, { calibration, journey, events });
                              await api.post('/travel/close');
                            })
                          }
                        >
                          Close out journey
                        </button>
                        {journey ? <Link to={`/journeys/${journey.id}`}>view log</Link> : null}
                      </div>
                    ) : null}
                  </>
                ) : null}

                {isGM && phase !== 'idle' ? (
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="small danger" disabled={busy} onClick={() => call(() => api.post('/travel/abandon'))}>
                      Abandon journey
                    </button>
                    {journey ? (
                      <Link className="small" to={`/journeys/${journey.id}`}>
                        journey log
                      </Link>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>

          {/* ---------------- Recent rolls ---------------- */}
          <div className="panel">
            <h2>Recent rolls</h2>
            {rollFeed.length === 0 ? (
              <p className="small muted">Nothing rolled yet this session.</p>
            ) : (
              <div className="roll-feed">
                {rollFeed.map((entry, i) => (
                  <div className="entry" key={entry.roll?.id ?? i}>
                    <div>{entry.message}</div>
                    {entry.roll?.result ? <DiceResult result={entry.roll.result} compact /> : null}
                  </div>
                ))}
              </div>
            )}
          </div>

          {events?.length ? (
            <div className="panel">
              <h2>This journey so far</h2>
              <div className="roll-feed">
                {events
                  .slice()
                  .reverse()
                  .map((e) => (
                    <div className="entry" key={e.id}>
                      {e.kind === 'marching_test' ? (
                        <span className="muted">Marching Test — {e.consequence}</span>
                      ) : (
                        <>
                          <strong>{e.eventName || 'Event'}</strong> at ({e.col},{e.row}) —{' '}
                          {roleLabel(e.targetRole)}
                          {e.targetCharacterId ? ` (${nameOf(e.targetCharacterId)})` : ''} —{' '}
                          <span className={e.outcome === 'success' ? 'ok' : 'bad'}>{e.outcome}</span>
                          {e.companyFatigue ? ` — Fatigue +${e.companyFatigue}` : ''}
                        </>
                      )}
                    </div>
                  ))}
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </>
  );
}

function DaysBreakdown({ days }) {
  return (
    <table style={{ marginBottom: 10 }}>
      <tbody>
        <tr>
          <td>March days{days.forcedMarch ? ' (forced march: 1 per 2 hexes)' : ''}</td>
          <td className="mono">{days.marchDays}</td>
        </tr>
        <tr>
          <td>Hard-terrain days</td>
          <td className="mono">+{days.hardTerrainDays}</td>
        </tr>
        <tr>
          <td>Mishap / Short Cut adjustments</td>
          <td className="mono">
            {days.dayAdjustments >= 0 ? '+' : ''}
            {days.dayAdjustments}
          </td>
        </tr>
        <tr>
          <td>Subtotal</td>
          <td className="mono">{days.beforeMount}</td>
        </tr>
        {days.mounted ? (
          <tr>
            <td>Mounted — halve, round up</td>
            <td className="mono">{days.totalDays}</td>
          </tr>
        ) : null}
        <tr>
          <td>
            <strong>Total days</strong>
          </td>
          <td className="mono">
            <strong>{days.totalDays}</strong>
          </td>
        </tr>
        {days.forcedMarchFatigue ? (
          <tr>
            <td>Forced March Fatigue per hero</td>
            <td className="mono">+{days.forcedMarchFatigue}</td>
          </tr>
        ) : null}
      </tbody>
    </table>
  );
}

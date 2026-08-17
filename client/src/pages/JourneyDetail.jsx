import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { regionLabel, roleLabel } from '@shared/journey.js';
import { api } from '../lib/api.js';
import DiceResult from '../components/DiceResult.jsx';

export default function JourneyDetail() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [notes, setNotes] = useState('');
  const [eventNotes, setEventNotes] = useState({});
  const [status, setStatus] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/journeys/${id}`);
      setData(d);
      setNotes(d.journey.notes);
      setEventNotes(Object.fromEntries(d.events.map((e) => [e.id, e.notes])));
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (m) => {
    setStatus(m);
    setTimeout(() => setStatus(''), 1500);
  };

  if (error) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted">Loading…</p>;

  const { journey, events, rolls, characters } = data;
  const nameOf = (cid) => characters.find((c) => c.id === cid)?.name ?? 'unknown';
  const rollFor = (rollId) => rolls.find((r) => r.id === rollId);
  const days = journey.summary?.days;

  let eventNumber = 0;

  return (
    <>
      <div className="page-head">
        <h1>
          {journey.fromLabel || journey.fromHex} → {journey.toLabel || journey.toHex}
        </h1>
        <div className="row">
          <Link to="/journeys" className="small">
            ← all journeys
          </Link>
          <a href={`/api/journeys/${journey.id}/export?format=md`}>export markdown</a>
          <a href={`/api/journeys/${journey.id}/export?format=json`}>json</a>
        </div>
      </div>

      {status ? <div className="info-box">{status}</div> : null}

      <div className="panel">
        <div className="row">
          <span className="pill gold">
            {journey.season} {journey.year}
          </span>
          <span className="pill">{journey.hexesTraversed} hexes traversed</span>
          <span className="pill">{journey.hardTerrainHexes} hard-terrain days</span>
          <span className="pill">
            {journey.dayAdjustments >= 0 ? '+' : ''}
            {journey.dayAdjustments} day adj.
          </span>
          {journey.mounted ? <span className="pill blue">mounted</span> : null}
          {journey.forcedMarch ? <span className="pill bad">forced march</span> : null}
          <span className="pill ok">{journey.totalDays || '—'} days total</span>
          <span className="pill">{journey.status}</span>
        </div>
        <p className="small muted" style={{ marginBottom: 0, marginTop: 8 }}>
          Roles:{' '}
          {Object.entries(journey.roles ?? {})
            .map(([cid, r]) => `${nameOf(cid)} — ${roleLabel(r)}`)
            .join(', ') || '—'}
        </p>
      </div>

      {days ? (
        <div className="panel">
          <h2>Ending the journey</h2>
          <table>
            <tbody>
              <tr>
                <td>March days{days.forcedMarch ? ' (1 day per 2 hexes)' : ''}</td>
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
                  <strong>Total</strong>
                </td>
                <td className="mono">
                  <strong>{days.totalDays} days</strong>
                </td>
              </tr>
            </tbody>
          </table>

          <h3>Fatigue</h3>
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>Hero</th>
                  <th>Start</th>
                  <th>Mount</th>
                  <th>TRAVEL roll</th>
                  <th>Final</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(journey.summary?.relief ?? {}).map(([cid, r]) => (
                  <tr key={cid}>
                    <td>{r.name}</td>
                    <td className="mono">{r.startingFatigue}</td>
                    <td className="mono">
                      {r.mountReduction ? `−${r.mountReduction}` : '—'}
                      {r.mountName ? ` (${r.mountName} V${r.mountVigour})` : ''}
                    </td>
                    <td className="mono">
                      {r.travelRoll
                        ? `${r.travelRoll.success ? 'success' : 'failed'}${r.rollReduction ? ` −${r.rollReduction}` : ''}`
                        : 'not rolled'}
                    </td>
                    <td className="mono">{r.finalFatigue}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div className="panel">
        <h2>Events</h2>
        {events.length === 0 ? <p className="muted small">No events recorded.</p> : null}
        {events.map((e) => {
          if (e.kind === 'marching_test') {
            return (
              <div key={e.id} className="small muted" style={{ padding: '6px 0', borderBottom: '1px solid #2c261e' }}>
                <em>Marching Test</em> → hex ({e.col},{e.row}) · {e.consequence}
                {e.detail?.icons ? ` · ${e.detail.icons} icon(s)` : ''}
              </div>
            );
          }
          eventNumber += 1;
          const roll = rollFor(e.resolutionRollId);
          return (
            <div key={e.id} style={{ padding: '10px 0', borderBottom: '1px solid #2c261e' }}>
              <div className="row">
                <strong>Event {eventNumber}</strong>
                <span className="pill">
                  ({e.col},{e.row}) {regionLabel(e.regionType)}
                </span>
                {e.hardTerrain ? <span className="pill bad">hard terrain</span> : null}
                {e.road ? <span className="pill gold">road</span> : null}
                {e.perilous ? <span className="pill bad">perilous</span> : null}
              </div>
              <div className="small" style={{ margin: '6px 0' }}>
                Target: <strong>{roleLabel(e.targetRole)}</strong>
                {e.targetCharacterId ? ` (${nameOf(e.targetCharacterId)})` : ''} · Feat Die{' '}
                <strong>{e.featFace}</strong>: <strong>{e.eventName}</strong> ·{' '}
                {e.targetSkill ? `${e.targetSkill.toUpperCase()} roll: ` : ''}
                <span className={e.outcome === 'success' ? 'ok' : 'bad'}>{e.outcome}</span>
              </div>
              <div className="small muted">
                Consequence: {e.consequence} · Company Fatigue +{e.companyFatigue} each
                {e.dayAdjustment ? ` · journey ${e.dayAdjustment > 0 ? '+' : ''}${e.dayAdjustment} day` : ''}
              </div>
              {e.detail?.applied?.length ? (
                <div className="small muted">Applied: {e.detail.applied.join('; ')}</div>
              ) : null}
              {roll?.result ? (
                <div style={{ margin: '6px 0' }}>
                  <DiceResult result={roll.result} compact />
                  {roll.specialSuccesses?.length ? (
                    <div className="small">
                      Special Successes: {roll.specialSuccesses.join(', ')}
                    </div>
                  ) : null}
                </div>
              ) : null}
              <label className="field" style={{ marginTop: 6 }}>
                <span>Notes</span>
                <textarea
                  rows={2}
                  value={eventNotes[e.id] ?? ''}
                  onChange={(ev) => setEventNotes({ ...eventNotes, [e.id]: ev.target.value })}
                  onBlur={async () => {
                    await api.patch(`/journeys/${journey.id}/events/${e.id}`, { notes: eventNotes[e.id] ?? '' });
                    flash('Event note saved.');
                  }}
                  placeholder="What actually happened…"
                />
              </label>
            </div>
          );
        })}
      </div>

      <div className="panel">
        <h2>Journey notes</h2>
        <textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
        <button
          className="primary"
          style={{ marginTop: 8 }}
          onClick={async () => {
            await api.patch(`/journeys/${journey.id}`, { notes });
            flash('Journey notes saved.');
          }}
        >
          Save notes
        </button>
      </div>
    </>
  );
}

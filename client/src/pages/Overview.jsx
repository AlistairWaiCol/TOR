import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { SEASONS } from '@shared/journey.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { AreaField, NumField, SelectField, TextField } from '../components/Fields.jsx';

export default function Overview() {
  const { isGM, campaign, refresh } = useApp();
  const [data, setData] = useState(null);
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const load = () => api.get('/campaign').then(setData).catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (data?.campaign && !form) setForm({ ...data.campaign });
  }, [data]);

  const save = async () => {
    setError('');
    try {
      await api.patch('/campaign', {
        year: Number(form.year),
        season: form.season,
        tnBase: Number(form.tnBase),
        name: form.name,
        notes: form.notes,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 1800);
      await load();
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const journeys = data?.journeys ?? [];

  return (
    <>
      <div className="page-head">
        <h1>Campaign Overview</h1>
        <div className="row">
          <span className="pill gold">
            {campaign ? `${campaign.season} ${campaign.year}` : '—'}
          </span>
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {saved ? <div className="info-box">Saved.</div> : null}

      <div className="panel">
        <h2>Year &amp; Season</h2>
        <p className="small muted">
          Season feeds the travel engine directly: a failed Marching Test puts the next event 2 hexes
          away in Spring/Summer, 1 hex away in Autumn/Winter.
        </p>
        {!form ? (
          <p className="muted">Loading…</p>
        ) : isGM ? (
          <>
            <div className="grid g4">
              <TextField label="Campaign" value={form.name} onChange={(v) => setForm({ ...form, name: v })} />
              <NumField label="Year" value={form.year} onChange={(v) => setForm({ ...form, year: v })} />
              <SelectField
                label="Season"
                value={form.season}
                onChange={(v) => setForm({ ...form, season: v })}
                options={SEASONS}
              />
              <SelectField
                label="Target Number base"
                value={String(form.tnBase)}
                onChange={(v) => setForm({ ...form, tnBase: Number(v) })}
                options={[
                  { value: '20', label: '20 − Attribute (standard)' },
                  { value: '18', label: '18 − Attribute (short campaign)' },
                ]}
              />
            </div>
            <AreaField
              label="Campaign notes"
              value={form.notes}
              onChange={(v) => setForm({ ...form, notes: v })}
            />
            <button className="primary" onClick={save}>
              Save campaign state
            </button>
          </>
        ) : (
          <div className="grid g4">
            <Readout label="Campaign" value={form.name} />
            <Readout label="Year" value={form.year} />
            <Readout label="Season" value={form.season} />
            <Readout label="TN base" value={`${form.tnBase} − Attribute`} />
            {form.notes ? <Readout label="Notes" value={form.notes} /> : null}
          </div>
        )}
        {!isGM ? <p className="small muted">Only the GM can change the Year and Season.</p> : null}
      </div>

      <div className="panel">
        <h2>Journeys</h2>
        {journeys.length === 0 ? (
          <p className="muted small">
            No journeys recorded yet. Start one from <Link to="/map">Map &amp; Travel</Link>.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>From → To</th>
                  <th>Days</th>
                  <th>Flags</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {journeys.map((j) => (
                  <tr key={j.id}>
                    <td className="muted">
                      {j.season} {j.year}
                    </td>
                    <td>
                      {j.fromLabel || '?'} → {j.toLabel || '?'}
                    </td>
                    <td>{j.totalDays || '—'}</td>
                    <td className="small muted">
                      {[j.mounted && 'mounted', j.forcedMarch && 'forced march']
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                    <td>
                      <span className={`pill ${j.status === 'complete' ? 'ok' : j.status === 'active' ? 'gold' : ''}`}>
                        {j.status}
                      </span>
                    </td>
                    <td>
                      <Link to={`/journeys/${j.id}`}>Log</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

function Readout({ label, value }) {
  return (
    <div>
      <div className="small muted" style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>
        {label}
      </div>
      <div>{value}</div>
    </div>
  );
}

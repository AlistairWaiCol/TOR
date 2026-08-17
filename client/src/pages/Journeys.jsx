import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';

export default function Journeys() {
  const { isGM } = useApp();
  const [journeys, setJourneys] = useState([]);
  const [error, setError] = useState('');

  const load = () =>
    api
      .get('/journeys')
      .then((d) => setJourneys(d.journeys))
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const remove = async (id) => {
    if (!window.confirm('Delete this journey log and all its events?')) return;
    await api.del(`/journeys/${id}`);
    load();
  };

  return (
    <>
      <div className="page-head">
        <h1>Journey Log</h1>
        <span className="pill">{journeys.length} recorded</span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="panel">
        <p className="small muted" style={{ marginTop: 0 }}>
          A travel-mechanics record only — it is kept entirely separate from your own campaign
          documents and never writes into them.
        </p>
        {journeys.length === 0 ? (
          <p className="muted">
            No journeys yet. Start one from <Link to="/map">Map &amp; Travel</Link>.
          </p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>From → To</th>
                  <th>Hexes</th>
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
                      <Link to={`/journeys/${j.id}`}>
                        {j.fromLabel || j.fromHex} → {j.toLabel || j.toHex}
                      </Link>
                    </td>
                    <td>{j.hexesTraversed}</td>
                    <td>{j.totalDays || '—'}</td>
                    <td className="small muted">
                      {[j.mounted && 'mounted', j.forcedMarch && 'forced march'].filter(Boolean).join(', ') || '—'}
                    </td>
                    <td>
                      <span className={`pill ${j.status === 'complete' ? 'ok' : j.status === 'active' ? 'gold' : ''}`}>
                        {j.status}
                      </span>
                    </td>
                    <td className="row">
                      <a href={`/api/journeys/${j.id}/export?format=md`}>md</a>
                      <a href={`/api/journeys/${j.id}/export?format=json`}>json</a>
                      {isGM ? (
                        <button className="small danger" onClick={() => remove(j.id)}>
                          ×
                        </button>
                      ) : null}
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

import { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { promptedRollFor, roleLabel } from '@shared/journey.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';

/**
 * "It's your turn to roll."
 *
 * Rendered at the app shell rather than inside the Map page, because the whole
 * point is to reach a player who is *not* staring at the map — reading their
 * character sheet, say, or the Compendium.
 *
 * Everything it needs is already in the Socket.IO snapshot the map view reads:
 * `travel.phase`, `travel.state.pendingEvent` and the journey's role snapshot.
 * No new server state, no polling.
 *
 * This never replaces or gates the GM's own controls on the Map page — the GM
 * can still fire any step manually, exactly as before.
 */

/** Which server-side roll each prompt kind fires. */
const ENDPOINTS = {
  marching_test: '/travel/marching-test',
  resolution: '/travel/resolve',
};

export default function TurnPrompt() {
  const { travel, journey, playingAs, playingCharacter, refresh } = useApp();
  const location = useLocation();
  const [busy, setBusy] = useState(false);
  const [hopeSpent, setHopeSpent] = useState(false);
  const [error, setError] = useState('');
  const [dismissed, setDismissed] = useState('');

  const prompt = promptedRollFor({ travel, journey, characterId: playingAs });
  // One dismissal per step, so the next one prompts again.
  const promptKey = prompt
    ? `${prompt.kind}:${prompt.eventId ?? journey?.routeIndex ?? ''}`
    : '';
  if (!prompt || dismissed === promptKey) return null;

  const skill = String(prompt.skill || '').toUpperCase();
  const who = playingCharacter?.name ?? 'You';

  const roll = async () => {
    setBusy(true);
    setError('');
    try {
      // The same server-side roll the GM's button on the Map page fires — one
      // performRoll() path, one Discord post, one journey-log entry.
      await api.post(ENDPOINTS[prompt.kind], { hopeSpent });
      setHopeSpent(false);
      refresh();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="turn-prompt">
      <h3>
        {roleLabel(prompt.roleKey)} ({who}) — please roll {skill}
      </h3>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        {prompt.kind === 'marching_test'
          ? 'Marching Test: your roll decides how far the Company gets before the next event.'
          : 'Event Resolution: the targeted hero makes this roll themselves.'}
      </p>
      {error ? <div className="error-box">{error}</div> : null}
      <label className="check" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={hopeSpent} onChange={(e) => setHopeSpent(e.target.checked)} />
        Spend 1 Hope
      </label>
      <div className="row">
        <button className="primary" disabled={busy} onClick={roll}>
          {busy ? 'Rolling…' : `Roll ${skill}`}
        </button>
        {location.pathname !== '/map' ? (
          <Link className="small" to="/map">
            open the map
          </Link>
        ) : null}
        <div className="spacer" />
        <button className="small" onClick={() => setDismissed(promptKey)} title="Hide until the next step">
          later
        </button>
      </div>
    </div>
  );
}

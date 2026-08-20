import { useEffect, useState } from 'react';
import { totalProtection } from '@shared/character.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { useRoll } from './RollDialog.jsx';

/**
 * The in-app replacement for the native confirm()/alert() a hit used to pop
 * up as. Routed the same way TurnPrompt/CombatTurnPrompt are: gated on the
 * viewer's own "Playing As" pick, so it only ever appears on the HIT
 * PLAYER'S screen — never as a popup on the GM's, who triggered the roll but
 * isn't the one deciding whether to eat the hit or spend Knockback on it.
 *
 * Reads `combat.pendingHits[playingAs]`, a small state machine server-side
 * (server/lib/combatEngine.js): 'hit' -> (Piercing Blow only) 'protection' ->
 * (failed only) 'wound-severity', at which point it's the GM's turn to act
 * (a control on the Combat Tracker page, not here).
 */
export default function CombatHitPrompt() {
  const { combat, playingCharacter } = useApp();
  const { openRoll } = useRoll();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resolution, setResolution] = useState(null); // last resolveHit() response, shown once
  const [waitingDismissed, setWaitingDismissed] = useState(false);

  const characterId = playingCharacter?.id;
  const pending = characterId ? combat?.pendingHits?.[characterId] : null;

  // A fresh wound-severity wait (or any other stage change) un-dismisses —
  // dismissal is "I've seen this one", not "never show me this stage again".
  useEffect(() => {
    setWaitingDismissed(false);
  }, [pending?.stage]);

  if (!characterId || (!pending && !resolution)) return null;
  if (pending?.stage === 'wound-severity' && waitingDismissed && !resolution) return null;

  const resolveHit = async (knockback) => {
    setBusy(true);
    setError('');
    try {
      const data = await api.post('/combat/resolve-hit', {
        characterId,
        enduranceLoss: pending.enduranceLoss,
        knockback,
      });
      setResolution(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const rollProtection = () => {
    const rating = totalProtection(playingCharacter.sheet).total;
    openRoll({
      title: 'Protection — Piercing Blow',
      characterId,
      skill: 'Protection',
      kind: 'protection',
      label: 'Protection',
      rating,
      targetNumber: pending.weaponInjury,
      note: `Piercing Blow from ${pending.source}. Success Dice = total Protection (${rating}), TN = the weapon's Injury (${pending.weaponInjury}).`,
      endpoint: '/combat/protection-roll',
      extraBody: {},
      onRolled: () => {},
    });
  };

  // A resolveHit() response is shown once, with its own escalating tier, then
  // dismissed — after that, `combat.pendingHits` (already updated by the
  // broadcast the resolution triggered) takes back over.
  if (resolution) {
    const tier = resolution.kill ? 'tier-kill' : '';
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <div className={`roll-outcome ${tier}`}>
            {resolution.kill ? <div className="outcome-banner">☠ {playingCharacter.name} is down</div> : null}
            <h2 style={{ margin: '0 0 6px' }}>
              {resolution.kill ? 'Reduced to zero Endurance' : 'Hit resolved'}
            </h2>
            <p className="small muted">
              Took {resolution.appliedLoss} Endurance — now {resolution.endurance}.
            </p>
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => setResolution(null)}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pending.stage === 'hit') {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2 style={{ margin: '0 0 6px' }}>Hit by {pending.source}</h2>
          {error ? <div className="error-box">{error}</div> : null}
          <p>
            {playingCharacter.name} is hit for <strong>{pending.enduranceLoss} Endurance</strong>.
          </p>
          <p className="small muted">
            Take it, or spend your next main action on Knockback to halve it (rounded up).
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={busy} onClick={() => resolveHit(false)}>
              Take it
            </button>
            <button disabled={busy} onClick={() => resolveHit(true)}>
              Knockback (halve it)
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pending.stage === 'protection') {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <div className="roll-outcome tier-piercing">
            <div className="outcome-banner">⚡ Piercing Blow</div>
            <h2 style={{ margin: '0 0 6px' }}>Roll PROTECTION</h2>
          </div>
          {error ? <div className="error-box">{error}</div> : null}
          <p className="small muted">
            {pending.source}'s blow pierced {playingCharacter.name}'s defences. Roll Protection — a
            failure is a Wound.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={rollProtection}>
              Roll Protection
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (pending.stage === 'wound-severity') {
    return (
      <div className="modal-backdrop">
        <div className="modal">
          <h2 style={{ margin: '0 0 6px' }}>Protection failed</h2>
          <p className="small muted">
            Waiting on the GM to record the Wound's severity on the Combat Tracker.
          </p>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" onClick={() => setWaitingDismissed(true)}>
              OK, I'll wait
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

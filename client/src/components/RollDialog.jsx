import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { SPECIAL_SUCCESS_OPTIONS } from '@shared/dice.js';
import { api } from '../lib/api.js';
import DiceResult from './DiceResult.jsx';
import { CheckField, NumField, SelectField } from './Fields.jsx';

const RollContext = createContext(null);

export function useRoll() {
  const ctx = useContext(RollContext);
  if (!ctx) throw new Error('useRoll must be used inside <RollProvider>');
  return ctx;
}

/**
 * One dialog for every roll in the app. It pre-fills from whatever context
 * opened it (a skill row, the Marching Test, an event resolution) but stays
 * editable, because at the table the GM always wants to nudge something.
 */
export function RollProvider({ children }) {
  const [config, setConfig] = useState(null);

  const openRoll = useCallback((cfg) => setConfig(cfg), []);
  const closeRoll = useCallback(() => setConfig(null), []);

  const value = useMemo(() => ({ openRoll, closeRoll }), [openRoll, closeRoll]);

  return (
    <RollContext.Provider value={value}>
      {children}
      {config ? <RollModal config={config} onClose={closeRoll} /> : null}
    </RollContext.Provider>
  );
}

/**
 * Useful Items the rolling hero owns that name this skill.
 *
 * A reminder, not a modifier. Per the core rulebook a Useful Item's bonus is
 * awarded by the GM when the item is narratively relevant to the roll being
 * made — not a standing plus on every roll of that skill — so this sits next to
 * the Flat bonus field and adds nothing to the pool on its own, the same way a
 * Hope spend is offered as a choice rather than applied automatically.
 *
 * Before this the bonuses only existed on the character sheet's own Useful
 * Items table, which is exactly where nobody is looking at the moment of a roll.
 */
function UsefulItemNote({ items }) {
  if (!items?.length) return null;
  return (
    <div className="info-box" style={{ marginTop: 4 }}>
      <strong>Useful Items that could apply:</strong>{' '}
      {items
        .map((i) => `${i.name} ${Number(i.bonus) > 0 ? '+' : ''}${Number(i.bonus)}`)
        .join(' · ')}
      <div className="small muted">
        GM's discretion — if the item fits what is being attempted, add its bonus in "Flat bonus"
        above. Nothing is applied automatically.
      </div>
    </div>
  );
}

function RollModal({ config, onClose }) {
  // Attack rolls take the target's Parry rather than a raw TN: in TOR 2e an
  // attack's Target Number is the attacker's STRENGTH TN raised by the target's
  // Parry, and the target is usually an NPC with no sheet in this app.
  const parryTarget = Boolean(config.parryTarget);
  const strengthTN = Number(config.strengthTN) || 0;

  const [form, setForm] = useState(() => ({
    rating: config.rating ?? 0,
    targetNumber: config.targetNumber ?? 14,
    targetParry: config.targetParry ?? 0,
    favourState: config.illFavoured ? 'Ill-Favoured' : config.favoured ? 'Favoured' : 'Normal',
    extraDice: config.extraDice ?? 0,
    bonus: config.bonus ?? 0,
    hopeSpent: false,
    whisperTo: config.whisperTo ?? 'public',
  }));

  const targetNumber = parryTarget
    ? strengthTN + (Number(form.targetParry) || 0)
    : Number(form.targetNumber);
  const [state, setState] = useState('idle'); // idle | rolling | done | error
  const [outcome, setOutcome] = useState(null);
  const [error, setError] = useState('');
  const [picks, setPicks] = useState([]);

  const hope = config.hope ?? 0;
  const inspired = Boolean(config.inspired);

  const set = (key) => (v) => setForm((f) => ({ ...f, [key]: v }));

  const doRoll = async () => {
    setState('rolling');
    setError('');
    try {
      const body = {
        characterId: config.characterId ?? undefined,
        // Only meaningful when there's no characterId (an adversary-triggered
        // combat roll, say) — performRoll() falls back to the sheet's own name
        // whenever a characterId is given, so this never overrides that.
        actorName: config.actorName ?? undefined,
        skill: config.skill ?? undefined,
        kind: config.kind ?? 'skill',
        label: config.label ?? config.skill ?? 'Roll',
        rating: Number(form.rating),
        targetNumber,
        favoured: form.favourState === 'Favoured',
        illFavoured: form.favourState === 'Ill-Favoured',
        extraDice: Number(form.extraDice),
        bonus: Number(form.bonus),
        hopeSpent: form.hopeSpent,
        whisperTo: form.whisperTo,
        // Passthrough for callers whose endpoint needs more than a plain roll —
        // the Combat Tracker's combatantId, weapon Damage/Injury, and so on.
        ...(config.extraBody ?? {}),
      };
      const url = config.endpoint ?? (config.characterId ? `/characters/${config.characterId}/roll` : '/rolls');
      const data = await api.post(url, body);
      setOutcome(data);
      setPicks(Array.from({ length: data.result?.icons ?? 0 }, () => ''));
      setState('done');
      config.onRolled?.(data);
    } catch (err) {
      setError(err.message);
      setState('error');
    }
  };

  const savePicks = async (next) => {
    setPicks(next);
    const chosen = next.filter(Boolean);
    try {
      await api.patch(`/rolls/${outcome.roll.id}`, { specialSuccesses: chosen });
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const whisperOptions = [
    { value: 'public', label: 'Everyone (posts to Discord)' },
    { value: 'gm', label: 'Whisper to GM (no Discord post)' },
    { value: 'me', label: 'Whisper to me only (no Discord post)' },
    ...(config.whisperTargets ?? []).map((n) => ({
      value: n,
      label: `Whisper to ${n} (no Discord post)`,
    })),
  ];

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="page-head">
          <h2 style={{ margin: 0 }}>{config.title ?? config.label ?? 'Roll'}</h2>
          <button className="small" onClick={onClose}>
            Close
          </button>
        </div>

        {config.note ? <div className="info-box">{config.note}</div> : null}
        {config.warning ? <div className="warn-box">{config.warning}</div> : null}
        {error ? <div className="error-box">{error}</div> : null}

        {state !== 'done' ? (
          <>
            <div className="grid g3">
              <NumField label="Success Dice (rating)" value={form.rating} onChange={set('rating')} min={0} />
              {parryTarget ? (
                <label className="field">
                  <span>Target's Parry</span>
                  <input
                    type="number"
                    min={0}
                    value={form.targetParry}
                    autoFocus
                    onChange={(e) =>
                      setForm((f) => ({ ...f, targetParry: e.target.value === '' ? 0 : Number(e.target.value) }))
                    }
                  />
                  <span className="small muted">
                    TN {strengthTN} (STRENGTH) + {Number(form.targetParry) || 0} = <strong>{targetNumber}</strong>
                  </span>
                </label>
              ) : (
                <NumField
                  label="Target Number"
                  value={form.targetNumber}
                  onChange={set('targetNumber')}
                  min={1}
                />
              )}
              <SelectField
                label="Feat modifier"
                value={form.favourState}
                onChange={set('favourState')}
                options={['Normal', 'Favoured', 'Ill-Favoured']}
              />
              <NumField
                label="Situational dice"
                value={form.extraDice}
                onChange={set('extraDice')}
                title="e.g. hard terrain −1, road +1"
              />
              <NumField
                label="Flat bonus"
                value={form.bonus}
                onChange={set('bonus')}
                title="Where a Useful Item's bonus goes, if the GM rules it applies"
              />
              <SelectField
                label="Visible to"
                value={form.whisperTo}
                onChange={set('whisperTo')}
                options={whisperOptions}
              />
            </div>

            <UsefulItemNote items={config.usefulItems} />

            {config.characterId ? (
              <div className="row" style={{ margin: '4px 0 12px' }}>
                <CheckField
                  label={`Spend 1 Hope for +${inspired ? 2 : 1} Success ${inspired ? 'Dice' : 'Die'}${inspired ? ' (Inspired)' : ''}`}
                  checked={form.hopeSpent}
                  onChange={set('hopeSpent')}
                />
                <span className="pill">Hope {hope}</span>
                {config.weary ? <span className="pill bad">Weary</span> : null}
                {config.miserable ? <span className="pill bad">Miserable</span> : null}
                {inspired ? <span className="pill gold">Inspired</span> : null}
              </div>
            ) : null}

            <div className="row">
              <button className="primary" onClick={doRoll} disabled={state === 'rolling'}>
                {state === 'rolling' ? 'Rolling…' : 'Roll the dice'}
              </button>
              <span className="small muted">
                1 Feat Die + {Math.max(0, Number(form.rating) + Number(form.extraDice) + (form.hopeSpent ? (inspired ? 2 : 1) : 0))} Success Dice
              </span>
            </div>
          </>
        ) : (
          <>
            <DiceResult result={outcome.result} />
            {outcome.hopeError ? <div className="warn-box">{outcome.hopeError}</div> : null}
            <div className="small muted mono" style={{ margin: '8px 0' }}>
              {outcome.message}
            </div>
            {outcome.discord && !outcome.discord.posted ? (
              <div className="small muted">
                Discord: not posted ({outcome.discord.reason}).
              </div>
            ) : null}

            {outcome.result?.success && outcome.result?.icons > 0 ? (
              <div className="panel" style={{ marginTop: 12 }}>
                <h3>Spend Success icons</h3>
                <p className="small muted">
                  {outcome.result.icons} icon{outcome.result.icons === 1 ? '' : 's'} available. Recorded
                  as a tag on the roll — the app does not enforce the narrative effect.
                </p>
                {picks.map((pick, i) => (
                  <SelectField
                    key={i}
                    label={`Icon ${i + 1}`}
                    value={pick}
                    onChange={(v) => {
                      const next = picks.slice();
                      next[i] = v;
                      savePicks(next);
                    }}
                    options={[{ value: '', label: '— unspent —' }, ...SPECIAL_SUCCESS_OPTIONS]}
                  />
                ))}
              </div>
            ) : null}

            <div className="row" style={{ marginTop: 12 }}>
              <button
                onClick={() => {
                  setState('idle');
                  setOutcome(null);
                  setPicks([]);
                }}
              >
                Roll again
              </button>
              <button className="primary" onClick={onClose}>
                Done
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

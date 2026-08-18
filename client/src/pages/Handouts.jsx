import { useCallback, useEffect, useMemo, useState } from 'react';
import { SEASONS } from '@shared/journey.js';
import { api, handoutImageUrl } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useApp } from '../state/AppContext.jsx';
import { AreaField, SelectField, TextField } from '../components/Fields.jsx';

/**
 * Handouts — an image plus notes, tagged to a campaign Year + Season.
 *
 * The Year/Season selector starts on the campaign's current date and is then
 * free to browse: a player wanting to re-read the letter they got two seasons
 * ago should not have to ask the GM.
 *
 * Hidden handouts never reach a player's browser at all — the list route
 * filters them server-side — so the eye/eye-slash indicator below is a GM-only
 * affordance over data only the GM was sent.
 */

const EYE = '👁';
const EYE_SLASH = '🚫';

export default function Handouts() {
  const { isGM, campaign } = useApp();
  const [handouts, setHandouts] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [open, setOpen] = useState(null); // the handout shown full-size
  const [when, setWhen] = useState(null); // { year, season }, null until campaign loads

  const load = useCallback(async () => {
    try {
      const d = await api.get('/handouts');
      setHandouts(d.handouts ?? []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Every mutation broadcasts; the list is refetched rather than pushed, so the
  // server's role filtering stays the single place hidden-ness is decided.
  useEffect(() => {
    const socket = getSocket();
    const onChanged = () => load();
    socket.on('handouts:changed', onChanged);
    return () => socket.off('handouts:changed', onChanged);
  }, [load]);

  // Default to the campaign's current Year/Season, once, then leave it alone.
  useEffect(() => {
    if (!when && campaign) setWhen({ year: campaign.year, season: campaign.season });
  }, [campaign, when]);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 1600);
  };

  /** Years that actually have handouts, plus the campaign's own year. */
  const years = useMemo(() => {
    const set = new Set((handouts ?? []).map((h) => h.year));
    if (campaign?.year) set.add(campaign.year);
    if (when?.year) set.add(when.year);
    return [...set].filter((y) => Number.isFinite(y)).sort((a, b) => a - b);
  }, [handouts, campaign?.year, when?.year]);

  const shown = useMemo(() => {
    if (!handouts || !when) return [];
    return handouts.filter((h) => h.year === when.year && h.season === when.season);
  }, [handouts, when]);

  /** Which other Year/Seasons hold anything, so browsing is not guesswork. */
  const elsewhere = useMemo(() => {
    const counts = new Map();
    for (const h of handouts ?? []) {
      const key = `${h.year}|${h.season}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([key, count]) => {
        const [year, season] = key.split('|');
        return { year: Number(year), season, count };
      })
      .sort((a, b) => a.year - b.year || SEASONS.indexOf(a.season) - SEASONS.indexOf(b.season));
  }, [handouts]);

  const patch = async (handout, body) => {
    setError('');
    try {
      await api.patch(`/handouts/${handout.id}`, body);
      await load();
      flash('Saved.');
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (handout) => {
    if (!window.confirm(`Delete the handout "${handout.title || 'untitled'}"? The image goes too.`)) {
      return;
    }
    setError('');
    try {
      await api.del(`/handouts/${handout.id}`);
      setOpen(null);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error && !handouts) return <div className="error-box">{error}</div>;
  if (!handouts || !when) return <p className="muted">Loading handouts…</p>;

  return (
    <>
      <div className="page-head">
        <h1>Handouts</h1>
        <div className="row">
          <span className="pill gold">
            {when.season} {when.year}
          </span>
          <span className="pill">
            {shown.length} handout{shown.length === 1 ? '' : 's'}
          </span>
          {isGM ? <span className="pill blue">GM — hidden handouts shown</span> : null}
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {status ? <div className="info-box">{status}</div> : null}

      <div className="panel">
        <div className="row">
          <div style={{ width: 150 }}>
            <SelectField
              label="Year"
              value={String(when.year)}
              onChange={(v) => setWhen((w) => ({ ...w, year: Number(v) }))}
              options={years.map((y) => ({ value: String(y), label: String(y) }))}
            />
          </div>
          <div style={{ width: 150 }}>
            <SelectField
              label="Season"
              value={when.season}
              onChange={(v) => setWhen((w) => ({ ...w, season: v }))}
              options={SEASONS}
            />
          </div>
          <div className="spacer" />
          {campaign &&
          (when.year !== campaign.year || when.season !== campaign.season) ? (
            <button
              className="small"
              onClick={() => setWhen({ year: campaign.year, season: campaign.season })}
            >
              back to {campaign.season} {campaign.year}
            </button>
          ) : null}
        </div>
        {elsewhere.length ? (
          <div className="row" style={{ marginTop: 4 }}>
            <span className="small muted">also:</span>
            {elsewhere.map((e) => (
              <button
                key={`${e.year}-${e.season}`}
                className="small"
                disabled={e.year === when.year && e.season === when.season}
                onClick={() => setWhen({ year: e.year, season: e.season })}
              >
                {e.season} {e.year} ({e.count})
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {isGM ? <CreateHandout when={when} onCreated={load} setError={setError} /> : null}

      {shown.length === 0 ? (
        <div className="panel">
          <p className="small muted" style={{ marginBottom: 0 }}>
            Nothing for {when.season} {when.year}
            {isGM ? '.' : ' — the GM may not have revealed anything for this season yet.'}
          </p>
        </div>
      ) : (
        <div className="handout-grid">
          {shown.map((h) => (
            <HandoutCard
              key={h.id}
              handout={h}
              isGM={isGM}
              onOpen={() => setOpen(h)}
              onToggleHidden={() => patch(h, { hidden: !h.hidden })}
            />
          ))}
        </div>
      )}

      {open ? (
        <HandoutModal
          handout={handouts.find((h) => h.id === open.id) ?? open}
          isGM={isGM}
          onClose={() => setOpen(null)}
          onPatch={patch}
          onRemove={remove}
        />
      ) : null}
    </>
  );
}

function HiddenPill({ hidden }) {
  return hidden ? (
    <span className="pill bad" title="Hidden — players cannot see this handout">
      {EYE_SLASH} hidden
    </span>
  ) : (
    <span className="pill ok" title="Visible to players">
      {EYE} visible
    </span>
  );
}

function HandoutCard({ handout, isGM, onOpen, onToggleHidden }) {
  return (
    <div className={`handout-card ${handout.hidden ? 'is-hidden' : ''}`}>
      <button className="handout-thumb" onClick={onOpen} title="Open the handout">
        {handout.tiers?.length ? (
          <img src={handoutImageUrl(handout.id, 'thumb')} alt={handout.title || 'Handout'} />
        ) : (
          <span className="small muted">no image</span>
        )}
      </button>
      <div className="handout-meta">
        <strong>{handout.title || '(untitled)'}</strong>
        {handout.notes ? <p className="small muted">{handout.notes.slice(0, 90)}</p> : null}
        <div className="row">
          {isGM ? <HiddenPill hidden={handout.hidden} /> : null}
          {isGM ? (
            <button className="small" onClick={onToggleHidden}>
              {handout.hidden ? 'reveal' : 'hide'}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function HandoutModal({ handout, isGM, onClose, onPatch, onRemove }) {
  const [notes, setNotes] = useState(handout.notes);
  const [title, setTitle] = useState(handout.title);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal handout-modal">
        <div className="page-head">
          <h2 style={{ margin: 0 }}>{handout.title || '(untitled handout)'}</h2>
          <div className="row">
            {isGM ? <HiddenPill hidden={handout.hidden} /> : null}
            <button className="small" onClick={onClose}>
              Close
            </button>
          </div>
        </div>

        {handout.tiers?.length ? (
          <img
            className="handout-full"
            src={handoutImageUrl(handout.id, 'view')}
            alt={handout.title || 'Handout'}
          />
        ) : (
          <p className="small muted">This handout has no image.</p>
        )}

        {isGM ? (
          <>
            <TextField label="Title" value={title} onChange={setTitle} />
            <AreaField label="Notes" rows={5} value={notes} onChange={setNotes} />
            <div className="row">
              <button className="primary" onClick={() => onPatch(handout, { title, notes })}>
                Save
              </button>
              <button onClick={() => onPatch(handout, { hidden: !handout.hidden })}>
                {handout.hidden ? `${EYE} Reveal to players` : `${EYE_SLASH} Hide from players`}
              </button>
              <div className="spacer" />
              <button className="small danger" onClick={() => onRemove(handout)}>
                Delete handout
              </button>
            </div>
          </>
        ) : handout.notes ? (
          <p style={{ whiteSpace: 'pre-wrap' }}>{handout.notes}</p>
        ) : null}

        <p className="small muted" style={{ marginBottom: 0 }}>
          {handout.season} {handout.year}
        </p>
      </div>
    </div>
  );
}

/** GM-only. New handouts are hidden by default; the checkbox opts out. */
function CreateHandout({ when, onCreated, setError }) {
  const [openForm, setOpenForm] = useState(false);
  const [title, setTitle] = useState('');
  const [notes, setNotes] = useState('');
  const [year, setYear] = useState(String(when.year));
  const [season, setSeason] = useState(when.season);
  const [hidden, setHidden] = useState(true);
  const [file, setFile] = useState(null);
  const [busy, setBusy] = useState(false);

  const reset = () => {
    setTitle('');
    setNotes('');
    setFile(null);
    setHidden(true);
    setYear(String(when.year));
    setSeason(when.season);
  };

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const form = new FormData();
      form.append('title', title);
      form.append('notes', notes);
      form.append('year', String(Number(year) || 0));
      form.append('season', season);
      form.append('hidden', hidden ? 'true' : 'false');
      if (file) form.append('image', file);
      await api.upload('/handouts', form);
      reset();
      setOpenForm(false);
      await onCreated();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!openForm) {
    return (
      <div className="panel">
        <button
          className="primary"
          onClick={() => {
            setYear(String(when.year));
            setSeason(when.season);
            setOpenForm(true);
          }}
        >
          + Create handout
        </button>
        <span className="small muted" style={{ marginLeft: 10 }}>
          New handouts start hidden.
        </span>
      </div>
    );
  }

  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>New handout</h2>
        <button className="small" onClick={() => setOpenForm(false)}>
          Cancel
        </button>
      </div>
      <div className="grid g3">
        <TextField label="Title" value={title} onChange={setTitle} placeholder="Thror's map" />
        <TextField label="Year" value={year} onChange={setYear} />
        <SelectField label="Season" value={season} onChange={setSeason} options={SEASONS} />
      </div>
      <AreaField label="Notes" rows={4} value={notes} onChange={setNotes} />
      <label className="field">
        <span>Image</span>
        <input
          type="file"
          accept="image/*"
          onChange={(e) => setFile(e.target.files?.[0] ?? null)}
        />
      </label>
      <div className="row">
        <label className="check" title="A new handout is GM prep until you reveal it">
          <input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} />
          Hidden from players
        </label>
        <button className="primary" disabled={busy} onClick={submit}>
          {busy ? 'Uploading…' : 'Create handout'}
        </button>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        The upload is re-encoded server-side into web-sized WebP; the original is kept on disk and
        never served. You can flip a handout between hidden and visible at any time afterwards.
      </p>
    </div>
  );
}

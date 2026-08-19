import { useCallback, useEffect, useMemo, useState } from 'react';
import { SEASONS } from '@shared/journey.js';
import { api } from '../lib/api.js';
import { getSocket } from '../lib/socket.js';
import { useApp } from '../state/AppContext.jsx';
import { AreaField, SelectField, TextField } from '../components/Fields.jsx';

/**
 * Adventure Notes — the table's scratchpad, one entry per campaign Year+Season.
 *
 * Not a list. Picking a Year/Season loads that season's single note for
 * editing, or an empty one ready to write into — the same Year/Season value
 * domain Campaign Overview and Handouts already use, and the selector starts on
 * the campaign's current date the same way Handouts' does.
 *
 * Its own tab rather than sharing Handouts' page: the two are Year/Season-scoped
 * but nothing else about them lines up. Handouts are GM-written, hidden until
 * revealed, and image-first; these are open to anyone with the player passcode,
 * have no hidden concept at all, and are text. One page juggling two permission
 * models would be harder to read than two pages.
 */

/** Years worth offering: the campaign's own, plus any that hold a note. */
function yearOptions(notes, campaignYear, selectedYear) {
  const set = new Set((notes ?? []).map((n) => n.year));
  if (Number.isFinite(campaignYear)) set.add(campaignYear);
  if (Number.isFinite(selectedYear)) set.add(selectedYear);
  return [...set].filter(Number.isFinite).sort((a, b) => a - b);
}

export default function AdventureNotes() {
  const { campaign } = useApp();
  const [notes, setNotes] = useState(null); // every note, for the index strip
  const [when, setWhen] = useState(null); // { year, season }, null until campaign loads
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [addYear, setAddYear] = useState('');

  const load = useCallback(async () => {
    try {
      const d = await api.get('/notes');
      setNotes(d.notes ?? []);
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Same shape Handouts uses: a mutation pings, the page refetches. Notes are
  // not in the Socket.IO snapshot — that snapshot is for the live map view.
  useEffect(() => {
    const socket = getSocket();
    const onChanged = () => load();
    socket.on('notes:changed', onChanged);
    return () => socket.off('notes:changed', onChanged);
  }, [load]);

  useEffect(() => {
    if (!when && campaign) setWhen({ year: campaign.year, season: campaign.season });
  }, [campaign, when]);

  const current = useMemo(() => {
    if (!notes || !when) return null;
    return notes.find((n) => n.year === when.year && n.season === when.season) ?? null;
  }, [notes, when]);

  // Load the selected season's text into the editor. Unsaved edits are NOT
  // clobbered by a refetch — only an actual change of season resets the boxes.
  const whenKey = when ? `${when.year}|${when.season}` : '';
  useEffect(() => {
    if (!when || !notes) return;
    const found = notes.find((n) => n.year === when.year && n.season === when.season);
    setTitle(found?.title ?? '');
    setBody(found?.body ?? '');
    setDirty(false);
    // Keyed on the selected season alone, deliberately — see above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [whenKey, notes === null]);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 1600);
  };

  const save = async () => {
    if (!when) return;
    setError('');
    try {
      await api.put(`/notes/${when.year}/${when.season}`, { title, body });
      await load();
      setDirty(false);
      flash('Saved.');
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async () => {
    if (!when || !current) return;
    if (!window.confirm(`Delete the note for ${when.season} ${when.year}?`)) return;
    setError('');
    try {
      await api.del(`/notes/${when.year}/${when.season}`);
      setTitle('');
      setBody('');
      setDirty(false);
      await load();
    } catch (e) {
      setError(e.message);
    }
  };

  if (error && !notes) return <div className="error-box">{error}</div>;
  if (!notes || !when) return <p className="muted">Loading notes…</p>;

  const years = yearOptions(notes, campaign?.year, when.year);
  const written = notes.filter((n) => n.title || n.body);

  return (
    <>
      <div className="page-head">
        <h1>Adventure Notes</h1>
        <div className="row">
          <span className="pill gold">
            {when.season} {when.year}
          </span>
          {current ? (
            <span className="pill">saved</span>
          ) : (
            <span className="pill">nothing written yet</span>
          )}
          {dirty ? <span className="pill bad">unsaved changes</span> : null}
          {status ? <span className="pill ok">{status}</span> : null}
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

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
          {/* The Year dropdown only lists years that exist somewhere; a note
              written ahead of (or behind) the campaign needs a way in. */}
          <div style={{ width: 170 }}>
            <TextField
              label="Jump to another year"
              value={addYear}
              placeholder="e.g. 2948"
              onChange={setAddYear}
            />
          </div>
          <button
            className="small"
            disabled={!Number.isFinite(Number(addYear)) || addYear === ''}
            onClick={() => {
              setWhen((w) => ({ ...w, year: Number(addYear) }));
              setAddYear('');
            }}
          >
            go
          </button>
          <div className="spacer" />
          {campaign && (when.year !== campaign.year || when.season !== campaign.season) ? (
            <button
              className="small"
              onClick={() => setWhen({ year: campaign.year, season: campaign.season })}
            >
              back to {campaign.season} {campaign.year}
            </button>
          ) : null}
        </div>
        {written.length ? (
          <div className="row" style={{ marginTop: 4 }}>
            <span className="small muted">written up:</span>
            {written.map((n) => (
              <button
                key={n.id}
                className="small"
                disabled={n.year === when.year && n.season === when.season}
                title={n.title || '(untitled)'}
                onClick={() => setWhen({ year: n.year, season: n.season })}
              >
                {n.season} {n.year}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <TextField
          label="Title"
          value={title}
          placeholder={`${when.season} ${when.year}`}
          onChange={(v) => {
            setTitle(v);
            setDirty(true);
          }}
        />
        <AreaField
          label="Notes"
          rows={18}
          value={body}
          placeholder="What happened, who was met, what the Company decided to do next…"
          onChange={(v) => {
            setBody(v);
            setDirty(true);
          }}
        />
        <div className="row">
          <button className="primary" onClick={save} disabled={!dirty}>
            {dirty ? 'Save notes' : 'Saved'}
          </button>
          {current ? (
            <button
              onClick={() => {
                setTitle(current.title);
                setBody(current.body);
                setDirty(false);
              }}
              disabled={!dirty}
            >
              Discard changes
            </button>
          ) : null}
          <div className="spacer" />
          {current ? (
            <button className="small danger" onClick={remove}>
              Delete this season's note
            </button>
          ) : null}
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          One note per Year and Season, shared by the whole table — anyone with the player passcode
          can read and edit it. A scratchpad, not an export: nothing here is synced anywhere.
          {current?.updatedAt ? ` Last saved ${current.updatedAt.slice(0, 16).replace('T', ' ')}.` : ''}
        </p>
      </div>
    </>
  );
}

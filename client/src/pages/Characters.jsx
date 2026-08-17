import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { TextField } from '../components/Fields.jsx';

export default function Characters() {
  const { refresh } = useApp();
  const [characters, setCharacters] = useState([]);
  const [name, setName] = useState('');
  const [player, setPlayer] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const load = () =>
    api
      .get('/characters')
      .then((d) => setCharacters(d.characters))
      .catch((e) => setError(e.message));

  useEffect(() => {
    load();
  }, []);

  const create = async () => {
    setError('');
    try {
      const d = await api.post('/characters', { name: name || 'New Hero', player });
      setName('');
      setPlayer('');
      await load();
      refresh();
      navigate(`/characters/${d.character.id}`);
    } catch (e) {
      setError(e.message);
    }
  };

  const remove = async (id, label) => {
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
    await api.del(`/characters/${id}`);
    await load();
    refresh();
  };

  return (
    <>
      <div className="page-head">
        <h1>Characters</h1>
        <span className="pill">{characters.length} hero{characters.length === 1 ? '' : 'es'}</span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      <div className="panel">
        <h2>New hero</h2>
        <div className="grid g3">
          <TextField label="Name" value={name} onChange={setName} placeholder="Haldamir" />
          <TextField label="Player" value={player} onChange={setPlayer} placeholder="who plays them" />
          <div style={{ alignSelf: 'end' }}>
            <button className="primary" onClick={create}>
              Create sheet
            </button>
          </div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          No per-user ownership — anyone with the player passcode can open and edit any sheet.
        </p>
      </div>

      {characters.length === 0 ? (
        <div className="panel">
          <p className="muted">No character sheets yet.</p>
        </div>
      ) : (
        <div className="grid g2">
          {characters.map((c) => {
            const s = c.sheet;
            const cond = [
              s.conditions.weary && 'Weary',
              s.conditions.miserable && 'Miserable',
              s.conditions.wounded && 'Wounded',
              s.conditions.inspired && 'Inspired',
            ].filter(Boolean);
            return (
              <div className="panel" key={c.id} style={{ marginBottom: 0 }}>
                <div className="page-head" style={{ marginBottom: 8 }}>
                  <h2 style={{ margin: 0 }}>
                    <Link to={`/characters/${c.id}`}>{c.name || 'Unnamed'}</Link>
                  </h2>
                  <button className="small danger" onClick={() => remove(c.id, c.name)}>
                    Delete
                  </button>
                </div>
                <p className="small muted" style={{ margin: 0 }}>
                  {[s.general.culture, s.general.calling, c.player && `played by ${c.player}`]
                    .filter(Boolean)
                    .join(' · ') || 'no culture set'}
                </p>
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="pill">
                    End {s.attributes.strength.endurance}/{s.attributes.strength.enduranceMax}
                  </span>
                  <span className="pill">
                    Hope {s.attributes.heart.hope}/{s.attributes.heart.hopeMax}
                  </span>
                  <span className="pill">Fatigue {s.attributes.strength.fatigue}</span>
                  <span className="pill">Shadow {s.attributes.heart.shadow}</span>
                  {s.conditions.favourState !== 'Normal' ? (
                    <span className="pill gold">{s.conditions.favourState}</span>
                  ) : null}
                  {cond.map((x) => (
                    <span className="pill bad" key={x}>
                      {x}
                    </span>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}

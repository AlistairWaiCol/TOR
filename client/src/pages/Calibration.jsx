import { useEffect, useMemo, useState } from 'react';
import { DEFAULT_CALIBRATION, hexKey } from '@shared/hexMath.js';
import { REGION_TYPES } from '@shared/journey.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import HexMap from '../components/HexMap.jsx';
import { CheckField, NumField, SelectField, TextField } from '../components/Fields.jsx';

const SLIDERS = [
  { key: 'hexEdge', label: 'Hex edge', min: 20, max: 200, step: 0.5 },
  { key: 'hexWidth', label: 'Hex width', min: 40, max: 400, step: 0.5 },
  { key: 'hexHeight', label: 'Hex height', min: 40, max: 400, step: 0.5 },
  { key: 'colSpacing', label: 'Column gap', min: 30, max: 300, step: 0.5 },
  { key: 'colOffset', label: 'Column offset', min: 0, max: 200, step: 0.5 },
  { key: 'offsetX', label: 'Origin X', min: -300, max: 600, step: 1 },
  { key: 'offsetY', label: 'Origin Y', min: -300, max: 600, step: 1 },
  { key: 'rotation', label: 'Rotation°', min: -15, max: 15, step: 0.05 },
];

const BLANK_TAGS = {
  regionType: 'wild',
  hardTerrain: false,
  road: false,
  perilous: false,
  perilRating: 0,
  label: '',
};

export default function Calibration() {
  const { refresh } = useApp();
  const [calibrations, setCalibrations] = useState([]);
  const [active, setActive] = useState(null);
  const [grid, setGrid] = useState(null);
  const [hexes, setHexes] = useState([]);
  const [tier, setTier] = useState('web');
  const [zoom, setZoom] = useState(1);
  const [showGrid, setShowGrid] = useState(true);
  const [mode, setMode] = useState('select'); // select | paint
  const [selected, setSelected] = useState(null);
  const [tags, setTags] = useState(BLANK_TAGS);
  const [brush, setBrush] = useState(BLANK_TAGS);
  const [painted, setPainted] = useState([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState(null);

  const load = async () => {
    try {
      const d = await api.get('/map/calibrations');
      setCalibrations(d.calibrations);
      const chosen = d.active ?? d.calibrations[0] ?? null;
      setActive(chosen);
      if (chosen) {
        setGrid({ ...chosen });
        const h = await api.get(`/map/calibrations/${chosen.id}/hexes`);
        setHexes(h.hexes);
      }
    } catch (e) {
      setError(e.message);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const hexIndex = useMemo(() => {
    const m = new Map();
    for (const h of hexes) m.set(hexKey(h.col, h.row), h);
    return m;
  }, [hexes]);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 1800);
  };

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('name', file.name.replace(/\.[^.]+$/, ''));
      await api.upload('/map/calibrations', fd);
      setFile(null);
      await load();
      refresh();
      flash('Map uploaded and web-sized derivatives generated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const useSeed = async () => {
    setBusy(true);
    setError('');
    try {
      await api.post('/map/calibrations/from-seed', {});
      await load();
      refresh();
      flash('Seeded map imported with its derivatives.');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const saveGrid = async () => {
    setError('');
    try {
      const body = {};
      for (const k of ['name', 'hexEdge', 'hexWidth', 'hexHeight', 'colSpacing', 'colOffset', 'offsetX', 'offsetY', 'rotation']) {
        body[k] = grid[k];
      }
      await api.patch(`/map/calibrations/${active.id}`, body);
      await load();
      refresh();
      flash('Calibration saved — hex coordinates are now stable across sessions.');
    } catch (e) {
      setError(e.message);
    }
  };

  const onHexClick = (hx) => {
    if (mode === 'paint') {
      setPainted((prev) =>
        prev.some((p) => p.col === hx.col && p.row === hx.row) ? prev : [...prev, hx],
      );
      return;
    }
    setSelected(hx);
    const existing = hexIndex.get(hexKey(hx.col, hx.row));
    setTags(existing ? { ...BLANK_TAGS, ...existing } : { ...BLANK_TAGS });
  };

  const saveHex = async () => {
    if (!selected) return;
    try {
      const d = await api.put(`/map/calibrations/${active.id}/hexes/${selected.col}/${selected.row}`, tags);
      setHexes((prev) => [
        ...prev.filter((h) => !(h.col === selected.col && h.row === selected.row)),
        d.hex,
      ]);
      flash(`Hex (${selected.col},${selected.row}) tagged.`);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const clearHex = async () => {
    if (!selected) return;
    await api.del(`/map/calibrations/${active.id}/hexes/${selected.col}/${selected.row}`);
    setHexes((prev) => prev.filter((h) => !(h.col === selected.col && h.row === selected.row)));
    setTags({ ...BLANK_TAGS });
    refresh();
  };

  const applyBrush = async () => {
    if (!painted.length) return;
    try {
      const d = await api.post(`/map/calibrations/${active.id}/hexes/bulk`, {
        hexes: painted.map((p) => ({ ...p, ...brush })),
      });
      const keys = new Set(d.hexes.map((h) => hexKey(h.col, h.row)));
      setHexes((prev) => [...prev.filter((h) => !keys.has(hexKey(h.col, h.row))), ...d.hexes]);
      flash(`Tagged ${d.hexes.length} hexes.`);
      setPainted([]);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1>Map Calibration</h1>
        <span className="pill">GM only · one-time setup</span>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      {status ? <div className="info-box">{status}</div> : null}

      <div className="panel">
        <h2>Map image</h2>
        <div className="row">
          <input type="file" accept="image/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          <button className="primary" onClick={upload} disabled={!file || busy}>
            {busy ? 'Processing…' : 'Upload & build derivatives'}
          </button>
          <button onClick={useSeed} disabled={busy}>
            Use seeded map (uploads/seed)
          </button>
          {calibrations.length > 1 ? (
            <select
              value={active?.id ?? ''}
              onChange={async (e) => {
                await api.post(`/map/calibrations/${e.target.value}/activate`);
                await load();
                refresh();
              }}
            >
              {calibrations.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        {active ? (
          <p className="small muted" style={{ marginBottom: 0 }}>
            <strong>{active.name}</strong> — original {active.originalWidth}×{active.originalHeight}px (kept
            on disk for reference, never served). Web tiers:{' '}
            {(active.tiers ?? [])
              .map((t) => `${t.name} ${t.width}px / ${(t.bytes / 1024 / 1024).toFixed(2)}MB`)
              .join(' · ') || 'none yet'}
            .
          </p>
        ) : (
          <p className="small muted" style={{ marginBottom: 0 }}>
            No map yet. Run <span className="mono">npm run seed:map</span> to drop northlands22.png into
            uploads/seed, then click "Use seeded map".
          </p>
        )}
      </div>

      {active && grid ? (
        <div className="map-shell">
          <div style={{ flex: '1 1 520px', minWidth: 320 }}>
            <div className="row" style={{ marginBottom: 8 }}>
              <SelectField
                label=""
                value={tier}
                onChange={setTier}
                options={(active.tiers ?? []).map((t) => ({ value: t.name, label: `${t.name} (${t.width}px)` }))}
              />
              <label className="field" style={{ width: 160 }}>
                <span>Zoom {zoom.toFixed(2)}×</span>
                <input type="range" min="0.4" max="2.5" step="0.05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} />
              </label>
              <CheckField label="grid" checked={showGrid} onChange={setShowGrid} />
              <SelectField
                label="Click mode"
                value={mode}
                onChange={(v) => {
                  setMode(v);
                  setPainted([]);
                }}
                options={[
                  { value: 'select', label: 'Select one hex' },
                  { value: 'paint', label: 'Paint many (drag)' },
                ]}
              />
            </div>
            <HexMap
              calibration={grid}
              hexes={hexes}
              tier={tier}
              zoom={zoom}
              showGrid={showGrid}
              selected={selected}
              route={mode === 'paint' ? painted : []}
              onHexClick={onHexClick}
              paintable={mode === 'paint'}
            />
            <div className="legend" style={{ marginTop: 8 }}>
              <span>
                <i style={{ background: 'rgba(95,127,158,0.6)' }} />
                Border Land
              </span>
              <span>
                <i style={{ background: 'rgba(111,154,91,0.6)' }} />
                Wild Land
              </span>
              <span>
                <i style={{ background: 'rgba(138,107,156,0.7)' }} />
                Dark Land
              </span>
              <span>diagonal hatch = hard terrain</span>
              <span>gold line = road</span>
              <span>red outline ☠n = perilous area (peril n)</span>
            </div>
          </div>

          <div className="map-side">
            <div className="panel">
              <h2>Hex grid</h2>
              <p className="small muted">
                Seeded with the measured values for northlands22.png (flat-top, offset columns). True
                them up against landmarks you recognise, then save.
              </p>
              {SLIDERS.map((s) => (
                <div className="slider-row" key={s.key}>
                  <span className="muted">{s.label}</span>
                  <input
                    type="range"
                    min={s.min}
                    max={s.max}
                    step={s.step}
                    value={grid[s.key]}
                    onChange={(e) => setGrid({ ...grid, [s.key]: Number(e.target.value) })}
                  />
                  <input
                    type="number"
                    step={s.step}
                    value={grid[s.key]}
                    onChange={(e) => setGrid({ ...grid, [s.key]: Number(e.target.value) })}
                  />
                </div>
              ))}
              <div className="row" style={{ marginTop: 10 }}>
                <button className="primary" onClick={saveGrid}>
                  Save calibration
                </button>
                <button onClick={() => setGrid({ ...grid, ...DEFAULT_CALIBRATION })}>Reset to spec defaults</button>
              </div>
              <p className="small muted" style={{ marginBottom: 0 }}>
                Regular flat-top geometry would be width = 2 × edge ({(grid.hexEdge * 2).toFixed(1)}), height =
                √3 × edge ({(Math.sqrt(3) * grid.hexEdge).toFixed(1)}), column gap = 1.5 × edge (
                {(grid.hexEdge * 1.5).toFixed(1)}).
              </p>
            </div>

            {mode === 'select' ? (
              <div className="panel">
                <h2>Tag hex {selected ? `(${selected.col},${selected.row})` : ''}</h2>
                {!selected ? (
                  <p className="muted small">Click a hex on the map.</p>
                ) : (
                  <>
                    <SelectField
                      label="Region type"
                      value={tags.regionType}
                      onChange={(v) => setTags({ ...tags, regionType: v })}
                      options={REGION_TYPES.map((r) => ({ value: r.key, label: `${r.label} (${r.featMode} Feat Die)` }))}
                    />
                    <div className="row" style={{ marginBottom: 8 }}>
                      <CheckField label="Hard terrain" checked={tags.hardTerrain} onChange={(v) => setTags({ ...tags, hardTerrain: v })} />
                      <CheckField label="Road" checked={tags.road} onChange={(v) => setTags({ ...tags, road: v })} />
                      <CheckField label="Perilous area" checked={tags.perilous} onChange={(v) => setTags({ ...tags, perilous: v })} />
                    </div>
                    {tags.perilous ? (
                      <NumField label="Peril rating (events to face)" value={tags.perilRating} onChange={(v) => setTags({ ...tags, perilRating: v })} min={0} />
                    ) : null}
                    <TextField label="Label" value={tags.label} onChange={(v) => setTags({ ...tags, label: v })} />
                    <div className="row">
                      <button className="primary" onClick={saveHex}>
                        Save hex
                      </button>
                      <button className="danger" onClick={clearHex}>
                        Clear tags
                      </button>
                    </div>
                    <p className="small muted" style={{ marginBottom: 0 }}>
                      Hard terrain and Road are independent — a hex can be both (the East Road through
                      the Weather Hills), and their event-roll dice modifiers cancel out.
                    </p>
                  </>
                )}
              </div>
            ) : (
              <div className="panel">
                <h2>Brush ({painted.length} hexes)</h2>
                <SelectField
                  label="Region type"
                  value={brush.regionType}
                  onChange={(v) => setBrush({ ...brush, regionType: v })}
                  options={REGION_TYPES.map((r) => ({ value: r.key, label: r.label }))}
                />
                <div className="row" style={{ marginBottom: 8 }}>
                  <CheckField label="Hard terrain" checked={brush.hardTerrain} onChange={(v) => setBrush({ ...brush, hardTerrain: v })} />
                  <CheckField label="Road" checked={brush.road} onChange={(v) => setBrush({ ...brush, road: v })} />
                  <CheckField label="Perilous" checked={brush.perilous} onChange={(v) => setBrush({ ...brush, perilous: v })} />
                </div>
                {brush.perilous ? (
                  <NumField label="Peril rating" value={brush.perilRating} onChange={(v) => setBrush({ ...brush, perilRating: v })} min={0} />
                ) : null}
                <div className="row">
                  <button className="primary" onClick={applyBrush} disabled={!painted.length}>
                    Apply to {painted.length} hexes
                  </button>
                  <button onClick={() => setPainted([])}>Clear selection</button>
                </div>
              </div>
            )}

            <div className="panel">
              <h3>Tagged hexes</h3>
              <p className="small muted" style={{ marginBottom: 0 }}>
                {hexes.length} tagged ·{' '}
                {hexes.filter((h) => h.hardTerrain).length} hard terrain ·{' '}
                {hexes.filter((h) => h.road).length} road ·{' '}
                {hexes.filter((h) => h.perilous).length} perilous
              </p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

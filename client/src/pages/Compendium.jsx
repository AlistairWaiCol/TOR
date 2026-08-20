import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ADVERSARY_CATEGORIES,
  ADVERSARY_SIZES,
  ITEM_KINDS,
  STANDARDS_OF_LIVING,
  emptyAdversary,
  emptyCatalogueItem,
  emptyCombatProficiency,
  emptyFellAbility,
  emptyLocation,
  hateResolveLabel,
  misdeedReminder,
  normaliseYears,
} from '@shared/compendium.js';
import { CULTURAL_VIRTUE_CULTURES } from '@shared/culturalVirtues.js';
import { PROFICIENCY_GROUPS } from '@shared/character.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { AreaField, NumField, SelectField, TextField } from '../components/Fields.jsx';
import Toast from '../components/Toast.jsx';

/**
 * The campaign's shared reference shelf. Sections come from
 * shared/compendium.js, so adding NPCs or a Bestiary later is a section entry
 * plus one more render branch — the switcher, loading and CRUD are generic.
 *
 * Edits save on blur, the same as the Journey Log's notes.
 */
export default function Compendium() {
  const { isGM, refresh } = useApp();
  const [section, setSection] = useState('virtues');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      setData(await api.get('/compendium'));
    } catch (e) {
      setError(e.message);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 1500);
  };

  /** Optimistic local edit; the row is PATCHed when the field loses focus. */
  const editLocal = (id, patch) =>
    setData((d) => ({
      ...d,
      [section]: d[section].map((e) => (e.id === id ? { ...e, ...patch } : e)),
    }));

  const saveEntry = async (entry, patch) => {
    setError('');
    try {
      await api.patch(`/compendium/${section}/${entry.id}`, patch);
      flash('Saved.');
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const addEntry = async (body) => {
    setError('');
    try {
      const d = await api.post(`/compendium/${section}`, body);
      setData((prev) => ({ ...prev, [section]: [...prev[section], d.entry] }));
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const removeEntry = async (entry) => {
    if (!window.confirm(`Delete "${entry.name || 'this entry'}" from the Compendium?`)) return;
    setError('');
    try {
      await api.del(`/compendium/${section}/${entry.id}`);
      setData((prev) => ({ ...prev, [section]: prev[section].filter((e) => e.id !== entry.id) }));
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  const entries = useMemo(() => {
    const list = data?.[section] ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) => JSON.stringify(e).toLowerCase().includes(q));
  }, [data, section, filter]);

  if (error && !data) return <div className="error-box">{error}</div>;
  if (!data) return <p className="muted">Loading the Compendium…</p>;

  // Server-filtered, not the static shared list: a player's response never
  // includes 'adversaries' at all — full stat blocks are GM-only.
  const sections = data.sections ?? [];
  const current = sections.find((s) => s.key === section) ?? sections[0];

  return (
    <>
      <div className="page-head">
        <h1>Compendium</h1>
        <span className="pill">
          {(data[section] ?? []).length} {(current?.label ?? '').toLowerCase()}
        </span>
      </div>

      <div className="row" style={{ marginBottom: 12 }}>
        {sections.map((s) => (
          <button
            key={s.key}
            className={section === s.key ? 'primary' : ''}
            onClick={() => {
              setSection(s.key);
              setFilter('');
            }}
          >
            {s.label}
          </button>
        ))}
        <div className="spacer" />
        <div style={{ width: 200 }}>
          <TextField label="" value={filter} onChange={setFilter} placeholder="filter…" />
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      <Toast message={status} />

      {section === 'virtues' ? (
        <VirtuesPanel
          entries={entries}
          editLocal={editLocal}
          saveEntry={saveEntry}
          addEntry={addEntry}
          removeEntry={removeEntry}
        />
      ) : null}

      {section === 'culturalVirtues' ? (
        <CulturalVirtuesPanel
          entries={entries}
          editLocal={editLocal}
          saveEntry={saveEntry}
          addEntry={addEntry}
          removeEntry={removeEntry}
        />
      ) : null}

      {section === 'rewards' ? (
        <RewardsPanel
          entries={entries}
          editLocal={editLocal}
          saveEntry={saveEntry}
          addEntry={addEntry}
          removeEntry={removeEntry}
        />
      ) : null}

      {section === 'items' ? (
        <ItemsPanel
          entries={entries}
          editLocal={editLocal}
          saveEntry={saveEntry}
          addEntry={addEntry}
          removeEntry={removeEntry}
        />
      ) : null}

      {section === 'locations' ? (
        <LocationsPanel
          entries={entries}
          editLocal={editLocal}
          saveEntry={saveEntry}
          addEntry={addEntry}
          removeEntry={removeEntry}
        />
      ) : null}

      {section === 'adversaries' ? (
        <AdversariesPanel
          entries={entries}
          editLocal={editLocal}
          saveEntry={saveEntry}
          addEntry={addEntry}
          removeEntry={removeEntry}
          isGM={isGM}
        />
      ) : null}
    </>
  );
}

function SourcePill({ entry }) {
  return entry.source === 'core' ? (
    <span className="pill gold" title="Seeded from the core rulebook">
      core
    </span>
  ) : (
    <span className="pill">home-brew</span>
  );
}

function DeleteButton({ entry, removeEntry }) {
  return (
    <button className="small danger" onClick={() => removeEntry(entry)} title="Delete">
      ×
    </button>
  );
}

/* ---------------- General Virtues ---------------- */

function VirtuesPanel({ entries, editLocal, saveEntry, addEntry, removeEntry }) {
  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>General Virtues</h2>
        <button className="small" onClick={() => addEntry({ name: 'New Virtue', effect: '' })}>
          + virtue
        </button>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 150 }}>Name</th>
              <th>Effect</th>
              <th style={{ width: 90 }} />
              <th />
            </tr>
          </thead>
          <tbody>
            {entries.map((v) => (
              <tr key={v.id}>
                <td>
                  <input
                    value={v.name}
                    onChange={(e) => editLocal(v.id, { name: e.target.value })}
                    onBlur={() => saveEntry(v, { name: v.name })}
                  />
                </td>
                <td>
                  <textarea
                    rows={2}
                    value={v.effect}
                    onChange={(e) => editLocal(v.id, { effect: e.target.value })}
                    onBlur={() => saveEntry(v, { effect: v.effect })}
                  />
                </td>
                <td>
                  <SourcePill entry={v} />
                </td>
                <td>
                  <DeleteButton entry={v} removeEntry={removeEntry} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        The six core Virtues any hero may take, whatever their culture, seeded on first run. Effects
        are summarised in the same terse style as the Reward qualities — check the wording against
        your rulebook before leaning on it. Culture-specific Virtues live in{' '}
        <strong>Cultural Virtues</strong>.
      </p>
    </div>
  );
}

/* ---------------- Cultural Virtues ---------------- */

/**
 * Grouped by Culture rather than listed flat: at the table you look these up
 * by "what can a Woodman take?", never alphabetically across all ten cultures.
 * Several Virtue names appear under more than one culture, so the culture is
 * part of an entry's identity, not a tag on it.
 */
function CulturalVirtuesPanel({ entries, editLocal, saveEntry, addEntry, removeEntry }) {
  const groups = useMemo(() => {
    const byCulture = new Map();
    for (const v of entries) {
      const key = v.culture || '(no culture)';
      if (!byCulture.has(key)) byCulture.set(key, []);
      byCulture.get(key).push(v);
    }
    return [...byCulture.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [entries]);

  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Cultural Virtues</h2>
        <button
          className="small"
          onClick={() =>
            addEntry({ name: 'New Cultural Virtue', description: '', culture: '' })
          }
        >
          + cultural virtue
        </button>
      </div>

      {groups.length === 0 ? (
        <p className="small muted">No Cultural Virtues yet.</p>
      ) : (
        groups.map(([culture, list]) => (
          <div key={culture} style={{ marginBottom: 14 }}>
            <h3 style={{ marginBottom: 6 }}>
              {culture} <span className="pill">{list.length}</span>
            </h3>
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th style={{ minWidth: 150 }}>Name</th>
                    <th>Description</th>
                    <th style={{ minWidth: 150 }}>Culture</th>
                    <th style={{ width: 90 }} />
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {list.map((v) => (
                    <tr key={v.id}>
                      <td>
                        <input
                          value={v.name}
                          onChange={(e) => editLocal(v.id, { name: e.target.value })}
                          onBlur={() => saveEntry(v, { name: v.name })}
                          style={{ minWidth: 150 }}
                        />
                      </td>
                      <td>
                        <textarea
                          rows={3}
                          value={v.description}
                          onChange={(e) => editLocal(v.id, { description: e.target.value })}
                          onBlur={() => saveEntry(v, { description: v.description })}
                          style={{ minWidth: 320 }}
                        />
                      </td>
                      <td>
                        <input
                          list="cultural-virtue-cultures"
                          value={v.culture}
                          onChange={(e) => editLocal(v.id, { culture: e.target.value })}
                          onBlur={() => saveEntry(v, { culture: v.culture })}
                          style={{ minWidth: 150 }}
                        />
                      </td>
                      <td>
                        <SourcePill entry={v} />
                      </td>
                      <td>
                        <DeleteButton entry={v} removeEntry={removeEntry} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}

      {/* Free text with suggestions, so a home-brew culture is still typeable. */}
      <datalist id="cultural-virtue-cultures">
        {CULTURAL_VIRTUE_CULTURES.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>

      <p className="small muted" style={{ marginBottom: 0 }}>
        Descriptions here are transcribed rather than summarised — a Cultural Virtue's wording
        usually carries the whole rule. The Culture field is free text so a home-brew culture works,
        and it is what the character sheet matches against a hero's own Culture.
      </p>
    </div>
  );
}

/* ---------------- Rewards ---------------- */

function RewardsPanel({ entries, editLocal, saveEntry, addEntry, removeEntry }) {
  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Rewards</h2>
        <button className="small" onClick={() => addEntry({ name: 'New Reward', summary: '' })}>
          + reward
        </button>
      </div>
      {entries.map((r) => (
        <div key={r.id} style={{ padding: '10px 0', borderBottom: '1px solid #2c261e' }}>
          <div className="row">
            <div style={{ flex: '1 1 180px' }}>
              <TextField
                label="Name"
                value={r.name}
                onChange={(v) => editLocal(r.id, { name: v })}
                onBlur={() => saveEntry(r, { name: r.name })}
              />
            </div>
            <div style={{ width: 70 }}>
              <TextField
                label="Code"
                value={r.code}
                onChange={(v) => editLocal(r.id, { code: v })}
                onBlur={() => saveEntry(r, { code: r.code })}
              />
            </div>
            <div style={{ flex: '2 1 240px' }}>
              <TextField
                label="Summary"
                value={r.summary}
                onChange={(v) => editLocal(r.id, { summary: v })}
                onBlur={() => saveEntry(r, { summary: r.summary })}
              />
            </div>
            <SourcePill entry={r} />
            <DeleteButton entry={r} removeEntry={removeEntry} />
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            <span className="small muted">applies to</span>
            {(r.appliesTo ?? []).map((a) => (
              <span className="pill" key={a}>
                {a}
              </span>
            ))}
          </div>
          {(r.tiers ?? []).length ? (
            <ul className="small muted" style={{ margin: '6px 0 0 18px' }}>
              {r.tiers.map((t) => (
                <li key={t.value}>{t.label}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Tiers (including the enhanced, culture-specific ones) are seeded straight from the same
        quality tables the character sheet's F / G / K / CF / CM / RI dropdowns use, so the two can
        never drift apart.
      </p>
    </div>
  );
}

/* ---------------- Weapons & Armour ---------------- */

const ITEM_COLUMNS = {
  weapon: ['type', 'proficiency', 'damage', 'injury', 'injuryTwoHanded', 'load', 'minStandard'],
  // `type` on armour (Leather armour / Mail armour / Headgear) is a Compendium
  // grouping field only — the sheet's armour rows have no such column and
  // catalogueItemToArmour() deliberately does not copy it across.
  armour: ['type', 'protection', 'load', 'minStandard'],
  shield: ['parry', 'load', 'minStandard'],
};

const ITEM_COLUMN_LABELS = {
  type: 'Type',
  proficiency: 'Proficiency',
  damage: 'Damage',
  injury: 'Injury',
  injuryTwoHanded: 'Injury (2h)',
  protection: 'Protection',
  parry: 'Parry',
  load: 'Load',
  minStandard: 'Min. Standard of Living',
};

const ITEM_COLUMN_TITLES = {
  injuryTwoHanded:
    'Second Injury rating for weapons usable in either grip (Long Sword, Spear, Long-hafted Axe). 0 = one Injury rating, like every other weapon.',
  minStandard:
    'A soft hint only. The character sheet notes it when a hero picks the item below their Standard of Living, and equips it anyway.',
  protection: 'Plain number behind the rulebook\'s "1d" notation. A Helm\'s 1 simply adds as another equipped row.',
};

function ItemsPanel({ entries, editLocal, saveEntry, addEntry, removeEntry }) {
  const [kind, setKind] = useState('weapon');
  const shown = entries.filter((e) => e.kind === kind);
  const columns = ITEM_COLUMNS[kind];

  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Weapons &amp; Armour</h2>
        <div className="row">
          <SelectField
            label=""
            value={kind}
            onChange={setKind}
            options={ITEM_KINDS.map((k) => ({ value: k, label: `${k}s` }))}
          />
          <button className="small" onClick={() => addEntry({ ...emptyCatalogueItem(kind), name: `New ${kind}` })}>
            + {kind}
          </button>
        </div>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th style={{ minWidth: 130 }}>Name</th>
              {columns.map((c) => (
                <th key={c} title={ITEM_COLUMN_TITLES[c]}>
                  {ITEM_COLUMN_LABELS[c] ?? c}
                </th>
              ))}
              <th>Notes</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {shown.map((item) => (
              <tr key={item.id}>
                <td>
                  <input
                    value={item.name}
                    onChange={(e) => editLocal(item.id, { name: e.target.value })}
                    onBlur={() => saveEntry(item, { name: item.name })}
                    style={{ minWidth: 130 }}
                  />
                </td>
                {columns.map((c) =>
                  c === 'proficiency' ? (
                    <td key={c}>
                      <select
                        value={item.proficiency}
                        onChange={(e) => {
                          editLocal(item.id, { proficiency: e.target.value });
                          saveEntry(item, { proficiency: e.target.value });
                        }}
                      >
                        <option value="">—</option>
                        {PROFICIENCY_GROUPS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : c === 'minStandard' ? (
                    <td key={c}>
                      <select
                        value={item.minStandard ?? ''}
                        onChange={(e) => {
                          editLocal(item.id, { minStandard: e.target.value });
                          saveEntry(item, { minStandard: e.target.value });
                        }}
                      >
                        <option value="">— none —</option>
                        {STANDARDS_OF_LIVING.map((s) => (
                          <option key={s} value={s}>
                            {s}
                          </option>
                        ))}
                      </select>
                    </td>
                  ) : c === 'type' ? (
                    <td key={c}>
                      <input
                        value={item.type}
                        onChange={(e) => editLocal(item.id, { type: e.target.value })}
                        onBlur={() => saveEntry(item, { type: item.type })}
                        style={{ minWidth: 96 }}
                      />
                    </td>
                  ) : (
                    <td key={c}>
                      <input
                        type="number"
                        value={item[c] ?? 0}
                        title={ITEM_COLUMN_TITLES[c]}
                        onChange={(e) => editLocal(item.id, { [c]: Number(e.target.value) })}
                        onBlur={() => saveEntry(item, { [c]: item[c] })}
                        style={{ width: 62 }}
                      />
                    </td>
                  ),
                )}
                <td>
                  <input
                    value={item.notes}
                    onChange={(e) => editLocal(item.id, { notes: e.target.value })}
                    onBlur={() => saveEntry(item, { notes: item.notes })}
                    style={{ minWidth: 130 }}
                  />
                </td>
                <td>
                  <DeleteButton entry={item} removeEntry={removeEntry} />
                </td>
              </tr>
            ))}
            {shown.length === 0 ? (
              <tr>
                <td colSpan={columns.length + 3} className="small muted">
                  No {kind}s catalogued yet.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="small muted" style={{ marginBottom: 0 }}>
        Columns match the character sheet's own tables. A sheet can add any of these with its
        "from catalogue" picker, and still add a blank row for home-brew gear. Reward qualities are
        picked per hero on the sheet, not stored on the catalogue entry.{' '}
        {kind === 'weapon'
          ? 'Injury (2h) is only set for the three weapons with an Injury rating per grip — Damage never changes with the grip.'
          : null}
        {kind === 'armour'
          ? 'Type groups armour here only; the sheet\'s armour rows have no Type column. A Helm\'s Protection is simply another equipped row, which the sheet already sums.'
          : null}{' '}
        Minimum Standard of Living is a hint on the sheet's picker, never a restriction.
      </p>
    </div>
  );
}

/* ---------------- Locations ---------------- */

function LocationsPanel({ entries, editLocal, saveEntry, addEntry, removeEntry }) {
  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Locations</h2>
        <button className="small" onClick={() => addEntry({ ...emptyLocation(), name: 'New Location' })}>
          + location
        </button>
      </div>
      {entries.map((loc) => (
        <div key={loc.id} style={{ padding: '10px 0', borderBottom: '1px solid #2c261e' }} id={`location-${loc.id}`}>
          <div className="row">
            <div style={{ flex: '1 1 200px' }}>
              <TextField
                label="Name"
                value={loc.name}
                onChange={(v) => editLocal(loc.id, { name: v })}
                onBlur={() => saveEntry(loc, { name: loc.name })}
              />
            </div>
            <div style={{ flex: '1 1 220px' }}>
              <TextField
                label="Years visited (comma separated)"
                value={(loc.years ?? []).join(', ')}
                placeholder="2946, 2947"
                onChange={(v) => editLocal(loc.id, { years: v.split(',').map((s) => s.trimStart()) })}
                onBlur={() => saveEntry(loc, { years: normaliseYears(loc.years) })}
              />
            </div>
            <DeleteButton entry={loc} removeEntry={removeEntry} />
          </div>
          <div className="row" style={{ marginTop: 4 }}>
            {normaliseYears(loc.years).map((y) => (
              <span className="pill gold" key={y}>
                {y}
              </span>
            ))}
          </div>
          <AreaField
            label="Key information"
            rows={3}
            value={loc.keyInfo}
            onChange={(v) => editLocal(loc.id, { keyInfo: v })}
          />
          <button className="small" onClick={() => saveEntry(loc, { keyInfo: loc.keyInfo })}>
            Save key information
          </button>
        </div>
      ))}
      {entries.length === 0 ? <p className="small muted">No locations yet.</p> : null}
      <p className="small muted" style={{ marginTop: 10, marginBottom: 0 }}>
        Map hexes link to these on the Map Calibration screen — a linked hex shows the Location's
        name on the live map and links back here.
      </p>
    </div>
  );
}

/* ---------------- Adversaries ---------------- */

/**
 * Announce a Fell Ability to Discord — same plumbing the journey engine
 * already uses, fired from here rather than mid-fight on the Combat Tracker
 * so the GM can narrate an ability the moment it matters, not just when a
 * combatant instance happens to have it. Formatted "[Source] - [Ability] -
 * [Text]" so the channel knows which adversary it came from.
 */
async function announceFellAbility(sourceName, ability) {
  await api.post('/combat/fell-ability-announce', {
    sourceName,
    name: ability.name || 'Fell Ability',
    description: ability.description || '',
  });
}

function AdversariesPanel({ entries, editLocal, saveEntry, addEntry, removeEntry, isGM }) {
  const groups = useMemo(() => {
    const byCategory = new Map();
    for (const adv of entries) {
      const key = ADVERSARY_CATEGORIES.includes(adv.category) ? adv.category : 'Other';
      if (!byCategory.has(key)) byCategory.set(key, []);
      byCategory.get(key).push(adv);
    }
    // Fixed category order, only the ones actually holding entries.
    return ADVERSARY_CATEGORIES.filter((c) => byCategory.has(c)).map((c) => [c, byCategory.get(c)]);
  }, [entries]);

  return (
    <div className="panel">
      <div className="page-head" style={{ marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Adversaries</h2>
        <button className="small" onClick={() => addEntry({ ...emptyAdversary(), name: 'New Adversary' })}>
          + adversary
        </button>
      </div>
      <p className="small muted">
        Reusable stat-block templates for the Combat Tracker — adding one to a fight makes an
        independent copy, so nothing here changes mid-battle. NPCs that will never fight can leave
        the combat fields blank or zero.
      </p>

      {groups.length === 0 ? <p className="small muted">No adversaries catalogued yet.</p> : null}
      {groups.map(([category, list]) => (
        <details key={category} className="category-group">
          <summary>
            {category} <span className="pill">{list.length}</span>
          </summary>
          <div className="category-body">
            {list.map((adv) => (
              <AdversaryCard
                key={adv.id}
                adv={adv}
                editLocal={editLocal}
                saveEntry={saveEntry}
                removeEntry={removeEntry}
                isGM={isGM}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

function AdversaryCard({ adv, editLocal, saveEntry, removeEntry, isGM }) {
  const setProficiencies = (entry, next) => {
    editLocal(entry.id, { combatProficiencies: next });
    saveEntry(entry, { combatProficiencies: next });
  };
  const setFellAbilities = (entry, next) => {
    editLocal(entry.id, { fellAbilities: next });
    saveEntry(entry, { fellAbilities: next });
  };

  const label = hateResolveLabel(adv.category);
  const reminder = misdeedReminder(adv.category);
  const proficiencies = adv.combatProficiencies ?? [];
  const fellAbilities = adv.fellAbilities ?? [];
  return (
    <div style={{ padding: '12px 0', borderBottom: '1px solid #2c261e' }}>
            <div className="row">
              <div style={{ flex: '2 1 200px' }}>
                <TextField
                  label="Name"
                  value={adv.name}
                  onChange={(v) => editLocal(adv.id, { name: v })}
                  onBlur={() => saveEntry(adv, { name: adv.name })}
                />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <SelectField
                  label="Category"
                  value={adv.category}
                  onChange={(v) => {
                    editLocal(adv.id, { category: v });
                    saveEntry(adv, { category: v });
                  }}
                  options={ADVERSARY_CATEGORIES}
                />
              </div>
              <div style={{ flex: '1 1 140px' }}>
                <SelectField
                  label="Size"
                  value={adv.size}
                  onChange={(v) => {
                    editLocal(adv.id, { size: v });
                    saveEntry(adv, { size: v });
                  }}
                  options={ADVERSARY_SIZES}
                />
              </div>
              <SourcePill entry={adv} />
              <DeleteButton entry={adv} removeEntry={removeEntry} />
            </div>

            <AreaField
              label="Distinctive Features"
              rows={2}
              value={adv.distinctiveFeatures}
              onChange={(v) => editLocal(adv.id, { distinctiveFeatures: v })}
            />
            <button
              className="small"
              onClick={() => saveEntry(adv, { distinctiveFeatures: adv.distinctiveFeatures })}
            >
              Save Distinctive Features
            </button>

            <div className="grid g4" style={{ marginTop: 8 }}>
              <NumField
                label="Attribute Level"
                value={adv.attributeLevel}
                onChange={(v) => editLocal(adv.id, { attributeLevel: v })}
                onBlur={() => saveEntry(adv, { attributeLevel: adv.attributeLevel })}
              />
              <NumField
                label="Endurance"
                value={adv.endurance}
                onChange={(v) => editLocal(adv.id, { endurance: v })}
                onBlur={() => saveEntry(adv, { endurance: adv.endurance })}
              />
              <NumField
                label="Might"
                value={adv.might}
                onChange={(v) => editLocal(adv.id, { might: v })}
                onBlur={() => saveEntry(adv, { might: adv.might })}
              />
              <NumField
                label={label}
                title="Hate (minions of the Enemy, fight to the death) or Resolve (non-monstrous, may yield or flee) — labelled from Category."
                value={adv.hateResolve}
                onChange={(v) => editLocal(adv.id, { hateResolve: v })}
                onBlur={() => saveEntry(adv, { hateResolve: adv.hateResolve })}
              />
              <NumField
                label="Parry"
                value={adv.parry}
                onChange={(v) => editLocal(adv.id, { parry: v })}
                onBlur={() => saveEntry(adv, { parry: adv.parry })}
              />
              <NumField
                label="Armour"
                value={adv.armour}
                onChange={(v) => editLocal(adv.id, { armour: v })}
                onBlur={() => saveEntry(adv, { armour: adv.armour })}
              />
            </div>
            {reminder ? <p className="small muted">{reminder}</p> : null}

            {/* ---- Combat Proficiencies ---- */}
            <div style={{ marginTop: 10 }}>
              <div className="row" style={{ marginBottom: 4 }}>
                <strong className="small">Combat Proficiencies</strong>
                <button
                  className="small"
                  onClick={() => setProficiencies(adv, [...proficiencies, emptyCombatProficiency()])}
                >
                  + proficiency
                </button>
              </div>
              {proficiencies.length ? (
                <div className="table-scroll">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 120 }}>Name</th>
                        <th>Rating</th>
                        <th>Damage</th>
                        <th>Injury</th>
                        <th>Special Damage options</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {proficiencies.map((p, i) => (
                        <tr key={i}>
                          <td>
                            <input
                              value={p.name}
                              onChange={(e) => {
                                const next = proficiencies.slice();
                                next[i] = { ...p, name: e.target.value };
                                editLocal(adv.id, { combatProficiencies: next });
                              }}
                              onBlur={() => setProficiencies(adv, adv.combatProficiencies)}
                              style={{ minWidth: 120 }}
                            />
                          </td>
                          {['rating', 'damage', 'injury'].map((f) => (
                            <td key={f}>
                              <input
                                type="number"
                                value={p[f] ?? 0}
                                onChange={(e) => {
                                  const next = proficiencies.slice();
                                  next[i] = { ...p, [f]: Number(e.target.value) || 0 };
                                  editLocal(adv.id, { combatProficiencies: next });
                                }}
                                onBlur={() => setProficiencies(adv, adv.combatProficiencies)}
                                style={{ width: 56 }}
                              />
                            </td>
                          ))}
                          <td>
                            <input
                              value={p.special}
                              placeholder="e.g. Break Shield, Seize"
                              onChange={(e) => {
                                const next = proficiencies.slice();
                                next[i] = { ...p, special: e.target.value };
                                editLocal(adv.id, { combatProficiencies: next });
                              }}
                              onBlur={() => setProficiencies(adv, adv.combatProficiencies)}
                              style={{ minWidth: 160 }}
                            />
                          </td>
                          <td>
                            <button
                              className="small danger"
                              title="Remove"
                              onClick={() => setProficiencies(adv, proficiencies.filter((_, j) => j !== i))}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="small muted">No Combat Proficiencies yet.</p>
              )}
            </div>

            {/* ---- Fell Abilities ---- */}
            <div style={{ marginTop: 10 }}>
              <div className="row" style={{ marginBottom: 4 }}>
                <strong className="small">Fell Abilities</strong>
                <button className="small" onClick={() => setFellAbilities(adv, [...fellAbilities, emptyFellAbility()])}>
                  + fell ability
                </button>
              </div>
              {fellAbilities.length ? (
                fellAbilities.map((fa, i) => (
                  <div key={i} className="row" style={{ marginBottom: 6, alignItems: 'flex-start' }}>
                    <div style={{ flex: '1 1 160px' }}>
                      <input
                        value={fa.name}
                        placeholder="Name"
                        onChange={(e) => {
                          const next = fellAbilities.slice();
                          next[i] = { ...fa, name: e.target.value };
                          editLocal(adv.id, { fellAbilities: next });
                        }}
                        onBlur={() => setFellAbilities(adv, adv.fellAbilities)}
                      />
                    </div>
                    <div style={{ flex: '2 1 260px' }}>
                      <input
                        value={fa.description}
                        placeholder="Description"
                        onChange={(e) => {
                          const next = fellAbilities.slice();
                          next[i] = { ...fa, description: e.target.value };
                          editLocal(adv.id, { fellAbilities: next });
                        }}
                        onBlur={() => setFellAbilities(adv, adv.fellAbilities)}
                      />
                    </div>
                    {isGM ? (
                      <button
                        className="small"
                        title="Announce this Fell Ability to Discord"
                        onClick={() => announceFellAbility(adv.name, fa)}
                      >
                        💬
                      </button>
                    ) : null}
                    <button
                      className="small danger"
                      title="Remove"
                      onClick={() => setFellAbilities(adv, fellAbilities.filter((_, j) => j !== i))}
                    >
                      ×
                    </button>
                  </div>
                ))
              ) : (
                <p className="small muted">No Fell Abilities yet.</p>
              )}
            </div>

            <AreaField
              label="Notes"
              rows={2}
              value={adv.notes}
              onChange={(v) => editLocal(adv.id, { notes: v })}
            />
            <button className="small" onClick={() => saveEntry(adv, { notes: adv.notes })}>
              Save Notes
            </button>
          </div>
  );
}

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ATTRIBUTES,
  PROFICIENCY_GROUPS,
  STANCES,
  computeWeary,
  effectiveLoad,
  emptyArmour,
  emptyUsefulItem,
  emptyWeapon,
  stanceAttackDice,
  stanceAttackNote,
  stanceAttackWarning,
  totalLoad,
  totalParry,
  totalProtection,
} from '@shared/character.js';
import { isCharacterTravelling } from '@shared/journey.js';
import {
  WEAPON_GRIPS,
  catalogueItemToArmour,
  catalogueItemToShield,
  catalogueItemToWeapon,
  isVersatileWeapon,
  standardOfLivingWarning,
} from '@shared/compendium.js';
import { culturalVirtuesFor } from '@shared/culturalVirtues.js';
import { computeTargetNumber } from '@shared/dice.js';
import { ARMOUR_QUALITIES, SHIELD_QUALITIES, WEAPON_QUALITIES, effectiveWeapon } from '@shared/rewards.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { useRoll } from '../components/RollDialog.jsx';
import {
  AreaField,
  CheckField,
  NumField,
  PipTrack,
  RollButton,
  SelectField,
  TextField,
} from '../components/Fields.jsx';

/**
 * A "pick one from the Compendium" dropdown that resets to its placeholder
 * after each pick. Every one of these sits next to the free-text or blank-row
 * control it supplements — catalogued entries are a convenience, never the only
 * way to put something on a sheet.
 */
function CataloguePicker({
  label,
  entries,
  onPick,
  empty = 'nothing catalogued yet',
  // Optional per-entry annotation appended to the option text, e.g. the
  // Minimum Standard of Living an item asks for, or a Virtue's culture.
  annotate,
}) {
  if (!entries.length) {
    return (
      <span className="small muted" title="Add entries on the Compendium screen">
        {label}: {empty}
      </span>
    );
  }
  return (
    <select
      value=""
      title={`${label} — adds a filled-in entry you can then edit`}
      onChange={(e) => {
        const picked = entries.find((x) => x.id === e.target.value);
        if (picked) onPick(picked);
        e.target.value = '';
      }}
    >
      <option value="">{label}</option>
      {entries.map((x) => {
        const note = annotate?.(x);
        return (
          <option key={x.id} value={x.id}>
            {x.name}
            {note ? ` — ${note}` : ''}
          </option>
        );
      })}
    </select>
  );
}

/** Option annotation for gear: the Standard of Living it normally calls for. */
function standardNote(item) {
  return item.minStandard ? `needs ${item.minStandard}` : '';
}

/**
 * A Standard-of-Living note after picking gear. Deliberately a soft warning
 * shown *after* the item has already been added — this app says so and lets
 * the table decide, the same line it takes on Rearward melee attacks and
 * mounted travel over hard terrain.
 */
function GearHint({ hint, where, onDismiss }) {
  if (!hint || hint.where !== where) return null;
  return (
    <div className="warn-box">
      {hint.text} Added anyway — Minimum Standard of Living is a character-creation guideline here,
      not a restriction.{' '}
      <button className="small" onClick={onDismiss}>
        dismiss
      </button>
    </div>
  );
}

function setIn(obj, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const clone = Array.isArray(obj) ? obj.slice() : { ...obj };
  clone[head] = setIn(obj?.[head] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value);
  return clone;
}

export default function CharacterSheet() {
  const { id } = useParams();
  const { campaign, characters, travel, journey, refresh } = useApp();
  const { openRoll } = useRoll();
  const [character, setCharacter] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  // The Compendium backs the Rewards / Virtues / gear pickers below. If it
  // fails to load the sheet still works — every picker has a manual fallback.
  const [compendium, setCompendium] = useState({
    virtues: [],
    culturalVirtues: [],
    rewards: [],
    items: [],
  });
  // Standard-of-Living hints from the gear pickers. A note, never a block.
  // Scoped to the panel the pick happened in, so it appears once, next to the
  // picker that raised it — { where: 'weapons' | 'armour', text }.
  const [gearHint, setGearHint] = useState(null);

  const tnBase = campaign?.tnBase ?? 20;

  const load = useCallback(async () => {
    try {
      const d = await api.get(`/characters/${id}`);
      setCharacter(d.character);
      setSheet(d.character.sheet);
      setDirty(false);
    } catch (e) {
      setError(e.message);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const blank = { virtues: [], culturalVirtues: [], rewards: [], items: [] };
    api
      .get('/compendium')
      .then((d) =>
        setCompendium({
          virtues: d.virtues ?? [],
          culturalVirtues: d.culturalVirtues ?? [],
          rewards: d.rewards ?? [],
          items: d.items ?? [],
        }),
      )
      .catch(() => setCompendium(blank));
  }, []);

  const update = (path, value) => {
    setSheet((s) => setIn(s, path, value));
    setDirty(true);
  };

  const save = useCallback(async () => {
    setError('');
    try {
      const d = await api.put(`/characters/${id}/sheet`, { sheet });
      setCharacter(d.character);
      setSheet(d.character.sheet);
      setDirty(false);
      setStatus('Saved.');
      setTimeout(() => setStatus(''), 1600);
      refresh();
      return d.character;
    } catch (e) {
      setError(e.message);
      throw e;
    }
  }, [id, sheet, refresh]);

  /** Pending edits are flushed before a roll so the server rolls the real sheet. */
  const rollWith = useCallback(
    async (config) => {
      if (dirty) {
        try {
          await save();
        } catch {
          return;
        }
      }
      openRoll({ ...config, onRolled: () => load() });
    },
    [dirty, save, openRoll, load],
  );

  const otherNames = useMemo(
    () => characters.filter((c) => c.id !== id).map((c) => c.name),
    [characters, id],
  );

  const catalogue = useMemo(
    () => ({
      weapons: compendium.items.filter((i) => i.kind === 'weapon'),
      armour: compendium.items.filter((i) => i.kind === 'armour'),
      shields: compendium.items.filter((i) => i.kind === 'shield'),
    }),
    [compendium.items],
  );

  /**
   * Cultural Virtues offered to this hero. `general.culture` is free text, so
   * the match is case-insensitive and falls back to the whole list (labelled by
   * culture) rather than showing an empty picker for a home-brew culture.
   */
  const culturalPicks = useMemo(() => {
    const mine = culturalVirtuesFor(sheet?.general?.culture, compendium.culturalVirtues);
    return mine.length
      ? { entries: mine, matched: true }
      : { entries: compendium.culturalVirtues, matched: false };
  }, [compendium.culturalVirtues, sheet?.general?.culture]);

  /** Append a Compendium entry's name + effect to one of the free-text boxes. */
  const appendToTextBlock = (path, current, entry) => {
    const detail = entry.effect || entry.summary || entry.description || '';
    const line = `${entry.name}${detail ? ` — ${detail}` : ''}`;
    const existing = String(current ?? '').trimEnd();
    update(path, existing ? `${existing}\n${line}` : line);
  };

  /**
   * Add a catalogued item to the sheet and, if it normally calls for a better
   * Standard of Living than this hero has, say so. It still goes on the sheet —
   * the rule is a guideline for character creation, not a lock on the gear.
   */
  const pickGear = (where, item, apply) => {
    apply(item);
    const text = standardOfLivingWarning(item, sheet?.general?.livingStandard);
    setGearHint(text ? { where, text } : null);
  };

  if (error && !sheet) return <div className="error-box">{error}</div>;
  if (!sheet) return <p className="muted">Loading sheet…</p>;

  const valour = sheet.rewards.valour;
  const protection = totalProtection(sheet);
  const parry = totalParry(sheet);
  // Load and Weary are derived on every render, never stored — equip a weapon or
  // change a quality tier and both update immediately.
  const load_ = totalLoad(sheet);
  const travelling = isCharacterTravelling({ travel, journey, characterId: id });
  const wearyLoad = effectiveLoad(sheet, { travelling });
  const weary = computeWeary(sheet, { travelling });
  const strengthTN = computeTargetNumber(sheet.attributes.strength.rating, tnBase);
  const stanceDice = stanceAttackDice(sheet);

  const conditionFlags = {
    weary,
    miserable: sheet.conditions.miserable,
    inspired: sheet.conditions.inspired,
    hope: sheet.attributes.heart.hope,
    whisperTargets: otherNames,
  };

  /**
   * Every attack roll on this sheet, from either the weapon table or the
   * proficiency list. The TN is the hero's STRENGTH TN plus the target's Parry
   * (typed into the dialog), and the Combat Stance adjusts the dice pool.
   */
  const rollAttack = ({ weapon = null, proficiency, title, label, extraNote = '' }) => {
    const group = proficiency || weapon?.proficiency || 'Swords';
    const p = sheet.combat.proficiencies[group] ?? { rating: 0, favoured: false };
    rollWith({
      title,
      characterId: id,
      skill: group,
      kind: 'attack',
      label,
      rating: p.rating,
      // Parry mode: the dialog asks for the target's Parry and adds it to this.
      parryTarget: true,
      strengthTN,
      targetParry: 0,
      extraDice: stanceDice,
      favoured: p.favoured || sheet.conditions.favourState === 'Favoured',
      illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
      bonus: sheet.combat.attackModifier,
      note:
        `TN = your STRENGTH TN (${strengthTN}) + the target's Parry. ${stanceAttackNote(sheet)}` +
        (extraNote ? ` ${extraNote}` : ''),
      warning: stanceAttackWarning(sheet, weapon ?? { proficiency: group }),
      ...conditionFlags,
    });
  };

  const rollSkill = (attrKey, skillName) => {
    const attr = sheet.attributes[attrKey];
    const entry = attr.skills[skillName];
    rollWith({
      title: `${skillName.toUpperCase()} — ${sheet.general.name || character.name}`,
      characterId: id,
      skill: skillName,
      kind: 'skill',
      label: skillName.toUpperCase(),
      rating: entry.rating,
      targetNumber: computeTargetNumber(attr.rating, tnBase),
      favoured: entry.favoured || sheet.conditions.favourState === 'Favoured',
      illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
      ...conditionFlags,
    });
  };

  return (
    <>
      <div className="page-head">
        <h1>{sheet.general.name || character.name || 'Unnamed hero'}</h1>
        <div className="row">
          <Link to="/characters" className="small">
            ← all characters
          </Link>
          {dirty ? <span className="pill bad">unsaved changes</span> : null}
          {status ? <span className="pill ok">{status}</span> : null}
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}

      {/* ---------------- General ---------------- */}
      <div className="panel">
        <h2>General</h2>
        <div className="grid g3">
          <TextField label="Name" value={sheet.general.name} onChange={(v) => update(['general', 'name'], v)} />
          <TextField label="Culture" value={sheet.general.culture} onChange={(v) => update(['general', 'culture'], v)} />
          <TextField label="Calling" value={sheet.general.calling} onChange={(v) => update(['general', 'calling'], v)} />
          <TextField
            label="Living Standard"
            value={sheet.general.livingStandard}
            onChange={(v) => update(['general', 'livingStandard'], v)}
          />
          <TextField label="Weakness" value={sheet.general.weakness} onChange={(v) => update(['general', 'weakness'], v)} />
          <TextField label="Patron" value={sheet.general.patron} onChange={(v) => update(['general', 'patron'], v)} />
          <SelectField
            label="Fellowship Focus"
            value={sheet.general.fellowshipFocus}
            onChange={(v) => update(['general', 'fellowshipFocus'], v)}
            options={[{ value: '', label: '— none —' }, ...otherNames]}
          />
          <TextField label="Age" value={sheet.general.age} onChange={(v) => update(['general', 'age'], v)} />
        </div>
        <AreaField label="Blessing" value={sheet.general.blessing} onChange={(v) => update(['general', 'blessing'], v)} rows={2} />
        <div className="grid g2">
          <AreaField
            label="Distinctive Features"
            value={sheet.general.distinctiveFeatures}
            onChange={(v) => update(['general', 'distinctiveFeatures'], v)}
          />
          <AreaField label="Flaws" value={sheet.general.flaws} onChange={(v) => update(['general', 'flaws'], v)} />
        </div>
      </div>

      {/* ---------------- Rewards / Virtues / Conditions ---------------- */}
      <div className="sheet-cols">
        <div className="panel">
          <h2>Rewards</h2>
          <div className="row">
            <CheckField
              label="Valour"
              checked={sheet.rewards.valourChecked}
              onChange={(v) => update(['rewards', 'valourChecked'], v)}
            />
            <div style={{ width: 78 }}>
              <NumField value={sheet.rewards.valour} onChange={(v) => update(['rewards', 'valour'], v)} min={0} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: 6 }}>
            <CataloguePicker
              label="+ from Compendium"
              entries={compendium.rewards}
              onPick={(r) => appendToTextBlock(['rewards', 'rewardTraits'], sheet.rewards.rewardTraits, r)}
            />
          </div>
          <AreaField
            label="Earned Reward traits (with effect)"
            value={sheet.rewards.rewardTraits}
            onChange={(v) => update(['rewards', 'rewardTraits'], v)}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Pick from the Compendium or just type — home-brew Rewards are fine. Valour also feeds the
            enhanced Close-fitting / Cunning Make tiers below.
          </p>
        </div>

        <div className="panel">
          <h2>Virtues</h2>
          <div className="row">
            <CheckField
              label="Wisdom"
              checked={sheet.virtues.wisdomChecked}
              onChange={(v) => update(['virtues', 'wisdomChecked'], v)}
            />
            <div style={{ width: 78 }}>
              <NumField value={sheet.virtues.wisdom} onChange={(v) => update(['virtues', 'wisdom'], v)} min={0} />
            </div>
          </div>
          <div className="row" style={{ marginBottom: 6 }}>
            <CataloguePicker
              label="+ general"
              entries={compendium.virtues}
              onPick={(v) => appendToTextBlock(['virtues', 'virtueList'], sheet.virtues.virtueList, v)}
            />
            <CataloguePicker
              label={culturalPicks.matched ? `+ ${sheet.general.culture}` : '+ cultural'}
              entries={culturalPicks.entries}
              empty="no Cultural Virtues catalogued"
              // When the hero's Culture matches a catalogued one the list is
              // narrowed to it; otherwise every culture is offered, labelled.
              annotate={culturalPicks.matched ? undefined : (v) => v.culture}
              onPick={(v) => appendToTextBlock(['virtues', 'virtueList'], sheet.virtues.virtueList, v)}
            />
          </div>
          <AreaField
            label="Virtues (e.g. Hardiness)"
            value={sheet.virtues.virtueList}
            onChange={(v) => update(['virtues', 'virtueList'], v)}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Pick from the Compendium or type your own. Text only — numeric effects are not
            auto-applied.{' '}
            {culturalPicks.matched
              ? `Cultural Virtues are filtered to ${sheet.general.culture}.`
              : 'Set a Culture above to filter the Cultural Virtues to it.'}
          </p>
        </div>

        <div className="panel">
          <h2>Conditions &amp; Modifiers</h2>
          <SelectField
            label="Next-roll modifier"
            value={sheet.conditions.favourState}
            onChange={(v) => update(['conditions', 'favourState'], v)}
            options={['Normal', 'Favoured', 'Ill-Favoured']}
          />
          <div className="row" style={{ marginBottom: 8 }}>
            <label
              className="check"
              title={`Computed: Endurance ${sheet.attributes.strength.endurance} ${weary ? '≤' : '>'} effective Load ${wearyLoad}. Outlined Success Dice (1-3) count as 0 while Weary.`}
            >
              <input type="checkbox" checked={weary} readOnly disabled />
              Weary
            </label>
            <CheckField
              label="Miserable"
              title="An Eye of Sauron is an automatic failure"
              checked={sheet.conditions.miserable}
              onChange={(v) => update(['conditions', 'miserable'], v)}
            />
            <CheckField
              label="Wounded"
              checked={sheet.conditions.wounded}
              onChange={(v) => update(['conditions', 'wounded'], v)}
            />
            <CheckField
              label="Inspired"
              title="Hope spend grants +2 Success Dice instead of +1"
              checked={sheet.conditions.inspired}
              onChange={(v) => update(['conditions', 'inspired'], v)}
            />
          </div>
          <p className="small muted" style={{ marginTop: 0 }}>
            Weary is computed: Endurance ({sheet.attributes.strength.endurance}) ≤ Load ({load_}
            {travelling ? ` + ${sheet.attributes.strength.fatigue} Fatigue while travelling = ${wearyLoad}` : ''}).
            Miserable and Wounded stay manual.
          </p>
          <TextField label="Injury" value={sheet.conditions.injury} onChange={(v) => update(['conditions', 'injury'], v)} />
        </div>
      </div>

      {/* ---------------- Attributes & Skills ---------------- */}
      <div className="sheet-cols">
        {ATTRIBUTES.map((attr) => {
          const a = sheet.attributes[attr.key];
          const tn = computeTargetNumber(a.rating, tnBase);
          return (
            <div className="panel" key={attr.key}>
              <h2 style={{ margin: '0 0 8px' }}>{attr.label}</h2>
              {/* Rating and Target Number are the two headline numbers of an
                  Attribute, so the TN gets a real stat box beside the Rating
                  rather than a pill tucked into the heading. */}
              <div className="pool-grid" style={{ marginBottom: 10 }}>
                <NumField label="Rating" value={a.rating} onChange={(v) => update(['attributes', attr.key, 'rating'], v)} min={0} />
                <label
                  className="field"
                  title={`Target Number = ${tnBase} − ${attr.label} rating (${a.rating}). Computed, not editable.`}
                >
                  <span>Target No.</span>
                  <input type="number" value={tn} readOnly disabled />
                </label>
              </div>

              <div className="pool-grid" style={{ marginBottom: 12 }}>
                {attr.key === 'strength' ? (
                  <>
                    <NumField label="Endurance" value={a.endurance} onChange={(v) => update(['attributes', 'strength', 'endurance'], v)} />
                    <NumField label="Max" value={a.enduranceMax} onChange={(v) => update(['attributes', 'strength', 'enduranceMax'], v)} />
                    <label
                      className="field"
                      title="Computed from equipped weapons, armour and shield (after Cunning Make) plus Treasure."
                    >
                      <span>Load</span>
                      <input type="number" value={load_} readOnly disabled />
                    </label>
                    <NumField label="Treasure" value={a.treasure} onChange={(v) => update(['attributes', 'strength', 'treasure'], v)} />
                    <NumField label="Fatigue" value={a.fatigue} onChange={(v) => update(['attributes', 'strength', 'fatigue'], v)} />
                  </>
                ) : null}
                {attr.key === 'heart' ? (
                  <>
                    <NumField label="Hope" value={a.hope} onChange={(v) => update(['attributes', 'heart', 'hope'], v)} />
                    <NumField label="Max" value={a.hopeMax} onChange={(v) => update(['attributes', 'heart', 'hopeMax'], v)} />
                    <NumField label="Shadow" value={a.shadow} onChange={(v) => update(['attributes', 'heart', 'shadow'], v)} />
                    <NumField label="Taint" value={a.taint} onChange={(v) => update(['attributes', 'heart', 'taint'], v)} />
                    <NumField label="Scars" value={a.scars} onChange={(v) => update(['attributes', 'heart', 'scars'], v)} />
                  </>
                ) : null}
                {attr.key === 'wits' ? (
                  <>
                    <NumField label="Parry base" value={a.parryBase} onChange={(v) => update(['attributes', 'wits', 'parryBase'], v)} />
                    <NumField label="Shield" value={a.parryShield} onChange={(v) => update(['attributes', 'wits', 'parryShield'], v)} />
                    <NumField label="Other" value={a.parryOther} onChange={(v) => update(['attributes', 'wits', 'parryOther'], v)} />
                    <NumField label="Stance" value={a.parryStance} onChange={(v) => update(['attributes', 'wits', 'parryStance'], v)} />
                  </>
                ) : null}
              </div>
              {attr.key === 'strength' ? (
                <p className="small">
                  <span className="pill gold">Load {load_}</span>{' '}
                  {weary ? <span className="pill bad">Weary</span> : null}{' '}
                  <span className="muted">
                    Load is computed from equipped gear (after Cunning Make) plus Treasure, and Weary
                    follows from Endurance ≤ Load
                    {travelling ? ' + Fatigue while travelling' : ''}.
                  </span>
                </p>
              ) : null}
              {attr.key === 'wits' ? (
                <p className="small">
                  <span className="pill gold">Total Parry {parry}</span>{' '}
                  <span className="muted">
                    Parry is a static value in TOR 2e (it sets the TN attackers must beat), so there is
                    no Parry roll — see Total Protection below for the roll.
                  </span>
                </p>
              ) : null}

              <h3>Skills</h3>
              {attr.skills.map((skillName) => {
                const s = a.skills[skillName];
                return (
                  <div className="skill-row" key={skillName}>
                    <input
                      type="checkbox"
                      title="Favoured"
                      checked={s.favoured}
                      onChange={(e) => update(['attributes', attr.key, 'skills', skillName, 'favoured'], e.target.checked)}
                    />
                    <RollButton title={`Roll ${skillName}`} onClick={() => rollSkill(attr.key, skillName)} />
                    <span>{skillName}</span>
                    <PipTrack
                      value={s.rating}
                      onChange={(v) => update(['attributes', attr.key, 'skills', skillName, 'rating'], v)}
                      title={`${skillName} rating`}
                    />
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>

      {/* ---------------- Experience / Mount / Useful Items ---------------- */}
      <div className="sheet-cols">
        <div className="panel">
          <h2>Experience</h2>
          <div className="pool-grid">
            <NumField label="Adventure Pts" value={sheet.experience.adventurePoints} onChange={(v) => update(['experience', 'adventurePoints'], v)} />
            <NumField label="Skill Pts" value={sheet.experience.skillPoints} onChange={(v) => update(['experience', 'skillPoints'], v)} />
            <NumField label="Fellowship" value={sheet.experience.fellowship} onChange={(v) => update(['experience', 'fellowship'], v)} />
            <NumField label="Adventure Total" value={sheet.experience.adventureTotal} onChange={(v) => update(['experience', 'adventureTotal'], v)} />
            <NumField label="Skill Total" value={sheet.experience.skillTotal} onChange={(v) => update(['experience', 'skillTotal'], v)} />
            <NumField label="Treasure Rating" value={sheet.experience.treasureRating} onChange={(v) => update(['experience', 'treasureRating'], v)} />
          </div>
        </div>

        <div className="panel">
          <h2>Mount</h2>
          <div className="grid g3">
            <TextField label="Name" value={sheet.mount.name} onChange={(v) => update(['mount', 'name'], v)} />
            <NumField label="Vigour" value={sheet.mount.vigour} onChange={(v) => update(['mount', 'vigour'], v)} min={0} />
            <NumField label="Treasure" value={sheet.mount.treasure} onChange={(v) => update(['mount', 'treasure'], v)} min={0} />
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            Vigour reduces this hero's accumulated Fatigue first at the end of a journey.
          </p>
        </div>

        <div className="panel">
          <div className="page-head" style={{ marginBottom: 8 }}>
            <h2 style={{ margin: 0 }}>Useful Items</h2>
            <CheckField
              label="use table"
              checked={sheet.usefulItems.useTable}
              onChange={(v) => update(['usefulItems', 'useTable'], v)}
            />
          </div>
          {sheet.usefulItems.useTable ? (
            <>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th style={{ width: 62 }}>Bonus</th>
                      <th>Applies to</th>
                      <th>and</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {sheet.usefulItems.items.map((item, i) => (
                      <tr key={item.id ?? i}>
                        <td>
                          <input value={item.name} onChange={(e) => update(['usefulItems', 'items', i, 'name'], e.target.value)} />
                        </td>
                        <td>
                          <input
                            type="number"
                            value={item.bonus}
                            onChange={(e) => update(['usefulItems', 'items', i, 'bonus'], Number(e.target.value))}
                          />
                        </td>
                        <td>
                          <input value={item.skill1} onChange={(e) => update(['usefulItems', 'items', i, 'skill1'], e.target.value)} />
                        </td>
                        <td>
                          <input value={item.skill2} onChange={(e) => update(['usefulItems', 'items', i, 'skill2'], e.target.value)} />
                        </td>
                        <td>
                          <button
                            className="small danger"
                            onClick={() =>
                              update(
                                ['usefulItems', 'items'],
                                sheet.usefulItems.items.filter((_, j) => j !== i),
                              )
                            }
                          >
                            ×
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <button
                className="small"
                style={{ marginTop: 8 }}
                onClick={() => update(['usefulItems', 'items'], [...sheet.usefulItems.items, emptyUsefulItem()])}
              >
                + item
              </button>
              <p className="small muted">
                A Bonus is a flat modifier — enter it in the roll dialog's "Flat bonus" field when the
                item applies.
              </p>
            </>
          ) : (
            <AreaField
              label="Gear"
              rows={6}
              value={sheet.usefulItems.gearText}
              onChange={(v) => update(['usefulItems', 'gearText'], v)}
            />
          )}
        </div>
      </div>

      {/* ---------------- Combat ---------------- */}
      <div className="panel">
        <h2>Combat</h2>
        <div className="grid g3" style={{ marginBottom: 12 }}>
          <div>
            <div className="row" style={{ alignItems: 'flex-end' }}>
              <div style={{ flex: 1, minWidth: 120 }}>
                <SelectField
                  label="Stance"
                  value={sheet.combat.stance}
                  onChange={(v) => update(['combat', 'stance'], v)}
                  options={STANCES}
                />
              </div>
              <div style={{ width: 96 }}>
                <NumField
                  label="# engaging"
                  title="Opponents currently engaging this hero — Defensive stance costs 1 Success Die each"
                  value={sheet.combat.opponentsEngaging}
                  onChange={(v) => update(['combat', 'opponentsEngaging'], v)}
                  min={0}
                />
              </div>
            </div>
            <p className="small muted" style={{ margin: '4px 0 0' }}>
              {stanceAttackNote(sheet)}
              {stanceDice ? ` Attack rolls get ${stanceDice > 0 ? '+' : ''}${stanceDice}d.` : ''}
            </p>
          </div>
          <NumField label="Attack Modifier" value={sheet.combat.attackModifier} onChange={(v) => update(['combat', 'attackModifier'], v)} />
          <div>
            <label className="field">
              <span>Stance Damage</span>
            </label>
            <div className="row">
              <CheckField
                label="on"
                checked={sheet.combat.stanceDamageEnabled}
                onChange={(v) => update(['combat', 'stanceDamageEnabled'], v)}
              />
              <div style={{ width: 78 }}>
                <NumField value={sheet.combat.stanceDamage} onChange={(v) => update(['combat', 'stanceDamage'], v)} />
              </div>
            </div>
          </div>
        </div>

        <h3>Proficiencies</h3>
        <div className="grid g3">
          {PROFICIENCY_GROUPS.map((group) => {
            const p = sheet.combat.proficiencies[group];
            return (
              <div className="skill-row" key={group}>
                <input
                  type="checkbox"
                  title="Favoured"
                  checked={p.favoured}
                  onChange={(e) => update(['combat', 'proficiencies', group, 'favoured'], e.target.checked)}
                />
                <RollButton
                  title={`Attack roll with ${group}`}
                  onClick={() =>
                    rollAttack({
                      proficiency: group,
                      title: `${group} attack roll`,
                      label: `${group} attack`,
                    })
                  }
                />
                <span>{group}</span>
                <PipTrack value={p.rating} onChange={(v) => update(['combat', 'proficiencies', group, 'rating'], v)} />
              </div>
            );
          })}
        </div>
      </div>

      {/* ---------------- Weapons ---------------- */}
      <div className="panel">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Weapons</h2>
          <div className="row">
            <CataloguePicker
              label="+ from catalogue"
              entries={catalogue.weapons}
              annotate={standardNote}
              onPick={(item) =>
                pickGear('weapons', item, (it) =>
                  update(['weapons'], [...sheet.weapons, { ...emptyWeapon(), ...catalogueItemToWeapon(it) }]),
                )
              }
            />
            <button className="small" onClick={() => update(['weapons'], [...sheet.weapons, emptyWeapon()])}>
              + weapon
            </button>
          </div>
        </div>
        <GearHint hint={gearHint} where="weapons" onDismiss={() => setGearHint(null)} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Atk</th>
                <th>Dmg</th>
                <th>Eq</th>
                <th>Name</th>
                <th>Type</th>
                <th>Prof.</th>
                <th>Damage</th>
                <th>Injury</th>
                <th title="Long Sword, Spear and Long-hafted Axe have one Injury rating per grip. Damage is the same either way.">
                  Grip
                </th>
                <th>Load</th>
                <th title="Fell — +2 Injury">F</th>
                <th title="Grievous — +1 Damage">G</th>
                <th title="Keen — Piercing Blow on 9+">K</th>
                <th>Notes</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sheet.weapons.map((w, i) => {
                const eff = effectiveWeapon(w, { valour });
                return (
                  <tr key={w.id ?? i}>
                    <td>
                      <RollButton
                        title="Attack roll"
                        onClick={() =>
                          rollAttack({
                            weapon: w,
                            title: `Attack — ${w.name || w.type || 'weapon'}`,
                            label: `${w.name || w.type || 'weapon'} attack`,
                            extraNote: `Piercing Blow on a Feat Die of ${eff.piercingThreshold}+.`,
                          })
                        }
                      />
                    </td>
                    <td>
                      <button
                        className="roll-btn"
                        title="Damage / Injury readout"
                        onClick={() =>
                          window.alert(
                            `${w.name || w.type || 'Weapon'}\n` +
                              `Damage ${eff.damage}${eff.bonuses.damage ? ` (base ${w.damage} +${eff.bonuses.damage} Grievous)` : ''}\n` +
                              `Injury ${eff.injury}${eff.bonuses.injury ? ` (base ${eff.baseInjury} +${eff.bonuses.injury} Fell)` : ''}` +
                              (isVersatileWeapon(w)
                                ? ` — held ${w.grip === '2h' ? 'two-handed' : 'one-handed'} (${w.injury} / ${w.injuryTwoHanded})`
                                : '') +
                              '\n' +
                              `Piercing Blow on Feat Die ${eff.piercingThreshold}+\n` +
                              (sheet.combat.stanceDamageEnabled ? `Stance damage +${sheet.combat.stanceDamage}\n` : '') +
                              `\nDamage is a static value in TOR 2e, not a dice roll.`,
                          )
                        }
                      >
                        ✦
                      </button>
                    </td>
                    <td>
                      <input type="checkbox" checked={w.equipped} onChange={(e) => update(['weapons', i, 'equipped'], e.target.checked)} />
                    </td>
                    <td>
                      <input value={w.name} onChange={(e) => update(['weapons', i, 'name'], e.target.value)} style={{ minWidth: 110 }} />
                    </td>
                    <td>
                      <input value={w.type} onChange={(e) => update(['weapons', i, 'type'], e.target.value)} style={{ minWidth: 96 }} />
                    </td>
                    <td>
                      <select value={w.proficiency} onChange={(e) => update(['weapons', i, 'proficiency'], e.target.value)}>
                        <option value="">—</option>
                        {PROFICIENCY_GROUPS.map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input type="number" value={w.damage} onChange={(e) => update(['weapons', i, 'damage'], Number(e.target.value))} style={{ width: 58 }} />
                      {eff.bonuses.damage ? <div className="small muted">→ {eff.damage}</div> : null}
                    </td>
                    <td>
                      <input type="number" value={w.injury} onChange={(e) => update(['weapons', i, 'injury'], Number(e.target.value))} style={{ width: 58 }} />
                      {/* The effective Injury differs from the typed one-handed
                          value once Fell applies, or once a two-handed grip is
                          selected on a weapon that has a rating for each. */}
                      {eff.injury !== (Number(w.injury) || 0) ? (
                        <div className="small muted">→ {eff.injury}</div>
                      ) : null}
                    </td>
                    <td>
                      {isVersatileWeapon(w) ? (
                        <>
                          <select
                            value={w.grip || '1h'}
                            onChange={(e) => update(['weapons', i, 'grip'], e.target.value)}
                            style={{ minWidth: 86 }}
                            title={`Injury ${w.injury} one-handed, ${w.injuryTwoHanded} two-handed.`}
                          >
                            {WEAPON_GRIPS.map((g) => (
                              <option key={g.value} value={g.value}>
                                {g.label}
                              </option>
                            ))}
                          </select>
                          <div className="small muted">
                            {w.injury} / {w.injuryTwoHanded}
                          </div>
                        </>
                      ) : (
                        <span className="small muted" title="This weapon has a single Injury rating.">
                          —
                        </span>
                      )}
                    </td>
                    <td>
                      <input type="number" value={w.load} onChange={(e) => update(['weapons', i, 'load'], Number(e.target.value))} style={{ width: 58 }} />
                    </td>
                    {['fell', 'grievous', 'keen'].map((q) => (
                      <td key={q}>
                        <select value={w[q]} onChange={(e) => update(['weapons', i, q], e.target.value)} style={{ minWidth: 120 }}>
                          {WEAPON_QUALITIES[q].options.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </td>
                    ))}
                    <td>
                      <input value={w.notes} onChange={(e) => update(['weapons', i, 'notes'], e.target.value)} style={{ minWidth: 130 }} />
                    </td>
                    <td>
                      <button className="small danger" onClick={() => update(['weapons'], sheet.weapons.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="small muted">
          Enchanted Rewards (Biting Dart, Cleaving, Foe-slaying, …) are out of scope for v1 — note them
          in the weapon's Notes field.
        </p>
      </div>

      {/* ---------------- Armour ---------------- */}
      <div className="panel">
        <div className="page-head" style={{ marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Armour &amp; Shield</h2>
          <div className="row">
            <CataloguePicker
              label="+ armour from catalogue"
              entries={catalogue.armour}
              annotate={standardNote}
              onPick={(item) =>
                pickGear('armour', item, (it) =>
                  update(['armour'], [...sheet.armour, { ...emptyArmour(), ...catalogueItemToArmour(it) }]),
                )
              }
            />
            <CataloguePicker
              label="set shield from catalogue"
              entries={catalogue.shields}
              annotate={standardNote}
              onPick={(item) =>
                pickGear('armour', item, (it) =>
                  update(['shield'], {
                    ...sheet.shield,
                    ...catalogueItemToShield(it),
                    equipped: sheet.shield.equipped,
                  }),
                )
              }
            />
            <button className="small" onClick={() => update(['armour'], [...sheet.armour, emptyArmour()])}>
              + armour
            </button>
          </div>
        </div>
        <GearHint hint={gearHint} where="armour" onDismiss={() => setGearHint(null)} />
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Eq</th>
                <th>Piece</th>
                <th>Protection</th>
                <th>Load</th>
                <th title="Close-fitting — +2 to PROTECTION rolls">CF</th>
                <th title="Cunning Make — −2 Load">CM</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {sheet.armour.map((a, i) => (
                <tr key={a.id ?? i}>
                  <td>
                    <input type="checkbox" checked={a.equipped} onChange={(e) => update(['armour', i, 'equipped'], e.target.checked)} />
                  </td>
                  <td>
                    <input value={a.name} onChange={(e) => update(['armour', i, 'name'], e.target.value)} style={{ minWidth: 110 }} />
                  </td>
                  <td>
                    <input type="number" value={a.protection} onChange={(e) => update(['armour', i, 'protection'], Number(e.target.value))} style={{ width: 62 }} />
                  </td>
                  <td>
                    <input type="number" value={a.load} onChange={(e) => update(['armour', i, 'load'], Number(e.target.value))} style={{ width: 62 }} />
                  </td>
                  {['closeFitting', 'cunningMake'].map((q) => (
                    <td key={q}>
                      <select value={a[q]} onChange={(e) => update(['armour', i, q], e.target.value)} style={{ minWidth: 150 }}>
                        {ARMOUR_QUALITIES[q].options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </td>
                  ))}
                  <td>
                    <button className="small danger" onClick={() => update(['armour'], sheet.armour.filter((_, j) => j !== i))}>
                      ×
                    </button>
                  </td>
                </tr>
              ))}
              <tr>
                <td>
                  <input type="checkbox" checked={sheet.shield.equipped} onChange={(e) => update(['shield', 'equipped'], e.target.checked)} />
                </td>
                <td>
                  <input
                    value={sheet.shield.name}
                    placeholder="Shield"
                    onChange={(e) => update(['shield', 'name'], e.target.value)}
                    style={{ minWidth: 110 }}
                  />
                </td>
                <td>
                  <div className="small muted">Parry</div>
                  <input type="number" value={sheet.shield.parry} onChange={(e) => update(['shield', 'parry'], Number(e.target.value))} style={{ width: 62 }} />
                </td>
                <td>
                  <input type="number" value={sheet.shield.load} onChange={(e) => update(['shield', 'load'], Number(e.target.value))} style={{ width: 62 }} />
                </td>
                <td>
                  <select value={sheet.shield.reinforced} onChange={(e) => update(['shield', 'reinforced'], e.target.value)} style={{ minWidth: 150 }}>
                    {SHIELD_QUALITIES.reinforced.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                  <div className="small muted">RI</div>
                </td>
                <td>
                  <select value={sheet.shield.cunningMake} onChange={(e) => update(['shield', 'cunningMake'], e.target.value)} style={{ minWidth: 150 }}>
                    {SHIELD_QUALITIES.cunningMake.options.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <RollButton
            title="Total Protection roll"
            onClick={() =>
              rollWith({
                title: 'Total PROTECTION roll',
                characterId: id,
                kind: 'protection',
                label: 'PROTECTION',
                rating: protection.protection,
                bonus: protection.bonus,
                targetNumber: 14,
                favoured: sheet.conditions.favourState === 'Favoured',
                illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
                note: `Success Dice = total Protection (${protection.protection}), plus ${protection.bonus} from Close-fitting. The Target Number of a Protection roll is set by the blow that caused it — set it below. Stance: ${sheet.combat.stance}.`,
                ...conditionFlags,
              })
            }
          />
          <span className="pill gold">
            Protection {protection.protection}
            {protection.bonus ? ` +${protection.bonus} CF` : ''}
          </span>
          <span className="pill">Total Parry {parry}</span>
          <span className="pill" title="Equipped gear after Cunning Make, plus Treasure">
            Load {load_}
          </span>
          <span className="pill">
            Stance {sheet.combat.stance}
            {stanceDice ? ` (${stanceDice > 0 ? '+' : ''}${stanceDice}d attack)` : ''}
          </span>
        </div>
      </div>

      {/* ---------------- Custom roller ---------------- */}
      <div className="panel">
        <h2>Custom Dice Roller</h2>
        <div className="grid g3">
          <TextField label="Label" value={sheet.customRoller.label} onChange={(v) => update(['customRoller', 'label'], v)} />
          <SelectField
            label="Whisper to"
            value={sheet.customRoller.whisperTo}
            onChange={(v) => update(['customRoller', 'whisperTo'], v)}
            options={[
              { value: 'public', label: 'Everyone (posts to Discord)' },
              { value: 'me', label: 'Me only' },
              { value: 'gm', label: 'GM' },
              ...otherNames.map((n) => ({ value: n, label: n })),
            ]}
          />
          <SelectField
            label="Feat modifier"
            value={sheet.customRoller.featModifier}
            onChange={(v) => update(['customRoller', 'featModifier'], v)}
            options={['Normal', 'Favoured', 'Ill-Favoured']}
          />
          <NumField label="Success Dice" value={sheet.customRoller.successDice} onChange={(v) => update(['customRoller', 'successDice'], v)} min={0} />
          <NumField label="Target Number" value={sheet.customRoller.targetNumber} onChange={(v) => update(['customRoller', 'targetNumber'], v)} min={1} />
          <div style={{ alignSelf: 'end' }}>
            <button
              className="primary"
              onClick={() =>
                rollWith({
                  title: sheet.customRoller.label || 'Custom roll',
                  characterId: id,
                  kind: 'custom',
                  label: sheet.customRoller.label || 'Custom roll',
                  rating: sheet.customRoller.successDice,
                  targetNumber: sheet.customRoller.targetNumber,
                  favoured: sheet.customRoller.featModifier === 'Favoured',
                  illFavoured: sheet.customRoller.featModifier === 'Ill-Favoured',
                  whisperTo: sheet.customRoller.whisperTo,
                  ...conditionFlags,
                })
              }
            >
              Roll
            </button>
          </div>
        </div>
        <p className="small muted" style={{ marginBottom: 0 }}>
          A whispered roll is not posted to the public Discord channel.
        </p>
      </div>

      <div className="sticky-bar">
        <button className="primary" onClick={save} disabled={!dirty}>
          {dirty ? 'Save sheet' : 'Saved'}
        </button>
        <button onClick={load} disabled={!dirty}>
          Discard changes
        </button>
        <span className="small muted">
          Edits are saved on demand; rolls auto-save first so the server rolls the current sheet.
        </span>
      </div>
    </>
  );
}

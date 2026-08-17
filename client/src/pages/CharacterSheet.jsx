import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ATTRIBUTES,
  PROFICIENCY_GROUPS,
  STANCES,
  emptyArmour,
  emptyUsefulItem,
  emptyWeapon,
  totalLoad,
  totalParry,
  totalProtection,
} from '@shared/character.js';
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

function setIn(obj, path, value) {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  const clone = Array.isArray(obj) ? obj.slice() : { ...obj };
  clone[head] = setIn(obj?.[head] ?? (typeof rest[0] === 'number' ? [] : {}), rest, value);
  return clone;
}

export default function CharacterSheet() {
  const { id } = useParams();
  const { campaign, characters, refresh } = useApp();
  const { openRoll } = useRoll();
  const [character, setCharacter] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

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

  if (error && !sheet) return <div className="error-box">{error}</div>;
  if (!sheet) return <p className="muted">Loading sheet…</p>;

  const valour = sheet.rewards.valour;
  const protection = totalProtection(sheet);
  const parry = totalParry(sheet);
  const load_ = totalLoad(sheet);

  const conditionFlags = {
    weary: sheet.conditions.weary,
    miserable: sheet.conditions.miserable,
    inspired: sheet.conditions.inspired,
    hope: sheet.attributes.heart.hope,
    whisperTargets: otherNames,
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
          <AreaField
            label="Earned Reward traits (with effect)"
            value={sheet.rewards.rewardTraits}
            onChange={(v) => update(['rewards', 'rewardTraits'], v)}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Valour also feeds the enhanced Close-fitting / Cunning Make tiers below.
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
          <AreaField
            label="Virtues (e.g. Hardiness)"
            value={sheet.virtues.virtueList}
            onChange={(v) => update(['virtues', 'virtueList'], v)}
          />
          <p className="small muted" style={{ marginBottom: 0 }}>
            Text only in v1 — numeric effects are not auto-applied.
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
            <CheckField
              label="Weary"
              title="Outlined Success Dice (1-3) count as 0"
              checked={sheet.conditions.weary}
              onChange={(v) => update(['conditions', 'weary'], v)}
            />
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
              <div className="page-head" style={{ marginBottom: 8 }}>
                <h2 style={{ margin: 0 }}>{attr.label}</h2>
                <span className="pill gold" title={`${tnBase} − ${a.rating}`}>
                  TN {tn}
                </span>
              </div>
              <div style={{ width: 96, marginBottom: 10 }}>
                <NumField label="Rating" value={a.rating} onChange={(v) => update(['attributes', attr.key, 'rating'], v)} min={0} />
              </div>

              <div className="pool-grid" style={{ marginBottom: 12 }}>
                {attr.key === 'strength' ? (
                  <>
                    <NumField label="Endurance" value={a.endurance} onChange={(v) => update(['attributes', 'strength', 'endurance'], v)} />
                    <NumField label="Max" value={a.enduranceMax} onChange={(v) => update(['attributes', 'strength', 'enduranceMax'], v)} />
                    <NumField label="Load" value={a.load} onChange={(v) => update(['attributes', 'strength', 'load'], v)} />
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
          <SelectField label="Stance" value={sheet.combat.stance} onChange={(v) => update(['combat', 'stance'], v)} options={STANCES} />
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
                    rollWith({
                      title: `${group} attack roll`,
                      characterId: id,
                      skill: group,
                      kind: 'attack',
                      label: `${group} attack`,
                      rating: p.rating,
                      targetNumber: computeTargetNumber(sheet.attributes.strength.rating, tnBase),
                      favoured: p.favoured || sheet.conditions.favourState === 'Favoured',
                      illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
                      bonus: sheet.combat.attackModifier,
                      note: 'In TOR 2e the TN of an attack is set by the target — usually the foe\'s Parry. Adjust the Target Number before rolling.',
                      ...conditionFlags,
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
          <button className="small" onClick={() => update(['weapons'], [...sheet.weapons, emptyWeapon()])}>
            + weapon
          </button>
        </div>
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Atk</th>
                <th>Dmg</th>
                <th>Eq</th>
                <th>Type</th>
                <th>Prof.</th>
                <th>Damage</th>
                <th>Injury</th>
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
                          rollWith({
                            title: `Attack — ${w.type || 'weapon'}`,
                            characterId: id,
                            skill: w.proficiency || 'Swords',
                            kind: 'attack',
                            label: `${w.type || 'weapon'} attack`,
                            rating: sheet.combat.proficiencies[w.proficiency || 'Swords']?.rating ?? 0,
                            targetNumber: computeTargetNumber(sheet.attributes.strength.rating, tnBase),
                            favoured:
                              sheet.combat.proficiencies[w.proficiency || 'Swords']?.favoured ||
                              sheet.conditions.favourState === 'Favoured',
                            illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
                            bonus: sheet.combat.attackModifier,
                            note: `Piercing Blow on a Feat Die of ${eff.piercingThreshold}+. The attack TN is set by the target's Parry — adjust it below.`,
                            ...conditionFlags,
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
                            `${w.type || 'Weapon'}\n` +
                              `Damage ${eff.damage}${eff.bonuses.damage ? ` (base ${w.damage} +${eff.bonuses.damage} Grievous)` : ''}\n` +
                              `Injury ${eff.injury}${eff.bonuses.injury ? ` (base ${w.injury} +${eff.bonuses.injury} Fell)` : ''}\n` +
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
                      {eff.bonuses.injury ? <div className="small muted">→ {eff.injury}</div> : null}
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
          <button className="small" onClick={() => update(['armour'], [...sheet.armour, emptyArmour()])}>
            + armour
          </button>
        </div>
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
          <span className="pill">Equipped Load {load_}</span>
          <span className="pill">Stance {sheet.combat.stance}</span>
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

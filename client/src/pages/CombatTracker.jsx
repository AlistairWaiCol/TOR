import { useEffect, useState } from 'react';
import {
  skillEntry,
  stanceAttackDice,
  stanceAttackNote,
  totalParry,
  totalProtection,
  usefulItemsForSkill,
} from '@shared/character.js';
import { computeTargetNumber } from '@shared/dice.js';
import { effectiveWeapon } from '@shared/rewards.js';
import {
  STANCE_LABELS,
  STANCE_ORDER,
  adversarySpecialDamageOptions,
  engagementCounts,
  engagementLimits,
  pcSpecialDamageOptions,
  promptedCombatActionFor,
} from '@shared/combat.js';
import { hateResolveLabel, misdeedReminder } from '@shared/compendium.js';
import { api } from '../lib/api.js';
import { useApp } from '../state/AppContext.jsx';
import { useRoll } from '../components/RollDialog.jsx';
import Toast from '../components/Toast.jsx';
import { NumField, SelectField } from '../components/Fields.jsx';

const TACTICAL_ACTIONS = {
  Forward: { key: 'intimidate-foe', label: 'Intimidate Foe', skill: 'Awe' },
  Open: { key: 'rally-comrades', label: 'Rally Comrades', skill: 'Enhearten' },
  Defensive: { key: 'protect-companion', label: 'Protect Companion', skill: 'Athletics' },
  Rear: { key: 'prepare-shot', label: 'Prepare Shot', skill: 'Scan' },
};

/**
 * The Combat Tracker (Pass 1). Everything is driven off the live combat
 * snapshot already broadcast to every client — see server/lib/combatEngine.js
 * for the rules this page is a thin view over, and shared/combat.js for the
 * pure maths (turn order, engagement limits, Special Damage options).
 */
export default function CombatTracker() {
  const { isGM, characters, combat, combatants, playingAs, refresh } = useApp();
  const { openRoll } = useRoll();
  const [adversaryBank, setAdversaryBank] = useState([]);
  const [pickAdversaryId, setPickAdversaryId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  useEffect(() => {
    if (!isGM) return;
    api
      .get('/compendium/adversaries')
      .then((d) => setAdversaryBank(d.entries ?? []))
      .catch(() => setAdversaryBank([]));
  }, [isGM]);

  const flash = (msg) => {
    setStatus(msg);
    setTimeout(() => setStatus(''), 1800);
  };

  const call = async (fn) => {
    setError('');
    try {
      await fn();
      refresh();
    } catch (e) {
      setError(e.message);
    }
  };

  if (!combat) return <p className="muted">Loading the Combat Tracker…</p>;

  /** Every combat-round control is owned by whoever has this hero Playing As — the GM can always override. Sheet editing elsewhere is unaffected. */
  const canControl = (characterId) => isGM || playingAs === characterId;

  const activeCombatants = combatants.filter((c) => c.status === 'active');
  const engagedCounts = engagementCounts(combat.engagements);
  const stances = combat.stances ?? {};

  /* ---- GM actions ---- */

  const startCombat = () => call(() => api.post('/combat/start'));
  const endCombat = () => {
    if (!window.confirm('End combat and clear the board? Every roll already posted to Discord stays there.')) return;
    call(() => api.post('/combat/end'));
  };
  const nextRoundAction = () => call(() => api.post('/combat/next-round'));
  const lockStances = () => call(() => api.post('/combat/lock-stances'));

  const addAdversaries = () => {
    if (!pickAdversaryId) return;
    call(async () => {
      await api.post('/combat/adversaries', { adversaryId: pickAdversaryId, quantity: Number(quantity) || 1 });
      flash('Added to the fight.');
    });
  };

  const editCombatant = (id, patch) => call(() => api.patch(`/combat/combatants/${id}`, patch));

  const recordWoundSeverity = (characterId, healingDays, dying) =>
    call(async () => {
      await api.post('/combat/wound-severity', { characterId, healingDays, dying });
      flash('Wound recorded.');
    });

  /* ---- stance & engagement ---- */

  /** Directly sets the box's own stance — never a cycle. */
  const assignStance = (characterId, stance) => call(() => api.post('/combat/stance', { characterId, stance }));

  const setEngagement = (characterId, combatantId) =>
    call(() => api.post('/combat/engage', { characterId, combatantId: combatantId || null }));

  /* ---- rolls ---- */

  const rollAttack = (character, weapon, combatant) => {
    const sheet = character.sheet;
    const group = weapon.proficiency || 'Swords';
    const p = sheet.combat.proficiencies[group] ?? { rating: 0, favoured: false };
    const strengthTN = computeTargetNumber(sheet.attributes.strength.rating, 20);
    const eff = effectiveWeapon(weapon, { valour: sheet.rewards.valour });
    const pending = combat.pendingModifiers?.[character.id];
    openRoll({
      title: `Attack — ${character.name} vs ${combatant.name}`,
      characterId: character.id,
      skill: group,
      kind: 'attack',
      label: `Attack (${weapon.name || group})`,
      rating: p.rating,
      parryTarget: true,
      strengthTN,
      targetParry: combatant.parry,
      extraDice: stanceAttackDice(sheet) + (Number(pending?.extraDice) || 0),
      favoured: p.favoured || sheet.conditions.favourState === 'Favoured',
      illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
      bonus: sheet.combat.attackModifier,
      note:
        `TN = STRENGTH TN (${strengthTN}) + ${combatant.name}'s Parry (${combatant.parry}). ${stanceAttackNote(sheet)}` +
        (pending?.note ? ` ${pending.note}.` : ''),
      usefulItems: usefulItemsForSkill(sheet, group),
      specialSuccessOptions: pcSpecialDamageOptions(weapon, Boolean(sheet.shield?.equipped)),
      weary: sheet.conditions.weary,
      miserable: sheet.conditions.miserable,
      inspired: sheet.conditions.inspired,
      hope: sheet.attributes.heart.hope,
      whisperTargets: characters.filter((c) => c.id !== character.id).map((c) => c.name),
      endpoint: '/combat/attack',
      extraBody: { combatantId: combatant.id, weaponDamage: eff.damage, piercingThreshold: eff.piercingThreshold },
      onRolled: () => refresh(),
    });
  };

  /**
   * GM-triggered. The result — hit/miss, Piercing Blow — reaches the target
   * player through the broadcast `combat.pendingHits` state and
   * CombatHitPrompt.jsx on THEIR screen; nothing here pops a dialog locally.
   */
  const rollAdversaryAttack = (combatant, proficiencyIndex, target) => {
    const prof = combatant.combatProficiencies?.[proficiencyIndex];
    if (!prof || !target) return;
    const targetSheet = target.sheet;
    const tn = totalParry(targetSheet);
    openRoll({
      title: `${combatant.name} attacks ${target.name}`,
      actorName: combatant.name,
      skill: prof.name,
      kind: 'attack',
      label: `${prof.name} vs ${target.name}`,
      rating: prof.rating,
      targetNumber: tn,
      note: `TN = ${target.name}'s total Parry (${tn}). Might ${combatant.might} — ${combatant.attacksUsedThisRound}/${Math.max(1, combatant.might)} attacks used this round.`,
      specialSuccessOptions: adversarySpecialDamageOptions(prof),
      endpoint: '/combat/adversary-attack',
      extraBody: {
        combatantId: combatant.id,
        characterId: target.id,
        weaponDamage: prof.damage,
        weaponInjury: prof.injury,
      },
      onRolled: () => refresh(),
    });
  };

  const rollTacticalAction = (character, actionType, targetCharacterId) => {
    const def = Object.values(TACTICAL_ACTIONS).find((a) => a.key === actionType) ?? { skill: 'Battle', label: 'Battle' };
    const sheet = character.sheet;
    const entry = skillEntry(sheet, def.skill);
    const tn = computeTargetNumber(entry?.attributeRating ?? 0, 20);
    openRoll({
      title: `${def.label} — ${character.name}`,
      characterId: character.id,
      skill: def.skill,
      kind: 'skill',
      label: def.label,
      rating: entry?.rating ?? 0,
      targetNumber: tn,
      favoured: entry?.favoured || sheet.conditions.favourState === 'Favoured',
      illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
      usefulItems: usefulItemsForSkill(sheet, def.skill),
      weary: sheet.conditions.weary,
      miserable: sheet.conditions.miserable,
      inspired: sheet.conditions.inspired,
      hope: sheet.attributes.heart.hope,
      endpoint: '/combat/action',
      extraBody: { actionType, targetCharacterId: targetCharacterId || undefined },
      onRolled: (data) => {
        refresh();
        if (data?.effect) flash(data.effect);
      },
    });
  };

  const rollBattle = (character, targetCharacterId, gmModifier) => {
    const sheet = character.sheet;
    const entry = skillEntry(sheet, 'Battle');
    const tn = computeTargetNumber(entry?.attributeRating ?? 0, 20);
    openRoll({
      title: `Battle — ${character.name}`,
      characterId: character.id,
      skill: 'Battle',
      kind: 'skill',
      label: 'Battle',
      rating: entry?.rating ?? 0,
      targetNumber: tn,
      favoured: entry?.favoured || sheet.conditions.favourState === 'Favoured',
      illFavoured: sheet.conditions.favourState === 'Ill-Favoured',
      note: 'A general tactical roll — GM picks a modifier and attaches it to an upcoming roll for this hero (and a second, if named).',
      weary: sheet.conditions.weary,
      miserable: sheet.conditions.miserable,
      inspired: sheet.conditions.inspired,
      hope: sheet.attributes.heart.hope,
      endpoint: '/combat/action',
      extraBody: { actionType: 'battle', targetCharacterId: targetCharacterId || undefined, gmModifier },
      onRolled: (data) => {
        refresh();
        if (data?.effect) flash(data.effect);
      },
    });
  };

  const rollRetreat = (character, free) => {
    if (free) {
      call(() => api.post('/combat/retreat', { characterId: character.id, free: true }));
      return;
    }
    const sheet = character.sheet;
    const strengthTN = computeTargetNumber(sheet.attributes.strength.rating, 20);
    const myCombatantId = combat.engagements?.[character.id];
    const foe = combatants.find((c) => c.id === myCombatantId);
    openRoll({
      title: `Retreat — ${character.name}`,
      characterId: character.id,
      skill: 'Retreat',
      kind: 'attack',
      label: 'Retreat',
      rating: 0,
      parryTarget: true,
      strengthTN,
      targetParry: foe?.parry ?? 0,
      note: 'Defensive Retreat: success means no damage dealt, but this hero disengages. Failure means they stay put.',
      endpoint: '/combat/retreat',
      extraBody: {},
      onRolled: () => refresh(),
    });
  };

  const announceFellAbility = (combatant, ability) =>
    call(() =>
      api.post('/combat/fell-ability-announce', {
        sourceName: combatant.name,
        name: ability.name,
        description: ability.description,
      }),
    );

  return (
    <>
      <div className="page-head">
        <h1>Combat Tracker</h1>
        <div className="row">
          {combat.active ? (
            <>
              <span className="pill gold">Round {combat.round}</span>
              <span className={`pill ${combat.stanceLocked ? 'ok' : ''}`}>
                {combat.stanceLocked ? 'stances locked' : 'stance lock'}
              </span>
            </>
          ) : (
            <span className="pill">no combat underway</span>
          )}
        </div>
      </div>

      {error ? <div className="error-box">{error}</div> : null}
      <Toast message={status} />

      {isGM ? (
        <div className="panel">
          <h2>Setup</h2>
          {!combat.active ? (
            <button className="primary" onClick={startCombat}>
              Start Combat
            </button>
          ) : (
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <div style={{ minWidth: 220 }}>
                <SelectField
                  label="Add from Adversary Bank"
                  value={pickAdversaryId}
                  onChange={setPickAdversaryId}
                  options={[
                    { value: '', label: '— pick an adversary —' },
                    ...adversaryBank.map((a) => ({ value: a.id, label: a.name })),
                  ]}
                />
              </div>
              <div style={{ width: 90 }}>
                <NumField label="Quantity" value={quantity} onChange={setQuantity} min={1} max={20} />
              </div>
              <button onClick={addAdversaries} disabled={!pickAdversaryId}>
                + add
              </button>
              <div className="spacer" />
              {!combat.stanceLocked ? (
                <button onClick={lockStances}>Lock Stances</button>
              ) : (
                <button onClick={nextRoundAction}>Start Next Round</button>
              )}
              <button className="danger" onClick={endCombat}>
                End Combat
              </button>
            </div>
          )}
        </div>
      ) : combat.active ? (
        <p className="small muted">Waiting on the GM to add adversaries and manage the round.</p>
      ) : null}

      {combat.active ? (
        <div className="panel">
          <div className="grid g4" style={{ gap: 12 }}>
            {STANCE_ORDER.map((stance) => (
              <StanceColumn
                key={stance}
                stance={stance}
                characters={characters}
                stances={stances}
                locked={combat.stanceLocked}
                canControl={canControl}
                onAssign={assignStance}
              />
            ))}
          </div>
          <div className="panel" style={{ marginTop: 12 }}>
            <h3 style={{ marginTop: 0 }}>Adversaries</h3>
            {activeCombatants.length === 0 ? (
              <p className="small muted">None added yet.</p>
            ) : (
              <div className="row" style={{ flexWrap: 'wrap' }}>
                {activeCombatants.map((c) => (
                  <span key={c.id} className="pill" title={`Size: ${c.size}`}>
                    {c.name} — engaged: {engagedCounts[c.id] || 0}/{engagementLimits(c.size).maxAttackersOnFoe}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      ) : null}

      {combat.active && combat.stanceLocked ? (
        <div className="panel">
          <h2>Engagement &amp; Actions</h2>
          {characters.map((character) => {
            const stance = stances[character.id];
            const acted = (combat.actedPlayers ?? []).includes(character.id);
            const isMyTurn = Boolean(promptedCombatActionFor({ combat, characterId: character.id }));
            return (
              <HeroActionRow
                key={character.id}
                character={character}
                stance={stance}
                combatants={activeCombatants}
                engagedId={combat.engagements?.[character.id] ?? ''}
                acted={acted}
                canControl={canControl(character.id)}
                isMyTurn={isMyTurn}
                pendingModifier={combat.pendingModifiers?.[character.id]}
                onEngage={(id) => setEngagement(character.id, id)}
                onAttack={(weapon, combatant) => rollAttack(character, weapon, combatant)}
                onTactical={(actionType, targetId) => rollTacticalAction(character, actionType, targetId)}
                onBattle={(targetId, mod) => rollBattle(character, targetId, mod)}
                onRetreat={(free) => rollRetreat(character, free)}
              />
            );
          })}

          {isGM ? (
            <div style={{ marginTop: 12 }}>
              <h3>Adversary attacks (GM-triggered)</h3>
              {activeCombatants.map((c) => (
                <AdversaryAttackRow
                  key={c.id}
                  combatant={c}
                  characters={characters}
                  onFire={(profIdx, targetId) =>
                    rollAdversaryAttack(
                      c,
                      profIdx,
                      characters.find((ch) => ch.id === targetId),
                    )
                  }
                  onEdit={(patch) => editCombatant(c.id, patch)}
                  onAnnounce={(ability) => announceFellAbility(c, ability)}
                />
              ))}
              <WoundSeverityPanel characters={characters} combat={combat} onRecord={recordWoundSeverity} />
            </div>
          ) : null}
        </div>
      ) : null}

      {combat.active ? (
        <CombatSidebar characters={characters} combatants={combatants} combat={combat} />
      ) : null}
    </>
  );
}

/* ---------------- Stance column ---------------- */

function StanceColumn({ stance, characters, stances, locked, canControl, onAssign }) {
  const inStance = characters.filter((c) => stances[c.id] === stance);
  return (
    <div className="panel" style={{ margin: 0 }}>
      <h3 style={{ marginTop: 0 }}>{STANCE_LABELS[stance]}</h3>
      {inStance.length === 0 ? <p className="small muted">nobody</p> : null}
      <div className="row" style={{ flexWrap: 'wrap' }}>
        {inStance.map((c) => (
          <span key={c.id} className="pill gold">
            {c.name}
          </span>
        ))}
      </div>
      {!locked ? (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {characters
            .filter((c) => stances[c.id] !== stance)
            .map((c) => (
              <button
                key={c.id}
                className="small"
                disabled={!canControl(c.id)}
                title={canControl(c.id) ? undefined : `Only ${c.name} (Playing As) or the GM can set this.`}
                onClick={() => onAssign(c.id, stance)}
              >
                + {c.name.split(' ')[0]}
              </button>
            ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Hero action row ---------------- */

function HeroActionRow({
  character,
  stance,
  combatants,
  engagedId,
  acted,
  canControl,
  isMyTurn,
  pendingModifier,
  onEngage,
  onAttack,
  onTactical,
  onBattle,
  onRetreat,
}) {
  const sheet = character.sheet;
  const [weaponIdx, setWeaponIdx] = useState(0);
  const [battleTarget, setBattleTarget] = useState('');
  const [battleMod, setBattleMod] = useState(1);

  const equippedWeapons = (sheet.weapons ?? []).filter((w) => w.equipped);
  const tactical = TACTICAL_ACTIONS[stance];
  const isCloseCombat = stance && stance !== 'Rear';

  if (!stance) {
    return (
      <div style={{ padding: '10px 0', borderBottom: '1px solid #2c261e', opacity: 0.6 }}>
        <div className="row">
          <strong style={{ minWidth: 140 }}>{character.name}</strong>
          <span className="pill bad">no stance — sits out this round</span>
        </div>
      </div>
    );
  }

  // Engaging/Weapon prep is available once locked, gated only by ownership;
  // the actual action buttons additionally need it to be this stance's turn.
  const prepDisabled = !canControl;
  const actionDisabled = !canControl || !isMyTurn || acted;

  return (
    <div style={{ padding: '10px 0', borderBottom: '1px solid #2c261e' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <strong style={{ minWidth: 140 }}>{character.name}</strong>
        <span className="pill">{STANCE_LABELS[stance]}</span>
        {acted ? (
          <span className="pill ok">acted</span>
        ) : isMyTurn ? (
          <span className="pill gold">their turn</span>
        ) : (
          <span className="pill">waiting for turn</span>
        )}
        {pendingModifier?.note ? <span className="pill gold">{pendingModifier.note}</span> : null}
      </div>

      {isCloseCombat ? (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 180 }}>
            <SelectField
              label="Engaging"
              value={engagedId}
              onChange={onEngage}
              disabled={prepDisabled}
              options={[{ value: '', label: '— none —' }, ...combatants.map((c) => ({ value: c.id, label: c.name }))]}
            />
          </div>
        </div>
      ) : null}

      <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        {equippedWeapons.length ? (
          <>
            <div style={{ minWidth: 160 }}>
              <SelectField
                label="Weapon"
                value={String(weaponIdx)}
                onChange={(v) => setWeaponIdx(Number(v))}
                disabled={prepDisabled}
                options={equippedWeapons.map((w, i) => ({ value: String(i), label: w.name || w.proficiency }))}
              />
            </div>
            {/* Ranged/Rearward heroes have no "Engaging" picker above, so the
                attack target is chosen right here instead — everyone else
                just attacks whoever they're already engaging. */}
            {!isCloseCombat ? (
              <div style={{ minWidth: 160 }}>
                <SelectField
                  label="Attack target"
                  value={engagedId}
                  onChange={onEngage}
                  disabled={prepDisabled}
                  options={[{ value: '', label: '— pick a target —' }, ...combatants.map((c) => ({ value: c.id, label: c.name }))]}
                />
              </div>
            ) : null}
            <button
              disabled={actionDisabled || !engagedId}
              title={!canControl ? `Only ${character.name} (Playing As) or the GM can act for them.` : !isMyTurn ? "Not this hero's turn yet." : undefined}
              onClick={() => {
                const w = equippedWeapons[weaponIdx];
                const target = combatants.find((c) => c.id === engagedId);
                if (w && target) onAttack(w, target);
              }}
            >
              Attack
            </button>
          </>
        ) : (
          <span className="small muted">No equipped weapon on the sheet.</span>
        )}

        {tactical ? (
          <button
            disabled={actionDisabled}
            title={!canControl ? `Only ${character.name} (Playing As) or the GM can act for them.` : !isMyTurn ? "Not this hero's turn yet." : undefined}
            onClick={() => onTactical(tactical.key, tactical.key === 'protect-companion' ? engagedId : undefined)}
          >
            {tactical.label}
          </button>
        ) : null}

        <button disabled={actionDisabled} onClick={() => onBattle(battleTarget || undefined, battleMod)}>
          Battle
        </button>
        <div style={{ width: 90 }}>
          <NumField label="Battle ±d" value={battleMod} onChange={setBattleMod} min={-2} max={2} disabled={prepDisabled} />
        </div>

        {stance === 'Rear' ? (
          <button disabled={actionDisabled} onClick={() => onRetreat(true)}>
            Retreat (free)
          </button>
        ) : stance === 'Defensive' ? (
          <button disabled={actionDisabled} onClick={() => onRetreat(false)}>
            Retreat (roll)
          </button>
        ) : null}
      </div>
    </div>
  );
}

/* ---------------- Adversary attack row (GM) ---------------- */

function AdversaryAttackRow({ combatant, characters, onFire, onEdit, onAnnounce }) {
  const [profIdx, setProfIdx] = useState(0);
  const [targetId, setTargetId] = useState(characters[0]?.id ?? '');
  const budget = Math.max(1, combatant.might);
  const doneForRound = combatant.attacksUsedThisRound >= budget;

  return (
    <div style={{ padding: '8px 0', borderBottom: '1px solid #2c261e' }}>
      <div className="row" style={{ flexWrap: 'wrap' }}>
        <strong style={{ minWidth: 140 }}>{combatant.name}</strong>
        <span className="pill">
          Endurance {combatant.currentEndurance}/{combatant.maxEndurance}
        </span>
        {doneForRound ? (
          <span className="pill ok">Acted {combatant.attacksUsedThisRound}/{budget}</span>
        ) : (
          <span className="pill">Attacks {combatant.attacksUsedThisRound}/{budget}</span>
        )}
        {combatant.weary ? <span className="pill bad">weary</span> : null}
        <button className="small danger" onClick={() => onEdit({ status: 'removed' })}>
          remove
        </button>
      </div>
      <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
        <div style={{ minWidth: 140 }}>
          <SelectField
            label="Proficiency"
            value={String(profIdx)}
            onChange={(v) => setProfIdx(Number(v))}
            options={(combatant.combatProficiencies ?? []).map((p, i) => ({ value: String(i), label: `${p.name} (Rating ${p.rating})` }))}
          />
        </div>
        <div style={{ minWidth: 160 }}>
          <SelectField
            label="Target"
            value={targetId}
            onChange={setTargetId}
            options={characters.map((c) => ({ value: c.id, label: c.name }))}
          />
        </div>
        <button disabled={doneForRound} onClick={() => onFire(profIdx, targetId)}>
          Attack
        </button>
      </div>
      {(combatant.fellAbilities ?? []).length ? (
        <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
          {combatant.fellAbilities.map((fa, i) => (
            <button key={i} className="small" title={fa.description} onClick={() => onAnnounce(fa)}>
              💬 {fa.name}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- Wound Severity (GM) ---------------- */

/** Surfaces once a hit player's Protection roll fails — the GM's own book gives the healing days. */
function WoundSeverityPanel({ characters, combat, onRecord }) {
  const waiting = characters.filter((c) => combat.pendingHits?.[c.id]?.stage === 'wound-severity');
  if (!waiting.length) return null;
  return (
    <div className="warn-box" style={{ marginTop: 10 }}>
      <strong>Wound Severity owed:</strong>
      {waiting.map((c) => (
        <WoundSeverityRow key={c.id} character={c} pending={combat.pendingHits[c.id]} onRecord={onRecord} />
      ))}
    </div>
  );
}

function WoundSeverityRow({ character, pending, onRecord }) {
  const [healingDays, setHealingDays] = useState(3);
  const [dying, setDying] = useState(false);
  return (
    <div className="row" style={{ marginTop: 6, flexWrap: 'wrap' }}>
      <span>
        {character.name} — Feat Die {pending.featFace === 11 ? 'ᚷ' : pending.featFace === 0 ? '👁' : pending.featFace}
      </span>
      <div style={{ width: 90 }}>
        <NumField label="Healing days" value={healingDays} onChange={setHealingDays} min={0} disabled={dying} />
      </div>
      <label className="check">
        <input type="checkbox" checked={dying} onChange={(e) => setDying(e.target.checked)} />
        Worst result — Dying
      </label>
      <button className="primary" onClick={() => onRecord(character.id, healingDays, dying)}>
        Record
      </button>
    </div>
  );
}

/* ---------------- Status sidebar ---------------- */

function CombatSidebar({ characters, combatants, combat }) {
  return (
    <div className="panel">
      <h2>Status</h2>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Endurance</th>
              <th>Parry</th>
              <th>Armour / Protection</th>
              <th>Condition</th>
              <th>Hope / Hate-Resolve</th>
              <th>Acted</th>
            </tr>
          </thead>
          <tbody>
            {characters.map((c) => {
              const sheet = c.sheet;
              const protection = totalProtection(sheet);
              const acted = (combat.actedPlayers ?? []).includes(c.id);
              return (
                <tr key={c.id}>
                  <td>{c.name}</td>
                  <td>
                    {sheet.attributes.strength.endurance}/{sheet.attributes.strength.enduranceMax}
                  </td>
                  <td>{totalParry(sheet)}</td>
                  <td>{protection.total}</td>
                  <td>
                    {sheet.conditions.dying ? (
                      <span className="pill bad">Dying</span>
                    ) : sheet.conditions.wounded ? (
                      <span className="pill bad">Wounded</span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>{sheet.attributes.heart.hope}</td>
                  <td>{acted ? <span className="pill ok">acted</span> : ''}</td>
                </tr>
              );
            })}
            {combatants
              .filter((c) => c.status !== 'removed')
              .map((c) => {
                const budget = Math.max(1, c.might);
                const doneForRound = c.attacksUsedThisRound >= budget;
                return (
                  <tr key={c.id} style={{ opacity: c.status === 'down' ? 0.5 : 1 }}>
                    <td>
                      {c.name} {c.status === 'down' ? '(down)' : ''}
                    </td>
                    <td>
                      {c.currentEndurance}/{c.maxEndurance}
                    </td>
                    <td>{c.parry}</td>
                    <td>{c.armour}</td>
                    <td>{c.weary ? <span className="pill bad">Weary</span> : '—'}</td>
                    <td>
                      {hateResolveLabel(c.category)} {c.hateResolve} (spent {c.hateResolveSpent}/{c.might})
                    </td>
                    <td>
                      {doneForRound ? (
                        <span className="pill ok">
                          Acted {c.attacksUsedThisRound}/{budget}
                        </span>
                      ) : (
                        `${c.attacksUsedThisRound}/${budget}`
                      )}
                    </td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
      {combatants.some((c) => misdeedReminder(c.category)) ? (
        <p className="small muted" style={{ marginTop: 8 }}>
          {misdeedReminder('Evil Men')}
        </p>
      ) : null}
    </div>
  );
}

/**
 * The Combat Tracker (Pass 1) — start/end a fight, the Adversary/NPC Bank →
 * combatant snapshot copy, stances/engagement, and every attack/tactical-
 * action roll. Same shape as travelEngine.js: this module holds the rules,
 * server/routes/combat.js is a thin router over it.
 */

import { STANCES, totalProtection } from '../../shared/character.js';
import {
  canEnterRearward,
  isPiercingBlow,
  nextRoundState,
  resetCombatantForRound,
} from '../../shared/combat.js';
import { performRoll } from './rollService.js';
import { boldName, formatMessage, postToDiscord } from './discord.js';
import { broadcastSnapshot } from '../realtime.js';
import {
  createCombatant,
  deleteAllCombatants,
  getCharacter,
  getCombatState,
  getCombatantRow,
  getCompendiumEntry,
  listCharacters,
  listCombatants,
  replaceCharacterSheet,
  setCombatState,
  updateCombatantRow,
} from './store.js';

function fail(message, status = 400) {
  throw Object.assign(new Error(message), { status });
}

export async function combatSnapshot() {
  const [combat, combatants] = await Promise.all([getCombatState(), listCombatants()]);
  return { combat, combatants };
}

/** Mark a hero done for the round, and consume any pending self-buff they held. */
async function markActed(characterId) {
  const combat = await getCombatState();
  const actedPlayers = combat.actedPlayers.includes(characterId)
    ? combat.actedPlayers
    : [...combat.actedPlayers, characterId];
  const pendingModifiers = { ...combat.pendingModifiers };
  delete pendingModifiers[characterId];
  await setCombatState({ actedPlayers, pendingModifiers });
}

/* --- lifecycle --------------------------------------------------------------- */

export async function startCombat() {
  await deleteAllCombatants();
  await setCombatState({
    active: true,
    round: 1,
    stanceLocked: false,
    stances: {},
    engagements: {},
    actedPlayers: [],
    pendingModifiers: {},
    pendingHits: {},
  });
  await broadcastSnapshot();
  return combatSnapshot();
}

export async function endCombat() {
  await deleteAllCombatants();
  await setCombatState({
    active: false,
    round: 1,
    stanceLocked: false,
    stances: {},
    engagements: {},
    actedPlayers: [],
    pendingModifiers: {},
    pendingHits: {},
  });
  await broadcastSnapshot();
  return combatSnapshot();
}

export async function nextRound() {
  const combat = await getCombatState();
  if (!combat.active) fail('No combat is underway.');
  const patch = nextRoundState(combat);
  await setCombatState({ ...patch, pendingModifiers: {} });
  for (const c of await listCombatants()) {
    const reset = resetCombatantForRound(c);
    await updateCombatantRow(c.id, {
      attacksUsedThisRound: reset.attacksUsedThisRound,
      hateResolveSpent: reset.hateResolveSpent,
      weary: reset.weary,
    });
  }
  await broadcastSnapshot();
  return combatSnapshot();
}

/** The base name before any trailing " N" auto-numbering. */
function baseNameOf(name) {
  const m = /^(.*) (\d+)$/.exec(String(name ?? ''));
  return m ? m[1] : name;
}

/**
 * Add N independent instances of a bank entry to the fight — a snapshot copy,
 * never a live link. Also usable mid-fight for reinforcements.
 */
export async function addAdversaries({ adversaryId, quantity }) {
  if (!adversaryId) fail('adversaryId is required.');
  const qty = Math.max(1, Math.min(20, Number(quantity) || 1));
  const entry = await getCompendiumEntry('adversaries', adversaryId);
  if (!entry) fail('That adversary is not in the Compendium.');

  const combat = await getCombatState();
  const existing = await listCombatants();
  const baseName = entry.name || 'Adversary';
  const existingWithBase = existing.filter((c) => baseNameOf(c.name) === baseName);
  const willNumber = existingWithBase.length > 0 || qty > 1;

  // A single existing unnumbered instance becomes "Name 1" once a duplicate
  // joins, so numbering stays contiguous instead of skipping straight to 2.
  if (willNumber && existingWithBase.length === 1 && existingWithBase[0].name === baseName) {
    await updateCombatantRow(existingWithBase[0].id, { name: `${baseName} 1` });
  }
  const startIndex = existingWithBase.length + 1;

  const created = [];
  for (let i = 0; i < qty; i += 1) {
    const name = willNumber ? `${baseName} ${startIndex + i}` : baseName;
    // eslint-disable-next-line no-await-in-loop
    const row = await createCombatant({
      name,
      adversaryId: entry.id,
      category: entry.category,
      size: entry.size,
      attributeLevel: entry.attributeLevel,
      parry: entry.parry,
      armour: entry.armour,
      might: entry.might,
      hateResolve: entry.hateResolve,
      combatProficiencies: entry.combatProficiencies,
      fellAbilities: entry.fellAbilities,
      currentEndurance: entry.endurance,
      maxEndurance: entry.endurance,
      joinedRound: combat.round,
    });
    created.push(row);
  }
  await broadcastSnapshot();
  return { ...(await combatSnapshot()), added: created };
}

/** Manual edits — status, Endurance, notes — independent of the normal attack flow. */
export async function editCombatant(id, patch) {
  const existing = await getCombatantRow(id);
  if (!existing) fail('That combatant is not in this fight.');
  await updateCombatantRow(id, patch);
  await broadcastSnapshot();
  return combatSnapshot();
}

/* --- stance & engagement ------------------------------------------------------ */

export async function setStance({ characterId, stance }) {
  if (!characterId) fail('characterId is required.');
  if (!STANCES.includes(stance)) fail(`Stance must be one of ${STANCES.join(', ')}.`);

  const combat = await getCombatState();
  const stances = { ...combat.stances, [characterId]: stance };

  let warning = '';
  if (stance === 'Rear') {
    const totalEnemies = (await listCombatants()).filter((c) => c.status === 'active').length;
    const companySize = (await listCharacters()).length;
    const rearwardCount = Object.values(stances).filter((s) => s === 'Rear').length;
    const closeCombatCount = Object.values(stances).filter((s) => s && s !== 'Rear').length;
    if (!canEnterRearward({ totalEnemies, companySize, rearwardCount, closeCombatCount })) {
      warning =
        'Not valid by the book right now — Rearward needs total enemies at or under twice the ' +
        'Company size, and two Close Combat heroes per hero in Rearward. Allowed anyway; agree it ' +
        'with the GM.';
    }
  }
  await setCombatState({ stances });

  // Mirror onto the sheet so the existing attack-dice math (stanceAttackDice)
  // on the character sheet keeps working unchanged.
  const character = await getCharacter(characterId);
  if (character) {
    await replaceCharacterSheet(characterId, {
      ...character.sheet,
      combat: { ...character.sheet.combat, stance },
    });
  }
  await broadcastSnapshot();
  return { ...(await combatSnapshot()), warning };
}

export async function lockStances() {
  await setCombatState({ stanceLocked: true });
  await broadcastSnapshot();
  return combatSnapshot();
}

/**
 * Free choice, never enforced (spec). `combatantId: null` clears the pick.
 *
 * `opponentsEngaging` is set to 0/1 to match — see the scope note on
 * engagementCounts() in shared/combat.js for why this can't capture several
 * adversaries piling onto one hero; the GM can still hand-set the sheet field.
 */
export async function setEngagement({ characterId, combatantId }) {
  if (!characterId) fail('characterId is required.');
  const combat = await getCombatState();
  const engagements = { ...combat.engagements, [characterId]: combatantId || null };
  await setCombatState({ engagements });

  const character = await getCharacter(characterId);
  if (character) {
    await replaceCharacterSheet(characterId, {
      ...character.sheet,
      combat: { ...character.sheet.combat, opponentsEngaging: combatantId ? 1 : 0 },
    });
  }
  await broadcastSnapshot();
  return combatSnapshot();
}

/* --- attacks ------------------------------------------------------------------- */

/** A Player-hero attacking a combatant instance. Applies damage immediately. */
export async function attack({
  characterId,
  combatantId,
  skill,
  label,
  rating,
  targetNumber,
  favoured,
  illFavoured,
  extraDice,
  bonus,
  hopeSpent,
  whisperTo,
  weaponDamage,
  piercingThreshold,
}) {
  if (!characterId) fail('characterId is required.');
  if (!combatantId) fail('combatantId is required.');
  const combatant = await getCombatantRow(combatantId);
  if (!combatant) fail('That combatant is no longer in the fight.');

  const combat = await getCombatState();
  const pending = combat.pendingModifiers?.[characterId];
  const totalExtraDice = (Number(extraDice) || 0) + (Number(pending?.extraDice) || 0);

  const { roll, result, message, discord, hopeError } = await performRoll({
    characterId,
    skill,
    kind: 'attack',
    label,
    rating,
    targetNumber,
    favoured,
    illFavoured,
    extraDice: totalExtraDice,
    bonus,
    hopeSpent,
    whisperTo,
  });

  let hit = null;
  let piercingBlow = false;
  if (result.success) {
    piercingBlow = isPiercingBlow(result.featFace, Number(piercingThreshold) || 10);
    const loss = Math.max(0, Number(weaponDamage) || 0);
    const nextEndurance = Math.max(0, combatant.currentEndurance - loss);
    const patch = { currentEndurance: nextEndurance };
    let removed = false;
    if (nextEndurance <= 0) {
      const nextWounds = combatant.woundsTaken + 1;
      if (nextWounds >= combatant.woundThreshold) {
        patch.status = 'down';
        removed = true;
      } else {
        // Flagged by the GM as needing more than one Wound — still standing.
        patch.woundsTaken = nextWounds;
        patch.currentEndurance = 1;
      }
    }
    await updateCombatantRow(combatantId, patch);
    hit = { combatantId, combatantName: combatant.name, enduranceLoss: loss, removed };
  }

  await markActed(characterId);
  await broadcastSnapshot();
  return {
    roll,
    result,
    message,
    discord,
    hopeError,
    hit,
    piercingBlow,
    combat: await combatSnapshot(),
  };
}

/**
 * GM-triggered: a combatant instance attacks a Player-hero. Does NOT apply
 * damage yet — the hit character's controller still gets to choose Knockback
 * (see resolveHit below), which adversaries themselves can never do. Instead
 * this parks a `pendingHits` entry for that character, which is how their own
 * screen (CombatHitPrompt.jsx, gated on their own "Playing As" pick) finds out
 * — never a popup shown to the GM who triggered the roll.
 */
export async function adversaryAttack({
  combatantId,
  characterId,
  label,
  skill,
  rating,
  targetNumber,
  favoured,
  illFavoured,
  extraDice,
  bonus,
  whisperTo,
  weaponDamage,
  weaponInjury,
}) {
  if (!combatantId) fail('combatantId is required.');
  if (!characterId) fail('characterId is required.');
  const combatant = await getCombatantRow(combatantId);
  if (!combatant) fail('That combatant is no longer in the fight.');
  if (combatant.status !== 'active') fail(`${combatant.name} can no longer attack.`);
  const budget = Math.max(1, combatant.might);
  if (combatant.attacksUsedThisRound >= budget) {
    fail(`${combatant.name} has already attacked ${combatant.attacksUsedThisRound} time(s) this round (Might ${combatant.might}).`);
  }
  const target = await getCharacter(characterId);
  if (!target) fail('Target hero not found.');

  const { roll, result, message, discord, hopeError } = await performRoll({
    actorName: combatant.name,
    skill,
    kind: 'attack',
    label,
    rating,
    targetNumber,
    favoured,
    illFavoured,
    extraDice,
    bonus,
    whisperTo,
  });

  await updateCombatantRow(combatantId, { attacksUsedThisRound: combatant.attacksUsedThisRound + 1 });

  const piercingBlow = result.success && isPiercingBlow(result.featFace, 10);
  const enduranceLoss = Math.max(0, Number(weaponDamage) || 0);

  if (result.success) {
    const combat = await getCombatState();
    await setCombatState({
      pendingHits: {
        ...combat.pendingHits,
        [characterId]: {
          stage: 'hit',
          enduranceLoss,
          source: combatant.name,
          rollId: roll.id,
          piercingBlow,
          weaponInjury: Number(weaponInjury) || 0,
        },
      },
    });
  }

  await broadcastSnapshot();
  return {
    roll,
    result,
    message,
    discord,
    hopeError,
    hit: result.success ? { characterId, enduranceLoss, combatantName: combatant.name } : null,
    piercingBlow,
    combat: await combatSnapshot(),
  };
}

/**
 * The hit hero's controller's choice, after adversaryAttack(): take the full
 * loss, or spend their next main action on Knockback to halve it (round up).
 * If the blow was a Piercing Blow, this hands off to the Protection-roll
 * stage instead of clearing the pending hit outright.
 */
export async function resolveHit({ characterId, enduranceLoss, knockback }) {
  if (!characterId) fail('characterId is required.');
  const character = await getCharacter(characterId);
  if (!character) fail('Character not found.');
  const combat = await getCombatState();
  const pending = combat.pendingHits?.[characterId];

  const loss = knockback
    ? Math.ceil((Number(enduranceLoss) || 0) / 2)
    : Math.max(0, Number(enduranceLoss) || 0);
  const endurance = Number(character.sheet.attributes.strength.endurance) || 0;
  const nextEndurance = Math.max(0, endurance - loss);
  await replaceCharacterSheet(characterId, {
    ...character.sheet,
    attributes: {
      ...character.sheet.attributes,
      strength: { ...character.sheet.attributes.strength, endurance: nextEndurance },
    },
  });
  if (knockback) await markActed(characterId);

  const pendingHits = { ...combat.pendingHits };
  if (pending?.piercingBlow) {
    pendingHits[characterId] = { stage: 'protection', weaponInjury: pending.weaponInjury, source: pending.source };
  } else {
    delete pendingHits[characterId];
  }
  await setCombatState({ pendingHits });

  await broadcastSnapshot();
  return {
    characterId,
    appliedLoss: loss,
    endurance: nextEndurance,
    kill: nextEndurance <= 0,
    combat: await combatSnapshot(),
  };
}

/**
 * The Protection roll a Piercing Blow calls for, fired by the hit player from
 * inside the same pop-up that told them about it — Success Dice and TN are
 * computed here from their own sheet and the weapon's Injury rating, exactly
 * as CombatHitPrompt.jsx pre-fills them.
 */
export async function protectionRoll({ characterId, hopeSpent, whisperTo }) {
  if (!characterId) fail('characterId is required.');
  const character = await getCharacter(characterId);
  if (!character) fail('Character not found.');
  const combat = await getCombatState();
  const pending = combat.pendingHits?.[characterId];
  if (!pending || pending.stage !== 'protection') fail('No Protection roll is owed right now.');

  const protection = totalProtection(character.sheet);
  const { roll, result, message, discord, hopeError } = await performRoll({
    characterId,
    skill: 'Protection',
    kind: 'protection',
    label: 'Protection',
    rating: protection.total,
    targetNumber: pending.weaponInjury,
    hopeSpent,
    whisperTo,
  });

  const pendingHits = { ...combat.pendingHits };
  if (result.success) {
    delete pendingHits[characterId];
  } else {
    pendingHits[characterId] = { stage: 'wound-severity', featFace: result.featFace, source: pending.source };
  }
  await setCombatState({ pendingHits });

  await broadcastSnapshot();
  return { roll, result, message, discord, hopeError, combat: await combatSnapshot() };
}

/**
 * The GM's call after a failed Protection roll — see the README's judgment
 * call: this app resolves the Protection roll itself, but the exact healing
 * days for a middling Feat Die result come off the GM's own physical Wound
 * Severity table, not a hard-coded guess here.
 */
export async function recordWoundSeverity({ characterId, healingDays, dying }) {
  if (!characterId) fail('characterId is required.');
  const character = await getCharacter(characterId);
  if (!character) fail('Character not found.');
  const conditions = character.sheet.conditions;
  const patch = conditions.wounded
    ? { dying: true } // second Wound: skip severity entirely
    : { wounded: true, healingDays: Math.max(0, Number(healingDays) || 0), dying: Boolean(dying) };

  const nextSheet = { ...character.sheet, conditions: { ...conditions, ...patch } };
  if (patch.dying) {
    nextSheet.attributes = {
      ...nextSheet.attributes,
      strength: { ...nextSheet.attributes.strength, endurance: 0 },
    };
  }
  await replaceCharacterSheet(characterId, nextSheet);

  const combat = await getCombatState();
  const pendingHits = { ...combat.pendingHits };
  delete pendingHits[characterId];
  await setCombatState({ pendingHits });

  await broadcastSnapshot();
  return { characterId, conditions: nextSheet.conditions, combat: await combatSnapshot() };
}

/* --- tactical actions ----------------------------------------------------------
 * Intimidate Foe, Rally Comrades, Protect Companion, Prepare Shot and Battle
 * all share the same shape: one roll, then an effect on success. Mechanical
 * effects that land on the ROLLER's own next roll (Rally/Prepare/Battle) are
 * applied automatically via pendingModifiers and consumed on that hero's next
 * attack; effects that land on OTHER heroes' rolls (Protect Companion) are
 * shown as a reminder only, the same "GM applies it by eye" treatment Useful
 * Items already get — nothing here enforces those narratively.
 */

const TACTICAL_ACTIONS = {
  'intimidate-foe': { skill: 'Awe', label: 'Intimidate Foe' },
  'rally-comrades': { skill: 'Enhearten', label: 'Rally Comrades' },
  'protect-companion': { skill: 'Athletics', label: 'Protect Companion' },
  'prepare-shot': { skill: 'Scan', label: 'Prepare Shot' },
  battle: { skill: 'Battle', label: 'Battle' },
};

export async function performTacticalAction({
  characterId,
  actionType,
  targetCharacterId,
  gmModifier,
  rating,
  targetNumber,
  favoured,
  illFavoured,
  extraDice,
  bonus,
  hopeSpent,
  whisperTo,
}) {
  const def = TACTICAL_ACTIONS[actionType];
  if (!def) fail(`Unknown combat action "${actionType}".`);
  if (!characterId) fail('characterId is required.');

  const { roll, result, message, discord, hopeError } = await performRoll({
    characterId,
    skill: def.skill,
    kind: 'skill',
    label: def.label,
    rating,
    targetNumber,
    favoured,
    illFavoured,
    extraDice,
    bonus,
    hopeSpent,
    whisperTo,
  });

  let effect = '';
  if (result.success) {
    const icons = result.icons;
    const combat = await getCombatState();
    const pendingModifiers = { ...combat.pendingModifiers };

    if (actionType === 'intimidate-foe') {
      const wearyThreshold = icons >= 2 ? Infinity : icons === 1 ? 2 : 1;
      for (const c of await listCombatants()) {
        if (c.status === 'active' && c.might <= wearyThreshold) {
          // eslint-disable-next-line no-await-in-loop
          await updateCombatantRow(c.id, { weary: true });
        }
      }
      effect =
        icons >= 2
          ? 'Every adversary is Weary for the round.'
          : icons === 1
            ? 'Might 1-2 adversaries are Weary for the round.'
            : 'Might 1 adversaries are Weary for the round.';
    } else if (actionType === 'rally-comrades') {
      const reach = icons >= 2 ? ['Forward', 'Open', 'Defensive'] : icons === 1 ? ['Forward', 'Open'] : ['Forward'];
      for (const [heroId, stance] of Object.entries(combat.stances)) {
        if (heroId === characterId || !reach.includes(stance)) continue;
        pendingModifiers[heroId] = {
          ...(pendingModifiers[heroId] || {}),
          extraDice: (pendingModifiers[heroId]?.extraDice || 0) + 1,
          note: 'Rally Comrades: +1 Success Die next attack',
        };
      }
      await setCombatState({ pendingModifiers });
      effect = `Allies in ${reach.join('/')} stance get +1 Success Die on their next attack.`;
    } else if (actionType === 'protect-companion') {
      if (!targetCharacterId) fail('Protect Companion needs a targetCharacterId.');
      const reduction = 1 + icons;
      pendingModifiers[targetCharacterId] = {
        ...(pendingModifiers[targetCharacterId] || {}),
        note: `Protected: the next attack against them loses ${reduction} Success Die${reduction === 1 ? '' : 's'}.`,
      };
      await setCombatState({ pendingModifiers });
      effect = `The next attack against the protected ally loses ${reduction} Success Die${reduction === 1 ? '' : 's'}.`;
    } else if (actionType === 'prepare-shot') {
      const bonusDice = 1 + icons;
      pendingModifiers[characterId] = {
        ...(pendingModifiers[characterId] || {}),
        extraDice: (pendingModifiers[characterId]?.extraDice || 0) + bonusDice,
        note: `Prepare Shot: +${bonusDice} Success Dice next ranged attack`,
      };
      await setCombatState({ pendingModifiers });
      effect = `+${bonusDice} Success Dice on the next ranged attack.`;
    } else if (actionType === 'battle') {
      const mod = Number(gmModifier) || 0;
      const beneficiaries = [characterId, ...(targetCharacterId ? [targetCharacterId] : [])];
      for (const heroId of beneficiaries) {
        pendingModifiers[heroId] = {
          ...(pendingModifiers[heroId] || {}),
          extraDice: (pendingModifiers[heroId]?.extraDice || 0) + mod,
          note: `Battle: ${mod > 0 ? '+' : ''}${mod} dice next roll`,
        };
      }
      await setCombatState({ pendingModifiers });
      effect =
        `${mod > 0 ? '+' : ''}${mod} dice attached to an upcoming roll` +
        `${icons ? ` (${icons} icon${icons === 1 ? '' : 's'} rolled — extend to more allies by eye)` : ''}.`;
    }
  }

  await markActed(characterId);
  await broadcastSnapshot();
  return { roll, result, message, discord, hopeError, effect, combat: await combatSnapshot() };
}

/* --- retreat --------------------------------------------------------------- */

export async function retreat({
  characterId,
  free,
  rating,
  targetNumber,
  favoured,
  illFavoured,
  extraDice,
  bonus,
  hopeSpent,
  whisperTo,
}) {
  if (!characterId) fail('characterId is required.');

  if (free) {
    // Rearward: leaves on their turn, no roll required.
    const combat = await getCombatState();
    await setCombatState({ engagements: { ...combat.engagements, [characterId]: null } });
    await markActed(characterId);
    await broadcastSnapshot();
    return { retreated: true, combat: await combatSnapshot() };
  }

  // Defensive: their normal attack roll — success means no damage dealt, but
  // they disengage; failure means they stay put.
  const { roll, result, message, discord, hopeError } = await performRoll({
    characterId,
    skill: 'Retreat',
    kind: 'attack',
    label: 'Retreat',
    rating,
    targetNumber,
    favoured,
    illFavoured,
    extraDice,
    bonus,
    hopeSpent,
    whisperTo,
  });

  if (result.success) {
    const combat = await getCombatState();
    await setCombatState({ engagements: { ...combat.engagements, [characterId]: null } });
  }
  await markActed(characterId);
  await broadcastSnapshot();
  return { roll, result, message, discord, hopeError, retreated: result.success, combat: await combatSnapshot() };
}

/* --- Discord ----------------------------------------------------------------- */

/**
 * Same plumbing the journey engine uses — see server/lib/discord.js.
 * "[Adversary] - [Ability] - [Text]", so the channel knows who did it.
 */
export async function announceFellAbility({ sourceName, name, description }) {
  const source = sourceName ? `${boldName(sourceName)} - ` : '';
  const discord = await postToDiscord(
    formatMessage('💀', `${source}${boldName(name || 'Fell Ability')}${description ? ` - ${description}` : ''}`),
  );
  return { ok: true, discord };
}

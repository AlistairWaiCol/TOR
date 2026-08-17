/**
 * The single server-side path every roll takes.
 *
 * Doing this on the server (rather than in the browser) means one dice engine,
 * one Discord post, one persisted Roll row, and one broadcast — no matter
 * whether the roll came from a character sheet button, the Marching Test, or the
 * end-of-journey Fatigue relief.
 */

import { rollDice } from '../../shared/dice.js';
import { rollContextForSkill } from '../../shared/character.js';
import { formatRollMessage, postToDiscord } from './discord.js';
import { broadcast, broadcastToGM } from '../realtime.js';
import {
  adjustCharacterPool,
  createRoll,
  getCampaign,
  getCharacter,
} from './store.js';

/**
 * @param {object} input
 * @param {string} [input.characterId]  Whose sheet the roll comes from.
 * @param {string} [input.skill]        Named skill / proficiency; drives rating + TN.
 * @param {string} [input.kind]         Roll kind (see schema.rolls.kind).
 * @param {string} [input.label]        Human label for the log / Discord.
 * @param {number} [input.rating]       Overrides the sheet's skill rating.
 * @param {number} [input.targetNumber] Overrides the derived TN.
 * @param {boolean}[input.favoured]     Overrides the sheet's Favoured state.
 * @param {boolean}[input.illFavoured]
 * @param {boolean}[input.hopeSpent]    Spend 1 Hope for bonus dice (deducted).
 * @param {number} [input.extraDice]    Situational Success Dice.
 * @param {number} [input.bonus]        Flat bonus to the total.
 * @param {string} [input.whisperTo]    public | gm | me | <name>
 */
export async function performRoll(input = {}, { rng } = {}) {
  const campaign = await getCampaign();
  const tnBase = input.tnBase ?? campaign.tnBase ?? 20;

  let character = null;
  let context = {
    rating: 0,
    targetNumber: 14,
    favoured: false,
    illFavoured: false,
    weary: false,
    miserable: false,
    inspired: false,
    hope: 0,
  };

  if (input.characterId) {
    character = await getCharacter(input.characterId);
    if (!character) throw Object.assign(new Error('Character not found.'), { status: 404 });
    if (input.skill) {
      context = { ...context, ...rollContextForSkill(character.sheet, input.skill, { tnBase }) };
    } else {
      const c = character.sheet.conditions;
      context = {
        ...context,
        favoured: c.favourState === 'Favoured',
        illFavoured: c.favourState === 'Ill-Favoured',
        weary: Boolean(c.weary),
        miserable: Boolean(c.miserable),
        inspired: Boolean(c.inspired),
        hope: character.sheet.attributes.heart.hope,
      };
    }
  }

  // Explicit request values win over sheet-derived ones.
  const rating = input.rating != null ? Number(input.rating) : context.rating;
  const targetNumber = input.targetNumber != null ? Number(input.targetNumber) : context.targetNumber;
  const favoured = input.favoured != null ? Boolean(input.favoured) : context.favoured;
  const illFavoured = input.illFavoured != null ? Boolean(input.illFavoured) : context.illFavoured;
  const weary = input.weary != null ? Boolean(input.weary) : context.weary;
  const miserable = input.miserable != null ? Boolean(input.miserable) : context.miserable;
  const inspired = input.inspired != null ? Boolean(input.inspired) : context.inspired;

  // A Hope spend requires actually having a Hope point to spend.
  let hopeSpent = Boolean(input.hopeSpent);
  let hopeError = null;
  if (hopeSpent && character && (context.hope ?? 0) < 1) {
    hopeSpent = false;
    hopeError = 'No Hope left to spend — rolled without the bonus dice.';
  }

  const result = rollDice(
    {
      rating,
      targetNumber,
      tnBase,
      favoured,
      illFavoured,
      weary,
      miserable,
      inspired,
      hopeSpent,
      extraDice: Number(input.extraDice) || 0,
      bonus: Number(input.bonus) || 0,
    },
    rng,
  );

  if (hopeSpent && character) {
    await adjustCharacterPool(character.id, 'heart', 'hope', -1);
  }

  const actorName = input.actorName || character?.name || '';
  const label = input.label || input.skill || 'Roll';
  const whisperTo = input.whisperTo || 'public';

  const roll = await createRoll({
    characterId: character?.id ?? null,
    characterName: actorName,
    journeyId: input.journeyId ?? null,
    journeyEventId: input.journeyEventId ?? null,
    kind: input.kind || 'skill',
    label,
    skill: input.skill || '',
    result,
    whisperTo,
    note: input.note || '',
  });

  const message = formatRollMessage({
    kind: input.kind || 'skill',
    label,
    actor: actorName,
    result,
    extra: input.discordExtra,
  });
  const discord = await postToDiscord(message, { whisperTo });

  const payload = { roll, message, whisperTo };
  if (whisperTo === 'public') broadcast('roll:new', payload);
  else broadcastToGM('roll:new', payload);

  return { roll, result, message, discord, hopeError, character };
}

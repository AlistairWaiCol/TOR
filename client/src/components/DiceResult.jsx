import { EYE, GANDALF } from '@shared/dice.js';

function featLabel(face) {
  if (face === GANDALF) return 'ᚷ';
  if (face === EYE) return '👁';
  return String(face);
}

export function FeatDie({ die }) {
  const cls = [
    'die',
    'feat',
    die.isGandalf ? 'gandalf' : '',
    die.isEye ? 'eye' : '',
    die.kept === false ? 'dropped' : '',
  ]
    .filter(Boolean)
    .join(' ');
  const title = die.isGandalf
    ? 'Gandalf rune — automatic success'
    : die.isEye
      ? 'Eye of Sauron — counts 0 (automatic failure if Miserable)'
      : `Feat Die ${die.value}`;
  return (
    <span className={cls} title={title}>
      {featLabel(die.face)}
    </span>
  );
}

export function SuccessDie({ die }) {
  const zeroed = die.counted === 0 && die.value > 0;
  const cls = ['die', die.icon ? 'icon' : '', zeroed ? 'zeroed' : ''].filter(Boolean).join(' ');
  const title = die.icon
    ? 'Success icon (6)'
    : zeroed
      ? `Outlined ${die.value} — zeroed by Weary`
      : `Success Die ${die.value}`;
  return (
    <span className={cls} title={title}>
      {die.icon ? '✦' : die.value}
    </span>
  );
}

/** Full readout of a dice-engine result: the dice, the maths, the verdict. */
export default function DiceResult({ result, compact = false }) {
  if (!result) return null;
  const verdict = result.autoFail
    ? 'Automatic failure — Eye of Sauron while Miserable'
    : result.autoSuccess
      ? 'Automatic success — Gandalf rune'
      : result.success
        ? 'Success'
        : 'Failure';
  const levelText =
    result.success && result.icons > 0
      ? result.icons >= 2
        ? ' (extraordinary success)'
        : ' (great success)'
      : '';

  return (
    <div>
      <div className="row tight" style={{ marginBottom: 6 }}>
        {(result.featDice ?? []).map((d, i) => (
          <FeatDie key={`f${i}`} die={d} />
        ))}
        {(result.successDice ?? []).length ? <span className="muted">+</span> : null}
        {(result.successDice ?? []).map((d, i) => (
          <SuccessDie key={`s${i}`} die={d} />
        ))}
      </div>
      <div className="result-line">
        <strong>{result.total}</strong> <span className="muted">vs TN {result.targetNumber}</span>
        {' — '}
        <span className={result.success ? 'ok' : 'bad'}>
          {verdict}
          {levelText}
        </span>
      </div>
      {!compact ? (
        <div className="small muted">
          Feat {result.isGandalf ? 'rune' : result.isEye ? 'Eye (0)' : result.featValue}
          {' + '}
          {result.successTotal} from {(result.successDice ?? []).length} Success{' '}
          {(result.successDice ?? []).length === 1 ? 'Die' : 'Dice'}
          {result.bonus ? ` ${result.bonus > 0 ? '+' : ''}${result.bonus} bonus` : ''}
          {' · '}
          {result.icons} Success icon{result.icons === 1 ? '' : 's'}
          {result.favourState && result.favourState !== 'normal' ? ` · ${result.favourState}` : ''}
          {result.weary ? ' · Weary' : ''}
          {result.miserable ? ' · Miserable' : ''}
          {result.hopeSpent ? ` · Hope spent (+${result.bonusDice} dice)` : ''}
          {result.extraDice ? ` · ${result.extraDice > 0 ? '+' : ''}${result.extraDice} situational dice` : ''}
        </div>
      ) : null}
    </div>
  );
}

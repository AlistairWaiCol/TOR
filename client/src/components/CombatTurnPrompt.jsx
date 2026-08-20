import { Link, useLocation } from 'react-router-dom';
import { STANCE_LABELS, promptedCombatActionFor } from '@shared/combat.js';
import { useApp } from '../state/AppContext.jsx';

/**
 * "It's your stance-block's turn in combat." Same shell-level nudge pattern
 * as TurnPrompt.jsx, for a player who is not looking at the Combat Tracker —
 * turns open strictly Forward -> Open -> Defensive -> Rearward, so this fires
 * once every earlier stance block has acted and it's finally this hero's turn.
 */
export default function CombatTurnPrompt() {
  const { combat, playingCharacter } = useApp();
  const location = useLocation();

  const prompt = promptedCombatActionFor({ combat, characterId: playingCharacter?.id });
  if (!prompt || location.pathname === '/combat') return null;

  return (
    <div className="turn-prompt">
      <h3>
        {STANCE_LABELS[prompt.stance]} stance ({playingCharacter?.name ?? 'You'}) — it's your turn to act
      </h3>
      <p className="small muted" style={{ margin: '0 0 8px' }}>
        Attack, a tactical action, or Retreat — open the Combat Tracker to act.
      </p>
      <div className="row">
        <Link className="primary" to="/combat">
          open the Combat Tracker
        </Link>
      </div>
    </div>
  );
}

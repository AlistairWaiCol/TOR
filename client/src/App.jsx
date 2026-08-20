import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { useApp } from './state/AppContext.jsx';
import Login from './pages/Login.jsx';
import Overview from './pages/Overview.jsx';
import Characters from './pages/Characters.jsx';
import CharacterSheet from './pages/CharacterSheet.jsx';
import MapView from './pages/MapView.jsx';
import Calibration from './pages/Calibration.jsx';
import Journeys from './pages/Journeys.jsx';
import JourneyDetail from './pages/JourneyDetail.jsx';
import Compendium from './pages/Compendium.jsx';
import Handouts from './pages/Handouts.jsx';
import AdventureNotes from './pages/AdventureNotes.jsx';
import CombatTracker from './pages/CombatTracker.jsx';
import TurnPrompt from './components/TurnPrompt.jsx';
import CombatTurnPrompt from './components/CombatTurnPrompt.jsx';

/**
 * Nav is data-driven so a v2 section can be switched on by swapping
 * `soon: true` for a real component — no layout or routing rewrite needed.
 * Handouts, the Compendium, Adventure Notes and now the Combat Tracker were
 * all promoted out of "Later" that way. NPCs/Bestiary ended up folded into
 * the Compendium's own Adversaries section rather than a separate page, so
 * there's nothing left in "Later" for the moment.
 */
const NAV = [
  { section: 'Campaign' },
  { to: '/', label: 'Overview', end: true },
  { to: '/characters', label: 'Characters' },
  { to: '/compendium', label: 'Compendium' },
  { to: '/handouts', label: 'Handouts' },
  { to: '/notes', label: 'Adventure Notes' },
  { section: 'Travel' },
  { to: '/map', label: 'Map & Travel' },
  { to: '/journeys', label: 'Journey Log' },
  { section: 'Combat' },
  { to: '/combat', label: 'Combat Tracker' },
  { section: 'Game Master', gmOnly: true },
  { to: '/calibration', label: 'Map Calibration', gmOnly: true },
];

/**
 * "Which of these heroes am I playing?" — stored in localStorage, per browser.
 *
 * Explicitly NOT a permission: anyone may still open and edit any sheet, the
 * same as before. All it does is decide who the travel engine's "your turn to
 * roll" prompts are addressed to.
 */
function PlayingAsPicker() {
  const { characters, playingAs, setPlayingAs } = useApp();
  return (
    <div className="play-as">
      <label className="field" style={{ marginBottom: 0 }}>
        <span>Playing as</span>
        <select
          value={playingAs}
          onChange={(e) => setPlayingAs(e.target.value)}
          title="Local to this browser — it decides who gets prompted to roll, nothing else"
        >
          <option value="">— nobody in particular —</option>
          {characters.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
    </div>
  );
}

function Sidebar() {
  const { isGM, role, logout, connected, campaign } = useApp();
  return (
    <nav className="sidebar">
      <div className="brand">
        One Ring Companion
        <small>Darkening of Mirkwood</small>
      </div>

      <PlayingAsPicker />

      {NAV.map((item, i) => {
        if (item.section) {
          if (item.gmOnly && !isGM) return null;
          return (
            <div className="nav-section" key={`s${i}`}>
              {item.section}
            </div>
          );
        }
        if (item.gmOnly && !isGM) return null;
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-link ${isActive ? 'active' : ''} ${item.soon ? 'soon' : ''}`}
          >
            <span>{item.label}</span>
            {item.soon ? <span className="tag">soon</span> : null}
          </NavLink>
        );
      })}

      <div className="sidebar-foot">
        <div>
          {campaign ? `${campaign.season} ${campaign.year}` : '—'}
          {campaign?.tnBase === 18 ? ' · TN base 18' : ''}
        </div>
        <div style={{ margin: '4px 0' }}>
          <span className={`pill ${connected ? 'ok' : 'bad'}`}>{connected ? 'live' : 'offline'}</span>{' '}
          <span className="pill gold">{role === 'gm' ? 'GM' : 'Player'}</span>
        </div>
        <button className="small" onClick={logout}>
          Sign out
        </button>
      </div>
    </nav>
  );
}

function RequireGM({ children }) {
  const { isGM } = useApp();
  if (!isGM) {
    return (
      <div className="panel">
        <h2>GM only</h2>
        <p className="muted">This screen needs the GM passcode.</p>
      </div>
    );
  }
  return children;
}

export default function App() {
  const { role } = useApp();

  if (role === undefined) {
    return (
      <div className="login-wrap">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!role) return <Login />;

  return (
    <div className="app">
      <Sidebar />
      <main className="main">
        <Routes>
          <Route path="/" element={<Overview />} />
          <Route path="/characters" element={<Characters />} />
          <Route path="/characters/:id" element={<CharacterSheet />} />
          <Route path="/compendium" element={<Compendium />} />
          <Route path="/handouts" element={<Handouts />} />
          <Route path="/notes" element={<AdventureNotes />} />
          <Route path="/map" element={<MapView />} />
          <Route
            path="/calibration"
            element={
              <RequireGM>
                <Calibration />
              </RequireGM>
            }
          />
          <Route path="/journeys" element={<Journeys />} />
          <Route path="/journeys/:id" element={<JourneyDetail />} />
          <Route path="/combat" element={<CombatTracker />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {/* At the shell, not inside the Map page: "it's your turn" is most useful
          to a player who is looking at something else. */}
      <TurnPrompt />
      <CombatTurnPrompt />
    </div>
  );
}

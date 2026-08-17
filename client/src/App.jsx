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
import ComingSoon from './pages/ComingSoon.jsx';

/**
 * Nav is data-driven so the v2 sections (combat tracker, bestiary, session
 * notes) can be switched on by swapping `soon: true` for a real component —
 * no layout or routing rewrite needed.
 */
const NAV = [
  { section: 'Campaign' },
  { to: '/', label: 'Overview', end: true },
  { to: '/characters', label: 'Characters' },
  { section: 'Travel' },
  { to: '/map', label: 'Map & Travel' },
  { to: '/journeys', label: 'Journey Log' },
  { section: 'Game Master', gmOnly: true },
  { to: '/calibration', label: 'Map Calibration', gmOnly: true },
  { section: 'Later' },
  { to: '/combat', label: 'Combat Tracker', soon: true },
  { to: '/bestiary', label: 'Bestiary & NPCs', soon: true },
  { to: '/notes', label: 'Session Notes', soon: true },
];

function Sidebar() {
  const { isGM, role, logout, connected, campaign } = useApp();
  return (
    <nav className="sidebar">
      <div className="brand">
        One Ring Companion
        <small>Darkening of Mirkwood</small>
      </div>

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
          <Route path="/combat" element={<ComingSoon title="Combat Tracker" />} />
          <Route path="/bestiary" element={<ComingSoon title="Bestiary & NPCs" />} />
          <Route path="/notes" element={<ComingSoon title="Session Notes" />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </div>
  );
}

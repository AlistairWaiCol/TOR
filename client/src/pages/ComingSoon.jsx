const BLURB = {
  'Combat Tracker': 'Initiative order, stances, Endurance/Wound tracking and Piercing Blows.',
  'Bestiary & NPCs': 'Adversary stat blocks and named NPCs, wired into the combat tracker.',
  'Session Notes': 'You keep the narrative record by hand — this would be a place to paste it.',
};

export default function ComingSoon({ title }) {
  return (
    <>
      <div className="page-head">
        <h1>{title}</h1>
        <span className="pill">not in v1</span>
      </div>
      <div className="panel">
        <p className="muted">{BLURB[title] ?? 'Planned for a later pass.'}</p>
        <p className="small muted" style={{ marginBottom: 0 }}>
          Deliberately out of scope for v1. The nav, routing and data layer already leave room for
          it: add a page component and flip the nav entry in <span className="mono">client/src/App.jsx</span>.
        </p>
      </div>
    </>
  );
}

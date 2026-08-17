import { useState } from 'react';
import { useApp } from '../state/AppContext.jsx';

export default function Login() {
  const { login } = useApp();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(passcode);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <h1>One Ring Companion</h1>
        <p className="muted small" style={{ marginTop: 0 }}>
          Darkening of Mirkwood · shared passcode
        </p>
        {error ? <div className="error-box">{error}</div> : null}
        <label className="field">
          <span>Passcode</span>
          <input
            type="password"
            value={passcode}
            autoFocus
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="player or GM passcode"
          />
        </label>
        <button className="primary" type="submit" disabled={busy || !passcode}>
          {busy ? 'Checking…' : 'Enter'}
        </button>
        <p className="small muted" style={{ marginBottom: 0 }}>
          The player passcode gives full read/write on everything. The GM passcode adds the roll
          trigger, map calibration and Year/Season editing.
        </p>
      </form>
    </div>
  );
}

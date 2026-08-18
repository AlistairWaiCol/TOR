import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { disconnectSocket, getSocket } from '../lib/socket.js';

const AppContext = createContext(null);

/**
 * "Which of these heroes am I playing?" — a per-browser preference, NOT an
 * account and NOT a permission. Anyone may still open and edit any sheet; this
 * only decides who the travel-engine prompts are addressed to.
 */
const PLAYING_AS_KEY = 'orc:playing-as';

const NO_CHARACTERS = [];

function readPlayingAs() {
  try {
    return window.localStorage.getItem(PLAYING_AS_KEY) || '';
  } catch {
    return ''; // private mode / storage disabled
  }
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside <AppProvider>');
  return ctx;
}

export function AppProvider({ children }) {
  const [role, setRole] = useState(undefined); // undefined = still checking
  const [snapshot, setSnapshot] = useState(null);
  const [rollFeed, setRollFeed] = useState([]);
  const [connected, setConnected] = useState(false);
  const [playingAs, setPlayingAsState] = useState(readPlayingAs);

  const setPlayingAs = useCallback((characterId) => {
    const id = characterId || '';
    setPlayingAsState(id);
    try {
      if (id) window.localStorage.setItem(PLAYING_AS_KEY, id);
      else window.localStorage.removeItem(PLAYING_AS_KEY);
    } catch {
      // Nothing to do — the selection just will not survive a reload.
    }
  }, []);

  useEffect(() => {
    api
      .get('/auth/session')
      .then((d) => setRole(d.role ?? null))
      .catch(() => setRole(null));
  }, []);

  useEffect(() => {
    if (!role) {
      disconnectSocket();
      setConnected(false);
      return undefined;
    }
    const socket = getSocket();
    const onSnapshot = (s) => setSnapshot(s);
    const onRoll = (payload) => setRollFeed((prev) => [payload, ...prev].slice(0, 60));
    const onConnect = () => {
      setConnected(true);
      socket.emit('state:request');
    };
    const onDisconnect = () => setConnected(false);

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('state:snapshot', onSnapshot);
    socket.on('roll:new', onRoll);
    if (socket.connected) onConnect();

    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('state:snapshot', onSnapshot);
      socket.off('roll:new', onRoll);
    };
  }, [role]);

  const login = useCallback(async (passcode) => {
    const d = await api.post('/auth/login', { passcode });
    setRole(d.role);
    return d;
  }, []);

  const logout = useCallback(async () => {
    await api.post('/auth/logout');
    disconnectSocket();
    setRole(null);
    setSnapshot(null);
  }, []);

  const refresh = useCallback(() => {
    const socket = getSocket();
    socket.emit('state:request');
  }, []);

  // Stable empty array, so the memo below is not busted on every render while
  // the first snapshot is still in flight.
  const characters = snapshot?.characters ?? NO_CHARACTERS;

  const value = useMemo(
    () => ({
      role,
      isGM: role === 'gm',
      snapshot,
      campaign: snapshot?.campaign ?? null,
      characters,
      // A stored id whose character has since been deleted resolves to null
      // rather than leaving the selector pointing at nothing.
      playingAs: characters.some((c) => c.id === playingAs) ? playingAs : '',
      playingCharacter: characters.find((c) => c.id === playingAs) ?? null,
      setPlayingAs,
      party: snapshot?.party ?? null,
      travel: snapshot?.travel ?? null,
      journey: snapshot?.journey ?? null,
      events: snapshot?.events ?? [],
      calibration: snapshot?.calibration ?? null,
      hexes: snapshot?.hexes ?? [],
      locations: snapshot?.locations ?? [],
      rollFeed,
      connected,
      login,
      logout,
      refresh,
    }),
    [role, snapshot, characters, playingAs, setPlayingAs, rollFeed, connected, login, logout, refresh],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { disconnectSocket, getSocket } from '../lib/socket.js';

const AppContext = createContext(null);

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

  const value = useMemo(
    () => ({
      role,
      isGM: role === 'gm',
      snapshot,
      campaign: snapshot?.campaign ?? null,
      characters: snapshot?.characters ?? [],
      party: snapshot?.party ?? null,
      travel: snapshot?.travel ?? null,
      journey: snapshot?.journey ?? null,
      events: snapshot?.events ?? [],
      calibration: snapshot?.calibration ?? null,
      hexes: snapshot?.hexes ?? [],
      rollFeed,
      connected,
      login,
      logout,
      refresh,
    }),
    [role, snapshot, rollFeed, connected, login, logout, refresh],
  );

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

/**
 * Socket.IO wiring and the broadcast helpers the rest of the server uses.
 *
 * Kept in its own module with a settable `io` so route modules and the travel
 * engine can broadcast without importing the HTTP server (no circular imports).
 */

import { Server } from 'socket.io';
import { config } from './config.js';
import { tokenFromCookieHeader, verifySession } from './lib/auth.js';
import {
  getCampaign,
  getParty,
  getTravelState,
  listCharacters,
  getActiveCalibration,
  listHexes,
  getJourney,
  listJourneyEvents,
  listCompendium,
} from './lib/store.js';

let io = null;

export function getIo() {
  return io;
}

export function broadcast(event, payload) {
  if (io) io.emit(event, payload);
}

export function broadcastToGM(event, payload) {
  if (io) io.to('gm').emit(event, payload);
}

/** Full snapshot of everything the live map view needs. */
export async function buildSnapshot() {
  const [campaign, party, travel, characters, calibration, locationList] = await Promise.all([
    getCampaign(),
    getParty(),
    getTravelState(),
    listCharacters(),
    getActiveCalibration(),
    // The live map needs Locations to resolve a hex's linkedLocationId.
    listCompendium('locations'),
  ]);
  const hexList = calibration ? await listHexes(calibration.id) : [];
  let journey = null;
  let events = [];
  if (travel.journeyId) {
    journey = await getJourney(travel.journeyId);
    if (journey) events = await listJourneyEvents(journey.id);
  }
  return {
    campaign,
    party,
    travel,
    journey,
    events,
    calibration,
    hexes: hexList,
    locations: locationList,
    characters: characters.map((c) => ({
      id: c.id,
      name: c.name,
      player: c.player,
      culture: c.culture,
      sheet: c.sheet,
    })),
    at: new Date().toISOString(),
  };
}

/** Push the current snapshot to every connected client. */
export async function broadcastSnapshot() {
  if (!io) return null;
  const snapshot = await buildSnapshot();
  io.emit('state:snapshot', snapshot);
  return snapshot;
}

export function attachRealtime(httpServer) {
  io = new Server(httpServer, {
    cors: { origin: config.clientOrigin, credentials: true },
  });

  io.use((socket, next) => {
    const cookieToken = tokenFromCookieHeader(socket.handshake.headers?.cookie);
    const authToken = socket.handshake.auth?.token || socket.handshake.headers?.['x-orc-token'];
    const role = verifySession(cookieToken) || verifySession(authToken);
    if (!role) return next(new Error('Passcode required.'));
    socket.data.role = role;
    return next();
  });

  io.on('connection', async (socket) => {
    socket.join('all');
    if (socket.data.role === 'gm') socket.join('gm');

    socket.emit('session', { role: socket.data.role, socketId: socket.id });
    socket.emit('state:snapshot', await buildSnapshot());

    // Clients ask for a resync after reconnecting.
    socket.on('state:request', async () => {
      socket.emit('state:snapshot', await buildSnapshot());
    });

    // Route drawing is the one thing every player may do live (spec §6b).
    socket.on('route:set', async (payload, ack) => {
      try {
        const party = await getParty();
        if (party.routeLocked && socket.data.role !== 'gm') {
          if (ack) ack({ ok: false, error: 'Route is locked by the GM.' });
          return;
        }
        const { updateParty } = await import('./lib/store.js');
        const route = Array.isArray(payload?.route)
          ? payload.route.map((h) => ({ col: Number(h.col), row: Number(h.row) }))
          : [];
        const updated = await updateParty({ route });
        io.emit('party:update', updated);
        await broadcastSnapshot();
        if (ack) ack({ ok: true, party: updated });
      } catch (err) {
        if (ack) ack({ ok: false, error: err.message });
      }
    });

    socket.on('ping:check', (_p, ack) => {
      if (ack) ack({ ok: true, role: socket.data.role });
    });
  });

  return io;
}

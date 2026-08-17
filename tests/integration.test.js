/**
 * End-to-end checks against a real server + real SQLite file:
 *  - passcode gate (player vs GM)
 *  - character CRUD persistence
 *  - map derivative generation, and that the original is NOT reachable
 *  - two concurrent Socket.IO clients receiving the same state update
 *  - the full travel sequence from Marching Test to Fatigue relief
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';

const PORT = 3411;
const DB_FILE = `./data/test-${process.pid}.db`;

process.env.PORT = String(PORT);
process.env.DATABASE_URL = `file:${DB_FILE}`;
process.env.PLAYER_PASSCODE = 'test-player';
process.env.GM_PASSCODE = 'test-gm';
process.env.SESSION_SECRET = 'test-secret';
process.env.DISCORD_WEBHOOK_URL = '';

const { paths, projectRoot } = await import('../server/config.js');
const serverModule = await import('../server/index.js');
const sharp = (await import('sharp')).default;
const { io: ioClient } = await import('socket.io-client');

const BASE = `http://localhost:${PORT}`;
const TEST_MAP = 'zz-test-map.png';

let playerToken = '';
let gmToken = '';

async function call(method, url, body, token) {
  const res = await fetch(`${BASE}/api${url}`, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-orc-token': token } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  return { status: res.status, data, res };
}

const gm = (m, u, b) => call(m, u, b, gmToken);
const player = (m, u, b) => call(m, u, b, playerToken);

before(async () => {
  // Give listen() a moment.
  await new Promise((r) => setTimeout(r, 400));
  const p = await call('POST', '/auth/login', { passcode: 'test-player' });
  assert.equal(p.status, 200);
  playerToken = p.data.token;
  const g = await call('POST', '/auth/login', { passcode: 'test-gm' });
  assert.equal(g.status, 200);
  gmToken = g.data.token;
});

after(async () => {
  const { getIo } = await import('../server/realtime.js');
  try {
    getIo()?.close();
  } catch {}
  serverModule.server.close();
  const { getSqlite } = await import('../server/db/index.js');
  try {
    getSqlite().close();
  } catch {}
  for (const suffix of ['', '-wal', '-shm']) {
    await fsp.rm(path.join(projectRoot, DB_FILE + suffix), { force: true }).catch(() => {});
  }
  await fsp.rm(path.join(paths.seed, TEST_MAP), { force: true }).catch(() => {});
});

describe('passcode gate', () => {
  it('rejects an unknown passcode', async () => {
    const r = await call('POST', '/auth/login', { passcode: 'nope' });
    assert.equal(r.status, 401);
  });

  it('refuses unauthenticated API access', async () => {
    const r = await call('GET', '/characters');
    assert.equal(r.status, 401);
  });

  it('gives the player passcode read/write but not GM controls', async () => {
    assert.equal((await player('GET', '/characters')).status, 200);
    const r = await player('PATCH', '/campaign', { year: 2947 });
    assert.equal(r.status, 403);
  });

  it('gives the GM passcode the GM controls', async () => {
    const r = await gm('PATCH', '/campaign', { year: 2947, season: 'Autumn' });
    assert.equal(r.status, 200);
    assert.equal(r.data.campaign.year, 2947);
    assert.equal(r.data.campaign.season, 'Autumn');
  });

  it('rejects an invalid season and an invalid TN base', async () => {
    assert.equal((await gm('PATCH', '/campaign', { season: 'Mud' })).status, 400);
    assert.equal((await gm('PATCH', '/campaign', { tnBase: 19 })).status, 400);
  });
});

describe('character CRUD against SQLite', () => {
  let id;

  it('creates a character', async () => {
    const r = await player('POST', '/characters', { name: 'Haldamir', player: 'Sam' });
    assert.equal(r.status, 201);
    id = r.data.character.id;
    assert.equal(r.data.character.name, 'Haldamir');
    // The full §5 sheet skeleton comes back hydrated.
    assert.ok(r.data.character.sheet.attributes.heart.skills.Travel);
    assert.ok(r.data.character.sheet.combat.proficiencies.Swords);
  });

  it('persists edits across a fresh read', async () => {
    const get1 = await player('GET', `/characters/${id}`);
    const sheet = get1.data.character.sheet;
    sheet.general.culture = 'Woodmen of Wilderland';
    sheet.general.calling = 'Warden';
    sheet.attributes.heart.rating = 5;
    sheet.attributes.heart.skills.Travel.rating = 3;
    sheet.attributes.heart.skills.Travel.favoured = true;
    sheet.attributes.heart.hope = 9;
    sheet.attributes.heart.hopeMax = 12;
    sheet.rewards.valour = 3;
    sheet.mount = { name: 'Windfola', vigour: 2, treasure: 0 };
    sheet.weapons = [
      {
        id: 'w1',
        equipped: true,
        type: 'Long sword',
        damage: 5,
        injury: 16,
        load: 3,
        notes: '',
        proficiency: 'Swords',
        fell: 'enhanced_elven',
        grievous: 'standard',
        keen: 'enhanced_dwarven',
      },
    ];

    const put = await player('PUT', `/characters/${id}/sheet`, { sheet });
    assert.equal(put.status, 200);

    const get2 = await player('GET', `/characters/${id}`);
    const s2 = get2.data.character.sheet;
    assert.equal(s2.general.culture, 'Woodmen of Wilderland');
    assert.equal(s2.attributes.heart.rating, 5);
    assert.equal(s2.attributes.heart.skills.Travel.rating, 3);
    assert.equal(s2.attributes.heart.skills.Travel.favoured, true);
    assert.equal(s2.attributes.heart.hope, 9);
    assert.equal(s2.rewards.valour, 3);
    assert.equal(s2.mount.vigour, 2);
    assert.equal(s2.weapons[0].keen, 'enhanced_dwarven');
    assert.equal(get2.data.character.culture, 'Woodmen of Wilderland');
  });

  it('supports partial PATCH without clobbering other sections', async () => {
    const r = await player('PATCH', `/characters/${id}`, {
      sheet: { conditions: { weary: true } },
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.character.sheet.conditions.weary, true);
    assert.equal(r.data.character.sheet.general.culture, 'Woodmen of Wilderland');
    assert.equal(r.data.character.sheet.attributes.heart.hope, 9);
    await player('PATCH', `/characters/${id}`, { sheet: { conditions: { weary: false } } });
  });

  it('rolls a skill through the shared dice engine and applies sheet state', async () => {
    const r = await player('POST', `/characters/${id}/roll`, { skill: 'Travel', kind: 'skill' });
    assert.equal(r.status, 200);
    // Heart 5 -> TN 15 with the standard base of 20.
    assert.equal(r.data.result.targetNumber, 15);
    assert.equal(r.data.result.rating, 3);
    // The skill's own Favoured checkbox means two Feat Dice.
    assert.equal(r.data.result.featDice.length, 2);
    assert.equal(r.data.result.favourState, 'favoured');
  });

  it('deducts Hope when a Hope point is spent for bonus dice', async () => {
    const before = (await player('GET', `/characters/${id}`)).data.character.sheet.attributes.heart.hope;
    const r = await player('POST', `/characters/${id}/roll`, {
      skill: 'Travel',
      hopeSpent: true,
    });
    assert.equal(r.data.result.hopeSpent, true);
    assert.equal(r.data.result.bonusDice, 1);
    assert.equal(r.data.result.successDice.length, 4); // rating 3 + 1
    const after = (await player('GET', `/characters/${id}`)).data.character.sheet.attributes.heart.hope;
    assert.equal(after, before - 1);
  });

  it('refuses to spend Hope the hero does not have', async () => {
    const get = await player('GET', `/characters/${id}`);
    const sheet = get.data.character.sheet;
    sheet.attributes.heart.hope = 0;
    await player('PUT', `/characters/${id}/sheet`, { sheet });
    const r = await player('POST', `/characters/${id}/roll`, { skill: 'Travel', hopeSpent: true });
    assert.equal(r.data.result.hopeSpent, false);
    assert.match(r.data.hopeError, /No Hope left/);
  });

  it('records Special Successes only within the icons actually rolled', async () => {
    const r = await player('POST', '/rolls', {
      label: 'rigged',
      rating: 0,
      targetNumber: 1,
    });
    const rollId = r.data.roll.id;
    const icons = r.data.result.icons;
    const tooMany = await player('PATCH', `/rolls/${rollId}`, {
      specialSuccesses: Array.from({ length: icons + 1 }, () => 'Make Haste'),
    });
    assert.equal(tooMany.status, 400);
  });

  it('deletes a character', async () => {
    const tmp = await player('POST', '/characters', { name: 'Doomed' });
    const del = await player('DELETE', `/characters/${tmp.data.character.id}`);
    assert.equal(del.status, 200);
    assert.equal((await player('GET', `/characters/${tmp.data.character.id}`)).status, 404);
  });
});

describe('map derivatives', () => {
  let calibrationId;

  it('generates web-sized tiers and never exposes the original', async () => {
    await fsp.mkdir(paths.seed, { recursive: true });
    const seedPath = path.join(paths.seed, TEST_MAP);
    // A deliberately oversized source so the resize logic actually has work to do.
    await sharp({
      create: { width: 4200, height: 2600, channels: 3, background: '#4a5b3c' },
    })
      .png()
      .toFile(seedPath);
    const originalBytes = (await fsp.stat(seedPath)).size;

    const r = await gm('POST', '/map/calibrations/from-seed', { file: TEST_MAP, name: 'Test Map' });
    assert.equal(r.status, 201);
    const cal = r.data.calibration;
    calibrationId = cal.id;

    assert.equal(cal.originalWidth, 4200);
    assert.equal(cal.originalHeight, 2600);
    // Spec-measured grid defaults are seeded, not zeroes.
    assert.equal(cal.hexEdge, 71);
    assert.equal(cal.colSpacing, 106);
    assert.equal(cal.colOffset, 62);

    assert.ok(cal.tiers.length >= 2, 'expected multiple resolution tiers');
    for (const t of cal.tiers) {
      assert.ok(t.width <= 3200, `tier ${t.name} should be web-sized`);
      assert.ok(t.bytes < originalBytes, `tier ${t.name} should be smaller than the original`);
      assert.ok(fs.existsSync(path.join(paths.derivatives, t.file)));
    }

    // The client-facing shape must not leak the on-disk original's filename.
    assert.equal(cal.originalFile, undefined);
  });

  it('serves a derivative, not the original', async () => {
    const web = await fetch(`${BASE}/api/map/calibrations/${calibrationId}/image/web`, {
      headers: { 'x-orc-token': playerToken },
    });
    assert.equal(web.status, 200);
    assert.equal(web.headers.get('content-type'), 'image/webp');
    const bytes = (await web.arrayBuffer()).byteLength;
    assert.ok(bytes > 0 && bytes < 3 * 1024 * 1024, `derivative was ${bytes} bytes`);

    // Nothing serves the uploads tree, so the original is unreachable. (With a
    // production build present the SPA fallback answers these with index.html,
    // so the invariant to assert is "never image bytes", not "404".)
    for (const p of [
      `/uploads/seed/${TEST_MAP}`,
      `/uploads/originals/${TEST_MAP}`,
      `/uploads/derivatives/${calibrationId}-web.webp`,
    ]) {
      const raw = await fetch(`${BASE}${p}`, { headers: { 'x-orc-token': playerToken } });
      const type = raw.headers.get('content-type') ?? '';
      assert.ok(!type.startsWith('image/'), `${p} must not serve image bytes (got ${raw.status} ${type})`);
    }

    // An unknown :tier cannot be steered at another file on disk.
    for (const tier of [`..%2F..%2Fseed%2F${TEST_MAP}`, 'original', 'nope']) {
      const r = await fetch(`${BASE}/api/map/calibrations/${calibrationId}/image/${tier}`, {
        headers: { 'x-orc-token': playerToken },
      });
      assert.equal(r.status, 404, `tier "${tier}" should not resolve`);
    }

    // And the image route still needs a passcode.
    const anon = await fetch(`${BASE}/api/map/calibrations/${calibrationId}/image/web`);
    assert.equal(anon.status, 401);
  });

  it('tags hexes with independent hard-terrain and road flags (GM only)', async () => {
    const denied = await player('PUT', `/map/calibrations/${calibrationId}/hexes/3/3`, {
      regionType: 'wild',
    });
    assert.equal(denied.status, 403);

    const r = await gm('PUT', `/map/calibrations/${calibrationId}/hexes/3/3`, {
      regionType: 'border',
      hardTerrain: true,
      road: true,
      label: 'Weather Hills',
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.hex.hardTerrain, true);
    assert.equal(r.data.hex.road, true);
    assert.equal(r.data.hex.regionType, 'border');
  });
});

describe('Socket.IO multi-client sync', () => {
  it('delivers the same state update to two concurrent clients', { timeout: 20000 }, async () => {
    const a = ioClient(BASE, { auth: { token: playerToken }, transports: ['websocket'] });
    const b = ioClient(BASE, { auth: { token: gmToken }, transports: ['websocket'] });

    // Listeners must be attached before the handshake completes — the server
    // pushes the initial snapshot the moment it accepts the connection.
    const firstSnapshot = (s) => new Promise((resolve) => s.once('state:snapshot', resolve));
    const snapshotA = firstSnapshot(a);
    const snapshotB = firstSnapshot(b);

    const connected = (s) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('socket connect timed out')), 6000);
        s.on('connect', () => {
          clearTimeout(timer);
          resolve();
        });
        s.on('connect_error', (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });
    await Promise.all([connected(a), connected(b)]);

    const [snapA, snapB] = await Promise.all([snapshotA, snapshotB]);
    assert.ok(snapA.campaign && snapB.campaign);

    // A GM change must reach BOTH clients with the same value.
    const nextYear = 2951;
    const waitFor = (s) =>
      new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for snapshot')), 4000);
        const handler = (snap) => {
          if (snap.campaign.year === nextYear) {
            clearTimeout(timer);
            s.off('state:snapshot', handler);
            resolve(snap);
          }
        };
        s.on('state:snapshot', handler);
      });
    const bothUpdated = Promise.all([waitFor(a), waitFor(b)]);
    await gm('PATCH', '/campaign', { year: nextYear, season: 'Summer' });
    const [ua, ub] = await bothUpdated;
    assert.equal(ua.campaign.year, nextYear);
    assert.equal(ub.campaign.year, nextYear);
    assert.equal(ua.campaign.season, 'Summer');
    assert.equal(ub.campaign.season, 'Summer');

    // A route drawn by one client must appear for the other — the live map case.
    const route = [
      { col: 1, row: 1 },
      { col: 2, row: 1 },
    ];
    const routeSeen = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for route')), 4000);
      const handler = (snap) => {
        if (snap.party.route.length === 2) {
          clearTimeout(timer);
          b.off('state:snapshot', handler);
          resolve(snap);
        }
      };
      b.on('state:snapshot', handler);
    });
    await new Promise((resolve, reject) =>
      a.emit('route:set', { route }, (res) => (res?.ok ? resolve(res) : reject(new Error(res?.error)))),
    );
    const seen = await routeSeen;
    assert.deepEqual(seen.party.route, route);

    // And a roll broadcast reaches the other client's feed.
    const rollSeen = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timed out waiting for roll broadcast')), 4000);
      b.once('roll:new', (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });
    await player('POST', '/rolls', { label: 'sync check', rating: 2, targetNumber: 10 });
    const broadcastRoll = await rollSeen;
    assert.equal(broadcastRoll.roll.label, 'sync check');

    a.disconnect();
    b.disconnect();
  });

  it('refuses a socket connection without a valid passcode session', { timeout: 15000 }, async () => {
    const bad = ioClient(BASE, {
      auth: { token: 'garbage' },
      transports: ['websocket'],
      reconnection: false,
    });
    const err = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(new Error('no connection established')), 5000);
      bad.on('connect_error', (e) => {
        clearTimeout(timer);
        resolve(e);
      });
      bad.on('connect', () => {
        clearTimeout(timer);
        resolve(null);
      });
    });
    bad.disconnect();
    assert.ok(err, 'expected the handshake to be rejected');
  });
});

describe('full travel sequence', () => {
  const heroes = {};
  let calibrationId;
  let route;

  it('sets up a Company, a tagged route and a journey', async () => {
    // Fresh campaign state for predictable maths.
    await gm('PATCH', '/campaign', { year: 2946, season: 'Summer', tnBase: 20 });

    const specs = [
      ['Guide Hero', 'guide'],
      ['Hunter Hero', 'hunter'],
      ['Lookout Hero', 'lookout'],
      ['Scout Hero', 'scout'],
    ];
    const roles = {};
    for (const [name, role] of specs) {
      const c = (await player('POST', '/characters', { name })).data.character;
      const sheet = c.sheet;
      sheet.attributes.heart.rating = 4;
      sheet.attributes.strength.rating = 4;
      sheet.attributes.wits.rating = 4;
      sheet.attributes.heart.skills.Travel.rating = 3;
      sheet.attributes.strength.skills.Hunting.rating = 2;
      sheet.attributes.strength.skills.Awareness.rating = 2;
      sheet.attributes.wits.skills.Explore.rating = 2;
      sheet.attributes.heart.hope = 10;
      sheet.attributes.heart.hopeMax = 10;
      sheet.mount = { name: 'Pony', vigour: 1, treasure: 0 };
      await player('PUT', `/characters/${c.id}/sheet`, { sheet });
      heroes[role] = c.id;
      roles[c.id] = role;
    }

    const cals = await gm('GET', '/map/calibrations');
    calibrationId = cals.data.active.id;

    // A 10-hex route: some hard terrain, a road, and a Perilous Area of rating 2.
    route = Array.from({ length: 11 }, (_, i) => ({ col: i, row: 4 }));
    const tags = route.map((h, i) => ({
      ...h,
      regionType: i > 7 ? 'dark' : i > 3 ? 'wild' : 'border',
      hardTerrain: i === 2 || i === 5,
      road: i === 1,
      perilous: i === 6,
      perilRating: i === 6 ? 2 : 0,
    }));
    const bulk = await gm('POST', `/map/calibrations/${calibrationId}/hexes/bulk`, { hexes: tags });
    assert.equal(bulk.status, 200);
    assert.equal(bulk.data.hexes.length, 11);

    const rolesRes = await player('PUT', '/party/roles', { roles });
    assert.equal(rolesRes.status, 200);
    assert.equal(rolesRes.data.roleCheck.valid, true);

    await gm('PATCH', '/party', { route, mounted: false, forcedMarch: false });

    const start = await gm('POST', '/travel/start', { fromLabel: 'Rhosgobel', toLabel: 'The Old Ford' });
    assert.equal(start.status, 200);
    assert.equal(start.data.travel.phase, 'awaiting_marching_test');
    assert.equal(start.data.journey.route.length, 11);
    assert.equal(start.data.journey.season, 'Summer');
  });

  it('refuses to start a second journey while one is underway', async () => {
    const r = await gm('POST', '/travel/start', {});
    assert.equal(r.status, 400);
  });

  it('only lets the GM roll the Marching Test', async () => {
    const r = await player('POST', '/travel/marching-test');
    assert.equal(r.status, 403);
  });

  it('honours a GM manual event pin', async () => {
    const bad = await gm('POST', '/travel/pin', { col: 99, row: 99 });
    assert.equal(bad.status, 400);

    const pin = await gm('POST', '/travel/pin', { col: 2, row: 4 });
    assert.equal(pin.status, 200);
    assert.deepEqual(
      { col: pin.data.travel.state.manualPin.col, row: pin.data.travel.state.manualPin.row },
      { col: 2, row: 4 },
    );

    const mt = await gm('POST', '/travel/marching-test');
    assert.equal(mt.status, 200);
    // The pin, not the dice, decided the distance: the party is on hex index 2.
    assert.equal(mt.data.journey.routeIndex, 2);
    assert.equal(mt.data.journey.hexesTraversed, 2);
    // Hex 2 is hard terrain, hex 1 is not.
    assert.equal(mt.data.journey.hardTerrainHexes, 1);
    assert.equal(mt.data.travel.state.manualPin, null);
    assert.equal(mt.data.travel.phase, 'awaiting_target');
  });

  it('runs Select Target → Determine Event → Resolution', async () => {
    const st = await gm('POST', '/travel/select-target');
    assert.equal(st.status, 200);
    let phase = st.data.travel.phase;
    let pending = st.data.travel.state.pendingEvent;
    assert.ok(['awaiting_event_die', 'awaiting_target_choice'].includes(phase));
    assert.ok(['scout', 'lookout', 'hunter'].includes(pending.roleKey));
    assert.ok(['Explore', 'Awareness', 'Hunting'].includes(pending.skill));

    if (phase === 'awaiting_target_choice') {
      const assigned = await gm('POST', '/travel/assign-target', { characterId: heroes.scout });
      phase = assigned.data.travel.phase;
      pending = assigned.data.travel.state.pendingEvent;
    }
    assert.equal(phase, 'awaiting_event_die');
    assert.ok(pending.targetCharacterId);

    const de = await gm('POST', '/travel/determine-event');
    assert.equal(de.status, 200);
    assert.equal(de.data.travel.phase, 'awaiting_resolution');
    const evt = de.data.events.find((e) => e.kind === 'event');
    assert.ok(evt.eventName, 'the event should be named from the Journey Events Table');
    // Hex 2 is Border Land, so the event die is rolled Favoured (two Feat Dice).
    assert.equal(evt.regionType, 'border');

    // The targeted PLAYER makes this roll, not the GM.
    const res = await player('POST', '/travel/resolve', { note: 'integration note' });
    assert.equal(res.status, 200);
    const resolved = res.data.events.find((e) => e.id === evt.id);
    assert.ok(['success', 'failure'].includes(resolved.outcome));
    assert.equal(resolved.notes, 'integration note');
    assert.ok(resolved.resolutionRollId);
  });

  it('drives the rest of the journey to the destination', { timeout: 60000 }, async () => {
    let guard = 0;
    let snap = await gm('GET', '/travel');
    const seen = new Set();
    while (guard < 80) {
      guard += 1;
      const phase = snap.data.travel.phase;
      seen.add(phase);
      if (phase === 'journey_end' || phase === 'awaiting_fatigue_relief') break;
      if (phase === 'awaiting_marching_test') snap = await gm('POST', '/travel/marching-test');
      else if (phase === 'awaiting_target') snap = await gm('POST', '/travel/select-target');
      else if (phase === 'awaiting_target_choice')
        snap = await gm('POST', '/travel/assign-target', { characterId: heroes.hunter });
      else if (phase === 'awaiting_event_die') snap = await gm('POST', '/travel/determine-event');
      else if (phase === 'awaiting_resolution') snap = await player('POST', '/travel/resolve', {});
      else throw new Error(`unexpected phase ${phase}`);
      assert.equal(snap.status, 200, `phase ${phase} failed: ${JSON.stringify(snap.data)}`);
    }
    assert.ok(guard < 80, 'travel sequence did not terminate');
    assert.equal(snap.data.travel.phase, 'journey_end');
    assert.ok(seen.has('awaiting_marching_test'));
    assert.ok(seen.has('awaiting_target'));
    assert.ok(seen.has('awaiting_event_die'));
    assert.ok(seen.has('awaiting_resolution'));

    const journey = snap.data.journey;
    assert.equal(journey.routeIndex, 10, 'party should be on the last hex of the route');
    assert.equal(journey.hexesTraversed, 10);
    assert.equal(journey.hardTerrainHexes, 2, 'hexes 2 and 5 are hard terrain');

    // The Perilous Area at hex 6 (rating 2) must have produced back-to-back
    // events with no Marching Test between them.
    const perilEvents = snap.data.events.filter((e) => e.kind === 'event' && e.perilous);
    assert.ok(perilEvents.length >= 2, `expected >=2 perilous events, got ${perilEvents.length}`);
    const eventIdx = snap.data.events.findIndex((e) => e.id === perilEvents[0].id);
    const between = snap.data.events
      .slice(eventIdx, snap.data.events.findIndex((e) => e.id === perilEvents[1].id))
      .filter((e) => e.kind === 'marching_test');
    assert.equal(between.length, 0, 'no Marching Test may occur inside a Perilous Area');
  });

  it('computes the ending-the-journey maths and applies mount Vigour', async () => {
    const fatigueBefore = {};
    for (const [role, cid] of Object.entries(heroes)) {
      fatigueBefore[role] = (await player('GET', `/characters/${cid}`)).data.character.sheet.attributes
        .strength.fatigue;
    }
    assert.ok(
      Object.values(fatigueBefore).some((f) => f > 0),
      'events should have piled Fatigue on the Company',
    );

    const fin = await gm('POST', '/travel/finish');
    assert.equal(fin.status, 200);
    assert.equal(fin.data.travel.phase, 'awaiting_fatigue_relief');

    const j = fin.data.journey;
    const days = j.summary.days;
    // 10 hexes + 2 hard-terrain days + accumulated Mishap/Short Cut adjustments.
    assert.equal(days.marchDays, 10);
    assert.equal(days.hardTerrainDays, 2);
    assert.equal(days.beforeMount, 10 + 2 + j.dayAdjustments);
    assert.equal(days.totalDays, days.beforeMount);
    assert.equal(j.totalDays, days.totalDays);
    assert.equal(j.status, 'complete');

    // Every hero has a Vigour-1 pony, so Fatigue drops by 1 (floored at 0).
    for (const [role, cid] of Object.entries(heroes)) {
      const after = (await player('GET', `/characters/${cid}`)).data.character.sheet.attributes.strength
        .fatigue;
      assert.equal(after, Math.max(0, fatigueBefore[role] - 1), `mount relief for ${role}`);
      assert.equal(fin.data.travel.state.fatigueRelief[cid].mountVigour, 1);
    }
  });

  it('lets each hero roll TRAVEL to shed more Fatigue, once', async () => {
    for (const cid of Object.values(heroes)) {
      const before = (await player('GET', `/characters/${cid}`)).data.character.sheet.attributes.strength
        .fatigue;
      const r = await player('POST', '/travel/fatigue-roll', { characterId: cid });
      assert.equal(r.status, 200);
      const entry = r.data.travel.state.fatigueRelief[cid];
      assert.ok(entry.travelRoll);
      const after = (await player('GET', `/characters/${cid}`)).data.character.sheet.attributes.strength
        .fatigue;
      const expected = entry.travelRoll.success
        ? Math.max(0, before - (1 + entry.travelRoll.icons))
        : before;
      assert.equal(after, expected);

      const again = await player('POST', '/travel/fatigue-roll', { characterId: cid });
      assert.equal(again.status, 400, 'a hero may only roll TRAVEL once per journey');
    }
  });

  it('exports the journey log and closes out', async () => {
    const snap = await gm('GET', '/travel');
    const journeyId = snap.data.journey.id;

    const md = await fetch(`${BASE}/api/journeys/${journeyId}/export?format=md`, {
      headers: { 'x-orc-token': playerToken },
    });
    assert.equal(md.status, 200);
    const text = await md.text();
    assert.match(text, /# Journey Log — Rhosgobel → The Old Ford/);
    assert.match(text, /Year \/ Season:\*\* 2946 · Summer/);
    assert.match(text, /## Ending the Journey/);
    assert.match(text, /\*\*Event 1\*\*/);
    assert.match(text, /integration note/);

    const notes = await player('PATCH', `/journeys/${journeyId}`, { notes: 'The road was long.' });
    assert.equal(notes.data.journey.notes, 'The road was long.');

    const close = await gm('POST', '/travel/close');
    assert.equal(close.data.travel.phase, 'idle');
    assert.equal(close.data.travel.journeyId, null);

    const list = await player('GET', '/journeys');
    assert.ok(list.data.journeys.some((x) => x.id === journeyId && x.status === 'complete'));
  });
});

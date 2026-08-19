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

const { hexDistance, hexPolygon } = await import('../shared/hexMath.js');

/**
 * Where a finger would land to hit hex (col,row), in the original-image pixel
 * space the freehand route endpoint speaks.
 */
function hexCentre(calibration, col, row) {
  const poly = hexPolygon(col, row, calibration);
  return { x: (poly[0].x + poly[3].x) / 2, y: (poly[1].y + poly[4].y) / 2 };
}

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
    assert.equal(cal.hexEdge, 70);
    assert.equal(cal.colSpacing, 105);
    assert.equal(cal.colOffset, 60);

    assert.ok(cal.tiers.length >= 2, 'expected multiple resolution tiers');
    // The 'full' tier is deliberately NOT downscaled (re-encode only, so zoomed-in
    // text stays sharp) — every other tier is downscaled for zoomed-out use.
    const full = cal.tiers.find((t) => t.name === 'full');
    assert.ok(full, 'expected a full-resolution tier');
    assert.equal(full.width, 4200);
    for (const t of cal.tiers) {
      if (t.name !== 'full') assert.ok(t.width <= 3200, `tier ${t.name} should be web-sized`);
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

describe('Compendium', () => {
  let locationId;
  let weaponId;

  it('comes seeded with the six core Virtues and the six core Rewards', async () => {
    const r = await player('GET', '/compendium');
    assert.equal(r.status, 200);

    const virtueNames = r.data.virtues.map((v) => v.name).sort();
    assert.deepEqual(virtueNames, [
      'Confidence',
      'Dour-handed',
      'Hardiness',
      'Mastery',
      'Nimbleness',
      'Prowess',
    ]);
    for (const v of r.data.virtues) {
      assert.equal(v.source, 'core');
      assert.ok(v.effect.length > 5, `${v.name} needs effect text`);
    }

    const rewardNames = r.data.rewards.map((x) => x.name).sort();
    assert.deepEqual(rewardNames, [
      'Close-fitting',
      'Cunning Make',
      'Fell',
      'Grievous',
      'Keen',
      'Reinforced',
    ]);

    // Tiers come from shared/rewards.js, enhanced tiers included.
    const fell = r.data.rewards.find((x) => x.name === 'Fell');
    assert.deepEqual(fell.appliesTo, ['weapon']);
    assert.equal(fell.code, 'F');
    assert.ok(fell.tiers.some((t) => t.value === 'enhanced_elven'));
    assert.ok(!fell.tiers.some((t) => t.value === 'none'), '"None" is not a tier of a Reward');

    // Cunning Make is shared between armour and shields and listed once.
    const cm = r.data.rewards.find((x) => x.name === 'Cunning Make');
    assert.deepEqual(cm.appliesTo, ['armour', 'shield']);
  });

  it('comes seeded with the core gear tables and the 60 Cultural Virtues', async () => {
    const r = await player('GET', '/compendium');
    assert.equal(r.status, 200);

    const core = r.data.items.filter((i) => i.source === 'core');
    assert.equal(core.filter((i) => i.kind === 'weapon').length, 16);
    assert.equal(core.filter((i) => i.kind === 'armour').length, 5);
    assert.equal(core.filter((i) => i.kind === 'shield').length, 3);

    const longSword = core.find((i) => i.name === 'Long Sword');
    assert.equal(longSword.injury, 16);
    assert.equal(longSword.injuryTwoHanded, 18, 'the per-grip Injury survives the round trip');
    assert.equal(longSword.damage, 5);

    const mail = core.find((i) => i.name === 'Mail-shirt');
    assert.equal(mail.protection, 3);
    assert.equal(mail.type, 'Mail armour');
    assert.equal(mail.minStandard, 'Common');
    assert.equal(core.find((i) => i.name === 'Great Shield').minStandard, 'Prosperous');
    assert.equal(core.find((i) => i.name === 'Helm').minStandard, '', 'Helm is explicitly none');

    assert.equal(r.data.culturalVirtues.length, 60);
    assert.equal(new Set(r.data.culturalVirtues.map((v) => v.culture)).size, 10);
    for (const v of r.data.culturalVirtues) assert.equal(v.source, 'core');
    const bears = r.data.culturalVirtues.find((v) => v.name === 'Brother to Bears');
    assert.ok(!bears.description.includes('verify the exact symbol'));
  });

  it('keeps General and Cultural Virtues in separate sections', async () => {
    const general = await player('GET', '/compendium/virtues');
    const cultural = await player('GET', '/compendium/culturalVirtues');
    assert.equal(cultural.status, 200);
    // The core six live only in `virtues`, never duplicated into the new table.
    assert.ok(!cultural.data.entries.some((v) => v.name === 'Hardiness'));
    assert.ok(!general.data.entries.some((v) => v.name === 'Brother to Bears'));

    const mine = await player('POST', '/compendium/culturalVirtues', {
      name: 'Fen-walker',
      description: 'Home-brew.',
      culture: 'Marsh-folk',
    });
    assert.equal(mine.status, 201);
    assert.equal(mine.data.entry.culture, 'Marsh-folk');
    assert.equal(mine.data.entry.source, 'custom');
    await player('DELETE', `/compendium/culturalVirtues/${mine.data.entry.id}`);
  });

  it('drops an unrecognised Minimum Standard of Living rather than storing it', async () => {
    const r = await player('POST', '/compendium/items', {
      kind: 'armour',
      name: 'Gilded plate',
      minStandard: 'Fabulously Wealthy',
    });
    assert.equal(r.data.entry.minStandard, '');
    const ok = await player('PATCH', `/compendium/items/${r.data.entry.id}`, {
      minStandard: 'Prosperous',
    });
    assert.equal(ok.data.entry.minStandard, 'Prosperous');
    await player('DELETE', `/compendium/items/${r.data.entry.id}`);
  });

  it('re-seeding is idempotent and leaves home-brew alone', async () => {
    const before = await player('GET', '/compendium/virtues');
    const mine = await player('POST', '/compendium/virtues', {
      name: 'Woodcraft',
      effect: 'Home-brew.',
    });
    assert.equal(mine.status, 201);
    assert.equal(mine.data.entry.source, 'custom', 'the app never writes core entries');

    const { migrate } = await import('../server/db/migrate.js');
    await migrate();

    const after = await player('GET', '/compendium/virtues');
    assert.equal(after.data.entries.length, before.data.entries.length + 1);
    assert.ok(after.data.entries.some((v) => v.name === 'Woodcraft'));
    assert.equal(after.data.entries.filter((v) => v.name === 'Confidence').length, 1);

    await player('DELETE', `/compendium/virtues/${mine.data.entry.id}`);
  });

  it('does CRUD on the Weapons & Armour catalogue', async () => {
    const created = await player('POST', '/compendium/items', {
      kind: 'weapon',
      name: 'Long-hafted axe',
      type: 'Axe',
      proficiency: 'Axes',
      damage: 6,
      injury: 18,
      load: 4,
    });
    assert.equal(created.status, 201);
    weaponId = created.data.entry.id;
    assert.equal(created.data.entry.damage, 6);

    const patched = await player('PATCH', `/compendium/items/${weaponId}`, { load: 5 });
    assert.equal(patched.data.entry.load, 5);
    assert.equal(patched.data.entry.name, 'Long-hafted axe', 'a partial patch keeps other fields');

    // An unknown proficiency is dropped rather than stored.
    const bad = await player('POST', '/compendium/items', { name: 'Odd', proficiency: 'Catapults' });
    assert.equal(bad.data.entry.proficiency, '');
    await player('DELETE', `/compendium/items/${bad.data.entry.id}`);
  });

  it('stores Locations with a list of years visited', async () => {
    const r = await player('POST', '/compendium/locations', {
      name: 'Rhosgobel',
      years: '2946, 2947, 2946',
      keyInfo: 'Radagast keeps the wood.',
    });
    assert.equal(r.status, 201);
    locationId = r.data.entry.id;
    assert.deepEqual(r.data.entry.years, ['2946', '2947'], 'years are de-duped');
    assert.equal(r.data.entry.keyInfo, 'Radagast keeps the wood.');

    const list = await player('GET', '/compendium/locations');
    assert.ok(list.data.entries.some((l) => l.id === locationId));
  });

  it('rejects an unknown section', async () => {
    assert.equal((await player('GET', '/compendium/dragons')).status, 404);
    assert.equal((await player('POST', '/compendium/dragons', { name: 'Smaug' })).status, 404);
  });

  it('links a map hex to a Location and clears the link when it is deleted', async () => {
    const cals = await gm('GET', '/map/calibrations');
    const calId = cals.data.active?.id;
    assert.ok(calId, 'the map-derivatives suite should have created a calibration');

    const tagged = await gm('PUT', `/map/calibrations/${calId}/hexes/7/2`, {
      regionType: 'border',
      label: 'Rhosgobel',
      linkedLocationId: locationId,
    });
    assert.equal(tagged.status, 200);
    assert.equal(tagged.data.hex.linkedLocationId, locationId);

    const hexes = await player('GET', `/map/calibrations/${calId}/hexes`);
    assert.equal(hexes.data.hexes.find((h) => h.col === 7 && h.row === 2).linkedLocationId, locationId);

    // Deleting the Location must not leave the hex pointing at nothing.
    assert.equal((await player('DELETE', `/compendium/locations/${locationId}`)).status, 200);
    const after = await player('GET', `/map/calibrations/${calId}/hexes`);
    assert.equal(after.data.hexes.find((h) => h.col === 7 && h.row === 2).linkedLocationId, null);

    await player('DELETE', `/compendium/items/${weaponId}`);
  });
});

describe('Handouts', () => {
  let hidden;
  let visible;

  /** A small PNG, posted as multipart the way the browser form does. */
  async function uploadHandout(fields = {}) {
    const png = await sharp({
      create: { width: 900, height: 600, channels: 3, background: '#6b4a22' },
    })
      .png()
      .toBuffer();
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.append(k, String(v));
    form.append('image', new Blob([png], { type: 'image/png' }), 'handout.png');
    const res = await fetch(`${BASE}/api/handouts`, {
      method: 'POST',
      headers: { 'x-orc-token': gmToken },
      body: form,
    });
    return { status: res.status, data: await res.json() };
  }

  it('creates a handout hidden by default, with web-sized derivatives', async () => {
    const r = await uploadHandout({ title: "Thror's map", notes: 'Runes on the back.', year: 2946, season: 'Spring' });
    assert.equal(r.status, 201);
    hidden = r.data.handout;

    assert.equal(hidden.hidden, true, 'a new handout is GM prep until revealed');
    assert.equal(hidden.title, "Thror's map");
    assert.equal(hidden.year, 2946);
    assert.equal(hidden.season, 'Spring');
    assert.equal(hidden.imageWidth, 900, 'dimensions are read off the file, not trusted');

    assert.deepEqual(hidden.tiers.map((t) => t.name).sort(), ['thumb', 'view']);
    for (const t of hidden.tiers) {
      assert.ok(fs.existsSync(path.join(paths.derivatives, t.file)), `${t.name} not generated`);
      assert.ok(t.width <= 1600);
    }
    // Never leak the on-disk original's name, same as map calibrations.
    assert.equal(hidden.originalFile, undefined);
  });

  it('hides a hidden handout from players in the list, the row AND the image', async () => {
    const asPlayer = await player('GET', '/handouts');
    assert.equal(asPlayer.status, 200);
    assert.ok(!asPlayer.data.handouts.some((h) => h.id === hidden.id), 'hidden handout leaked to a player');

    assert.equal((await player('GET', `/handouts/${hidden.id}`)).status, 404);

    const img = await fetch(`${BASE}/api/handouts/${hidden.id}/image/view`, {
      headers: { 'x-orc-token': playerToken },
    });
    assert.equal(img.status, 404, 'a hidden handout\'s image must not be fetchable by id');

    // The GM sees all of it.
    const asGM = await gm('GET', '/handouts');
    assert.ok(asGM.data.handouts.some((h) => h.id === hidden.id));
    assert.equal((await gm('GET', `/handouts/${hidden.id}`)).status, 200);
  });

  it('reveals and re-hides — the toggle works in both directions', async () => {
    const shown = await gm('PATCH', `/handouts/${hidden.id}`, { hidden: false });
    assert.equal(shown.status, 200);
    assert.equal(shown.data.handout.hidden, false);
    assert.ok((await player('GET', '/handouts')).data.handouts.some((h) => h.id === hidden.id));

    const img = await fetch(`${BASE}/api/handouts/${hidden.id}/image/thumb`, {
      headers: { 'x-orc-token': playerToken },
    });
    assert.equal(img.status, 200);
    assert.equal(img.headers.get('content-type'), 'image/webp');

    const rehidden = await gm('PATCH', `/handouts/${hidden.id}`, { hidden: true });
    assert.equal(rehidden.data.handout.hidden, true, 'revealing must not be one-way');
    assert.equal((await player('GET', `/handouts/${hidden.id}`)).status, 404);
  });

  it('serves handout pixels only through the controlled route', async () => {
    const r = await uploadHandout({ title: 'Letter from Bard', year: 2947, season: 'Autumn', hidden: 'false' });
    visible = r.data.handout;
    assert.equal(visible.hidden, false, "an explicit hidden=false creates it visible");

    // Only the two named tiers resolve; a crafted :tier cannot escape.
    for (const tier of ['full', 'web', 'original', '..%2F..%2Foriginals%2Fhandout.png']) {
      const bad = await fetch(`${BASE}/api/handouts/${visible.id}/image/${tier}`, {
        headers: { 'x-orc-token': playerToken },
      });
      assert.equal(bad.status, 404, `tier "${tier}" should not resolve`);
    }

    // And it still needs a passcode.
    assert.equal((await fetch(`${BASE}/api/handouts/${visible.id}/image/view`)).status, 401);
  });

  it('keeps writes GM-only, unlike the Compendium', async () => {
    assert.equal((await player('PATCH', `/handouts/${visible.id}`, { notes: 'nope' })).status, 403);
    assert.equal((await player('DELETE', `/handouts/${visible.id}`)).status, 403);

    const res = await fetch(`${BASE}/api/handouts`, {
      method: 'POST',
      headers: { 'x-orc-token': playerToken },
      body: new FormData(),
    });
    assert.equal(res.status, 403);
  });

  it('edits notes and re-tags the Year/Season, refusing a bogus season', async () => {
    const r = await gm('PATCH', `/handouts/${visible.id}`, {
      notes: 'Sealed with the sigil of Dale.',
      year: 2948,
      season: 'Winter',
    });
    assert.equal(r.data.handout.notes, 'Sealed with the sigil of Dale.');
    assert.equal(r.data.handout.year, 2948);
    assert.equal(r.data.handout.season, 'Winter');

    // A season outside the campaign's own enum leaves the stored one alone.
    const bogus = await gm('PATCH', `/handouts/${visible.id}`, { season: 'Mud' });
    assert.equal(bogus.data.handout.season, 'Winter');
  });

  it('deletes the row and its generated files', async () => {
    const files = [...hidden.tiers, ...visible.tiers].map((t) =>
      path.join(paths.derivatives, t.file),
    );
    assert.equal((await gm('DELETE', `/handouts/${hidden.id}`)).status, 200);
    assert.equal((await gm('DELETE', `/handouts/${visible.id}`)).status, 200);
    assert.equal((await gm('GET', `/handouts/${hidden.id}`)).status, 404);
    for (const f of files) assert.ok(!fs.existsSync(f), `${f} was left behind`);
    assert.deepEqual((await gm('GET', '/handouts')).data.handouts, []);
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

  it('keeps the GM-only travel steps GM-only', async () => {
    // The Marching Test is NOT among them — it is the Guide's own TRAVEL roll,
    // and the Guide is a player. It is exercised at player level below.
    assert.equal((await player('POST', '/travel/select-target')).status, 403);
    assert.equal((await player('POST', '/travel/determine-event')).status, 403);
    assert.equal((await player('POST', '/travel/pin', { col: 2, row: 4 })).status, 403);
    assert.equal((await player('POST', '/travel/finish')).status, 403);
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
      // Rolled at PLAYER level throughout: the Guide makes the Marching Test.
      if (phase === 'awaiting_marching_test') snap = await player('POST', '/travel/marching-test');
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

/**
 * Journey-event Fatigue, checked on the persisted character rows rather than on
 * what the journey log claims happened. Covers the Perilous-Area repeated-event
 * path and the GM manual-pin path, and confirms a hero with no travel role is
 * not part of "the Company".
 */
describe('travel event Fatigue reaches every Company member', () => {
  const company = {};
  let outsiderId;
  let calibrationId;
  let journeyId;
  const startFatigue = {};
  let eventsRun = 0;
  let sawCompanyFatigue = false;

  const fatigueOf = async (cid) =>
    (await player('GET', `/characters/${cid}`)).data.character.sheet.attributes.strength.fatigue;

  /** Select Target → Determine Event → Resolution, asserting the Fatigue deltas. */
  async function runOneEvent() {
    const ids = [...Object.values(company), outsiderId];
    const before = {};
    for (const cid of ids) before[cid] = await fatigueOf(cid);

    let snap = await gm('POST', '/travel/select-target');
    assert.equal(snap.status, 200);
    const eventId = snap.data.travel.state.pendingEvent.eventId;
    if (snap.data.travel.phase === 'awaiting_target_choice') {
      snap = await gm('POST', '/travel/assign-target', { characterId: company.hunter });
      assert.equal(snap.status, 200);
    }
    assert.equal(snap.data.travel.phase, 'awaiting_event_die');

    snap = await gm('POST', '/travel/determine-event');
    assert.equal(snap.status, 200);
    assert.equal(snap.data.travel.phase, 'awaiting_resolution');

    snap = await player('POST', '/travel/resolve', {});
    assert.equal(snap.status, 200, JSON.stringify(snap.data));

    const row = snap.data.events.find((e) => e.id === eventId);
    assert.ok(row, 'the resolved event row should be in the snapshot');

    // Mishap gives its target 1 Fatigue on top of the Company's, on a failure.
    const targetExtra = row.eventKey === 'mishap' && row.outcome === 'failure' ? 1 : 0;

    for (const cid of Object.values(company)) {
      const after = await fatigueOf(cid);
      const expected = before[cid] + row.companyFatigue + (cid === row.targetCharacterId ? targetExtra : 0);
      assert.equal(
        after,
        expected,
        `${row.eventName} (${row.outcome}): ${cid} should be at ${expected} Fatigue, not ${after}`,
      );
    }
    // A hero with no travel role is not in the Company and gains nothing.
    assert.equal(await fatigueOf(outsiderId), before[outsiderId], 'a role-less hero is not travelling');

    eventsRun += 1;
    if (row.companyFatigue > 0) sawCompanyFatigue = true;
    return row;
  }

  it('sets up a Company on a route with a Perilous Area', async () => {
    await gm('PATCH', '/campaign', { year: 2946, season: 'Summer', tnBase: 20 });

    const specs = [
      ['Fatigue Guide', 'guide'],
      ['Fatigue Hunter', 'hunter'],
      ['Fatigue Lookout', 'lookout'],
      ['Fatigue Scout', 'scout'],
    ];
    const roles = {};
    for (const [name, role] of specs) {
      const c = (await player('POST', '/characters', { name })).data.character;
      const sheet = c.sheet;
      sheet.attributes.strength.rating = 4;
      sheet.attributes.heart.rating = 4;
      sheet.attributes.wits.rating = 4;
      sheet.attributes.strength.endurance = 30;
      sheet.attributes.heart.skills.Travel.rating = 2;
      sheet.attributes.strength.skills.Hunting.rating = 2;
      sheet.attributes.strength.skills.Awareness.rating = 2;
      sheet.attributes.wits.skills.Explore.rating = 2;
      sheet.attributes.heart.hope = 8;
      sheet.attributes.heart.hopeMax = 8;
      // No mounts: mount Vigour must not muddy the per-event Fatigue arithmetic.
      await player('PUT', `/characters/${c.id}/sheet`, { sheet });
      company[role] = c.id;
      roles[c.id] = role;
    }

    outsiderId = (await player('POST', '/characters', { name: 'Stays Behind' })).data.character.id;

    const cals = await gm('GET', '/map/calibrations');
    calibrationId = cals.data.active.id;

    // Row 9 keeps this route clear of the one the earlier suite tagged on row 4.
    const route = Array.from({ length: 6 }, (_, i) => ({ col: i, row: 9 }));
    const tags = route.map((h, i) => ({
      ...h,
      regionType: 'wild',
      hardTerrain: false,
      road: false,
      perilous: i === 2,
      perilRating: i === 2 ? 2 : 0,
    }));
    assert.equal((await gm('POST', `/map/calibrations/${calibrationId}/hexes/bulk`, { hexes: tags })).status, 200);

    const rolesRes = await player('PUT', '/party/roles', { roles });
    assert.equal(rolesRes.data.roleCheck.valid, true);
    await gm('PATCH', '/party', { route, mounted: false, forcedMarch: false });

    const start = await gm('POST', '/travel/start', { fromLabel: 'Woodmen-town', toLabel: 'Mountains of Mirkwood' });
    assert.equal(start.status, 200);
    journeyId = start.data.journey.id;

    for (const cid of [...Object.values(company), outsiderId]) startFatigue[cid] = await fatigueOf(cid);
    assert.deepEqual(Object.values(startFatigue), [0, 0, 0, 0, 0], 'everyone sets out unfatigued');
  });

  it('honours a GM pin and halts the Company inside the Perilous Area', async () => {
    const pin = await gm('POST', '/travel/pin', { col: 2, row: 9 });
    assert.equal(pin.status, 200);

    const mt = await gm('POST', '/travel/marching-test');
    assert.equal(mt.status, 200);
    // The pin, not the dice, chose the distance.
    assert.equal(mt.data.journey.routeIndex, 2);
    assert.equal(mt.data.travel.phase, 'awaiting_target');
    assert.equal(mt.data.travel.state.perilousArea, true);
    // Peril rating 2 -> two events back-to-back with no Marching Test between.
    assert.equal(mt.data.travel.state.eventsRemainingHere, 2);
  });

  it('adds each event Fatigue to every Company member persisted sheet', { timeout: 60000 }, async () => {
    // Both Perilous-Area events, then keep going until at least one event has
    // actually charged the Company Fatigue (Joyful Sight and a successful
    // Chance-meeting both cost nothing, so a fixed event count could see zero).
    let guard = 0;
    while (guard < 40) {
      guard += 1;
      const phase = (await gm('GET', '/travel')).data.travel.phase;
      if (phase === 'awaiting_target') {
        await runOneEvent();
        if (sawCompanyFatigue && eventsRun >= 2) break;
      } else if (phase === 'awaiting_marching_test') {
        assert.equal((await gm('POST', '/travel/marching-test')).status, 200);
      } else if (phase === 'journey_end') {
        break;
      } else {
        throw new Error(`unexpected phase ${phase}`);
      }
    }
    assert.ok(eventsRun >= 2, `expected at least 2 events, ran ${eventsRun}`);
    assert.ok(sawCompanyFatigue, 'expected at least one event to charge Company Fatigue');
  });

  it('ran the two Perilous-Area events with no Marching Test between them', async () => {
    const { data } = await player('GET', `/journeys/${journeyId}`);
    const perilous = data.events.filter((e) => e.kind === 'event' && e.perilous);
    assert.equal(perilous.length, 2, 'peril rating 2 should produce exactly two events in the area');
    const first = data.events.findIndex((e) => e.id === perilous[0].id);
    const second = data.events.findIndex((e) => e.id === perilous[1].id);
    const between = data.events.slice(first, second).filter((e) => e.kind === 'marching_test');
    assert.equal(between.length, 0);
  });

  it('leaves every Company member more Fatigued than when they set out', async () => {
    for (const [role, cid] of Object.entries(company)) {
      const now = await fatigueOf(cid);
      assert.ok(now > startFatigue[cid], `${role} should have gained Fatigue (still ${now})`);
    }
    assert.equal(await fatigueOf(outsiderId), 0, 'the hero with no travel role gained nothing');
  });

  it('closes the journey out', async () => {
    assert.equal((await gm('POST', '/travel/abandon')).status, 200);
  });
});

/**
 * Spending Success icons is a record, not a mechanic — but the choice has to
 * reach the channel the roll was announced in. DISCORD_WEBHOOK_URL is unset in
 * the test env, so what we can assert is that a post was *attempted* with the
 * right content and the right whisper handling.
 */
describe('Special Success spends are announced to Discord', () => {
  /** Roll enough dice that Success icons are all but certain, and retry if not. */
  async function rollWithIcons(body) {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const r = await player('POST', '/rolls', { rating: 24, targetNumber: 1, ...body });
      assert.equal(r.status, 200);
      if (r.data.result.icons >= 2) return r.data;
    }
    throw new Error('could not roll 2 Success icons in 20 attempts');
  }

  it('posts a follow-up naming only the newly spent icons', async () => {
    const rolled = await rollWithIcons({ label: 'AWE', actorName: 'Beorn' });
    const id = rolled.roll.id;

    const first = await player('PATCH', `/rolls/${id}`, { specialSuccesses: ['Gain Insight'] });
    assert.equal(first.status, 200);
    assert.equal(first.data.discord.posted, false);
    assert.equal(first.data.discord.reason, 'not-configured', 'a post was attempted');

    const second = await player('PATCH', `/rolls/${id}`, {
      specialSuccesses: ['Gain Insight', 'Make Haste'],
    });
    assert.equal(second.status, 200);
    assert.deepEqual(second.data.roll.specialSuccesses, ['Gain Insight', 'Make Haste']);

    const sent = (await gm('GET', '/rolls/discord/status')).data.recent.map((m) => m.content);
    assert.ok(
      sent.some((m) => m === '✨ Beorn spends a success icon on AWE: Gain Insight'),
      `first spend not announced; saw ${JSON.stringify(sent.slice(0, 4))}`,
    );
    assert.ok(
      sent.some((m) => m === '✨ Beorn spends a success icon on AWE: Make Haste'),
      'second spend should announce only the new pick',
    );
    assert.ok(
      !sent.some((m) => m.includes('Gain Insight, Make Haste')),
      'the whole list must not be re-announced on every save',
    );
  });

  it('says nothing when a pick is only cleared', async () => {
    const rolled = await rollWithIcons({ label: 'LORE', actorName: 'Gandalf' });
    const id = rolled.roll.id;
    await player('PATCH', `/rolls/${id}`, { specialSuccesses: ['Widen Influence'] });
    const cleared = await player('PATCH', `/rolls/${id}`, { specialSuccesses: [] });
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.data.roll.specialSuccesses, []);
    assert.equal(cleared.data.discord, null, 'clearing a pick is not worth a post');
  });

  it('keeps a whispered roll whispered', async () => {
    const rolled = await rollWithIcons({ label: 'STEALTH', actorName: 'Bilbo', whisperTo: 'gm' });
    const r = await player('PATCH', `/rolls/${rolled.roll.id}`, {
      specialSuccesses: ['Go Quietly'],
    });
    assert.equal(r.status, 200);
    assert.equal(r.data.discord.posted, false);
    assert.equal(r.data.discord.reason, 'whispered');
  });
});


/**
 * Route tools: who may clear a route, and the freehand draw endpoint.
 *
 * Both are player-level writes gated on the route's LOCKED state rather than on
 * the caller's role, which is the rule the UI also renders — checked here
 * because "the button is hidden" is not an access control.
 */
describe('route tools', () => {
  const HEXES = [
    { col: 2, row: 2 },
    { col: 3, row: 2 },
    { col: 4, row: 2 },
  ];

  async function calibrationForRoutes() {
    const list = await gm('GET', '/map/calibrations');
    return list.data.calibrations.find((c) => c.active) ?? list.data.calibrations[0];
  }

  it('lets a player clear an unlocked route', async () => {
    await player('PATCH', '/party', { route: HEXES });
    const cleared = await player('POST', '/party/clear-route');
    assert.equal(cleared.status, 200);
    assert.deepEqual(cleared.data.party.route, []);
  });

  it('refuses a player clearing a route the GM has locked', async () => {
    await player('PATCH', '/party', { route: HEXES });
    await gm('PATCH', '/party', { routeLocked: true });

    const denied = await player('POST', '/party/clear-route');
    assert.equal(denied.status, 403, 'a locked route is not a player\'s to clear');
    assert.equal((await player('GET', '/party')).data.party.route.length, HEXES.length);

    // The GM still can, and clearing unlocks in the same move.
    const byGM = await gm('POST', '/party/clear-route');
    assert.equal(byGM.status, 200);
    assert.deepEqual(byGM.data.party.route, []);
    assert.equal(byGM.data.party.routeLocked, false);
  });

  it('turns a drawn line into the same route data a click would', async () => {
    const cal = await calibrationForRoutes();
    assert.ok(cal, 'the map derivative tests should have left a calibration');

    // Two points, five hexes apart, with nothing sampled in between — the
    // server has to fill the gap itself.
    const from = hexCentre(cal, 4, 3);
    const to = hexCentre(cal, 9, 5);
    const r = await player('POST', '/party/draw-route', { points: [from, to] });
    assert.equal(r.status, 200);

    const route = r.data.party.route;
    assert.deepEqual(route[0], { col: 4, row: 3 });
    assert.deepEqual(route[route.length - 1], { col: 9, row: 5 });
    for (const h of route) assert.deepEqual(Object.keys(h).sort(), ['col', 'row']);
    for (let i = 1; i < route.length; i += 1) {
      assert.equal(
        hexDistance(route[i - 1], route[i]),
        1,
        `route must be walkable one hex at a time: ${JSON.stringify(route)}`,
      );
    }
  });

  it('refuses a drawn line while the route is locked, and needs a passcode', async () => {
    const cal = await calibrationForRoutes();
    const points = [hexCentre(cal, 2, 2), hexCentre(cal, 6, 2)];

    await gm('PATCH', '/party', { routeLocked: true });
    const denied = await player('POST', '/party/draw-route', { points });
    assert.equal(denied.status, 403);
    const stillGM = await gm('POST', '/party/draw-route', { points });
    assert.equal(stillGM.status, 200, 'the GM is not locked out by their own lock');

    const anon = await call('POST', '/party/draw-route', { points });
    assert.equal(anon.status, 401);

    await gm('POST', '/party/clear-route');
  });

  it('rejects a line with nothing in it', async () => {
    const r = await player('POST', '/party/draw-route', { points: [{ x: 10, y: 10 }] });
    assert.equal(r.status, 400);
  });
});

/**
 * Adventure Notes — one entry per Year + Season, open to anyone with the
 * player passcode (unlike Handouts, which are GM-written and hidden by default).
 */
describe('Adventure Notes', () => {
  it('reads an unwritten season as an empty note, not a 404', async () => {
    const r = await player('GET', '/notes/2946/Spring');
    assert.equal(r.status, 200);
    assert.equal(r.data.note, null);
  });

  it('creates on first write and updates in place afterwards', async () => {
    const first = await player('PUT', '/notes/2946/Spring', {
      title: 'The road east',
      body: 'Met a ranger at the ford.',
    });
    assert.equal(first.status, 200);
    assert.equal(first.data.note.title, 'The road east');
    const id = first.data.note.id;

    const second = await player('PUT', '/notes/2946/Spring', {
      title: 'The road east',
      body: 'Met a ranger at the ford. He warned us off the old track.',
    });
    assert.equal(second.status, 200);
    assert.equal(second.data.note.id, id, 'a second write must not make a second entry');
    assert.match(second.data.note.body, /old track/);

    const all = await player('GET', '/notes');
    const springs = all.data.notes.filter((n) => n.year === 2946 && n.season === 'Spring');
    assert.equal(springs.length, 1, 'one entry per Year + Season');
  });

  it('keeps each Year/Season separate', async () => {
    await player('PUT', '/notes/2946/Autumn', { title: 'Autumn', body: 'Leaf-fall.' });
    await player('PUT', '/notes/2947/Spring', { title: 'Next year', body: 'Thaw.' });
    assert.equal((await player('GET', '/notes/2946/Spring')).data.note.title, 'The road east');
    assert.equal((await player('GET', '/notes/2946/Autumn')).data.note.title, 'Autumn');
    assert.equal((await player('GET', '/notes/2947/Spring')).data.note.title, 'Next year');
  });

  it('is writable by a player, not just the GM — unlike a Handout', async () => {
    const byPlayer = await player('PUT', '/notes/2948/Winter', { title: 'Player wrote this', body: '' });
    assert.equal(byPlayer.status, 200);
    const byGM = await gm('PUT', '/notes/2948/Winter', { title: 'GM edited it', body: '' });
    assert.equal(byGM.status, 200);
    assert.equal(byGM.data.note.title, 'GM edited it');
  });

  it('rejects a season that is not one of the four', async () => {
    assert.equal((await player('PUT', '/notes/2946/Harvest', { title: 'x' })).status, 400);
    assert.equal((await player('GET', '/notes/2946/Harvest')).status, 400);
  });

  it('still needs a passcode', async () => {
    assert.equal((await call('GET', '/notes')).status, 401);
    assert.equal((await call('PUT', '/notes/2946/Spring', { title: 'nope' })).status, 401);
  });

  it('deletes one season without touching the others', async () => {
    const r = await player('DELETE', '/notes/2946/Autumn');
    assert.equal(r.status, 200);
    assert.equal((await player('GET', '/notes/2946/Autumn')).data.note, null);
    assert.ok((await player('GET', '/notes/2946/Spring')).data.note, 'Spring should survive');
  });
});

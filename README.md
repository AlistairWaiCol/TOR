# One Ring Companion

A personal-use companion app for a **The One Ring 2e** campaign (*Darkening of Mirkwood*) — digital
character sheets, a live shared hex map, and the full TOR 2e journey/travel engine, for 5 players
plus a GM. Not commercial, not hardened; built for six people on a LAN or a small host.

Built to the spec in `One_Ring_Companion_App_Spec.md`.

---

## Running it locally

```bash
npm install
npm run seed:map          # optional: import the campaign map + build web derivatives
npm run dev
```

| | |
|---|---|
| App (Vite dev server) | http://localhost:5173 |
| API + Socket.IO | http://localhost:3001 |
| Dev player passcode | `changeme` |
| Dev GM passcode | `changeme-gm` |

The Vite dev server proxies `/api` and `/socket.io` to the API, so everything is same-origin and the
session cookie and WebSocket upgrade just work. Copy `.env.example` to `.env` and change the
passcodes for real use.

```bash
npm test                  # dice engine + journey maths + full end-to-end integration suite
npm run db:migrate        # create/refresh the SQLite schema (also runs at server start)
npm run build             # production client build into dist/ (served by the API if present)
```

### Environment

| Variable | Purpose |
|---|---|
| `PLAYER_PASSCODE` | Full read/write on everything |
| `GM_PASSCODE` | Adds the GM-only controls |
| `SESSION_SECRET` | Signs the session cookie |
| `DISCORD_WEBHOOK_URL` | Optional. Unset/empty → posting is skipped silently |
| `DATABASE_URL` | `file:./data/one-ring.db` for SQLite |
| `DB_CLIENT` | `sqlite` now, `pg` after the Postgres swap |
| `PORT`, `CLIENT_ORIGIN` | Server port and the dev client origin |

---

## What's in it

**Campaign Overview** — GM-editable Year and Season (Season feeds the Marching Test failure
distance directly), the 20/18 Target-Number base toggle, and the list of past journeys.

**Character sheets** — the full field list from spec §5: General, Rewards, Virtues, Useful Items
(table or plain gear box), Conditions/Modifiers, Custom Dice Roller, the three Attributes with their
pools and six skills each, Experience, Mount, Combat proficiencies and stance, the Weapon table with
Fell/Grievous/Keen quality dropdowns, and the Armour + Shield tables with Close-fitting/Cunning
Make/Reinforced. Every roll icon goes through the one shared dice engine, with the sheet's current
Favoured/Ill-favoured selection and Weary/Miserable state applied automatically. No per-user
ownership — anyone with the player passcode can edit any sheet.

**Map calibration (GM)** — upload a map image, get three WebP resolution tiers generated
server-side, and true up a flat-top offset-column hex grid with live sliders seeded to the measured
values for `northlands22.png`. Per-hex tagging: Region type, and **independent** Hard Terrain and
Road flags, optional Perilous Area with a Peril rating, optional label. Paint mode tags many hexes
at once.

**Live shared map** — everyone sees the same party token and proposed route; any player can click
hexes to draw a route and it updates for everyone over Socket.IO. GM can lock or clear it. Role
assignment enforces exactly one Guide with all four roles covered (doubling allowed elsewhere), plus
the mounted and Forced March toggles.

**Travel engine** — the §6d sequence as an explicit server-side state machine: Marching Test →
distance → Perilous Areas → Select Target → Determine Event → Resolution → repeat → Ending the
Journey. The GM presses Roll; the *targeted player* makes their own resolution roll. Each roll posts
a short line to Discord and lands in the journey log.

**Journey Log** — auto-populated per event (hex tags, target role and hero, Feat Die, event, roll
outcome, consequence, Fatigue), with a free-text note per event and one for the whole journey.
Exportable as Markdown or JSON. Kept entirely separate from any of your own campaign documents.

---

## Layout

```
shared/          Game rules, imported by BOTH server and client — the single source of truth
  dice.js          The dice engine (§7). Pure, dependency-free, unit-tested.
  journey.js       Journey Events Table, Marching Test distance, day/Fatigue maths, role rules
  character.js     The §5 sheet shape, skill lists, derived values
  rewards.js       The six core Reward qualities (F/G/K/CF/CM/RI) and their effects
  hexMath.js       Flat-top offset-column hex geometry and the calibration defaults
server/
  config.js        Env + paths
  db/              Drizzle schema, connection, idempotent migration
  lib/             auth, store (repository layer), rollService, travelEngine, discord, images
  routes/          auth, campaign, characters, map, party, travel, journeys, rolls
  realtime.js      Socket.IO wiring + snapshot broadcasting
client/src/        React (Vite): pages/, components/, state/AppContext.jsx
tests/             dice.test.js, journey.test.js, integration.test.js
scripts/seedMap.js Import the campaign map and build derivatives
uploads/
  seed/            Original map images — never served over HTTP
  derivatives/     Generated WebP tiers — the only map bytes a browser ever gets
```

### The dice engine

One function, `rollDice()`, used by every roll in the app:

1 Feat Die (d12: 1–10, Gandalf rune, Eye of Sauron) + N Success Dice (d6: 1–3 outlined, 4–5 plain,
6 = Success icon). Favoured rolls two Feat Dice and keeps the higher; Ill-favoured keeps the lower;
both at once cancel. The Gandalf rune is an automatic success; the Eye counts 0, and is an automatic
failure if the hero is Miserable. Weary zeroes outlined Success Dice. Total vs Target Number
(20 − Attribute, or 18 for the short-campaign variant). Icons give the degree of success. Spending
1 Hope adds 1 Success Die, or 2 while Inspired, and deducts the Hope. Special Successes are recorded
as tags on the roll and not mechanically enforced.

`evaluateRoll()` is the pure evaluation half, separated so the tests drive every branch
deterministically rather than hoping the RNG cooperates.

---

## Judgment calls

Things the spec left open, and what was chosen:

- **Gandalf rune's numeric value = 11.** The spec says the rune is an automatic success but not what
  it contributes to a total. 11 makes it the highest face, which also makes Favoured/Ill-favoured
  selection and the Keen quality's "Piercing Blow on 9+" threshold work naturally.
- **Favoured + Ill-favoured cancel out** to a normal single-Feat-Die roll (RAW, not stated in the spec).
- **Character sheets are stored as one JSON document** alongside scalar columns for identity. The
  field list lives in `shared/character.js` as the single source of truth. This is a large, mostly
  static form with nested tables — a hundred columns would buy nothing, and the column becomes
  `jsonb` on Postgres with no query changes.
- **Damage is not a dice roll.** The reference sheet has a damage icon; in TOR 2e damage is a static
  value, so that icon shows the effective Damage/Injury/Piercing threshold after Grievous/Fell/Keen
  rather than faking dice.
- **Parry has no roll button.** Parry is a static value that sets the TN attackers must beat. Total
  Parry is displayed; the Protection cluster gets the roll button, as the spec describes.
- **Attack and Protection roll TNs are editable.** Both are set by something outside the sheet (the
  foe's Parry; the blow that caused the Protection roll), and there's no bestiary in v1 — so the
  dialog pre-fills a sensible number and says what actually sets it.
- **"The Company" for Fatigue/Shadow/Hope effects** = the heroes with a travel role assigned to this
  journey. If nobody has a role, it falls back to all characters.
- **Multiple heroes holding the rolled role.** The rulebook targets "the Scouts" (plural) but only
  one hero rolls; when several hold the role the GM picks who, the same flow as when nobody holds it.
- **Manual event placement has two flavours.** `Pin` sets the hex and the Marching Test still gets
  rolled (so the Guide's roll and its Discord post happen) but the pin decides the distance;
  `Place event, skip the test` skips the roll entirely. The spec's wording supports either reading.
- **Forced March is a GM toggle**, mounted is open to any player — matching "the GM can toggle Forced
  March" in §6d against the Company-wide mounted toggle in §6c.
- **Whispered rolls** never post to Discord. With no individual accounts, "whisper to me" simply
  means the result is not broadcast; "whisper to GM" broadcasts to GM sockets only.
- **Marching Tests are recorded in the journey log** as their own entry kind, so the day maths is
  auditable; the log view renders them more quietly than events.

## Not in v1

Combat tracker, NPC/bestiary database, session notes, a full Discord bot, individual user accounts,
and a native mobile app are all deliberately out of scope (spec §8). The nav, routing and data layer
already leave room: `client/src/App.jsx` has a data-driven `NAV` array with placeholder routes, so
adding one means writing a page component and flipping a flag.

## Later: Postgres + Railway

Not part of this build. When you're ready:

1. `server/db/schema.js` is the only dialect-aware file — swap `sqliteTable` → `pgTable`
   (`drizzle-orm/pg-core`) and `integer(..., { mode: 'boolean' })` → `boolean(...)`. `text`, `real`
   and the JSON-as-text columns map straight across, and no raw SQLite-only SQL is used anywhere.
2. `server/db/index.js` is the only place a driver is constructed — swap `better-sqlite3` for `pg`
   and `drizzle-orm/node-postgres`.
3. Replace `server/db/migrate.js` with `drizzle-kit generate` + the Drizzle migrator.
4. Then follow spec §3 for Railway: push to GitHub, deploy from repo, add PostgreSQL, set
   `PLAYER_PASSCODE` / `GM_PASSCODE` / `SESSION_SECRET` / `DISCORD_WEBHOOK_URL`, confirm
   `DATABASE_URL` is linked, generate a domain. `npm run build` + `npm start` serves the built client
   from the same process.

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
| `DATABASE_URL` | `file:./data/one-ring.db` for SQLite; a `postgres://...` connection string for Postgres |
| `DB_CLIENT` | `sqlite` (default) or `pg` — see "Postgres + Railway" below |
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

**Map calibration (GM)** — upload a map image, get WebP derivatives generated server-side (a
full-resolution tier that's re-encoded but never downscaled, so zoomed-in place names stay sharp,
plus smaller `web`/`thumb` tiers for zoomed-out overview use), and true up a flat-top offset-column
hex grid with live sliders seeded to the measured values for the Wilderland Adventurer's Map.
Per-hex tagging: Region type, and **independent** Hard Terrain and Road flags, optional Perilous
Area with a Peril rating, optional label. Paint mode tags many hexes at once.

**Live shared map** — everyone sees the same party token and proposed route; any player can click
hexes to draw a route and it updates for everyone over Socket.IO. GM can lock or clear it. Role
assignment enforces exactly one Guide with all four roles covered (doubling allowed elsewhere), plus
the mounted and Forced March toggles.

**Travel engine** — the §6d sequence as an explicit server-side state machine: Marching Test →
distance → Perilous Areas → Select Target → Determine Event → Resolution → repeat → Ending the
Journey. The GM presses Roll; the *targeted player* makes their own resolution roll. Each roll posts
a short line to Discord and lands in the journey log.

**Journey Log** — auto-populated per event (hex tags, target role and hero, Feat Die, event, roll
outcome, consequence, Fatigue), with a free-text note per event and one for the whole journey, plus
a route map cropped to the hexes actually travelled with a numbered pin per event. Exportable as
Markdown or JSON. Kept entirely separate from any of your own campaign documents.

**Compendium** — the campaign's shared reference shelf: **General Virtues** (the culture-agnostic
core six), **Cultural Virtues** (60 entries across ten cultures, grouped by Culture), Rewards, a
Weapons & Armour catalogue seeded with the core-rulebook gear tables, and Locations with the years
visited and a free-text key-information field. Map hexes link to a Location, and the live map shows
it on hover with a link into its entry. Character sheets pick Rewards, Virtues and gear from here —
the Cultural Virtue picker narrows itself to the hero's own Culture — while still accepting
home-brew entries typed in by hand.

**Handouts** — an image plus notes, tagged to a campaign Year + Season. Players get a Year/Season
selector that starts on the campaign's current date and is then free to browse back through earlier
seasons. New handouts are **hidden** until the GM reveals them, and the GM can hide them again at any
time; hidden ones are filtered out server-side, so a player's browser is never sent one. Uploads go
through the same pipeline discipline as the map: re-encoded server-side into WebP, original never
served.

---

## Layout

```
shared/          Game rules, imported by BOTH server and client — the single source of truth
  dice.js          The dice engine (§7). Pure, dependency-free, unit-tested.
  journey.js       Journey Events Table, Marching Test distance, day/Fatigue maths, role rules
  character.js     The §5 sheet shape, skill lists, derived values (Load, Weary, attack TN, stance)
  rewards.js       The six core Reward qualities (F/G/K/CF/CM/RI) and their effects, grip Injury
  compendium.js    Compendium sections, core Virtue/Reward/gear seed data, catalogue → sheet mapping
  culturalVirtues.js  The 60 Cultural Virtues, by culture
  hexMath.js       Flat-top offset-column hex geometry and the calibration defaults
server/
  config.js        Env + paths
  db/              Drizzle schema, connection, idempotent migration
  lib/             auth, store (repository layer), rollService, travelEngine, discord, images
  routes/          auth, campaign, characters, compendium, handouts, map, party, travel,
                   journeys, rolls
  realtime.js      Socket.IO wiring + snapshot broadcasting
client/src/        React (Vite): pages/, components/, state/AppContext.jsx
                   assets/party-pin.png is the map's party token
                   lib/journeyMap.js renders the Journey Log's route map on an offscreen canvas
tests/             dice.test.js, journey.test.js, character.test.js, compendium.test.js,
                   discord.test.js, integration.test.js
scripts/seedMap.js Import the campaign map and build derivatives
scripts/seedCompendium.js  Re-seed the core Virtues and Rewards (migrate() already does this)
scripts/seedCharacters.js  Import a party roster from a characters_seed.json file
uploads/
  seed/            Original map images — never served over HTTP
  originals/       Uploaded maps and handouts — never served over HTTP
  derivatives/     Generated WebP tiers — the only map/handout bytes a browser ever gets
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
- **An attack roll asks for the target's Parry, not a Target Number.** The TN of an attack is the
  attacker's STRENGTH TN plus the target's Parry, so the dialog takes the Parry and does the sum
  live. Targets are almost always NPCs with no sheet in this app, so it's a typed number rather than
  a lookup. **Protection roll TNs stay editable** — that TN is set by the blow that caused the roll,
  and there's no bestiary in v1.
- **Stance modifiers apply to the hero's own outgoing attacks only.** Forward +1 Success Die, Open
  no change, Defensive −1 per opponent engaging (a `# engaging` box next to the Stance selector, so
  it's live), Rearward no dice modifier. NPC/incoming attacks are still out of scope. The dialog
  pre-fills the modifier into the existing Situational-dice field, so the GM can still overrule it.
- **A Rearward attack with a melee weapon warns rather than blocks.** RAW the stance is ranged-only,
  but the app follows the same "say so, then let the table decide" line it takes on mounted travel
  over hard terrain — the roll dialog shows a warning box and the roll still goes through.
- **Load is computed, and includes Treasure.** Equipped weapons + armour + shield after Cunning Make,
  plus `strength.treasure`. It's derived from the sheet on every render rather than stored, so
  equipping a piece of gear or changing a quality tier updates it immediately with nothing stale to
  go out of sync.
- **Weary is computed: Endurance ≤ effective Load.** Effective Load is the computed Load, plus
  current Fatigue *only while the hero is actively travelling* (§6 — Fatigue temporarily raises Load
  on the road). That's a comparison-time adjustment; it never writes to the sheet. `computeWeary()`
  in `shared/character.js` is the single implementation, called by the sheet to render the state and
  by `performRoll()` so the dice engine rolls the same value. Miserable and Wounded remain manual.
  Note the formula is `≤`, so a blank sheet (Endurance 0, Load 0) reads as Weary until an Endurance
  is entered — that is the rule as written, not a bug.
- **"Actively travelling" means a journey in a non-terminal phase.** Every phase except `idle` and
  `complete` counts, including `journey_end` and `awaiting_fatigue_relief` — the Company is still
  shedding road Fatigue at that point. Who counts is the same "The Company" rule used for event
  Fatigue: the heroes holding a travel role, falling back to everyone if no roles are assigned.
- **Special Success spends post a follow-up to Discord, not an edit.** `postToDiscord()` doesn't
  capture the sent message's id (no `?wait=true`), so editing the original roll post isn't wired up.
  A short follow-up line referencing the roll's label is enough for this app, and it respects the
  same whisper rule — a whispered roll's spends stay quiet. Only *newly* spent icons are announced,
  because the dialog saves on every dropdown change and re-posting the whole list would spam.
- **Compendium writes need the player passcode, not the GM one.** This app has no per-user ownership
  (anyone may edit any sheet), and home-brew gear is normal at the table.
- **Compendium Rewards are seeded from `shared/rewards.js`, not re-typed.** The tier text and values
  come from the same quality tables the sheet's F/G/K/CF/CM/RI dropdowns use, so the two cannot
  drift. Cunning Make is listed once, applying to both armour and shields.
- **Virtue effect text is summarised, not transcribed.** Written in the same terse mechanical style
  as the Reward qualities ("+2 Injury", "−2 Load") rather than quoted from the rulebook — worth a
  glance against your book before leaning on the exact wording.
- **Compendium pickers never replace free text.** Rewards and Virtues append the picked entry to the
  existing text box; weapon/armour pickers add a pre-filled row you can then edit, alongside the
  blank-row buttons. Home-brew stays a first-class option.
- **The Journey Log map is rendered client-side.** The browser already has the map image, the hex
  geometry and the overlay code, so no server-side image pipeline was needed. It's generated when
  the GM closes a journey out, stored as a PNG data URL on the journey row, and there's a
  Draw/Redraw button on the log for journeys that predate the feature.
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
- **The player map shows no GM hex tagging.** `HexMap` already had `showTags` split from `showGrid`;
  `MapView` now passes `showTags={isGM}`. Players get the plain map art, the grid lines they need to
  click a route, the party token and the route — no region tint, hard-terrain hatching, road strokes,
  Perilous outlines or hex labels. Those are GM prep, and reading them off the map is reading the
  GM's notes.
- **Minimum Standard of Living is a hint, never a gate.** Catalogue armour and shields carry the
  requirement; the sheet's picker annotates each option ("Shield — needs Common") and, after adding
  an item the hero cannot normally afford, shows a warning *next to that picker* — with the item
  already on the sheet. Same "say so, then let the table decide" line the app takes on Rearward melee
  attacks and mounted travel over hard terrain. The rule governs character creation, not what a hero
  may pick up mid-campaign.
- **The Minimum Standard of Living mapping is explicit, not derived from the source tables'
  asterisks.** Mail-shirt and Shield → Common; Coat of Mail and Great Shield → Prosperous; everything
  else → none. ⚠️ **Flagging a real discrepancy:** the source armour table marks *Helm* with a single
  `*`, the same marker Mail-shirt carries, which by that pattern would put Helm at Common — but the
  explicit instruction was "none", and that is what is implemented. The shields table is
  self-inconsistent in the same way (both Shield and Great Shield carry `**` despite needing
  different tiers), which is why the asterisks are not trusted at all. Worth a check against your
  book; it is a one-line change in `CORE_ARMOUR` if Helm should be Common.
- **Three weapons have two Injury ratings, one per grip; Damage never changes.** Long Sword (16/18),
  Spear (14/16) and Long-hafted Axe (18/20) store both as `injury` + `injuryTwoHanded`, and the sheet's
  weapon row grows a Grip dropdown for exactly those three (everything else shows "—"). `gripInjury()`
  in `shared/rewards.js` picks the rating in use and Fell stacks on top of whichever it is. Flattening
  to one number would have lost half the rule.
- **Unarmed stores Injury 0 and keeps its caveat in Notes.** Its Injury is "–" in the table because it
  cannot cause a Piercing Blow. That is one row's worth of exception, so it did not earn a schema flag
  — the Notes text carries it.
- **Armour's Type (Leather / Mail / Headgear) is Compendium-only.** It groups the catalogue; it is not
  pushed onto the sheet's armour rows, and `catalogueItemToArmour()` deliberately does not copy it.
  A Helm's Protection needs no stacking logic either — `totalProtection()` already sums every equipped
  armour row, so a Helm is simply another row worth 1.
- **Cultural Virtues get their own table, not a Culture column on `virtues`.** Different retrieval
  semantics (you look them up by culture, never alphabetically across all ten) and a different
  identity: several Virtue names appear under more than one culture, so a Cultural Virtue is keyed on
  (name, culture). Descriptions are **transcribed** rather than summarised, unlike the terse core
  Virtue effects — a Cultural Virtue's wording usually carries the whole rule.
- **One research note was stripped from the imported Cultural Virtues.** The Beornings' "Brother to
  Bears" carried a parenthetical asking the reader to verify a symbol against the book; that is a note
  to a researcher, not rules text. The six **Bree Hobbits** rows keep their parenthetical about that
  culture's hybrid creation rule — that *is* rules content. (The brief described four such rows; the
  source file has six, and all six were left untouched.)
- **The Discord bold lives in the Discord layer, not the dice engine.** `describeRoll()` still returns
  plain text, because the same string is shown verbatim in the app's roll feed and RollDialog, neither
  of which renders Markdown. `formatRollMessageForDiscord()` calls it *without* `actor` and prefixes
  `**Name** ` itself, so only the Discord-bound copy is bold. The travel engine bolds hero names in
  place (`boldName()`) in the Select Target, GM-targets and event-resolved lines; the Marching Test and
  Determine Event summaries name no hero, so they were left alone. Effect strings inside a resolved
  event ("Grimfast is Wounded") are not bolded — bolding every name in a joined list is noise.
- **Target Number is a stat box, not a pill.** Each Attribute panel now leads with a `pool-grid`
  holding Rating and a read-only Target No. box, the same shape the computed Load box already used.
  The maths was already right; this is purely about giving it the weight it earns.
- **"Playing as" is a browser preference, not an account.** Stored in `localStorage`, never sent to the
  server. It changes nothing about permissions — anyone may still open and edit any sheet — and only
  decides who the travel engine's "your turn to roll" prompt is addressed to. A stored id whose
  character has since been deleted quietly resolves to nobody.
- **The turn prompt lives at the app shell.** Rendered next to `<main>`, not inside the Map page, since
  its whole value is reaching a player who is looking at their sheet instead of the map.
  `promptedRollFor()` in `shared/journey.js` is the pure branch table, driven entirely by state already
  broadcast over Socket.IO — no new server state, no polling.
- **The prompt fires the roll; it does not open the RollDialog.** The GM-triggered Marching Test and
  Event Resolution are not dialog rolls either — they `POST` to the travel engine, which owns the dice,
  the Discord post and the journey-log entry. Putting a dialog in front of the player's copy would
  create a second, divergent path and let a player edit a Marching Test's rating and TN when the GM's
  button cannot. The prompt instead offers the one choice the dialog would have added that matters:
  a *Spend 1 Hope* checkbox. The GM's own controls are untouched and still fire every step manually.
- **`POST /travel/marching-test` is now player-level.** The Marching Test is the Guide's own TRAVEL
  roll and the Guide is a player, so it sits with `/resolve` and `/fatigue-roll`. There is nothing to
  check a roller's identity against — this app has no accounts, and "Playing as" is a preference, not
  a login — which is the same footing every other player-level write already stands on.
- **Handout writes are GM-only, unlike the Compendium's.** The Compendium takes the player passcode
  because home-brew gear is normal at the table; a handout's entire point is that the GM decides when
  the table sees it. Hidden-ness is enforced on the list, single-read *and* image routes, so it holds
  up against someone poking at `/api` directly, and the image route sends `Cache-Control: private`
  because a revealed handout can be hidden again.
- **Handouts are not in the Socket.IO snapshot.** Mutations broadcast a bare `handouts:changed` ping
  and the page refetches over HTTP. The snapshot goes to every client including players, so putting
  handouts in it would mean either leaking hidden ones or building a second role-aware snapshot path;
  a refetch keeps the server's role filter as the single place hidden-ness is decided.
- **Handouts get two tiers, no full-resolution one.** A handout is a letter or a sketch, not the
  6600px campaign map — there is no zoom-in-and-read-the-place-names case, so 1600px `view` and 420px
  `thumb` are the whole picture. `withoutEnlargement` means a smaller upload stays its own size, and
  `skipOversized: false` guarantees both named tiers exist so both are addressable.
- **The party pin is anchored on its tip, not its centre.** The artwork is trimmed to its own bounding
  box at build time, so the pin's point *is* the bottom edge of the file and anchoring is
  bottom-centre on the hex centre — a map pin points at a place. It is drawn at 1.25× hex height so it
  scales with the grid at every zoom and tier, with a dark canvas drop-shadow behind it: it is a warm
  gold pin on warm-toned map art, and the shadow is doing real legibility work, not decoration. The
  original gold dot survives as the fallback while the image loads or if it fails.
- **The Postgres swap turned out to not be implemented, only documented.** This README used to
  describe it as "trivial — swap `sqliteTable` for `pgTable`" without anyone actually doing it;
  `DB_CLIENT` was read from the environment but never branched on anywhere. Discovered because a
  Railway deploy with a Postgres addon attached was still reporting `"db":"sqlite"` from
  `/api/health` — meaning production had been running on SQLite inside the container's ephemeral
  filesystem the whole time, silently losing data on every redeploy. It's real now (see "Postgres +
  Railway" above), and was built and verified against an actual local Postgres instance, not just
  written and assumed to work.
- **`seedCompendium.js` was rewritten from raw `sqlite.prepare()` calls to the Drizzle query
  builder** as part of making it dialect-portable — same idempotent find-or-insert logic, just
  through `db.select()`/`db.insert()` instead of hand-written `?`-placeholder SQL, so it runs
  unchanged against either dialect instead of needing a second parallel implementation.
- **Fixed a real, previously-dormant cross-platform bug while touching `migrate.js`:** its "was this
  file run directly?" check built a `file://` URL by hand and compared it against
  `import.meta.url`, which is wrong on Windows (an absolute path needs `file:///D:/...`, three
  slashes, not two). `npm run db:migrate` has therefore always silently done nothing on Windows —
  masked because the server calls `migrate()` directly at startup instead of through that check.
  Fixed with `pathToFileURL()`, the correct cross-platform way to do this comparison.
- **`seedCharacters.js` skips existing characters by name rather than updating or duplicating them.**
  The safer default for a script whose main job is "populate a fresh database" — re-running it after
  adding a new player to the source file should only add the new one, not silently overwrite hand-
  edited stats on the existing four.

## Not in v1

Combat tracker, NPC/bestiary database, session notes, a full Discord bot, individual user accounts,
and a native mobile app are all deliberately out of scope (spec §8). The nav, routing and data layer
already leave room: `client/src/App.jsx` has a data-driven `NAV` array with placeholder routes, so
adding one means writing a page component and flipping a flag.

The Compendium leaves the same room. Its sections are declared as data in
`shared/compendium.js` (`COMPENDIUM_SECTIONS`) and in `COMPENDIUM_TABLES` in `server/lib/store.js`,
and `server/routes/compendium.js` is one generic CRUD handler over them — so NPCs or a Bestiary
become a table, a section entry and a render branch, not another route file. One table per section
rather than a single polymorphic table, because the sections have genuinely different columns.

## Postgres + Railway

The dialect switch is real and implemented, not just designed-for: set `DB_CLIENT=pg` and
`DATABASE_URL` to a Postgres connection string and the app runs on Postgres, unchanged everywhere
outside three files.

- `server/db/schema.js` (SQLite) and `server/db/schema.pg.js` (Postgres) are field-for-field mirrors
  of each other — same tables, same columns, same JS types. Every other file imports `schema` from
  `server/db/index.js`, which picks the right one, so nothing downstream (`server/lib/store.js`,
  every route) is dialect-aware.
- `server/db/index.js` constructs either a `better-sqlite3` or a `pg.Pool` connection and hands
  Drizzle the matching schema. Postgres connects with `ssl: { rejectUnauthorized: false }` — the
  standard pragmatic choice for managed Postgres behind a proxy (Railway, Heroku, Render); it still
  encrypts the connection, it just doesn't validate the CA.
- `server/db/migrate.js` hand-rolls `CREATE TABLE IF NOT EXISTS` for both dialects rather than using
  `drizzle-kit` — simplest thing that could work for a two-table-count-forever personal app. Table
  creation is the one thing that has to be dialect-specific SQL; everything after it (the singleton
  campaign/party/travel rows, the Compendium seed in `seedCompendium.js`) goes through the Drizzle
  query builder and is identical code for both dialects.
- Timestamp columns stay `text` in both dialects, not native `timestamp`/`datetime` — the app always
  writes `new Date().toISOString()` from JS and expects to read back a string; a native timestamp
  type would hand back a `Date` object from Postgres instead, a real behavioural difference. The few
  inserts that rely on the column's own default (not JS setting it explicitly) use a Postgres
  `to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')` expression that produces the
  same shape `toISOString()` does.
- JSON documents (character sheets, journey routes, etc.) stay `text` in Postgres too, parsed in the
  repo layer exactly as SQLite does — switching to native `jsonb` would be a genuine future
  improvement but touches every call site, not worth the risk on a same-day cutover.

### Deploying to Railway

Follow spec §3: push to GitHub, deploy from the repo, add a PostgreSQL database, set
`PLAYER_PASSCODE` / `GM_PASSCODE` / `SESSION_SECRET` / `DISCORD_WEBHOOK_URL` / `DB_CLIENT=pg` on the
web service, confirm `DATABASE_URL` is linked from the Postgres service, generate a domain.
`npm run build` + `npm start` serves the built client from the same process. **`DB_CLIENT=pg` is the
part that's easy to forget** — without it the app silently falls back to SQLite inside the
container's filesystem, which is ephemeral and gets wiped on every redeploy. Check
`GET /api/health` after deploying — its `db` field says which one is actually live.

### Seeding a database — local or Railway, first time or after a reset

Three scripts, all dialect-aware (they read `DB_CLIENT`/`DATABASE_URL` the same way the server
does), each safe to re-run:

```bash
npm run db:migrate                                        # tables only, no data
npm run seed:map                                          # campaign map + hex calibration
npm run seed:compendium                                   # core Virtues/Rewards/catalogue/Cultural Virtues
npm run seed:characters -- "C:\path\to\characters_seed.json"   # a party roster
```

`seed:map` and `seed:compendium` skip/update in place if their data already exists (a calibration is
matched by name, Compendium `source = 'core'` rows are refreshed, never duplicated).
`seed:characters` matches existing characters by name and skips them with a warning — it only ever
adds characters that aren't there yet, so it's safe to run again after adding new players to the
source file.

**Against Railway specifically:** run these from your own machine with `DATABASE_URL` set to
Railway's Postgres connection string for that one command, e.g. in PowerShell:

```powershell
$env:DB_CLIENT = "pg"
$env:DATABASE_URL = "<paste from Railway's Postgres service → Variables → DATABASE_PUBLIC_URL>"
npm run seed:map
npm run seed:compendium
npm run seed:characters -- "C:\path\to\characters_seed.json"
```

Use `DATABASE_PUBLIC_URL` (the externally-reachable one with a public host/port), not the internal
`DATABASE_URL` Railway gives the web service itself — that one only resolves inside Railway's own
network. Unset `$env:DB_CLIENT`/`$env:DATABASE_URL` afterward (or just close the terminal) so your
next `npm run dev` goes back to local SQLite.

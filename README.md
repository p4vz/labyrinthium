# Labyrinthium

A web clone of the classic pencil-and-paper game **Labyrinth**: the computer is
the game master. It holds a secret multi-level maze; players know only the
level dimensions and the entrance, and navigate blind — move, get told what you
found, and draw your own map as you go. First player to walk out of an exit
carrying the treasure wins.

Between runs you build a **persistent character**: a customizable pixel-art
avatar dressed in cosmetic loot found inside the labyrinths (see below).

Full game spec and roadmap: [`docs/PLAN.md`](docs/PLAN.md).

## Packages

| package | what |
|---|---|
| `@labyrinthium/shared` | Pure, deterministic game engine + map generator + protocol schemas (zod). No framework deps; runs on the server, in tests, and in the browser (replay viewer). |
| `@labyrinthium/server` | Fastify + WebSocket game server: rooms, sessions/reconnect, spectators, SQLite persistence, map CRUD/generate/validate + game-history REST API, serves the built web app. |
| `@labyrinthium/web` | The browser client: lobby, game HUD with the manual mapping UI (stamp palette, level tabs, auxiliary maps with copy/paste/merge and undo/redo), map editor, replay viewer. |
| `@labyrinthium/cli` | Terminal client & random-bot harness for smoke-testing games. |

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test

# run everything: the server also serves the built web app
pnpm dev            # open http://localhost:8080

# frontend dev with hot reload (proxies /api and /ws to :8080)
pnpm --filter @labyrinthium/web dev   # open http://localhost:5173

# browser end-to-end tests (real chromium, two players to a win)
pnpm --filter @labyrinthium/web test:e2e

# generate a map from the shell
curl -s -X POST localhost:8080/api/maps/generate \
  -H 'content-type: application/json' \
  -d '{"preset":"medium","complexity":"advanced","seed":"demo"}'

# play from two terminals instead of the browser
pnpm --filter @labyrinthium/cli start -- --create --name alice
pnpm --filter @labyrinthium/cli start -- --join <ROOMCODE> --name bob

# or watch two bots stumble around
pnpm --filter @labyrinthium/cli start -- --smoke
```

## Deploying (Railway)

The repo ships a `Dockerfile` and `railway.json`, so deployment is:

1. Railway → **New Project → Deploy from GitHub repo** → pick this repo.
   Railway detects the Dockerfile and builds the whole game (server + web
   client) into one service.
2. Networking → **Generate Domain**. That URL is the game: share
   `https://<your-app>.up.railway.app` and play. WebSockets work out of the
   box; the platform's `PORT` variable is respected and `/health` is the
   healthcheck.
3. Optional: add a **Volume** mounted at `/data` to keep finished-game
   history (the replay archive) across deploys. Without it, replays reset on
   each deploy — live games are unaffected either way.

Any other Docker host (Fly.io, Render, a VPS) works the same way.

Using Claude Code? Open this repo and run **`/deploy-railway`** — it walks
the whole Railway CLI setup (login, project, deploy, domain, volume) for you
(see `.claude/commands/deploy-railway.md`).

## How a round works

1. Someone creates a room (generated map — size × complexity × seed — or a
   hand-built map id from the editor) and shares the 6-letter room code.
2. Players join from their own devices. Nobody sees the map — each player
   gets a blank grid (they know only the level dimensions and the entrance)
   and draws their own beliefs: walls, rivers, teleports, notes.
3. On your turn: walk, shoot, throw a grenade, or arm a mine. The game
   master (the server) tells you privately what happened; everyone hears
   public events ("a shot rang out…").
4. Teleported or dropped through a trap door? Open an auxiliary map, chart
   the unknown region, and merge it onto your main map once you recognize
   where you are.
5. First player to walk out of an exit carrying the treasure wins — then the
   real map is revealed, and the whole game can be replayed move by move.

## Your character (cosmetics meta-progression)

Every labyrinth also hides **aesthetic loot** — none of it changes gameplay,
all of it builds your character:

- A **guest profile** is created silently on your first visit (no login). Add
  a username + password later in the Wardrobe to secure the same character
  across devices.
- **Coins** and **common/uncommon cosmetics** are banked to your profile the
  moment you step on them.
- **Rare+ cosmetics** spawn deep in the maze and are only yours if you carry
  them OUT alive — win, or use the new **walk out** action to leave through an
  exit without the treasure (you forfeit the race; the game goes on without
  you). Get shot, mined, trapped, or mauled while carrying them and they drop
  where you fall, free for anyone to steal. A house-rule checkbox
  (`allowLeave`, on by default) can disable early walk-outs; if everyone walks
  out, nobody wins.
- The **Wardrobe** (Home → Wardrobe) is where you dress the avatar: 29
  pixel-art templates (hats / outfits / trinkets) across 8 themed sets, 6 skin
  tones, and 14 dye ramps. A collection log tracks which silhouettes you've
  discovered, with provenance on every item (which maze, extracted alive,
  when). A daily **shop** (rotates at midnight UTC, same stock for everyone)
  turns coins into looks.
- Your avatar shows on the Home screen, parades in the lobby, marks your pawn
  on your hand-drawn map, and walks the true map in spectator view, the
  end-of-game reveal, and replays.

Names are procedurally rolled — commons are plain (“Straw Hat”), rares carry
their origin (“Rune-etched Hood of the Drowned Hall”), legendaries are unique
(“The Minotaur's Own Horns”). Item identities are deterministic per map seed,
so re-farming the same seed can never duplicate a drop.

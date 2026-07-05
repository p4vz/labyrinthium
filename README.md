# Labyrinthium

A web clone of the classic pencil-and-paper game **Labyrinth**: the computer is
the game master. It holds a secret multi-level maze; players know only the
level dimensions and the entrance, and navigate blind — move, get told what you
found, and draw your own map as you go. First player to walk out of an exit
carrying the treasure wins.

Full game spec and roadmap: [`docs/PLAN.md`](docs/PLAN.md).

## Packages

| package | what |
|---|---|
| `@labyrinthium/shared` | Pure, deterministic game engine + map generator + protocol schemas (zod). No framework deps; runs on server, in tests, and later in the browser. |
| `@labyrinthium/server` | Fastify + WebSocket game server: rooms, sessions/reconnect, SQLite persistence, map CRUD/generate/validate REST API. |
| `@labyrinthium/cli` | Terminal client & random-bot harness for smoke-testing games. |
| `@labyrinthium/web` | Phase-4 placeholder for the browser client (mapping UI). |

## Quick start

```bash
pnpm install
pnpm -r build
pnpm -r test

# run the server
pnpm dev            # listens on :8080 by default

# generate a map
curl -s -X POST localhost:8080/api/maps/generate \
  -H 'content-type: application/json' \
  -d '{"preset":"medium","complexity":"advanced","seed":"demo"}'

# play from two terminals
pnpm --filter @labyrinthium/cli start -- --create --name alice
pnpm --filter @labyrinthium/cli start -- --join <ROOMCODE> --name bob

# or watch two bots stumble around
pnpm --filter @labyrinthium/cli start -- --smoke
```

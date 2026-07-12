# Deploy Labyrinthium to Railway

You are deploying this repo to Railway using the Railway CLI. The repo is
already deployment-ready: `Dockerfile` builds the whole game (server + web
client) into one service, `railway.json` configures the builder and the
`/health` healthcheck, and the server respects Railway's injected `PORT`.
Work through the steps below in order, verifying each one before moving on.
Ask the user before anything irreversible or account-related.

## 1. Preflight

- Run `git status` and `git branch --show-current`. If the deployable work
  lives on `claude/labyrinthium-backend-planning-wuuevl` and `main` doesn't
  have it yet, ask the user whether to merge it into `main` first
  (recommended) or deploy straight from the current branch. If they choose
  merge: `git checkout main && git merge <branch> && git push`.
- Confirm `Dockerfile` and `railway.json` exist at the repo root. If they
  are missing, stop — you are on the wrong branch.
- Do NOT run the full local build first; Railway builds in the cloud.

## 2. Install and authenticate the Railway CLI

- Check for the CLI: `railway --version`. If missing, install it:
  - macOS: `brew install railway`
  - any platform with Node: `npm i -g @railway/cli`
- Check auth: `railway whoami`. If not logged in, run `railway login`
  (opens a browser; on a headless machine use `railway login --browserless`
  and have the user complete the pairing code). This step needs the user —
  tell them what's happening and wait.

## 3. Create the project and deploy

From the repo root:

1. `railway init` — creates a new Railway project; suggest the name
   `labyrinthium` when it prompts.
2. `railway up --detach` — uploads the repo and starts the Docker build.
3. Poll the build: `railway logs --build` until it finishes. The build
   compiles the pnpm workspace including the better-sqlite3 native module;
   first build takes a few minutes. If it fails, read the log tail and fix
   before retrying.
4. Then check runtime logs: `railway logs` — you want to see the Fastify
   startup line and no crash loop. The healthcheck is `GET /health`.

## 4. Expose it

- `railway domain` — generates the public `*.up.railway.app` domain.
- Verify: `curl -s https://<domain>/health` must return `{"ok":true}`, and
  `curl -s https://<domain>/ | head -c 100` must return the app's HTML.

## 5. Optional but recommended: persistent replay storage

Live games run in memory; finished games are archived to SQLite at
`/data/labyrinthium.sqlite` (already set via env in the Dockerfile). To keep
that archive across deploys, attach a volume:

- `railway volume add --mount-path /data`
- Redeploy if prompted, then re-verify `/health`.

Skip this if the user doesn't care about replay history — everything else
works without it.

## 6. Hand off

Report to the user:
- the public URL (that link IS the game — share it, create a room, play),
- whether the volume was attached,
- a reminder that in-memory rooms are lost on redeploy/restart (finished
  games persist if the volume exists),
- how to redeploy after future pushes: `railway up --detach`, or suggest
  connecting the GitHub repo in the Railway dashboard (Settings → Source)
  for automatic deploys on push.

## Troubleshooting

- **Build OOM or timeout**: retry `railway up`; if it persists, ask the user
  to raise the builder resources in the Railway dashboard.
- **Healthcheck failing**: `railway logs` — the server must bind `0.0.0.0`
  and Railway's `PORT` (it does by default; do not override `PORT` or `HOST`
  in service variables).
- **WebSocket errors in the browser**: make sure the user opens the
  generated `https://` domain (wss upgrades work out of the box); no extra
  config is needed.
- **`railway` commands complain about no linked project**: run
  `railway link` and pick the project/service created in step 3.

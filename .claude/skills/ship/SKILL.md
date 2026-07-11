---
name: ship
description: >
  Ship a change for Labyrinthium: verify build/typecheck/tests, commit with a
  conventional message, and push. Works in Claude Code web/mobile and desktop.
allowed-tools: Read Write Edit Bash Grep Glob
---

# Ship

Systematic pre-push workflow for Labyrinthium (pnpm + TypeScript monorepo):
verify the workspace is green, commit cleanly, and push so CI runs.

This is intentionally **not** a version/tag/release flow — Labyrinthium is a
private app deployed from a branch (Railway), not a published package. Use this
to get a change committed and pushed with confidence.

## When to Use

- After finishing a feature or fix, before pushing
- When you want the full "is it safe to push?" checklist run for you
- On mobile, when you want to commit + push without typing the commands

## Preconditions

Confirm you're in the repo and know the target branch:

```bash
git rev-parse --is-inside-work-tree
git branch --show-current
```

Never push straight to the deployment branch (`claude-master`) or `main`. Work
on a feature branch and open a PR unless the user explicitly says otherwise.

## Step 1 — Verify (all must pass)

Run the same checks CI runs (`.github/workflows/ci.yml`), from the repo root:

```bash
pnpm install --frozen-lockfile   # only if deps/lockfile changed
pnpm -r build
pnpm -r typecheck
pnpm -r test
```

If a change touches the web client behavior, also consider the e2e smoke:

```bash
pnpm --filter @labyrinthium/web test:e2e
```

If anything fails: **stop**, report the failure with the relevant output, and
fix it (or ask the user) before committing. Do not commit a red tree.

## Step 2 — Review what you're shipping

```bash
git status
git diff --stat
git diff            # or the staged diff if already added
```

Sanity checks:
- [ ] No secrets, tokens, or `.env` files staged
- [ ] No stray debug logging or commented-out blocks
- [ ] Only the intended files changed
- [ ] Generated/build output (`dist/`, `node_modules/`) not staged

## Step 3 — Commit (conventional commits)

Labyrinthium uses conventional-commit style. Pick the type from the change:

- `feat:` new gameplay/feature (server, web, shared engine, cli)
- `fix:` bug fix
- `refactor:` internal change, no behavior change
- `test:` tests only
- `chore:` tooling, deps, config
- `docs:` docs only

Scope by package when it helps: `feat(web):`, `fix(server):`, `fix(shared):`.

```bash
git add <intended files>
git commit -m "feat(web): add compare view to the wardrobe screen

- <what changed and why, in a sentence or two>
- <any follow-up or caveat>"
```

Keep the subject under ~72 chars, imperative mood.

## Step 4 — Push

Push the current feature branch and set upstream:

```bash
git push -u origin "$(git branch --show-current)"
```

If the push fails on a transient network error, retry with backoff (2s, 4s,
8s, 16s). Do not force-push a shared branch.

## Step 5 — CI + PR follow-up

After pushing, check that CI is green and (if wanted) open/point at a PR.

Use whichever GitHub interface is available:
- **Claude Code web/mobile**: the GitHub tools (`mcp__github__*`) — e.g. list
  the PR's checks / actions runs for this branch and report status.
- **Desktop CLI**: `gh run list --branch <branch> --limit 1`, `gh run watch`.

Report the outcome plainly: branch pushed, CI status, and the PR link if one
exists. If CI fails, surface the failing job's log and diagnose before
declaring done.

## Notes

- CI (`.github/workflows/ci.yml`) runs on every PR: install → build →
  typecheck → test. Ship mirrors it so failures surface locally first.
- There is no lint step in this repo; don't invent one.
- Deployment is handled separately (Railway, see
  `.claude/commands/deploy-railway.md`) — shipping ≠ deploying.

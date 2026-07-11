---
name: repo-recap
description: >
  Generate a shareable recap of the repo state (open PRs, open issues, recent
  activity) as clean Markdown. Great for catching up from your phone.
allowed-tools: Bash Read Grep
---

# Repo Recap

Produce a structured, shareable snapshot of Labyrinthium: open PRs, open issues,
recent merges, and a short executive summary. Output is Markdown with clickable
GitHub links — designed to be read on mobile and pasted into chat.

## When to Use

- "Catch me up on the repo" — a quick status check from the phone
- Before a work session, to see what's open and what needs attention
- To share a status snapshot with someone else

## GitHub access

Use whichever interface is available in the session:

- **Claude Code web/mobile** (this is the mobile-app path): use the GitHub
  tools (`mcp__github__*`) — `list_pull_requests`, `list_issues`,
  `list_commits`, `list_releases`, etc. against `p4vz/labyrinthium`.
- **Desktop CLI**: the `gh` CLI works too (`gh pr list --json ...`).

Do **not** hardcode assumptions — derive the repo as `p4vz/labyrinthium` (the
`origin` remote) and fetch live data.

## Steps

### 1. Gather data

- Open PRs (number, title, author, created/updated, additions/deletions,
  changed files, draft, mergeable, review decision, CI status)
- Open issues (number, title, author, created/updated, labels, assignees)
- Recently merged PRs (last ~10, for activity)
- Recent tags/releases if any (Labyrinthium may have none — that's fine)

### 2. Analyze

**PR size labels** (for quick visual triage):

| Label | Additions |
| ----- | --------- |
| XS | < 50 |
| S | 50–200 |
| M | 200–500 |
| L | 500–1000 |
| XL | > 1000 |

Format: `+{additions}/-{deletions}, {files} files ({label})`.

- **Overlaps**: two PRs that modify >50% of the same files → cross-reference
  them.
- **Clusters**: an author with 3+ open PRs → note a suggested review order
  (smallest first).
- **Stale**: no activity in >14 days → flag.
- **Ready vs blocked**: ready = ≤1000 additions, ≤10 files, not conflicting, CI
  not failing. Blocked = anything larger, conflicting, or CI-red.
- **Issue ↔ PR links**: scan PR bodies for `fixes #N` / `closes #N` /
  `resolves #N` and cross-reference.

### 3. Output (Markdown)

```markdown
# Labyrinthium — Recap {date}

## Open PRs ({count})

| PR | Author | Title | Size | CI | Reviews | Status |
| -- | ------ | ----- | ---- | -- | ------- | ------ |

## Open Issues ({count})

| # | Author | Title | Labels | Age | Action |
| - | ------ | ----- | ------ | --- | ------ |

## Recent Activity

- Merged: [#N](link) title — @author
- ...

## Summary

- **Open**: {N} PRs, {M} issues
- **Quick wins**: {XS/S PRs ready to merge, or issues to close/label}
- **Risks**: {oversized PRs, CI failures, merge conflicts, overlaps}
- **Stale**: {PRs/issues with no activity >14d}
- **Active contributors**: {who has the most open work}
```

All PR/issue numbers must be clickable:
`[#123](https://github.com/p4vz/labyrinthium/pull/123)` for PRs,
`.../issues/123` for issues.

### 4. Empty-data handling

- 0 open PRs → "No open PRs."
- 0 open issues → "No open issues."
- 0 recent merges → "No recent merged PRs."

## Notes

- Keep tables compact — truncate long titles to ~60 chars.
- The GitHub `author` field is often an object `{login: "..."}` — use the login.
- Just render the Markdown; on mobile the user can copy it directly (no
  clipboard command needed).

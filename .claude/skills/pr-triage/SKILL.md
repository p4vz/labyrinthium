---
name: pr-triage
description: >
  Triage open PRs for Labyrinthium: audit them into a ranked action table,
  optionally deep-review selected ones, and post review comments (with your
  explicit approval). Args: "all", specific PR numbers (e.g. "42 57"), or none
  for audit-only.
allowed-tools: Bash Read Grep Glob
effort: medium
tags: [triage, pr, github, review, code-review]
---

# PR Triage

Three phases: **audit** (always) → **deep review** (opt-in) → **comment**
(only with explicit approval).

| Skill | Use it for |
|-------|-----------|
| `/pr-triage` | Sort, review, and comment on PRs |
| `/repo-recap` | A general shareable status snapshot |

Triggers: run manually (`/pr-triage`, `/pr-triage all`, `/pr-triage 42 57`), or
proactively when there are several unreviewed open PRs.

## GitHub access

Use whichever interface the session has:
- **Claude Code web/mobile**: the GitHub tools (`mcp__github__*`) against
  `p4vz/labyrinthium` — `list_pull_requests`, `pull_request_read` (diff/files/
  reviews), `get_check_run`/`actions_list` for CI, `add_issue_comment` /
  `pull_request_review_write` to comment.
- **Desktop CLI**: `gh` works too.

Derive the repo from `origin` (`p4vz/labyrinthium`); never hardcode elsewhere.

## Phase 1 — Audit (always)

Gather open PRs with metadata: number, title, author, created/updated,
additions/deletions, changed files, draft, mergeable, review decision, CI
status, and body (for issue cross-refs). For each candidate, also pull its
changed-file list (needed for overlap detection) and existing reviews.

**Size labels:**

| Label | Additions |
|-------|-----------|
| XS | < 50 |
| S | 50–200 |
| M | 200–500 |
| L | 500–1000 |
| XL | > 1000 |

Format: `+{additions}/-{deletions}, {files} files ({label})`.

**Detections:**
- **Overlaps**: >50% shared files between two PRs → cross-reference both.
- **Clusters**: an author with 3+ open PRs → suggest review order (smallest
  first).
- **Stale**: no activity >14 days.
- **CI**: clean / unstable / failing (treat unknown as `?`).
- **Reviews**: approved / changes requested / none.
- **PR ↔ issue**: scan the body for `fixes #N` / `closes #N` / `resolves #N`.

**Categorize:**
- _Ready_: ≤1000 additions AND ≤10 files AND not conflicting AND CI not failing.
- _Blocked_: >1000 additions OR >10 files OR conflicting OR CI failing OR
  overlapping another open PR.

**Output — triage table:**

```
## Open PRs ({count})

### Ready for review
| PR | Author | Title | Size | CI | Reviews | Action |
| -- | ------ | ----- | ---- | -- | ------- | ------ |

### Blocked / needs attention
| PR | Author | Title | Size | Problem | Recommended action |
| -- | ------ | ----- | ---- | ------- | ------------------ |

### Summary
- Quick wins: {XS/S PRs ready to merge}
- Risks: {overlaps, XL PRs, CI failures}
- Clusters: {authors with 3+ PRs}
- Stale: {PRs with no activity >14d}
```

If 0 open PRs → "No open PRs." and stop. Just render the table (no clipboard).

## Phase 2 — Deep review (opt-in)

Selection:
- Arg `all` → all non-draft PRs.
- Arg numbers (`42 57`) → only those (drafts allowed if named explicitly).
- No arg → ask the user which to deep-review (all / blocked only / ready only /
  skip). If "skip", end after the audit.

For each selected PR, review its diff carefully. On mobile do the review inline;
on desktop you may fan out `code-reviewer` subagents in parallel. Focus on
Labyrinthium's realities:
- **Determinism** in `@labyrinthium/shared` (engine, generator, bot brain must
  stay pure and reproducible — same seed → same result).
- **Protocol schemas** (zod) kept in sync across server/web/cli.
- No secrets; no accidental `dist/`/`node_modules/` commits.
- Tests updated for behavior changes; `pnpm -r typecheck` clean.

Return a structured review per PR:

```
### Critical 🔴
### Important 🟡
### Suggestions 🟢
### What's good ✅
```

Quote `file:line`, explain why, suggest the fix.

## Phase 3 — Comment (approval required)

Draft comments in **English**, professional and constructive, always including
at least one positive point. **Show every draft in the chat first**, then get
explicit approval for which to post (all / specific PRs / none). Only after
approval, post via the available GitHub tool. Confirm each: "Comment posted on
PR #{num}." If "none": "No comments posted."

Never post without explicit in-chat approval.

## Edge cases

| Situation | Behavior |
|-----------|----------|
| 0 open PRs | "No open PRs." + stop |
| Draft PR | Show in table; skip review unless named explicitly |
| CI unknown | Show `?` |
| Empty diff | Skip that PR, notify the user |
| Very large PR (>5000 additions) | Warn: partial review, diff truncated |
| `mergeable` = UNKNOWN | Treat as `?` |

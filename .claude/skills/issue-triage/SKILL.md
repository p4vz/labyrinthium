---
name: issue-triage
description: >
  Triage open issues for Labyrinthium: audit and categorize, detect duplicates,
  cross-reference PRs, assess risk, then optionally comment/label/close (with
  your explicit approval). Args: "all", issue numbers (e.g. "42 57"), or none
  for audit-only.
allowed-tools: Bash Read Grep
effort: medium
tags: [triage, issues, github, categorize, duplicates, risk]
---

# Issue Triage

Three phases: **audit** (always) → **deep analysis** (opt-in) → **actions**
(only with explicit approval).

| Skill | Use it for |
|-------|-----------|
| `/issue-triage` | Sort, analyze, and act on issues |
| `/repo-recap` | A general shareable status snapshot |

Triggers: run manually (`/issue-triage`, `/issue-triage all`,
`/issue-triage 42 57`), or proactively when many issues are untriaged.

## GitHub access

Use whichever interface the session has:
- **Claude Code web/mobile**: the GitHub tools (`mcp__github__*`) against
  `p4vz/labyrinthium` — `list_issues`, `issue_read`, `list_pull_requests`,
  `add_issue_comment`, `issue_write` (label/close).
- **Desktop CLI**: `gh` works too.

Derive the repo from `origin` (`p4vz/labyrinthium`).

## Phase 1 — Audit (always)

Gather open issues (number, title, author, created/updated, labels, assignees,
body, comment count), open PRs (for cross-refs), and recently closed issues (for
duplicate detection).

Analyze across these dimensions:

**1. Category** (existing labels win over inference):
- **Bug**: crash, error, fail, broken, regression, wrong, unexpected
- **Feature**: add, implement, support, new, `feat:`
- **Enhancement**: improve, optimize, better, refactor
- **Question/Docs**: how, why, help, unclear, docs
- **Duplicate candidate**: see dimension 3

**2. PR cross-ref**: scan open PR bodies for `fixes #N` / `closes #N` /
`resolves #N`; build an `issue → [PRs]` map. Issue linked to a merged PR →
recommend closing.

**3. Duplicate detection**: normalize titles (lowercase, strip `bug:`/`feat:`/
`[bug]` prefixes); Jaccard similarity on title words > 60% → duplicate
candidate (exclude stop words: a, the, is, in, of, for, to, with, on, at, by).
Reinforce with body keyword overlap > 50%. Compare against recently closed
issues too. Confirm/dismiss in Phase 2 — never act on suspicion alone.

**4. Risk**:
- **Red**: security, vulnerability, injection, auth bypass, exploit, credentials,
  leak, RCE, XSS
- **Yellow**: breaking change, migration, deprecation, incompatible
- **Green**: everything else

**5. Staleness**: >30d no activity → Stale; >90d → Very Stale.

**6. Recommended action**: Accept & Prioritize · Label needed · Comment needed
(missing info) · Linked to PR · Duplicate candidate (#N) · Close candidate
(stale/out-of-scope — never for a maintainer's own issue) · PR merged → close.

**Output — tables:**

```
## Open Issues ({count})

### Critical (red risk)
| # | Title | Author | Age | Labels | Action |

### Linked to a PR
| # | Title | Author | PR(s) | PR status | Action |

### Active
| # | Title | Author | Category | Age | Labels | Action |

### Duplicate candidates
| # | Title | Duplicate of | Similarity | Action |

### Stale
| # | Title | Author | Last activity | Action |

### Summary
- Total: {N} open
- Critical: {N} | Linked to PR: {N} | Duplicate candidates: {N}
- Stale (>30d): {N} | Very Stale (>90d): {N} | Unlabeled: {N}
- Quick wins: {issues to close or label fast}
```

If 0 open issues → "No open issues." and stop. `Age` = days since creation
(`{N}d`, bold if >30). Just render the tables (no clipboard).

## Phase 2 — Deep analysis (opt-in)

Selection: arg `all` → all; numbers → those; no arg → ask (all / critical only /
duplicate candidates / stale only / skip). If "skip", end after the audit.

For each selected issue, analyze (inline on mobile; parallel subagents on
desktop if helpful) and return:

```
### Scope Assessment      — what is it actually asking for? clearly defined?
### Missing Information    — repro steps, version, environment?
### Risk & Impact          — security? breaking? who's affected?
### Effort                 — XS (<1h) / S (1-4h) / M (1-2d) / L (3-5d) / XL (>1w)
### Priority               — P0 / P1 / P2 / P3
### Recommended Action     — Accept & Prioritize / Request More Info /
                             Mark Duplicate (#N) / Close (Stale) /
                             Close (Out of Scope) / Link to Existing PR
### Draft Comment          — English, specific, constructive
```

If an issue has >50 comments, summarize the last 5 only.

## Phase 3 — Actions (approval required)

Possible actions: comment, add label (skip if already present), close (reason
"not planned"). Draft comments in **English**, professional and constructive.
Never propose closing a maintainer's own issue automatically.

**Show every draft in the chat first** (proposed actions + comment text), then
get explicit approval for which to execute (all / specific issues / none). Only
after approval, execute in order: comment → label → close, via the available
GitHub tool. Confirm each: "Commented on issue #{num}." If "none": "No actions
taken."

Never comment, label, or close without explicit in-chat approval.

## Edge cases

| Situation | Behavior |
|-----------|----------|
| 0 open issues | "No open issues." + stop |
| No body | Categorize by title, recommend "Comment needed" |
| >50 comments | Summarize last 5 only |
| Label already present | Don't re-label; note it |
| Maintainer's own issue | Never auto "close candidate" |
| Very Stale (>90d) | Propose a kind closing message |
| Duplicate confirmed in Phase 2 | Comment + close in favor of the original |

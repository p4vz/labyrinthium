# Claude skills

Project skills for Labyrinthium. Any folder here with a `SKILL.md` is
auto-discovered by Claude Code — in the **web/mobile app** and the desktop CLI
alike — because these live in the repo and are cloned into every session.
Invoke one by typing `/<skill-name>` (e.g. `/repo-recap`) or just describe the
task and Claude will pick the matching skill.

## Available skills

| Skill | What it does |
|-------|--------------|
| `/ship` | Verify build/typecheck/tests, commit (conventional), and push. |
| `/repo-recap` | Shareable Markdown snapshot of open PRs, issues, and activity — good for catching up from your phone. |
| `/pr-triage` | Audit open PRs into a ranked action table; optionally deep-review and comment (with your approval). |
| `/issue-triage` | Audit/categorize open issues, detect duplicates, cross-ref PRs; optionally comment/label/close (with your approval). |

## Using them on the mobile app

These skills are GitHub-tool-agnostic: in Claude Code web/mobile they use the
built-in GitHub tools; on the desktop CLI they can use `gh`. Anything that
posts, labels, or closes on GitHub asks for your explicit approval in the chat
first.

## Attribution

`ship`, `repo-recap`, `pr-triage`, and `issue-triage` are adapted from the
[rtk-ai/rtk](https://github.com/rtk-ai/rtk) project (Apache-2.0), rewritten for
Labyrinthium's pnpm/TypeScript stack, translated to English, and made to work
in the Claude Code web/mobile environment.

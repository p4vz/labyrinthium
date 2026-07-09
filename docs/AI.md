# The Bayesian bots (`hard` and `expert`)

The `hard` and `expert` difficulties are driven by `BayesianBrain`
(`packages/shared/src/ai/`), a pure, deterministic, event-driven mind that
plays the way a strong human plays the pencil-and-paper game. It consumes
ONLY the events a human player receives — no peeking at the map — and its
turns follow the loop **probe → update hypotheses → test/exploit**.

(`easy` and `medium` keep their original heuristic implementations in
`packages/server/src/bots/bot.ts`; `BotController` is now just the transport
shell for all four tiers.)

## World model (`beliefs.ts`)

`WorldBelief` is the bot's main map sheet, in absolute coordinates:

- **Edges** are exact where observed (`open` / `blocked` / `grate` /
  `reinforced` / `exit`; bumps cannot tell a plain wall from a reinforced
  one — only a wasted grenade refines that), and priors elsewhere: the
  interior wall density is learned empirically as play progresses
  (Beta-smoothed around the generator's typical braid), and border edges are
  wall-or-exit a priori.
- **Cells** carry tri-state feature knowledge (stairs directions, teleport
  pad + rune label, trapdoor, river + flow). Negative knowledge is first
  class: settling on a cell *without* being teleported proves there is no
  pad — with one deliberate exception, a teleport *landing* never re-fires,
  so arrival cells keep those fields unknown.
- Resolved shortcuts are remembered: pad destinations, trapdoor drops and
  stairway pairs become known relocations (`padDest`/`stairsDest`) and later
  serve as fast travel.

## Localization (`frames.ts`)

Every disorientation (teleport, trapdoor, stairs) opens a `FrameBelief` —
the machine equivalent of a human's auxiliary map sheet. Observations are
recorded relative to the landing cell, and the frame maintains a posterior
over every possible absolute placement of that origin:

- Hypothesis space: all `(level, x, y)` anchors (≤ 15×15×levels — exact
  enumeration, fully re-scored on demand). Directions are absolute, so
  there is no rotation ambiguity.
- Constraints by frame kind: a trapdoor lands exactly one level down;
  stairs land on the known level (on a cell that must carry the mirrored
  stairs); a teleport can land anywhere — but a previously-seen rune label
  seeds its twin pad heavily, and labels are unique per teleport set, so
  riding the same rune twice while lost provably returns you to ground
  you've already charted.
- Observations are truthful, so contradictions are hard vetoes; unknown
  territory scores against the learned priors. Re-entering the same
  disorientation source **resumes** the old sheet — its charted region,
  visit counts and rejected anchors still apply.

**Merging.** A sheet folds into the main map when exactly one placement
survives (proof), or — for the sheet the bot is standing on — when the
posterior is lopsided (p ≥ 0.98) or the sheet has resisted collapse for a
long time (act on the best guess, like a human would). Non-proof merges are
**guarded**: every world write is journaled, observations that are
impossible under the merged map count as *surprises* (walls only change via
explosions, and explosions are always heard — so in a quiet spell a single
contradiction is proof of misplacement), and a rejected merge is rolled back
wholesale, the anchor banned, and the sheet resumed with everything since
folded in. Perceptual aliasing — two regions that look identical — is thus
survivable: commit, test, revise. Refused actions feed the same machinery
(climbing stairs that turn out not to exist is a contradiction too).

## Planning (`brain.ts`)

- **Probing.** While disoriented, free bumps are spent on the direction with
  the highest expected information gain (exact posterior-entropy reduction
  over the anchor set), discounted by the chance the edge is open — an open
  probe relocates you and ends the turn. When everything nearby is charted,
  the bot walks the sheet's corridors to its nearest uncharted edge, and if
  the only way out of a pocket is vertical or magical, it deliberately takes
  the stairs or pad. On the main map, unprobed stretches of the ground-level
  border are always worth a bump — an exit gate may hide there.
- **Movement.** Dijkstra over believed traversability: unknown edges are
  taxed by the wall prior (walking one doubles as a hypothesis test — a bump
  is free and re-plans within the same turn), known rivers carry you to the
  end of their charted stretch, resolved pads are portals, unresolved pads
  and own mines are hazards, recent monster spots are taxed. Exploration
  chases the best information-per-step frontier (biased away from the
  entrance, where the treasure never spawns) and commits to one goal at a
  time — with a no-progress abandon rule for targets the river model lies
  about. With the loot in hand it runs for the nearest known exit, or the
  stairs toward level 0.
- **Weapons.** A grenade is spent when opening one wall provably shortens
  the treasure run, or when a sealed region is the only thing left to test.
  When a guardian keeps intercepting in lockstep, the bot waits a random
  beat (breaking patrol synchronization) or puts a bullet down the corridor
  it is about to walk — bullets kill monsters silently.

## Opponent inference (`opponents.ts`, expert only)

Under the classic open-information table rules every player's observations
are spoken aloud. The expert keeps a per-opponent grid posterior fed by that
table-talk: successful moves shift mass through edges the expert believes
open, bumps reweight by wall beliefs, stairs and trapdoors move mass across
levels, teleports diffuse it, and a small per-turn leak absorbs everything
unobservable. Pickup announcements identify the treasure carrier. The expert
shoots when the carrier's posterior mass down a charted corridor is high,
mines its own trail when a pursuer is close, and shoots defensively while
carrying. With open information disabled the tracker starves gracefully and
the expert plays like a (still formidable) hard bot.

## Guarantees and limits

The suites in `packages/shared/test/ai-*.test.ts` assert, on real generated
labyrinths driven through the real engine:

- the brain only produces legal actions (a refused stairs-climb under a
  speculative placement is the one sanctioned exception — the refusal is
  the experiment);
- **whenever the bot is confident about its absolute position, it is
  correct** — on every single turn of every tested game;
- decisions are deterministic given the injected RNG (perfect replays).

Strength is asserted statistically: the solo hard bot currently finishes
~90% of classic, ~80% of advanced and ~70% of full `medium` maps within
1500 turns (the sweep test enforces a floor). The stragglers are genuine
map pathologies — usually a river-moated region after the grenades are
gone — that stall human players too; in multiplayer, someone else simply
wins first.

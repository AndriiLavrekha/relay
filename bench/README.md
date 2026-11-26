# bench: measure what RTK, Caveman and Ponytail really save

A paired A/B harness. It runs the same task headlessly (`claude -p`) under different tooling "arms", then reports tokens, cost, turns, time, diff size and whether hidden acceptance tests pass. Nothing here ships in the npm package.

## Run it

```bash
node bench/run.mjs selftest                      # no tokens: proves each scenario fails before and passes with a reference solution
node bench/run.mjs run --scenarios _calibrate,small-duration --arms baseline,rtk,caveman,ponytail,all --reps 1 --batch pilot --dry   # prints run count + cost ceiling
node bench/run.mjs run --scenarios _calibrate,small-duration,big-reply-unescape,big-fingerprint-tsconfig --reps 5 --batch main
node bench/report.mjs --batch main               # writes bench/results/main/report.md
```

Re-running with the same `--batch` skips runs that already finished (resume). Observed cost on a reference host at list price: about $0.10 (small), $0.25 and $0.35 (big) per baseline run, so `--reps 5` over everything is roughly $15–25 and ~90 minutes.

## Scenarios

| id | project | task | hidden check |
|---|---|---|---|
| `small-duration` | 3-file synthetic | implement a stub (`parseDuration`) from a written spec | `test/duration.hidden.test.mjs` |
| `big-reply-unescape` | this repo at `cb36fe9~1` (~30 modules, 168 tests) | real bug fix from history | `test/round-trip.test.mjs` from `cb36fe9` |
| `big-fingerprint-tsconfig` | this repo at `1121c59~1` | real two-part feature from history | `test/context.test.mjs`, `test/host-boundaries.test.mjs` from `1121c59` |
| `_calibrate` | empty | "Reply OK": measures each arm's fixed token overhead | none |

Workdirs come from `git archive` into an empty directory with a fresh `git init`, so the answer commit is not reachable from the agent. Hidden tests are written in only after the agent finishes. A run passes only if the hidden tests **and** the full `npm test` pass. Add a scenario by dropping a folder with a `scenario.json` into `scenarios/`, then run `selftest`.

## Arms (`arms.json`)

Every arm starts from `--setting-sources project` (no user hooks, plugins or env) plus the pinned model and effort, then re-enables a slice of `~/.claude/settings.json`: `rtk` (the `rtk hook` hook), `caveman` (its hooks plus the proxy `ANTHROPIC_BASE_URL`), `ponytail` (the plugin), `all`.

## What makes the numbers trustworthy

- Model and effort are pinned for every arm; a run that used another model is excluded.
- The child process env is scrubbed of this shell's `ANTHROPIC_*`/session variables, so baseline never goes through the Caveman proxy.
- Arms are interleaved (rep is the outer loop, arm order rotates), so no arm always runs first with a cold or warm prompt cache.
- An arm must prove it fired (its injected context shows in the hook events) or the run is excluded and listed. RTK is checked softly: the report shows `PreToolUse:Bash` hook hits beside Bash vs PowerShell call counts.
- Runs with permission denials, agent errors or missing results are excluded and listed, never silently counted as failures. A run that hits `--budget` counts as a fail.
- Primary token metric is total input (fresh + cache write + cache read); cost is shown too but depends on cache warmth.
- Raw stream logs and diffs are kept in `results/<batch>/logs` and `/diffs`.

## Caveats

- Global `~/.claude/CLAUDE.md` and user rules still load in every arm, including baseline. For a pristine baseline, point `CLAUDE_CONFIG_DIR` at a directory logged in separately and install the plugins there. The harness never copies credentials.
- The Caveman proxy must be running for the `caveman` arm.
- `claude -p` is not identical to an interactive session; long sessions with compaction are not covered.
- With fewer than ~5 reps, differences under roughly 20–30% are noise. Use the cost ranges in the report.

## Measuring Relay (ChatGPT delegation)

The same three scenarios are exported as real Task Capsules, you run them in ChatGPT by hand, and the replies go through the real `import` and `integrate` path before being graded with the same hidden tests as the Claude arms.

```bash
node bench/chatgpt.mjs prepare --reps 3     # writes bench/results/chatgpt/<scenario>__rN/ and START-HERE.md
# per folder: new ChatGPT chat, upload task.md, paste kickoff.md, save the reply as reply.md (or result.zip)
node bench/chatgpt.mjs grade bench/results/chatgpt/small-duration__r1 --reply <reply.md|result.zip> --label gpt-thinking
node bench/chatgpt.mjs regrade --batch main     # token-free: re-grade the Claude patches with the same metrics
node bench/chatgpt.mjs compare --batch main     # writes bench/results/main/compare.md
```

`prepare` checks the repo out at the baseline commit, exports through `relay export` (so the capsule, privacy scan and kickoff prompt are exactly what a user would upload), and keeps each task's repo so `import` can verify the baseline. `grade` imports with validation policy `skip` (the bench runs its own tests), integrates into a branch, and grades a clean clone of it. A reply that cannot be imported is recorded as a failure with `import ok` = no, which is itself a result (protocol adherence). The pipeline was verified by round-tripping the reference solution of each scenario through export, reply, import, integrate and hidden tests (`node bench/chatgpt.mjs fake-reply <dir>` regenerates such a reply; never grade it under a real label).

Metrics, identical for ChatGPT replies and Claude patches:

| metric | meaning |
|---|---|
| correctness | hidden tests and the full `npm test` both pass (after the host-owned `npm run bundle:plugins` step) |
| accuracy | share of the hidden tests that pass (finer than pass/fail) |
| scope precision | share of changed files inside the delegated editable scope (generated `plugins/` ignored). Claude arms were not told the scope, so for them this is blast radius, not obedience |
| diff vs reference | production-code (non-test) lines changed relative to the real commit |
| import ok | the reply followed the framing and passed the bridge's integrity checks |

Cost comparison: Claude arms report real tokens and list-price cost. ChatGPT is on your subscription, so the table shows capsule size in and reply size out (bytes/4, an estimate). The bridge's `export`/`import` are deterministic CLI calls with no LLM tokens; if you drive them through the plugin skills, add that session's Claude usage (session JSONL under `~/.claude/projects`) and your copy-paste minutes. Capsule overhead is large for small tasks (about 22 KB for the small scenario), which is the honest cost of delegating one.

## Measured results (Sonnet 5.5, high effort, list prices)

Raw numbers: `results/main/report.md` (arms), `results/main/compare.md` (Claude vs ChatGPT quality), `results/relay2/relay-report.md` (delegation cost). Medians; 5 runs per Claude arm, 3 delegations per scenario.

### Arms (RTK, Caveman, Ponytail), cost per task vs baseline

| arm | small | big / small task | big / medium task | Σ median cost |
|---|---|---|---|---|
| ponytail | -1% | -23% | -12% | **-14%** |
| rtk | +13% | +19% | -2% | +8% |
| caveman | +33% | +13% | +15% | +17% |
| all three | +6% | +10% | +29% | +18% |

All 75 Claude runs passed the hidden tests and the full suite, so these arms differ in cost and diff size, not in correctness on these tasks. Differences under about 20% are noise at n=5.

### Delegating to ChatGPT (Relay)

Claude's own work in a delegation is the export session plus the import/integrate session. ChatGPT's work is on the subscription and costs no Claude tokens.

| task | Claude does it | Claude orchestrates | saving | ChatGPT result |
|---|---|---|---|---|
| small (3 files) | $0.09 | $0.25 | **-172%** | 3/3 correct |
| big repo, small bug fix | $0.21 | $0.35 | **-64%** | 3/3 correct |
| big repo, medium feature | $0.27 | $0.36 | **-35%** | 1/3 correct |

Orchestration is a roughly fixed cost of $0.25-0.36 per task here, so delegation only pays off once the Claude work it replaces costs more than that. Break-even is about $0.35 of Claude work. These tasks were deliberately short; none reached it.

**Theoretical saving as the replaced work gets bigger** (extrapolation, not measured; assumes orchestration stays near the measured $0.36, and it may grow with repo size):

| Claude work replaced | saving if ChatGPT succeeds | saving with the measured 22% failure rate (a failure is redone by Claude at full price) |
|---|---|---|
| $0.50 | 28% | 6% |
| $1 | 64% | 42% |
| $2 | 82% | 60% |
| $5 | 93% | 71% |

Use delegation for medium and large, well-specified tasks with a test that can check the result. Do not use it for small tasks: the capsule and the two orchestration sessions cost more than the task.

### What to know before quoting these numbers

- ChatGPT passed 7 of 9 replies. Both failures missed the same stated edge case (an `extends` path without `.json`). Claude's import review did not catch either one, because staged validation passed (2 of 2 integrated unflagged). Put every edge case in the acceptance criteria and keep an independent acceptance test.
- Two policies were fixed in the prompts and apply to every number above: the export session confirms the exporter's low-confidence privacy warnings (the repo is public source), and the import session runs the host-owned `npm run bundle:plugins` step and integrates when staged validation passes, even if the worker lists known limitations. The first attempt without them stopped at the privacy gate on every big export and refused most imports.
- Historical note: the benchmarked runs used the pre-rename `0.3.3` plugin (`task-bridge`), not the current working tree.
- Small samples: 3 delegations per scenario, one Claude model, one ChatGPT mode (not recorded). Prices are API list prices. On a Claude subscription the saving is usage-limit headroom, not dollars.
- Not measured: long interactive sessions with compaction, where the replaced Claude work is larger and the saving should be bigger.

Run it: `node bench/relay.mjs run --scenarios <ids> --reps 3 --batch relay2 [--stages export,import]`, then `node bench/relay.mjs report --batch relay2` (needs the `chatgpt/` replies from `chatgpt.mjs grade`).

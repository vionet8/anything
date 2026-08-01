---
name: web-game-harness
description: Scaffold and verify small 2D browser games or interactive canvas prototypes (Phaser 3 game + Node static server + Playwright headless browser tests) with a real automated test harness — no human needs to open a browser or a device to confirm the game logic actually works. Use this whenever the user wants to prototype a game mechanic (physics arcs, tap-to-charge power, collision/scoring, click-or-tap targets, wave-based enemies, etc.), especially in a headless/remote/cloud coding session with no GUI and no native game engine editor available (Unity, Godot, and Unreal all need an Editor this kind of session doesn't have). Also use it whenever the user wants automated quality verification of gameplay code instead of manual playtesting, or says things like "test this without me having to open it", "verify the physics/scoring actually works", "build this so it's already checked before I try it", or asks to turn a game idea into a working prototype in an environment that can't run a native game engine.
---

# Web Game Harness

## Why this exists

A game engine editor (Unity, Godot, Unreal) needs a GUI, and most remote/cloud coding
sessions don't have one. That leaves two bad options: hand the user untested code and
hope it works, or refuse to build anything playable. There's a better path — build the
game as a browser canvas app (Phaser 3) and drive it with a headless browser
(Playwright), which many of these environments already have pre-installed. That turns
"please go test this for me" into "here's the code, and here's the passing test run
that proves the physics, scoring, and input handling actually behave as intended."

This only works if the game code is *structured* for headless testing from the start —
bolting tests on after the fact rarely works cleanly for interactive/physics-driven
code. Follow the pattern below rather than improvising your own.

## Workflow

### 1. Scaffold the project

Copy the templates in `assets/templates/` into the target project directory and adapt
them to the actual game concept:

- `package.json` — `phaser` as a dependency, `@playwright/test` as a devDependency
- `server.js` — a plain Node `http` static file server (no Express needed for a prototype)
- `index.html` — loads `node_modules/phaser/dist/phaser.min.js` via a plain `<script>`
  tag (skip bundlers entirely for a prototype; it adds build-step failure modes for no
  benefit at this scale) plus a small DOM overlay for score/status text
- `playwright.config.js` — see step 2 before finalizing this one
- `src/main.js.example` and `tests/game.spec.js.example` — a complete, working
  reference implementation (a physics-based aim-and-launch game) demonstrating every
  pattern described below. Don't copy it verbatim for unrelated mechanics, but reuse its
  structure: the Matter.js setup, the collision-pair handling, the `window.__game` test
  hook, and the Promise-based async action pattern all generalize well beyond this one
  example.

Run `npm install` and confirm `phaser`, `playwright`, and `@playwright/test` actually
landed in `node_modules` before moving on.

### 2. Point Playwright at the pre-installed browser

Many of these sandboxed environments pre-install a specific Chromium build (to avoid a
multi-hundred-MB download per session) at a fixed Playwright browser revision, with
`PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` set so `npm install` won't try to fetch a matching
one. If the `@playwright/test` version that just got installed expects a *different*
revision, `npx playwright test` fails with something like:

```
Error: browserType.launch: Executable doesn't exist at /opt/pw-browsers/chromium_headless_shell-XXXX/...
```

Don't waste a debugging cycle rediscovering this. Before running any tests, run:

```bash
bash <skill-dir>/scripts/find_chromium.sh
```

- If it prints a path, put that exact path in `playwright.config.js` under
  `use.launchOptions.executablePath`, as a plain string literal (see the template — it's
  already wired up, just confirm the path matches). This uses the pre-installed full
  Chromium build directly instead of Playwright's own resolution logic, which sidesteps
  the version-mismatch entirely.
- If it prints nothing / errors, there's probably no pre-installed browser in this
  environment and the gotcha doesn't apply — run `npx playwright install chromium`
  normally instead.

### 3. Design the game for headless testing

The single most important decision is exposing a small, deliberate test surface on
`window`, e.g. `window.__game = { ready, getState(), fireActionForTest(params) }`. Read
`references/testability-pattern.md` before writing game code — it explains why gameplay
actions that resolve asynchronously (a thrown projectile that eventually lands, an enemy
that eventually dies) should return a Promise the test can `await`, instead of the test
polling `getState()` in a loop, and why you need *both* one realistic
`page.mouse.down()/up()`-driven test and several parameter-driven deterministic tests
rather than only one style.

### 4. Run the tests and treat every failure as a real bug

Run `npx playwright test`. A red test at this stage is not noise to silence — in
practice this harness catches genuine logic bugs that reading the code or a successful
`npm install`/lint pass would not: collision-handling code that only checks one side of
a symmetric pair (so the pending event silently never resolves under specific orderings),
or gameplay constants that were never actually reaching their target and were just
untested guesses. Read `references/common-bugs.md` for both of these as fully worked
examples — including what a wrong-looking-fine collision handler looks like and how to
fix it — before assuming a hang or an unexpected score is a test problem rather than a
game-logic problem.

For constants that need empirical tuning (launch power, projectile speed, spawn timing,
anything where "does it actually reach X" isn't obvious from the formula), don't guess
and check by eye — write a disposable sweep script modeled on
`assets/templates/debug-tune.js.example`: it reloads a fresh page per trial, drives the
game via the same `window.__game` hook at a range of parameter values, and logs the
outcome for each. Once you've found good constants, hardcode them into the real game
code and delete the sweep script — it's a tuning tool, not part of the deliverable.

### 5. Definition of done

Don't report a game prototype as finished until `npx playwright test` has actually been
run in this session and passed — not "should pass," actually run. If you're out of turns
or budget before getting there, say explicitly what's untested rather than implying it's
verified. A game with a red test suite handed to the user is strictly worse than being
upfront that verification isn't finished yet.

## Reference files

- `references/testability-pattern.md` — the `window.__game` hook design, why async
  actions return Promises, and the two-style test approach (realistic input + direct
  parameter injection)
- `references/common-bugs.md` — two real bug classes this harness has caught, with
  buggy/fixed code side by side, generalized beyond the specific game they were found in
- `assets/templates/` — the full project scaffold, including a working example game

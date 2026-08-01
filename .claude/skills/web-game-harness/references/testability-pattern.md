# The `window.__game` testability pattern

## Why a hook on `window` at all

Playwright can click, drag, and type into a page, but a canvas has no DOM
structure to query — you can't ask "what's the score" by reading an element,
and you can't easily assert "the projectile landed in the bullseye" from
pixels alone. The fix is to have the game itself expose a small, deliberate
object on `window` that a test can read and call into. This is not a
back door or a hack — it's the same idea as a `data-testid` attribute, just
adapted for a canvas app with no DOM to attach attributes to.

Keep the exposed surface small and intentional:

```js
window.__game = {
  ready: true,                              // signals create() has finished
  getState: () => ({ score, round, gameOver }),
  fireActionForTest: (ratio) => this.fireProjectile(ratio),
};
```

`ready` matters more than it looks — without it, a test's first
`page.evaluate` can race the scene's `create()` and read `window.__game` as
`undefined`. Always `await page.waitForFunction(() => window.__game &&
window.__game.ready)` before touching anything else.

## Why gameplay actions should return Promises

A thrown projectile doesn't score the instant you throw it — it scores when
it lands, which might be a few hundred milliseconds and several physics steps
later. Two ways to handle this in a test:

1. **Poll**: fire the action, then `page.waitForFunction(() =>
   window.__game.getState().round === N)` in a loop until the round counter
   moves.
2. **Return a Promise from the action itself**, resolved from inside the
   collision handler (or whatever "this action is now complete" event fires),
   and let the test simply `await` the call.

Prefer (2). It's not just cleaner — polling only tells you the round
advanced, not what the outcome *was* at that specific throw, so you'd need a
second read to get the score, with a small window where another action could
already be in flight. A resolved Promise value is unambiguous: this call,
this outcome.

```js
fireProjectile(ratio) {
  return new Promise((resolve) => {
    // ... launch it ...
    this.pendingResolvers.push({ body: projectileBody, resolve });
  });
}

// later, in the collision handler, once you know this projectile is done:
resolve(score);
```

This also means a test can be written as a single `await
page.evaluate(...)` line and get back the real outcome, which is what makes
`assets/templates/game.spec.js.example` so short per test.

## Why you need both a realistic-input test and parameter-injection tests

`fireActionForTest(ratio)` bypasses the actual charge-and-release timing —
that's what makes most tests fast and deterministic. But it also means those
tests never touch `pointerdown`/`pointerup` handling at all, so a bug in the
*input* code (wrong event names, charge ratio computed backwards, power bar
never resetting) would sail through every test untouched.

Write exactly one test that drives the real interaction —
`page.mouse.move()` to position, `page.mouse.down()`, a real
`page.waitForTimeout()` while charging, `page.mouse.up()` — and let every
other test use the parameter-injection hook. That one realistic test is what
actually proves the input plumbing works; the rest are there to cheaply cover
game-logic edge cases (max power, repeated shots, round limits) without
paying a real-time cost for each one.

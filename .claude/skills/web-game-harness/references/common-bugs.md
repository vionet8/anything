# Bug classes this harness actually catches

These are two real bugs found by running the test suite against a working
prototype — not hypothetical. Both would have shipped silently without
automated verification: the code looked reasonable on read, compiled/ran
without error, and only failed under a specific runtime condition a human
playtester might not hit in a quick manual check either. Recognize the
*shape* of these, since they generalize well past the specific game they were
found in.

## 1. Only checking one side of a symmetric collision pair

A physics collision event gives you a pair of bodies, `bodyA` and `bodyB`,
in no guaranteed order. It's tempting to write:

```js
// BUGGY
const dartBody = bodyA.label === 'dart' ? bodyA : bodyB.label === 'dart' ? bodyB : null;
if (!dartBody) continue;
const index = this.pendingResolvers.findIndex((p) => p.body === dartBody);
if (index === -1) continue; // <-- gives up on this pair entirely
```

This looks fine for a *single* in-flight projectile colliding with a static
target. It breaks the moment two `'dart'`-labeled bodies can collide with
each other — e.g. a second shot hitting one that already landed and is now
sitting in the world as a static body. When that happens, `bodyA` might be
the *old*, already-resolved dart. The ternary picks it as "the dart" for this
pair, `pendingResolvers.findIndex` correctly finds nothing (it already
resolved), and the `continue` throws away the whole pair — including the
fact that `bodyB`, the actually-pending new dart, was sitting right there.
Its Promise never resolves. Nothing crashes. The game just... hangs, forever,
waiting for a collision that already happened.

**The fix**: check both bodies independently, don't let checking one
"consume" the pair:

```js
// FIXED
for (const dartBody of [pair.bodyA, pair.bodyB]) {
  if (dartBody.label !== 'dart') continue;
  const index = this.pendingResolvers.findIndex((p) => p.body === dartBody);
  if (index === -1) continue;
  // ... resolve it ...
}
```

**How you'd notice**: a test that fires a single shot passes fine. A test
that fires several shots *in sequence* (so earlier ones remain in the world)
either hangs past its timeout or takes suspiciously long. If a test times out
specifically on a later iteration of a loop rather than the first, suspect
state left over from earlier iterations colliding with the new one — not a
timing fluke.

This generalizes beyond physics collisions: any time you're matching one of
two symmetric/unordered things against a lookup table, and "no match" is
handled by silently giving up rather than checking the other one, you have
this bug shape.

## 2. Untuned gameplay constants that were never actually reaching the target

A launch power range, a projectile speed, a spawn interval — anything
computed from a formula (`velocity = power * cos(angle)`, `gravity=1`) is
easy to write with plausible-looking numbers that were never actually
checked against the specific world coordinates in play. In one case, a power
range of 6–18 with a 50° launch angle looked reasonable, but empirically
every shot landed on the floor 90-450px short of the target — the numbers
were internally consistent but never verified against where the target
actually was.

**How you'd notice**: a test asserting "a full-power throw scores points"
fails with `score: 0` even though nothing threw an error. That's the signal
to stop assuming the test is wrong and start asking whether the constants
were ever actually correct.

**The fix isn't to guess again** — it's to measure. Write a disposable sweep
script (see `assets/templates/debug-tune.js.example`) that fires the same
action across a range of raw parameter values, on a fresh page each time, and
logs the resulting outcome/landing position. A dozen data points across a
wide range tells you where the real sweet spot is in a few seconds, far
faster and more reliably than adjusting one guess at a time and re-reading
the code.

Once you've found a range that actually works, hardcode it as the real
constants and delete the sweep script — it did its job.

## 3. Scoring "distance from center" against a solid circular collider

If a target is a filled circular physics body and you score by measuring the
distance from the collision point to that circle's center, the score can
never vary meaningfully — because two circles in contact are always exactly
`targetRadius + projectileRadius` apart, center to center, regardless of
which angle the hit came from. Every hit lands in the same ring; a bullseye
and a near-total-miss-that-still-connects are indistinguishable. This was
caught the same way as the bugs above: a test asserting "a good throw scores
points" kept returning 0 even after fixing the power range, because the
collider itself made a meaningful score structurally impossible, not just
untuned.

**The fix**: separate the *visual* target (still a nice concentric-circle
sprite, for the player to aim at) from the *physics* collider, which should
be a thin sensor — e.g. a narrow vertical rectangle spanning the target's
height — so the position where the projectile actually crosses it varies
with real aim instead of being pinned to a fixed radius:

```js
this.add.circle(TARGET.x, TARGET.y, visualRadius, 0xf5f5f5); // just a sprite
this.matter.add.rectangle(TARGET.x, TARGET.y, thinWidth, tallHeight, {
  isStatic: true,
  label: 'target',
}); // the actual collider — thin, not filled
```

The general lesson: when a physics shape is also standing in for a scoring
zone, check whether the shape being collided with can structurally produce
the score range you want, before assuming the scoring *formula* is what's
wrong.

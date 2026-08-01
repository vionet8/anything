// Reference implementation: a tap-to-charge, physics-arc aim-and-launch game
// (gravity-based projectile, distance-from-center scoring). This is a
// complete, tested example of the patterns described in
// references/testability-pattern.md and references/common-bugs.md — reuse
// the STRUCTURE (Matter setup, collision handling, window.__darts hook,
// Promise-based async actions) for other mechanics, don't just rename
// variables and ship this verbatim unless the game genuinely is this one.
(function () {
  const TARGET = { x: 650, y: 200 };
  const RINGS = [
    { radius: 20, score: 50 },
    { radius: 45, score: 25 },
    { radius: 80, score: 15 },
    { radius: 130, score: 10 },
    { radius: 170, score: 5 },
  ];
  const TARGET_VISUAL_RADIUS = 180;
  // The physics collider is a thin vertical sensor, not a filled disc the
  // same size as the visual rings. A filled circular collider always
  // contacts an incoming body at exactly (target radius + projectile radius)
  // from its center, no matter which angle it's hit from — so "distance from
  // center at the collision point" would be a near-constant, and no ring
  // scoring could ever differentiate a bullseye from a near miss. A thin
  // wall lets the vertical hit position vary meaningfully instead. See
  // references/common-bugs.md if this file ever gets copied without reading
  // that first.
  const TARGET_WALL_THICKNESS = 12;
  const TARGET_WALL_HEIGHT = 2 * RINGS[RINGS.length - 1].radius + 40;
  const LAUNCH_POINT = { x: 80, y: 500 };
  const LAUNCH_ANGLE_DEG = 50;
  const MIN_POWER = 17;
  const MAX_POWER = 27;
  const CHARGE_DURATION_MS = 1200;
  const TOTAL_ROUNDS = 5;

  // These power/angle constants were found empirically with a sweep script
  // like debug-tune.js.example, not guessed: power 17 and 27 both miss the
  // target entirely, 20-21 land closest to the bullseye, and everything
  // between falls off in either direction — a real skill curve for the
  // charge-and-release mechanic. Re-tune the same way if you change TARGET,
  // LAUNCH_POINT, gravity, or the projectile's physics properties — the
  // relationship between "charge power" and "where it lands" is not obvious
  // from the formula alone.

  const state = { score: 0, round: 1, dartInFlight: false };

  function isGameOver() {
    return state.round > TOTAL_ROUNDS;
  }

  function scoreForDistance(distance) {
    for (const ring of RINGS) {
      if (distance <= ring.radius) return ring.score;
    }
    return 0;
  }

  const scoreEl = document.getElementById('score');
  const roundEl = document.getElementById('round');
  const powerFillEl = document.getElementById('power-bar-fill');

  function updateUI() {
    scoreEl.textContent = `Score: ${state.score}`;
    roundEl.textContent = isGameOver()
      ? `Finished! Score: ${state.score}`
      : `Round: ${state.round}/${TOTAL_ROUNDS}`;
  }

  function setChargeRatio(ratio) {
    powerFillEl.style.width = `${Math.round(ratio * 100)}%`;
  }

  class DartsScene extends Phaser.Scene {
    constructor() {
      super('darts');
      this.chargeStart = 0;
      this.isCharging = false;
      this.pendingResolvers = [];
    }

    create() {
      this.matter.world.setBounds(0, 0, 800, 600);
      this.matter.world.setGravity(0, 1);

      this.matter.add.rectangle(400, 596, 800, 8, { isStatic: true, label: 'floor' });

      this.add.circle(TARGET.x, TARGET.y, TARGET_VISUAL_RADIUS, 0xf5f5f5);
      this.matter.add.rectangle(TARGET.x, TARGET.y, TARGET_WALL_THICKNESS, TARGET_WALL_HEIGHT, {
        isStatic: true,
        label: 'target',
      });
      for (const ring of [...RINGS].reverse()) {
        this.add.circle(TARGET.x, TARGET.y, ring.radius).setStrokeStyle(1, 0x999999);
      }

      this.add.circle(LAUNCH_POINT.x, LAUNCH_POINT.y, 8, 0x66ccff);

      this.matter.world.on('collisionstart', (event) => this.handleCollision(event));

      this.input.on('pointerdown', () => this.startCharge());
      this.input.on('pointerup', () => this.releaseCharge());

      // The test-facing surface. `ready` lets tests know create() has
      // finished before they touch anything. `getState` is a plain snapshot
      // read. `fireActionForTest` bypasses real-time charging so tests are
      // fast and deterministic instead of racing setTimeout/requestAnimationFrame.
      window.__darts = {
        ready: true,
        getState: () => ({ score: state.score, round: state.round, gameOver: isGameOver() }),
        fireActionForTest: (ratio) => this.fireProjectile(ratio),
        fireRawPowerForTest: (power) => this.fireProjectileWithPower(power),
      };
    }

    update() {
      if (this.isCharging) {
        const elapsed = this.time.now - this.chargeStart;
        setChargeRatio(Phaser.Math.Clamp(elapsed / CHARGE_DURATION_MS, 0, 1));
      }
    }

    startCharge() {
      if (state.dartInFlight || isGameOver()) return;
      this.isCharging = true;
      this.chargeStart = this.time.now;
    }

    releaseCharge() {
      if (!this.isCharging) return;
      this.isCharging = false;
      const elapsed = this.time.now - this.chargeStart;
      const ratio = Phaser.Math.Clamp(elapsed / CHARGE_DURATION_MS, 0, 1);
      setChargeRatio(0);
      this.fireProjectile(ratio);
    }

    fireProjectile(ratio) {
      const power = Phaser.Math.Linear(MIN_POWER, MAX_POWER, ratio);
      return this.fireProjectileWithPower(power);
    }

    // Split out from fireProjectile(ratio) specifically so a calibration
    // script can drive raw power values directly, without needing to reverse
    // the ratio math. Keep this split in your own game too — it's what makes
    // debug-tune.js.example possible.
    fireProjectileWithPower(power) {
      return new Promise((resolve) => {
        if (state.dartInFlight || isGameOver()) {
          resolve(null);
          return;
        }
        state.dartInFlight = true;

        const rad = Phaser.Math.DegToRad(LAUNCH_ANGLE_DEG);
        const vx = Math.cos(rad) * power;
        const vy = -Math.sin(rad) * power;

        const shape = this.add.circle(LAUNCH_POINT.x, LAUNCH_POINT.y, 6, 0x888888);
        const projectile = this.matter.add.gameObject(shape, {
          shape: { type: 'circle', radius: 6 },
          restitution: 0,
          friction: 0.05,
          label: 'dart',
        });
        this.matter.body.setVelocity(projectile.body, { x: vx, y: vy });

        this.pendingResolvers.push({ body: projectile.body, resolve });
      });
    }

    handleCollision(event) {
      for (const pair of event.pairs) {
        // Check BOTH bodies in the pair, not just whichever comes first.
        // See references/common-bugs.md — checking only bodyA (or only
        // whichever one matches a label first) means that when two
        // 'dart'-labeled bodies collide with each other (a fresh projectile
        // hitting one that already landed), the pending one can end up on
        // either side of the pair, and skipping the other side leaves its
        // Promise unresolved forever.
        for (const dartBody of [pair.bodyA, pair.bodyB]) {
          if (dartBody.label !== 'dart') continue;

          const index = this.pendingResolvers.findIndex((p) => p.body === dartBody);
          if (index === -1) continue;

          const { resolve } = this.pendingResolvers[index];
          this.pendingResolvers.splice(index, 1);

          // Score from final resting position relative to the target,
          // regardless of what specifically stopped it (floor, target,
          // another projectile) — that's what "where did it land" means.
          const dx = dartBody.position.x - TARGET.x;
          const dy = dartBody.position.y - TARGET.y;
          const score = scoreForDistance(Math.sqrt(dx * dx + dy * dy));

          this.matter.body.setVelocity(dartBody, { x: 0, y: 0 });
          this.matter.body.setStatic(dartBody, true);

          state.score += score;
          state.round += 1;
          state.dartInFlight = false;
          updateUI();
          resolve(score);
        }
      }
    }
  }

  updateUI();

  new Phaser.Game({
    type: Phaser.AUTO,
    width: 800,
    height: 600,
    backgroundColor: '#202020',
    parent: document.body,
    physics: { default: 'matter', matter: { gravity: { x: 0, y: 1 }, debug: false } },
    scene: [DartsScene],
  });
})();

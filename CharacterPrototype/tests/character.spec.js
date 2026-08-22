const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 15000 });
});

test('character loads with a rigged skeleton and starts in idle', async ({ page }) => {
  const state = await page.evaluate(() => window.__char.getState());
  expect(state.animName).toBe('idle');
  expect(state.position).toEqual({ x: 0, y: 0, z: 0 });
});

test('holding a real movement key switches to the walk animation and moves the character', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(500);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyW');

  expect(midState.animName).toBe('walk');
  expect(midState.position.z).toBeGreaterThan(0);
});

test('releasing movement keys returns the character to idle', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(300);
  await page.keyboard.up('KeyW');
  await page.waitForTimeout(300);

  const state = await page.evaluate(() => window.__char.getState());
  expect(state.animName).toBe('idle');
});

test('moving forward for a fixed simulated duration advances position deterministically', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.moveForTest('forward', 1000, false));
  // MOVE_SPEED is 3.2 units/sec; allow some tolerance for discrete stepping.
  expect(result.position.z).toBeGreaterThan(2.8);
  expect(result.position.z).toBeLessThan(3.6);
  expect(result.animName).toBe('idle'); // resets after the simulated hold ends
});

test('running moves the character further than walking for the same duration', async ({ page }) => {
  const walked = await page.evaluate(() => window.__char.moveForTest('forward', 1000, false));

  // Reload for a clean position reset before comparing against a run.
  await page.goto('/');
  await page.waitForFunction(() => window.__char && window.__char.ready, null, { timeout: 15000 });
  const ran = await page.evaluate(() => window.__char.moveForTest('forward', 1000, true));

  expect(ran.position.z).toBeGreaterThan(walked.position.z);
});

test('turning left changes heading and the character rotates to face the new direction', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.moveForTest('left', 500, false));
  // heading = atan2(moveX, moveZ); moving purely left (moveX=-1, moveZ=0) => heading = -PI/2.
  // Precision is loose (1 decimal, ~0.05 rad) because moveForTest ends with a
  // 1ms settle step after releasing the movement key, and that step is enough
  // for the idle "face the camera" turn to nudge heading very slightly off
  // the exact movement-derived value — expected, not a bug.
  expect(result.heading).toBeCloseTo(-Math.PI / 2, 1);
  expect(result.position.x).toBeLessThan(0);
});

test('waving in place does not move the character and reports the wave state', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.triggerActionForTest('wave', 600));
  expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
  // The action resets to idle once the key is released, same as walk/run.
  expect(result.animName).toBe('idle');
});

test('crouching in place does not move the character', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.triggerActionForTest('crouch', 600));
  expect(result.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(result.animName).toBe('idle');
});

test('peace sign in place does not move the character and reports the peace state', async ({ page }) => {
  await page.keyboard.down('KeyV');
  await page.waitForTimeout(300);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyV');
  await page.waitForTimeout(300);
  const afterState = await page.evaluate(() => window.__char.getState());

  expect(midState.animName).toBe('peace');
  expect(midState.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(afterState.animName).toBe('idle'); // resets once the key is released
});

test('jumping rises and returns to the ground and idle, without net horizontal movement', async ({ page }) => {
  const result = await page.evaluate(() => window.__char.jumpForTest(900));
  // JUMP_VELOCITY=4.2, JUMP_GRAVITY=18 -> analytic max height = 0.49; allow
  // tolerance for discrete 16ms stepping.
  expect(result.maxHeight).toBeGreaterThan(0.4);
  expect(result.maxHeight).toBeLessThan(0.55);
  expect(result.position.y).toBe(0); // back on the ground by 900ms (full cycle is ~0.65s)
  expect(result.position.x).toBe(0);
  expect(result.position.z).toBe(0);
  expect(result.animName).toBe('idle'); // recovered and settled back to idle
});

test('a running jump keeps moving horizontally while airborne', async ({ page }) => {
  await page.keyboard.down('KeyW');
  await page.waitForTimeout(100);
  await page.keyboard.down('Space');
  await page.keyboard.up('Space');
  // Sample near the apex (~233ms), not late in the arc. The airborne phase
  // ends at ~467ms, so a 400ms wait left only ~67ms of margin and this failed
  // roughly two runs in three on real-time frame jitter.
  await page.waitForTimeout(250);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyW');

  expect(midState.animName).toBe('jump'); // jump outranks walk's animName while airborne
  expect(midState.position.z).toBeGreaterThan(0); // but WASD still moved her forward
});

test('double peace sign in place does not move the character and reports its own state', async ({ page }) => {
  await page.keyboard.down('KeyB');
  await page.waitForTimeout(300);
  const midState = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyB');
  await page.waitForTimeout(300);
  const afterState = await page.evaluate(() => window.__char.getState());

  expect(midState.animName).toBe('double-peace');
  expect(midState.position).toEqual({ x: 0, y: 0, z: 0 });
  expect(afterState.animName).toBe('idle');
});

test('the double peace puts both hands up beside the face, not out at the shoulders', async ({ page }) => {
  const measured = await page.evaluate(() => {
    window.__char.holdActionForTest('double-peace', 500);
    const out = {
      head: window.__char.getBoneWorld('head'),
      left: window.__char.getBoneWorld('leftHand'),
      right: window.__char.getBoneWorld('rightHand'),
    };
    window.__char.releaseActionsForTest();
    return out;
  });

  for (const side of ['left', 'right']) {
    const hand = measured[side];
    const distance = Math.hypot(
      hand.x - measured.head.x, hand.y - measured.head.y, hand.z - measured.head.z
    );
    // Beside the face: close to the head, and level with it rather than
    // hanging below at shoulder height like the one-handed peace does.
    expect(distance, `${side} hand distance from head`).toBeLessThan(0.32);
    expect(hand.y, `${side} hand height`).toBeGreaterThan(measured.head.y - 0.1);
  }
  // One hand either side of the face, not both crowded onto one side.
  // Measured as a spread plus a centred midpoint so the check does not depend
  // on which way she happens to be facing.
  const spread = Math.hypot(measured.left.x - measured.right.x, measured.left.z - measured.right.z);
  const midX = (measured.left.x + measured.right.x) / 2;
  const midZ = (measured.left.z + measured.right.z) / 2;
  expect(spread, 'distance between the hands').toBeGreaterThan(0.25);
  expect(Math.hypot(midX - measured.head.x, midZ - measured.head.z),
    'hands centred on the head').toBeLessThan(0.1);
});

// The hand's own frame, so a finger pose can be asserted on without depending
// on where the arm is holding it. Distances come back in centimetres from the
// wrist joint: `up` along the fingers, `across` toward the little finger,
// `palm` out of the palm — the side the fingers fold toward.
//
// `palm` comes from a cross product, so its direction follows the hand's
// handedness rather than the pose, and the left hand needs the flip.
// tools/measure_grip.js prints the same numbers for tuning by hand.
function handFrame(m, side) {
  const sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const cross = (a, b) => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const scale = (a, k) => ({ x: a.x * k, y: a.y * k, z: a.z * k });
  const norm = (a) => scale(a, 1 / Math.hypot(a.x, a.y, a.z));

  const wrist = m[`${side}Hand`];
  const up = norm(sub(m[`${side}MiddleProximal`], wrist));
  const across = norm(sub(m[`${side}LittleProximal`], m[`${side}IndexProximal`]));
  const palm = scale(norm(cross(up, across)), side === 'left' ? -1 : 1);
  return (p) => ({
    up: dot(sub(p, wrist), up) * 100,
    across: dot(sub(p, wrist), across) * 100,
    palm: dot(sub(p, wrist), palm) * 100,
  });
}

async function measureHands(page, pose, sides) {
  const bones = sides.flatMap((side) => [
    `${side}Hand`, `${side}IndexProximal`, `${side}MiddleProximal`, `${side}LittleProximal`,
    `${side}ThumbDistal`, `${side}RingIntermediate`,
  ]);
  const tips = sides.flatMap((side) => {
    const s = side === 'left' ? 'L' : 'R';
    return [`J_Bip_${s}_Thumb3_end`, `J_Bip_${s}_Ring3_end`];
  });
  return page.evaluate(([name, boneNames, tipNames]) => {
    window.__char.holdActionForTest(name, 400);
    const out = {};
    for (const bone of boneNames) out[bone] = window.__char.getBoneWorld(bone);
    for (const tip of tipNames) out[tip] = window.__char.getNodeWorld(tip);
    window.__char.releaseActionsForTest();
    return out;
  }, [pose, bones, tips]);
}

// Both peace poses, because they curl the fingers through the same code and
// the left hand goes through its mirror — which has been wrong before.
for (const [pose, sides] of [['peace', ['right']], ['double-peace', ['right', 'left']]]) {
  test(`${pose} folds the spare fingers into the palm rather than across it`, async ({ page }) => {
    const measured = await measureHands(page, pose, sides);

    for (const side of sides) {
      const local = handFrame(measured, side);
      const s = side === 'left' ? 'L' : 'R';
      const tip = local(measured[`J_Bip_${s}_Ring3_end`]);

      // Straight, the ring fingertip stands about 12cm up from the wrist and
      // level with the palm. Folded, it comes back down onto the palm. The
      // bug this catches is a fingertip that stays out at full length and
      // merely swings sideways, which reads as folded from the one camera
      // angle that can see past the sleeve.
      expect(tip.up, `${side} ring fingertip height`).toBeLessThan(4.5);
      expect(tip.palm, `${side} ring fingertip off the palm`).toBeGreaterThan(0.4);
      expect(tip.palm, `${side} ring fingertip off the palm`).toBeLessThan(2.5);
    }
  });

  test(`${pose} rests the thumb on top of the folded ring finger`, async ({ page }) => {
    const measured = await measureHands(page, pose, sides);

    for (const side of sides) {
      const local = handFrame(measured, side);
      const s = side === 'left' ? 'L' : 'R';
      const thumbTip = local(measured[`J_Bip_${s}_Thumb3_end`]);
      const ringMiddle = local(measured[`${side}RingIntermediate`]);

      // Over the ring finger's middle joint, near enough to be touching it...
      const sideways = Math.hypot(thumbTip.up - ringMiddle.up, thumbTip.across - ringMiddle.across);
      expect(sideways, `${side} thumb tip alongside the ring finger`).toBeLessThan(1.6);
      // ...and on top of it rather than through it or floating above it.
      const clearance = thumbTip.palm - ringMiddle.palm;
      expect(clearance, `${side} thumb tip above the ring finger`).toBeGreaterThan(0.3);
      expect(clearance, `${side} thumb tip above the ring finger`).toBeLessThan(1.6);
    }
  });
}

test('the model exposes the facial expressions the poses depend on', async ({ page }) => {
  // The previous model had every morph target stripped by an optimisation
  // pass, so this list came back empty and no expression could ever apply.
  // Nothing on screen said so, which is why it is asserted here.
  const expressions = await page.evaluate(() => window.__char.getExpressions());
  expect(expressions).toEqual(expect.arrayContaining(['happy', 'relaxed', 'blink']));
});

test('the peace poses and the jump smile, and idle does not', async ({ page }) => {
  const idle = await page.evaluate(() => window.__char.getState().smile);
  expect(idle).toBeLessThan(0.05);

  for (const pose of ['peace', 'double-peace']) {
    const smile = await page.evaluate((name) => {
      window.__char.holdActionForTest(name, 500);
      const value = window.__char.getState().smile;
      window.__char.releaseActionsForTest();
      return value;
    }, pose);
    expect(smile, `${pose} smile`).toBeGreaterThan(0.8);
  }

  const jumping = await page.evaluate(() => {
    window.__char.jumpForTest(200); // ~apex
    return window.__char.getState().smile;
  });
  expect(jumping).toBeGreaterThan(0.5);
});

test('the smile eases in rather than snapping to full on the first frame', async ({ page }) => {
  const early = await page.evaluate(() => {
    window.__char.holdActionForTest('double-peace', 32); // two frames
    const value = window.__char.getState().smile;
    window.__char.releaseActionsForTest();
    return value;
  });
  expect(early).toBeGreaterThan(0);
  expect(early).toBeLessThan(0.5);
});

test('the arms hang below the head at rest', async ({ page }) => {
  // A rig-orientation guard. The model is a VRM 0.x export whose normalized
  // skeleton is mirrored against the VRM 1.0 one these poses were written
  // for, and the failure mode is silent and total: every arm rotation
  // inverts, so idle raises both arms straight up instead of letting them
  // hang. Nothing else in the suite would notice.
  const measured = await page.evaluate(() => ({
    head: window.__char.getBoneWorld('head'),
    left: window.__char.getBoneWorld('leftHand'),
    right: window.__char.getBoneWorld('rightHand'),
  }));

  expect(measured.left.y).toBeLessThan(measured.head.y - 0.3);
  expect(measured.right.y).toBeLessThan(measured.head.y - 0.3);
});

test('the character faces the way she walks', async ({ page }) => {
  // Guards the half-turn that rotateVRM0 puts on the scene root: drop it and
  // she still travels the right way, but moonwalks there facing backwards.
  // Her left hand ends up on the wrong side of her, which is what this reads.
  const measured = await page.evaluate(() => {
    window.__char.moveForTest('forward', 400, false); // heading 0, travelling +Z
    return {
      left: window.__char.getBoneWorld('leftHand'),
      right: window.__char.getBoneWorld('rightHand'),
    };
  });
  // Facing +Z, her left hand sits at greater world X than her right.
  expect(measured.left.x).toBeGreaterThan(measured.right.x);
});

test('each expression key puts on its own expression', async ({ page }) => {
  const bindings = [
    ['Digit1', 'happy'], ['Digit2', 'relaxed'], ['Digit3', 'Surprised'],
    ['Digit4', 'angry'], ['Digit5', 'sad'], ['Digit6', 'Extra'],
  ];
  for (const [key, expression] of bindings) {
    await page.keyboard.down(key);
    await page.waitForTimeout(400);
    const state = await page.evaluate(() => window.__char.getState());
    await page.keyboard.up(key);
    await page.waitForTimeout(300);

    expect(state.expression, `${key}`).toBe(expression);
    expect(state.expressionWeight, `${key} weight`).toBeGreaterThan(0.9);
  }
});

test('releasing an expression key returns her face to rest', async ({ page }) => {
  await page.keyboard.down('Digit4');
  await page.waitForTimeout(400);
  await page.keyboard.up('Digit4');
  await page.waitForTimeout(600);

  const state = await page.evaluate(() => window.__char.getState());
  expect(state.expressionWeight).toBeLessThan(0.05);
});

test('a held expression key overrides the expression the pose would wear', async ({ page }) => {
  await page.keyboard.down('KeyV'); // peace, which on its own smiles
  await page.waitForTimeout(400);
  const smiling = await page.evaluate(() => window.__char.getState());

  await page.keyboard.down('Digit4'); // scowl through it
  await page.waitForTimeout(400);
  const scowling = await page.evaluate(() => window.__char.getState());

  await page.keyboard.up('Digit4');
  await page.keyboard.up('KeyV');

  expect(smiling.expression).toBe('happy');
  expect(scowling.animName).toBe('peace'); // still holding the pose
  expect(scowling.expression).toBe('angry');
  expect(scowling.expressionWeight).toBeGreaterThan(0.9);
});

test('rolling from one expression key to the next does not blank her face', async ({ page }) => {
  // Press the second before releasing the first, then release the first. The
  // naive "any keyup clears it" version drops back to neutral here.
  await page.keyboard.down('Digit1');
  await page.waitForTimeout(300);
  await page.keyboard.down('Digit5');
  await page.waitForTimeout(100);
  await page.keyboard.up('Digit1');
  await page.waitForTimeout(400);

  const state = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('Digit5');

  expect(state.expression).toBe('sad');
  expect(state.expressionWeight).toBeGreaterThan(0.9);
});

test('waving wears a smile of its own', async ({ page }) => {
  const smile = await page.evaluate(() => {
    window.__char.holdActionForTest('wave', 500);
    const value = window.__char.getState().smile;
    window.__char.releaseActionsForTest();
    return value;
  });
  expect(smile).toBeGreaterThan(0.6);
});

// Gaze is measured with the face-camera turn switched off, because she now
// turns to face the camera in every standing state — including while holding a
// pose, which is what this used to lean on. Left running, the body turn would
// cancel the angle under test before the gaze could be read. 'wave' is used
// rather than a peace pose because the peace smile closes her eyes.
async function gazeAt(page, degreesOffHerFacing) {
  return page.evaluate((degrees) => {
    window.__char.setAutoFaceForTest(false);
    const head = window.__char.getBoneWorld('head');
    const angle = window.__char.getState().heading + degrees * Math.PI / 180;
    const camera = {
      x: head.x + Math.sin(angle) * 2,
      y: head.y + 0.1,
      z: head.z + Math.cos(angle) * 2,
    };
    const target = { x: head.x, y: head.y, z: head.z };

    window.__char.setCameraForTest(camera, target);
    window.__char.holdActionForTest('wave', 1200); // long enough for the ease to settle
    window.__char.setCameraForTest(camera, target);

    const state = window.__char.getState();
    const aim = window.__char.getEyeAim();
    const to = {
      x: camera.x - aim.origin.x, y: camera.y - aim.origin.y, z: camera.z - aim.origin.z,
    };
    const length = Math.hypot(to.x, to.y, to.z);
    const alignment = Math.abs(
      (aim.forward.x * to.x + aim.forward.y * to.y + aim.forward.z * to.z) / length
    );

    // The angle she should be turning through, recomputed here rather than
    // assumed from `degrees`: holding the pose runs the camera follow, which
    // drifts the camera a little from where it was placed.
    const fx = Math.sin(state.heading);
    const fz = Math.cos(state.heading);
    const hx = camera.x - head.x;
    const hz = camera.z - head.z;
    const hn = Math.hypot(hx, hz);
    const trueAngle = Math.atan2(
      fz * (hx / hn) - fx * (hz / hn), fx * (hx / hn) + fz * (hz / hn)
    );

    window.__char.releaseActionsForTest();
    window.__char.setAutoFaceForTest(true);
    return { gazeAngle: state.gazeAngle, gazeWeight: state.gazeWeight, alignment, trueAngle };
  }, degreesOffHerFacing);
}

test('the gaze follows the camera around her', async ({ page }) => {
  for (const degrees of [0, 35, 70]) {
    const gaze = await gazeAt(page, degrees);
    expect(gaze.gazeWeight, `weight at ${degrees}deg`).toBeGreaterThan(0.9);
    expect(gaze.gazeAngle, `angle at ${degrees}deg`).toBeCloseTo(gaze.trueAngle, 1);
  }
});

test('the eyes are aimed at the camera when it is in front of her', async ({ page }) => {
  const gaze = await gazeAt(page, 0);
  expect(gaze.alignment).toBeGreaterThan(0.97);
});

test('the gaze gives up rather than straining when the camera goes behind her', async ({ page }) => {
  const gaze = await gazeAt(page, 170);
  expect(gaze.gazeWeight).toBeLessThan(0.1);
});

test('idle turns the character to face the camera instead of staying at the last movement heading', async ({ page }) => {
  const afterMove = await page.evaluate(() => window.__char.moveForTest('right', 500, false));
  // Give the idle face-camera turn time to settle (it eases in, not instant).
  await page.waitForTimeout(2500);
  const idleState = await page.evaluate(() => window.__char.getState());
  expect(idleState.heading).not.toBeCloseTo(afterMove.heading, 1);
});

// How far off the camera she is standing, in degrees, measured rather than
// inferred from `heading`: she moves while walking, so the direction to the
// camera is not the direction it started in.
async function degreesOffTheCamera(page) {
  return page.evaluate(() => {
    const state = window.__char.getState();
    const camera = window.__char.getCameraPosition();
    const wanted = Math.atan2(camera.x - state.position.x, camera.z - state.position.z);
    const delta = wanted - state.heading;
    return Math.abs(Math.atan2(Math.sin(delta), Math.cos(delta))) * 180 / Math.PI;
  });
}

test('standing still, she comes round to face the camera exactly', async ({ page }) => {
  await page.evaluate(() => window.__char.moveForTest('right', 500, false));
  await page.waitForTimeout(2500);
  // Tight on purpose. The turn used to be an exponential ease with no
  // stopping condition, which left her parked several degrees off — visibly
  // standing at an angle — and the further behind the frame rate, the worse.
  expect(await degreesOffTheCamera(page)).toBeLessThan(1);
});

test('a held pose faces the camera too, not wherever she stopped walking', async ({ page }) => {
  await page.evaluate(() => window.__char.moveForTest('left', 600, false));
  await page.keyboard.down('KeyV');
  await page.waitForTimeout(2500);
  const off = await degreesOffTheCamera(page);
  const state = await page.evaluate(() => window.__char.getState());
  await page.keyboard.up('KeyV');

  expect(state.animName).toBe('peace');
  expect(off).toBeLessThan(1);
});

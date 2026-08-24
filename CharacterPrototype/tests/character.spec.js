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
  // Reloads the page mid-test and waits for a cast of VRMs to come back, which
  // does not reliably fit in the default twenty seconds on a cold headless
  // browser. What is being measured is a distance, not a load time.
  test.setTimeout(60000);
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
  test.setTimeout(90000);
  const bindings = [
    ['Digit1', 'happy'], ['Digit2', 'relaxed'], ['Digit3', 'Surprised'],
    ['Digit4', 'angry'], ['Digit5', 'sad'], ['Digit6', 'Extra'],
  ];
  for (const [key, expression] of bindings) {
    await page.keyboard.down(key);
    // Frames, not milliseconds. The ease is per second of real time but it
    // only advances when one is drawn, and headless draws a few times a
    // second -- so a 400ms wait was a single step and the weight landed on
    // exactly 0.9, the value one step gets you.
    await warmFrames(page, 6);
    const state = await page.evaluate(() => window.__char.getState());
    await page.keyboard.up(key);
    await warmFrames(page, 4);

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

test('every character in the cast holds the same peace sign', async ({ page }) => {
  test.setTimeout(60000);
  // The three sample avatars share one skeleton, which is the whole reason the
  // hand-authored poses can be written once. This is the check on that claim:
  // the fingers are the fussiest thing in the file, so if a rig differs
  // anywhere it shows up here first.
  // Both numbers here are the length of CHARACTER_SOURCES and have to move
  // together: the wait was left at three when the cast went down to two, and
  // the test then sat for thirty seconds waiting for a character that was
  // never going to arrive.
  await page.waitForFunction(() => window.__game.listCastForTest().length === 2, null, { timeout: 30000 });
  const cast = await page.evaluate(() => window.__game.listCastForTest());
  expect(cast.map((member) => member.key)).toEqual(['a', 'b']);

  for (const member of cast) {
    await page.evaluate((key) => window.__game.setCharacterForTest(key), member.key);
    await page.waitForTimeout(200);
    const measured = await measureHands(page, 'peace', ['right']);
    const local = handFrame(measured, 'right');
    const thumbTip = local(measured['J_Bip_R_Thumb3_end']);
    const ringMiddle = local(measured.rightRingIntermediate);

    const sideways = Math.hypot(thumbTip.up - ringMiddle.up, thumbTip.across - ringMiddle.across);
    const clearance = thumbTip.palm - ringMiddle.palm;
    expect(sideways, `${member.label}: thumb alongside the ring finger`).toBeLessThan(1.6);
    expect(clearance, `${member.label}: thumb on top of the ring finger`).toBeGreaterThan(0.3);
    expect(clearance, `${member.label}: thumb on top of the ring finger`).toBeLessThan(1.6);
  }
});

// ---- The photo game ----

// Park the camera dead in front of her head at a given distance, which is what
// the framing bands are expressed in terms of.
async function frameHerAt(page, metres) {
  await page.evaluate((distance) => {
    const head = window.__char.getBoneWorld('head');
    window.__char.setCameraForTest(
      { x: head.x, y: head.y, z: head.z - distance },
      { x: head.x, y: head.y, z: head.z }
    );
  }, metres);
}

async function shootOnBrief(page, brief, { pose, expression, metres }) {
  await page.evaluate((request) => window.__game.startForTest(request), brief);
  // Front light and no compensation, so these tests are about the framing and
  // the brief rather than about whatever angle the sun was left at.
  await page.evaluate(() => {
    window.__game.setSunForTest(Math.PI, 0.3);
    window.__game.setCompensationForTest(0);
  });
  await frameHerAt(page, metres);
  if (pose) await page.keyboard.down(pose);
  if (expression) await page.keyboard.down(expression);
  await page.waitForTimeout(1400); // poses, expressions and the exposure all ease in
  const shot = await page.evaluate(() => window.__game.shootForTest());
  if (pose) await page.keyboard.up(pose);
  if (expression) await page.keyboard.up(expression);
  return shot;
}

test('a shot that matches the brief scores three stars', async ({ page }) => {
  const shot = await shootOnBrief(page,
    { pose: 'peace', expression: 'happy', framing: 'medium' },
    { pose: 'KeyV', expression: 'Digit1', metres: 2.4 });

  expect(shot.score.stars).toBe(3);
  for (const part of shot.score.parts) {
    if (part.key === 'centred') continue; // scored on a curve, not pass/fail
    expect(part.ok, part.label).toBe(true);
  }
});

test('the shutter returns an actual photograph', async ({ page }) => {
  const shot = await shootOnBrief(page,
    { pose: 'peace', expression: 'happy', framing: 'medium' },
    { pose: 'KeyV', expression: 'Digit1', metres: 2.4 });
  // A JPEG of an empty canvas is a couple of KB; a rendered frame is far more.
  // This is the check that the capture happens in the same tick as the render
  // it belongs to — read a frame late and the buffer is already cleared.
  expect(shot.bytes).toBeGreaterThan(20000);
});

test('the wrong pose cannot buy stars with good framing', async ({ page }) => {
  const shot = await shootOnBrief(page,
    { pose: 'double-peace', expression: 'happy', framing: 'medium' },
    { pose: 'KeyV', expression: 'Digit1', metres: 2.4 }); // peace, not double

  expect(shot.score.parts.find((part) => part.key === 'pose').ok).toBe(false);
  expect(shot.score.parts.find((part) => part.key === 'framing').ok).toBe(true);
  expect(shot.score.stars).toBeLessThanOrEqual(1);
});

test('the framing bands tell a tight shot from a loose one', async ({ page }) => {
  const onBand = await shootOnBrief(page,
    { pose: 'peace', expression: 'happy', framing: 'medium' },
    { pose: 'KeyV', expression: 'Digit1', metres: 2.4 });
  const tooFar = await shootOnBrief(page,
    { pose: 'peace', expression: 'happy', framing: 'medium' },
    { pose: 'KeyV', expression: 'Digit1', metres: 6.0 });

  expect(onBand.score.parts.find((part) => part.key === 'framing').ok).toBe(true);
  expect(tooFar.score.parts.find((part) => part.key === 'framing').ok).toBe(false);
});

// Driven through the real buttons rather than the test hooks, because the
// thing under test here is the session flow itself: three shots, a result
// after each, and an album at the end.
test('the dance has a peak worth waiting for, and it is brief', async ({ page }) => {
  test.setTimeout(60000);
  // Stepped, not sampled off requestAnimationFrame. What is being measured is
  // the shape of the routine over a couple of seconds of its own time, and
  // tying that to rendered frames made it a measurement of the renderer
  // instead: headless falls back to software rasterising and runs at three or
  // four frames a second, so a hundred and fifty frames took the better part
  // of a minute and timed the test out. Stepping the simulation directly
  // covers exactly the intended slice, at any frame rate, in a moment.
  const samples = await page.evaluate(() => {
    const out = [];
    for (let i = 0; i < 150; i++) {
      window.__char.holdActionForTest('dance', 16);
      out.push(window.__game.reachForTest());
    }
    return out;
  });
  const state = await page.evaluate(() => window.__char.getState().animName);
  await page.evaluate(() => window.__char.releaseActionsForTest());

  expect(state).toBe('dance');
  // Hands well above her head at the peak, well below it the rest of the time.
  expect(Math.max(...samples)).toBeGreaterThan(0.2);
  expect(Math.min(...samples)).toBeLessThan(-0.2);
  // And the window is a window: if most of the routine qualified there would
  // be no moment to catch.
  const atPeak = samples.filter((reach) => reach >= 0.15).length / samples.length;
  expect(atPeak).toBeGreaterThan(0.02);
  expect(atPeak).toBeLessThan(0.25);
});

test('a burst spans the moment, and picking the right frame is what scores', async ({ page }) => {
  test.setTimeout(60000);
  await page.evaluate(() => window.__game.startForTest(
    { pose: 'dance', expression: 'happy', framing: 'medium' }
  ));
  await page.evaluate(() => {
    const head = window.__char.getBoneWorld('head');
    window.__char.setCameraForTest(
      { x: head.x, y: head.y - 0.3, z: head.z - 2.6 }, { x: head.x, y: head.y - 0.3, z: head.z }
    );
    window.__game.setSunForTest(Math.PI, 0.3);
  });
  await page.keyboard.down('KeyR');
  await page.keyboard.down('Digit1');
  await page.waitForTimeout(1200);

  // Take bursts until one of them contains the peak. The burst covers a fixed
  // slice of time, so whether it catches the peak depends on when it started —
  // which is the game, and which is also why this loops rather than asserting
  // that any one burst has it.
  let frames = [];
  for (let attempt = 0; attempt < 8 && !frames.some((f) => f.reach >= 0.15); attempt++) {
    frames = await page.evaluate(() => window.__game.burstForTest());
    if (!frames.some((f) => f.reach >= 0.15)) {
      await page.evaluate(() => window.__game.startForTest(window.__game.getRequest()));
      await page.waitForTimeout(150);
    }
  }
  expect(frames.length, 'frames in a burst').toBeGreaterThan(1);
  const best = frames.reduce((a, b) => (a.reach > b.reach ? a : b));
  const worst = frames.reduce((a, b) => (a.reach < b.reach ? a : b));
  expect(best.reach, 'a burst that caught the peak').toBeGreaterThanOrEqual(0.15);

  const kept = await page.evaluate((index) => window.__game.pickForTest(index), best.index);
  const moment = (score) => score.parts.find((part) => part.key === 'moment');
  expect(moment(kept.score).ok, 'the frame at the peak').toBe(true);

  // The same burst, judged on its worst frame, does not score the moment.
  await page.evaluate(() => window.__game.startForTest(window.__game.getRequest()));
  const again = await page.evaluate(() => window.__game.burstForTest());
  if (again.some((f) => f.reach < 0.05)) {
    const low = again.reduce((a, b) => (a.reach < b.reach ? a : b));
    const missed = await page.evaluate((index) => window.__game.pickForTest(index), low.index);
    expect(moment(missed.score).ok, 'a frame away from the peak').toBe(false);
  }
  await page.keyboard.up('KeyR');
  await page.keyboard.up('Digit1');
  expect(worst.reach).toBeLessThan(best.reach);
});

// Park the camera in front of her with the sun at a known angle behind the
// subject or behind the camera, and let the auto exposure settle.
async function lightHerAt(page, degrees, stops) {
  await page.evaluate(([angle, ev]) => {
    const head = window.__char.getBoneWorld('head');
    window.__char.setCameraForTest(
      { x: head.x, y: head.y, z: head.z - 2.2 }, { x: head.x, y: head.y, z: head.z }
    );
    window.__game.setSunForTest(Math.PI - angle * Math.PI / 180, 0.3);
    window.__game.setCompensationForTest(ev);
  }, [degrees, stops]);
  await settleExposure(page);
}

// The auto exposure is a first-order chase with a quarter-second time
// constant, but it only steps when a frame renders. Headless renders a few
// times a second, so "wait 1.4 seconds" is about five steps and the reading
// lands somewhere on the way down -- which is how the whole measured light
// table came to be wrong. Wait for it to stop moving instead.
async function settleExposure(page) {
  // Three consecutive quiet samples, not one. A single small delta happens on
  // any plateau on the way down, and taking it as "settled" is worth about
  // 0.03 of face luma -- which is the same size as the effects these tests
  // measure, and is why a threshold here kept flipping between runs.
  let previous = null;
  let quiet = 0;
  for (let i = 0; i < 120; i++) {
    const auto = (await page.evaluate(() => window.__game.getExposureForTest())).auto;
    if (previous !== null && Math.abs(auto - previous) < 0.003) {
      if (++quiet >= 3) return;
    } else {
      quiet = 0;
    }
    previous = auto;
    await page.waitForTimeout(200);
  }
}

// The median of three frames. One frame's face luma carries the noise of
// whatever the renderer happened to finish; the median of three does not.
async function shootSteady(page) {
  const shots = [];
  for (let i = 0; i < 3; i++) {
    shots.push(await page.evaluate(() => window.__game.shootForTest()));
    await page.waitForTimeout(120);
  }
  shots.sort((a, b) => a.faceLuma - b.faceLuma);
  return shots[1];
}

test('shooting into the sun darkens her face, and compensation is the fix', async ({ page }) => {
  test.setTimeout(90000);
  // On the street: the park is full of dark trees either way, so the meter
  // opens up to match and turning round costs almost nothing there.
  await page.evaluate(() => window.__game.setCharacterForTest('b'));
  await page.waitForFunction(() => window.__char.ready);
  await page.evaluate(() => window.__char.setSceneForTest('street', 'noon'));
  await page.evaluate(() => window.__game.startForTest(
    { pose: 'idle', expression: 'happy', framing: 'medium' }
  ));

  await lightHerAt(page, 0, 0);          // sun behind the camera
  const frontLit = await shootSteady(page);
  await lightHerAt(page, 180, 0);        // shooting into it
  const backLit = await shootSteady(page);
  await lightHerAt(page, 180, 1 / 3);    // ...and lifted a third of a stop
  const lifted = await shootSteady(page);

  // The angle is reported the way a photographer means it.
  expect(frontLit.lightAngle).toBeLessThan(20);
  expect(backLit.lightAngle).toBeGreaterThan(160);

  // The direction of the effect, and that the slider is the lever. Both of
  // these hold. Where the numbers land relative to the scoring band does not
  // -- see the fixme below for why, and for the measurements.
  expect(backLit.faceLuma).toBeLessThan(frontLit.faceLuma);
  expect(lifted.faceLuma).toBeGreaterThan(backLit.faceLuma + 0.07);
  const brightness = (shot) => shot.score.parts.find((part) => part.key === 'brightness').ok;
  expect(brightness(frontLit), `front lit ${frontLit.faceLuma.toFixed(3)}`).toBe(true);
});

// Turning round has to be able to cost you the shot. It cannot, yet.
//
// This assertion used to pass, and it was passing on a measurement that had
// not finished: the settle helper returned on a single quiet sample, and a
// slow headless renderer plateaus on the way down. Four runs of the same
// configuration gave 0.436, 0.464, 0.575, 0.609. With the meter actually
// converged, a backlit face on the street sits at about 0.61 -- the middle of
// the 0.46-0.74 band. The lesson was never working; the test was reading the
// exposure before it arrived.
//
// Why it does not work, established by measurement rather than by guessing:
//
//  - MToon is built to light a face evenly from any direction. With the stock
//    values her face measured 0.762 front lit against 0.772 backlit. The shade
//    term is already pulled back once (SHADE_DARKEN in main.js).
//  - Pulling it back further does buy something, monotonically. Converged,
//    on the street, front / backlit / backlit +1/3 stop:
//        darken 0.62   a .753 .714 .886   b .616 .571 .733   c .699 .645 .799
//        darken 0.40   a .709 .616 .788   b .563 .485 .626   c .647 .546 .699
//        darken 0.25   a .662 .530 .681   b .533 .411 .534   c .610 .461 .596
//        darken 0.10   a .604 .415 .535   b .488 .310 .409   c .569 .350 .454
//    but no value works for the whole cast. The three characters' faces are
//    spread by 0.10-0.13, which is as large as the backlight penalty itself,
//    so the window where backlit fails an absolute band and a third of a stop
//    recovers it closes before it opens: by 0.16 A's backlit face is finally
//    out of the band, and by 0.16 a third of a stop no longer brings B's back.
//  - Pushed to the extreme -- shade black, terminator all the way over -- her
//    face goes cold and grey with no terminator on it at all. It is lit by the
//    green bounce off the grass. That is the finding: at these angles the
//    hemisphere fill is doing nearly all the modelling, and a hemisphere light
//    has no direction, so no shader setting can make the sun's position
//    matter.
//
// The fix is therefore in the scene lighting, not the character shader:
// less ambient fill relative to the sun. That changes the look of every place
// at every hour and re-opens every luma figure in this file, and it is a
// direction-of-the-art decision rather than a bug, so it is not being made
// here. Two things go with it when it is: the brightness band wants to be
// per-character rather than absolute, and the face wants headroom so the lit
// side stops clipping.
test.fixme('backlighting costs her the shot', async ({ page }) => {
  test.setTimeout(90000);
  await page.evaluate(() => window.__game.setCharacterForTest('b'));
  await page.waitForFunction(() => window.__char.ready);
  await page.evaluate(() => window.__char.setSceneForTest('street', 'noon'));
  await page.evaluate(() => window.__game.startForTest(
    { pose: 'idle', expression: 'happy', framing: 'medium' }
  ));
  await lightHerAt(page, 180, 0);
  const backLit = await shootSteady(page);
  await lightHerAt(page, 180, 1 / 3);
  const lifted = await shootSteady(page);
  const ok = (shot) => shot.score.parts.find((part) => part.key === 'brightness').ok;
  expect(ok(backLit), `backlit ${backLit.faceLuma.toFixed(3)}`).toBe(false);
  expect(ok(lifted), `backlit +1/3 ${lifted.faceLuma.toFixed(3)}`).toBe(true);
});

test('exposure compensation survives the auto exposure rather than being cancelled by it', async ({ page }) => {
  // Two settles, and a settle is a poll loop against a renderer running at a
  // few frames a second. That does not fit in the default twenty seconds.
  test.setTimeout(90000);
  // Written the other way round first, where compensation multiplied the auto
  // exposure's output: the meter simply pulled the brighter frame back down and
  // two stops bought about half of one.
  await lightHerAt(page, 90, 0);
  const plain = await page.evaluate(() => window.__game.getExposureForTest());
  await lightHerAt(page, 90, 1);
  const lifted = await page.evaluate(() => window.__game.getExposureForTest());

  expect(lifted.auto / plain.auto).toBeGreaterThan(1.7);
});

test('starting a session hands pose and expression to her; manual keys stop working', async ({ page }) => {
  test.setTimeout(30000);
  await page.getByRole('button', { name: '撮影を始める' }).click();
  expect(await page.evaluate(() => window.__game.getPhase())).toBe('shooting');

  // Hold the manual "wave" and "happy" keys down for the whole sample window.
  // If the keys still worked, that would pin her to wave/happy for the entire
  // window; if they are ignored, the director keeps changing things under the
  // held keys regardless. Variety over the window is the proof either way,
  // and it sidesteps the coincidence risk of checking a single instant against
  // a single expected value.
  await page.keyboard.down('KeyE');
  await page.keyboard.down('Digit1');
  const poses = new Set();
  for (let i = 0; i < 20; i++) {
    poses.add(await page.evaluate(() => window.__char.getState().animName));
    await page.waitForTimeout(350);   // ~7s total; the shortest hold is 1.4s
  }
  await page.keyboard.up('KeyE');
  await page.keyboard.up('Digit1');

  expect(poses.size, `poses observed while KeyE was held: ${[...poses].join(', ')}`).toBeGreaterThan(1);
});

test('the director can be switched off, which gives manual control back', async ({ page }) => {
  await page.evaluate(() => window.__game.setDirectorForTest(true));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__game.setDirectorForTest(false));

  await page.keyboard.down('KeyV');
  await page.waitForTimeout(400);
  const state = await page.evaluate(() => window.__char.getState().animName);
  await page.keyboard.up('KeyV');

  expect(state).toBe('peace');
});

// The shutter is a press-and-hold: a quick tap is one frame, holding it keeps
// shooting until release. Playwright's click() is too fast to ever become a
// burst, which is the point -- these two helpers are the two gestures.
// Headless Chromium can go several hundred milliseconds without running a
// single animation frame right after a screen changes, and a burst captures
// one frame per rendered frame -- so a hold started into a stall collects
// nothing. Waiting for the loop to actually be turning first makes the
// measurement about the gesture rather than about the harness.
async function warmFrames(page, count = 4) {
  await page.evaluate((n) => new Promise((resolve) => {
    let left = n;
    const spin = () => (left-- > 0 ? requestAnimationFrame(spin) : resolve());
    requestAnimationFrame(spin);
  }), count);
}

async function pressShutter(page, ms) {
  await warmFrames(page);
  const box = await page.locator('.pg-shutter').boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

const tapShutter = (page) => pressShutter(page, 60);
const holdShutter = (page, ms) => pressShutter(page, ms);

test('a session runs three shots and ends in an album', async ({ page }) => {
  // Three photographs, taken the ordinary way: a tap each. There is no picker
  // in this path at all now -- one frame has nothing to choose between, and a
  // review screen with a single option on it was most of what made the old
  // always-burst flow tiring.
  test.setTimeout(90000);
  await page.getByRole('button', { name: '撮影を始める' }).click();
  expect(await page.evaluate(() => window.__game.getPhase())).toBe('shooting');

  for (let shot = 1; shot <= 3; shot++) {
    await tapShutter(page);
    await expect(page.locator('.pg-stars')).toBeVisible({ timeout: 10000 });
    expect(await page.evaluate(() => window.__game.getShots())).toHaveLength(shot);
    await page.locator('.pg-card .pg-button').first().click();
  }

  expect(await page.evaluate(() => window.__game.getPhase())).toBe('album');
  await expect(page.locator('.pg-album img')).toHaveCount(3);
});

test('the brief covers every framing band and never asks for the >_< face', async ({ page }) => {
  test.setTimeout(40000);
  // Two guards in one loop, because each round trip to the page costs real
  // time and forty of them twice over runs past the test timeout on its own.
  //
  // Close-up: briefly removed by mistake -- the thing that did not survive a
  // tight frame was the '>_<' expression, not the frame. It is back.
  // '>_<': it replaces her eyes with a drawn squeeze, so it is not something
  // a photograph is judged on. It stays on the 6 key for free play.
  const framings = new Set();
  const expressions = new Set();
  for (let i = 0; i < 24; i++) {
    const request = await page.evaluate(() => {
      window.__game.startForTest();
      return window.__game.getRequest();
    });
    framings.add(request.framing);
    expressions.add(request.expression);
  }
  expect([...framings].sort()).toEqual(['close', 'medium', 'wide']);
  expect(expressions.has('Extra')).toBe(false);

  // And no scenario peak wears it either, which is the other way it could
  // reach a brief now that briefs are written from peaks.
  const peaks = await page.evaluate(() => window.__char.scenarioPeaksForTest());
  expect(peaks.some((peak) => peak.expression === 'Extra')).toBe(false);
});

test('the brief\'s exact pose and expression are guaranteed to happen soon, not left to coincidence', async ({ page }) => {
  test.setTimeout(90000);
  await page.getByRole('button', { name: '撮影を始める' }).click();
  const request = await page.evaluate(() => window.__game.getRequest());

  // The brief is written from the peak of the story she is about to perform
  // (main.js: startScenario), so the pair is not a coincidence of two
  // independent cycles -- it is a beat two or three into a scripted sequence.
  // A fresh session used to be able to run for many pose/expression cycles
  // without the requested pair ever lining up.
  let matched = false;
  for (let i = 0; i < 90 && !matched; i++) {
    const state = await page.evaluate(() => window.__char.getState());
    if (state.animName === request.pose && state.expression === request.expression
      && state.expressionWeight >= 0.6) {
      matched = true;
    }
    // A peak is two or three beats into a story, so about ten seconds of its
    // own time -- which is twice that in wall clock when headless is only
    // managing a few frames a second.
    await page.waitForTimeout(300);
  }
  expect(matched, `looking for pose=${request.pose} expression=${request.expression}`).toBe(true);
});

// Watch one scenario from its first beat to its last, sampling as fast as the
// round trip allows, and assert on the record afterwards. Two separate loops
// -- one per thing being checked -- do not work here: a full story runs about
// twenty seconds, and the second loop starts wherever the first one stopped.
async function traceScenario(page, key, seconds) {
  await page.evaluate((name) => window.__char.startScenarioForTest(name), key);
  const trace = [];
  const until = Date.now() + seconds * 1000;
  while (Date.now() < until) {
    const frame = await page.evaluate(() => {
      const scenario = window.__char.getScenarioForTest();
      const state = window.__char.getState();
      return {
        key: scenario && scenario.key,
        beat: scenario && scenario.beatIndex,
        pose: state.animName,
        expression: state.expressionWeight >= 0.6 ? state.expression : null,
        wind: window.__char.getWeatherForTest().wind,
        rain: window.__char.getWeatherForTest().rain,
        bird: window.__char.getBirdStateForTest().state,
        owner: window.__char.getBirdStateForTest().owner,
        birdX: window.__char.getBirdStateForTest().position.x,
        birdZ: window.__char.getBirdStateForTest().position.z,
      };
    });
    // Stop *before* recording, not after: one story runs straight into the
    // next, so a frame sampled a moment late belongs to a later run and would
    // show up as the beat counter going backwards. Checking the beat index as
    // well as the key matters because the next story drawn can be this one
    // again.
    const previous = trace[trace.length - 1];
    if (frame.key !== key) break;
    if (previous && frame.beat < previous.beat) break;
    trace.push(frame);
    await page.waitForTimeout(150);
  }
  return trace;
}

test('the bird is an episode, not a fixture', async ({ page }) => {
  // It used to potter about two metres away the whole time, session or no
  // session. A bird that is always there is not an event -- it is furniture,
  // and its arrival stops being the telegraph the stories rely on. So: off
  // stage in free play, and on stage only for the stories that are about it.
  test.setTimeout(60000);

  const idle = [];
  const until = Date.now() + 6000;
  while (Date.now() < until) {
    idle.push(await page.evaluate(() => window.__char.getBirdStateForTest().visible));
    await page.waitForTimeout(200);
  }
  expect(idle.some(Boolean), 'no bird with nothing going on').toBe(false);

  // And during its own story it is out and alive: it flies, it lands, and it
  // hops about between beats rather than freezing where it touched down.
  const trace = await traceScenario(page, 'bird-on-the-ground', 26);
  expect(trace.some((f) => f.bird === 'flying'), 'it flew').toBe(true);
  expect(trace.some((f) => f.bird === 'settled'), 'it landed').toBe(true);
  expect(trace.some((f) => f.owner === 'story'), 'its own story had hold of it').toBe(true);
});

test('the bird takes its time crossing the ground', async ({ page }) => {
  // The first pass had it covering three metres in under a second, which does
  // not read as flying. Timed off the rig: from the cue that sends it to her
  // hand to the frame it is perched, it should take a couple of seconds --
  // long enough that you can see it coming, which is the whole point.
  test.setTimeout(60000);
  await page.evaluate(() => window.__char.startScenarioForTest('bird-to-hand'));

  let launched = null;
  let landed = null;
  const until = Date.now() + 30000;
  while (Date.now() < until && landed === null) {
    const bird = await page.evaluate(() => window.__char.getBirdStateForTest());
    if (bird.anchor === 'hand') {
      if (bird.state === 'flying' && launched === null) launched = Date.now();
      if (bird.state === 'settled' && launched !== null) landed = Date.now();
    }
    await page.waitForTimeout(100);
  }
  expect(launched, 'it set off for her hand').not.toBeNull();
  expect(landed, 'it got there').not.toBeNull();
  expect((landed - launched) / 1000).toBeGreaterThan(1.4);
});

test('the bird causes her reaction rather than accompanying it', async ({ page }) => {
  // The first version of the bird was explicitly decoupled from what she was
  // doing -- a generic "something is about to happen" tell that flew in on a
  // timer while a shuffle bag picked her pose. That is the opposite of a
  // story. Now the bird only appears in the scenarios that are about it, and
  // in those the landing comes before the beat it motivates.
  // The whole story is around fourteen seconds of simulated time, and
  // headless runs at roughly half wall-clock, so the window has to cover the
  // sad beat at the end rather than only the landing at the start.
  test.setTimeout(90000);
  const trace = await traceScenario(page, 'bird-to-hand', 48);

  expect(trace.some((f) => f.bird === 'flying'), 'the bird flew in').toBe(true);
  expect(trace.some((f) => f.owner === 'story'), 'the story had hold of it').toBe(true);
  // Perched on her hand while she is delighted at it -- the cause and the
  // reaction in the same frame.
  expect(
    trace.some((f) => f.bird === 'settled' && f.pose === 'reach-out' && f.expression === 'happy'),
    'it was perched while she was delighted at it',
  ).toBe(true);
  // And the sad beat comes after it has gone, not at some unrelated moment.
  const left = trace.findIndex((f) => f.bird === 'settled');
  const sad = trace.findIndex((f) => f.expression === 'sad');
  expect(sad, 'she was sad at some point').toBeGreaterThan(-1);
  expect(sad, 'the sadness came after the bird had been and gone').toBeGreaterThan(left);
  // Leaving, not necessarily gone. The departure takes a second and a half
  // now that the bird moves at a believable speed, and she starts watching it
  // go while it is still going -- which is the beat, so the assertion is that
  // it is no longer sitting on her, not that it has vanished.
  expect(trace[sad].bird, 'it was not still perched on her').not.toBe('settled');
  expect(trace.some((f) => f.bird === 'offstage'), 'it did leave').toBe(true);
});

test('every scenario peak is a pair a brief could sensibly ask for', async ({ page }) => {
  // The complaint this answers: a double peace sign worn with a sad face.
  // Briefs are now written from scenario peaks, so the guard is on the peaks
  // themselves -- each one has to name a real pose, a real expression, and a
  // line of Japanese saying what is happening.
  const peaks = await page.evaluate(() => window.__char.scenarioPeaksForTest());
  expect(peaks.length).toBeGreaterThanOrEqual(8);
  const poses = new Set();
  for (const peak of peaks) {
    expect(typeof peak.pose).toBe('string');
    expect(typeof peak.expression).toBe('string');
    expect(peak.story, `${peak.key} has no story line`).toBeTruthy();
    poses.add(peak.pose);
  }
  // Not every peak is the same pose in a different hat.
  expect(poses.size).toBeGreaterThanOrEqual(5);
  // The exercise squat has no reason to happen in a photoshoot.
  expect(poses.has('crouch')).toBe(false);
});

test('a scenario runs its beats in order rather than cutting at random', async ({ page }) => {
  test.setTimeout(60000);
  const trace = await traceScenario(page, 'posing-for-you', 30);
  const beats = [];
  for (const frame of trace) {
    if (beats[beats.length - 1] !== frame.beat) beats.push(frame.beat);
  }
  expect(beats).toEqual([0, 1, 2, 3]);

  // Each beat is one pose held for a while, not a pose per frame.
  const poses = [];
  for (const frame of trace) {
    if (poses[poses.length - 1] !== frame.pose) poses.push(frame.pose);
  }
  expect(poses).toEqual(['idle', 'wave', 'peace', 'idle']);
});

test('how long you hold the shutter is how long it shoots', async ({ page }) => {
  // How long you hold it is how long it shoots. That used to be a number
  // chosen from a menu before the session began, which is a decision nobody
  // can make before they know what they are about to photograph.
  test.setTimeout(60000);
  await page.getByRole('button', { name: '撮影を始める' }).click();

  // Both holds are long by the standards of a thumb. Headless renders in
  // fits, and a burst can only capture frames that were actually drawn, so a
  // realistic half-second press collects two or three frames here and none at
  // all if it lands in a stall. The relationship being checked -- longer hold,
  // more frames -- is the same either way.
  await holdShutter(page, 1800);
  await expect(page.locator('.pg-frame').first()).toBeVisible({ timeout: 10000 });
  const shortHold = await page.locator('.pg-frame').count();
  expect(shortHold).toBeGreaterThan(1);

  await page.getByRole('button', { name: '撮り直す' }).click();
  await holdShutter(page, 3600);
  await expect(page.locator('.pg-frame').first()).toBeVisible({ timeout: 10000 });
  const longHold = await page.locator('.pg-frame').count();
  // Not a fixed ratio: a frame needs an actual render between captures, so a
  // slow renderer comes in under the nominal rate either way. What has to hold
  // is that holding longer gets you more of them, and that leaning on the
  // button cannot fill memory without bound.
  expect(longHold).toBeGreaterThan(shortHold);
  expect(longHold).toBeLessThanOrEqual(48);
});

test('a tap is one photograph and skips the picker entirely', async ({ page }) => {
  test.setTimeout(60000);
  await page.getByRole('button', { name: '撮影を始める' }).click();
  await tapShutter(page);
  await expect(page.locator('.pg-stars')).toBeVisible({ timeout: 10000 });
  expect(await page.locator('.pg-frame').count()).toBe(0);
  expect(await page.evaluate(() => window.__game.getPhase())).toBe('result');
  expect(await page.evaluate(() => window.__game.getShots())).toHaveLength(1);
});

test('retaking a burst discards it without spending a shot', async ({ page }) => {
  // Two full bursts captured over real time, back to back, on top of the
  // model load. 30s was not enough for that on a loaded machine.
  test.setTimeout(60000);
  await page.getByRole('button', { name: '撮影を始める' }).click();
  await holdShutter(page, 2500);
  await expect(page.locator('.pg-frame').first()).toBeVisible({ timeout: 10000 });

  await page.getByRole('button', { name: '撮り直す' }).click();
  expect(await page.evaluate(() => window.__game.getPhase())).toBe('shooting');
  expect(await page.evaluate(() => window.__game.getShots())).toHaveLength(0);

  // A second attempt still completes normally.
  await holdShutter(page, 2500);
  await expect(page.locator('.pg-frame').first()).toBeVisible({ timeout: 10000 });
  await page.locator('.pg-frame').first().click();
  await page.locator('.pg-use').click();
  await expect(page.locator('.pg-stars')).toBeVisible();
  expect(await page.evaluate(() => window.__game.getShots())).toHaveLength(1);
});

test.describe('wardrobe', () => {
  test('every outfit goes on, and none of them undresses her', async ({ page }) => {
    test.setTimeout(60000);
    const outfits = await page.evaluate(() => window.__char.listOutfitsForTest());
    expect(outfits.length).toBeGreaterThan(4);

    for (const outfit of outfits) {
      const state = await page.evaluate((key) => {
        window.__char.setOutfitForTest(key);
        return window.__char.wardrobeStateForTest();
      }, outfit.key);
      expect(state.outfit, `${outfit.label} goes on`).toBe(outfit.key);

      // The one that matters: whatever came off was replaced in kind. There
      // are two ways to replace it and an outfit may use either. Swimwear
      // paints the layer underneath, into the body texture where the camisole
      // was. The uniforms hide the model's own top and skirt and wear built
      // ones -- which is the only way a sailor collar can work, since laid
      // over the avatar's own clothes it is variously swallowed by a cardigan,
      // buried under waist-length hair, or poking through a puffer as a lump.
      //
      // Read off what the renderer is actually holding, not off the outfit
      // table, and checked for every outfit. This is not a wrong colour; it is
      // the failure that must not happen.
      const topOff = state.visible.Tops === false;
      const bottomOff = state.visible.Bottoms === false;
      const covered = state.bodyPainted
        || ((!topOff || state.pieces.includes('blouse'))
          && (!bottomOff || state.pieces.includes('skirt')));
      expect(covered, `${outfit.label}: tops ${state.visible.Tops}, `
        + `bottoms ${state.visible.Bottoms}, painted ${state.bodyPainted}, `
        + `pieces [${state.pieces}]`).toBe(true);
    }
  });

  test('the garments that are shapes are built, not painted', async ({ page }) => {
    test.setTimeout(45000);
    // A pleated skirt and a sailor collar cannot be produced by recolouring a
    // cardigan, so the outfits that call for them have to be carrying real
    // geometry. Checking the pieces are there is what stops the wardrobe
    // quietly regressing to a set of colourways.
    const sailor = await page.evaluate(() => {
      window.__char.setOutfitForTest('sailor');
      return window.__char.wardrobeStateForTest();
    });
    expect(sailor.pieces).toContain('collar');
    expect(sailor.pieces).toContain('skirt');
    // And the model's own shorts are off, or she is wearing both.
    expect(sailor.visible.Bottoms).toBe(false);

    const plain = await page.evaluate(() => {
      window.__char.setOutfitForTest('original');
      return window.__char.wardrobeStateForTest();
    });
    expect(plain.pieces).toEqual([]);
    expect(plain.visible.Tops).toBe(true);
    expect(plain.visible.Bottoms).toBe(true);
  });

  test('changing who is on stage keeps the costume', async ({ page }) => {
    test.setTimeout(60000);
    // The three of them start in different clothes, so an outfit cannot be
    // carried across as pixels -- it has to be rebuilt against the new model's
    // own textures. Easy to get wrong in a way that only shows on the swap.
    await page.evaluate(() => window.__char.setOutfitForTest('bikini'));
    for (const who of ['b', 'a']) {
      const state = await page.evaluate(async (key) => {
        window.__game.setCharacterForTest(key);
        return window.__char.wardrobeStateForTest();
      }, who);
      expect(state.outfit, `still in the bikini as ${who}`).toBe('bikini');
      expect(state.bodyPainted, `body repainted for ${who}`).toBe(true);
    }
  });
});

test.describe('places and weather', () => {
  test('every place builds, and swapping leaves one of them behind', async ({ page }) => {
    const scenes = await page.evaluate(() => window.__char.listScenesForTest());
    expect(scenes.length).toBeGreaterThanOrEqual(3);
    for (const scene of scenes) {
      const applied = await page.evaluate((key) => window.__char.setSceneForTest(key), scene.key);
      expect(applied).toBe(scene.key);
      // A scene swap that leaks the old geometry shows up here long before it
      // shows up as a frame rate.
      const counts = await page.evaluate(() => window.__char.sceneryCountForTest());
      expect(counts.groups, `${scene.key} left more than one scenery group`).toBe(1);
      expect(counts.meshes, `${scene.key} built nothing`).toBeGreaterThan(20);
    }
  });

  test('everything is the size the real thing is', async ({ page }) => {
    // The whole set was built by eye and came out a model village: conifers
    // 3.8m tall standing over a 1.6m person, four-metre palms, five-metre
    // buildings, beach rocks bigger than she is, and distant "hills" two
    // metres high. None of it looked wrong on its own -- scale errors only
    // show up in comparison, which is exactly what a person cannot do by
    // squinting and what a test can do exactly.
    //
    // Ranges are real-world figures, deliberately generous. This is a guard
    // against another order-of-magnitude drift, not a spec for the art.
    const person = await page.evaluate(() => window.__char.characterSizeForTest());
    expect(person.height).toBeGreaterThan(1.4);
    expect(person.height).toBeLessThan(1.9);

    const bird = await page.evaluate(() => window.__char.birdSizeForTest());
    expect(bird.length, 'a sparrow is about 14cm').toBeGreaterThan(0.10);
    expect(bird.length).toBeLessThan(0.20);

    const umbrella = await page.evaluate(() => window.__char.umbrellaSizeForTest());
    expect(umbrella.span).toBeGreaterThan(0.7);
    expect(umbrella.span).toBeLessThan(1.3);

    const EXPECTED = {
      park: {
        tree: [7, 20], broadleaf: [5, 12], bench: [0.8, 1.2], shrub: [0.4, 1.8],
        'park lamp': [2.5, 4.5],
      },
      beach: { palm: [6, 14] },
      street: {
        building: [7, 18], 'street lamp': [3.5, 6.5], broadleaf: [4, 9],
        'vending machine': [1.6, 2.1], 'power lines': [8, 13],
      },
    };
    for (const [scene, wanted] of Object.entries(EXPECTED)) {
      const props = await page.evaluate((key) => {
        window.__char.setSceneForTest(key, 'noon');
        return window.__char.propSizesForTest();
      }, scene);
      for (const [name, [low, high]] of Object.entries(wanted)) {
        const prop = props.find((entry) => entry.name === name);
        expect(prop, `${scene} has a ${name}`).toBeTruthy();
        expect(prop.h, `${scene} ${name} is ${prop.h.toFixed(2)}m tall`).toBeGreaterThan(low);
        expect(prop.h, `${scene} ${name} is ${prop.h.toFixed(2)}m tall`).toBeLessThan(high);
      }
    }

    // Distance is a size too. A hill is only a hill because it is far away and
    // subtends a few degrees; the same mesh parked at fifty metres is a fence
    // panel, and that is what the park's horizon used to be.
    for (const scene of ['park', 'beach']) {
      const hills = await page.evaluate((key) => {
        window.__char.setSceneForTest(key, 'noon');
        return window.__char.propPositionsForTest('hill').map((h) => Math.hypot(h.x, h.z));
      }, scene);
      expect(hills.length, `${scene} has hills`).toBeGreaterThan(3);
      expect(Math.min(...hills), `${scene}'s nearest hill`).toBeGreaterThan(400);
    }
  });

  test('she is photographed from eye height, with the horizon in the frame', async ({ page }) => {
    // The scale complaint that started the audit above turned out not to be
    // about any object's size at all -- measured side on against a metre
    // ruler, the benches and lamps and trees were right. It was the vantage
    // point. The camera opened at 2.6m looking down at a 1.59m subject, and a
    // twenty-degree downward tilt is the classic miniature cue: it pushes the
    // horizon out of the top of the frame, so there is no sky, nothing
    // full-size to measure the set against, and a correctly-built park reads
    // as a tabletop model.
    //
    // So this guards the two things that were actually wrong, and neither is
    // a property of any prop: where the camera stands, and whether the world
    // goes back far enough to have a horizon in the picture.
    const person = await page.evaluate(() => window.__char.characterSizeForTest());
    const camera = await page.evaluate(() => window.__char.getCameraPosition());
    expect(camera.y, 'the camera is not above her head').toBeLessThan(person.headTop);
    expect(camera.y, 'nor down at her ankles').toBeGreaterThan(0.9);

    const view = await page.evaluate(() => ({
      horizon: window.__char.projectForTest({ x: 0, y: window.__char.getCameraPosition().y, z: 2000 }),
      height: window.innerHeight,
    }));
    expect(view.horizon.y, 'the horizon is inside the frame').toBeGreaterThan(0);
    expect(view.horizon.y).toBeLessThan(view.height);
    // And in the upper half of it, which is what leaves room for sky.
    expect(view.horizon.y).toBeLessThan(view.height * 0.55);
  });

  test('every place works at every hour', async ({ page }) => {
    test.setTimeout(60000);
    const scenes = await page.evaluate(() => window.__char.listScenesForTest());
    const times = await page.evaluate(() => window.__char.listTimesForTest());
    expect(times.map((t) => t.key)).toEqual(['morning', 'noon', 'golden', 'night']);

    for (const scene of scenes) {
      for (const time of times) {
        const env = await page.evaluate(([s, t]) => {
          window.__char.setSceneForTest(s, t);
          return window.__char.getEnvForTest();
        }, [scene.key, time.key]);
        expect(env, `${scene.key} at ${time.key}`).not.toBeNull();
        expect(env.night).toBe(time.key === 'night');
        // The sun is somewhere a photographer could work with, not on the deck
        // and not overhead.
        expect(env.sunElevation[0]).toBeGreaterThan(0);
        expect(env.sunElevation[1]).toBeLessThan(1.2);
        expect(env.sunElevation[1]).toBeGreaterThanOrEqual(env.sunElevation[0]);
      }
    }
  });

  test('night is dark enough to be a problem, and lit enough to solve', async ({ page }) => {
    // The point of night is that the camera runs out of room: the meter is
    // pinned at its ceiling, so the compensation slider cannot rescue a face
    // standing in the dark and the answer is to move her under a light.
    // Both halves are measured off the rendered pixels, not asserted by feel.
    test.setTimeout(90000);
    await page.evaluate(() => window.__char.setSceneForTest('street', 'night'));
    await page.evaluate(() => window.__game.setSunForTest(2.4, 0.5));
    await page.evaluate(() => window.__game.startForTest());

    const nightEnv = await page.evaluate(() => window.__char.getEnvForTest());
    expect(nightEnv.nightLights, 'the street has lights after dark').toBeGreaterThan(0);
    expect(nightEnv.litWindows, 'and lit windows').toBeGreaterThan(10);

    const faceAt = async (x, z) => {
      await page.evaluate(([px, pz]) => window.__char.placeForTest(px, pz), [x, z]);
      await page.waitForTimeout(1200);
      return (await page.evaluate(() => window.__game.shootForTest())).faceLuma;
    };

    const inTheOpen = await faceAt(0, 0);
    const byTheLight = await faceAt(-4.6, -1.6);
    expect(inTheOpen, 'in the middle of the road she is under-exposed').toBeLessThan(0.43);
    expect(byTheLight, 'beside the vending machine she is not').toBeGreaterThan(0.43);
    expect(byTheLight).toBeLessThan(0.95);

    // And the slider genuinely cannot fix the dark spot -- that is the lesson,
    // so it needs to be true rather than merely intended.
    await page.evaluate(() => window.__game.setCompensationForTest(2));
    const lifted = await faceAt(0, 0);
    await page.evaluate(() => window.__game.setCompensationForTest(0));
    expect(lifted, '+2 stops does not rescue it').toBeLessThan(0.43);
  });

  test('daylight is not clamped the way night is', async ({ page }) => {
    // The ceiling that makes night hard must not be quietly making daytime
    // backlight impossible too.
    await page.evaluate(() => window.__char.setSceneForTest('park', 'noon'));
    await page.evaluate(() => window.__game.setSunForTest(2.4, 0.6));
    await page.evaluate(() => window.__game.startForTest());
    await page.waitForTimeout(1500);
    const shot = await page.evaluate(() => window.__game.shootForTest());
    expect(shot.faceLuma).toBeGreaterThan(0.3);
  });

  test('weather builds and dies away rather than switching on', async ({ page }) => {
    test.setTimeout(60000);
    // A cue sets a target; the ramp is what the beat before a gust is the
    // beat before. If it snapped there would be nothing to anticipate.
    await page.evaluate(() => window.__char.setWeatherForTest(1, 0));
    const early = await page.evaluate(() => window.__char.getWeatherForTest());
    expect(early.windTarget).toBe(1);
    expect(early.wind).toBeLessThan(0.9);

    // Generous waits rather than loose thresholds. Headless Chromium runs the
    // animation loop well under real time, so simulated seconds arrive at
    // roughly half wall-clock speed; the numbers being asserted are the real
    // ones, it just takes longer to get there.
    await page.waitForTimeout(9000);
    const settled = await page.evaluate(() => window.__char.getWeatherForTest());
    expect(settled.wind).toBeGreaterThan(0.85);

    await page.evaluate(() => window.__char.setWeatherForTest(0, 0));
    await page.waitForTimeout(9000);
    expect((await page.evaluate(() => window.__char.getWeatherForTest())).wind).toBeLessThan(0.15);
  });

  test('the umbrella is only out when she is holding it', async ({ page }) => {
    expect((await page.evaluate(() => window.__char.getWeatherForTest())).umbrellaVisible).toBe(false);
    await page.evaluate(() => window.__char.holdActionForTest('umbrella', 1500));
    await page.waitForTimeout(500);
    const up = await page.evaluate(() => window.__char.getWeatherForTest());
    expect(up.umbrellaVisible).toBe(true);
    expect(up.umbrella).toBeGreaterThan(0.7);

    await page.evaluate(() => window.__char.releaseActionsForTest());
    await page.waitForTimeout(3500);
    expect((await page.evaluate(() => window.__char.getWeatherForTest())).umbrellaVisible).toBe(false);
  });

  test('the rain story brings the weather with it and takes it away again', async ({ page }) => {
    test.setTimeout(60000);
    const trace = await traceScenario(page, 'caught-in-the-rain', 26);
    expect(trace.some((f) => f.rain > 0.5), 'it rained').toBe(true);
    expect(trace.some((f) => f.pose === 'umbrella'), 'she put an umbrella up').toBe(true);
    // The umbrella beat comes after it is actually raining, not before.
    const firstRain = trace.findIndex((f) => f.rain > 0.3);
    const firstUmbrella = trace.findIndex((f) => f.pose === 'umbrella');
    expect(firstRain).toBeGreaterThan(-1);
    expect(firstUmbrella).toBeGreaterThan(firstRain);

    // And no weather is left running once a different story starts.
    await page.evaluate(() => window.__char.startScenarioForTest('posing-for-you'));
    await page.waitForTimeout(12000);
    const after = await page.evaluate(() => window.__char.getWeatherForTest());
    expect(after.rainTarget).toBe(0);
    expect(after.rain).toBeLessThan(0.2);
  });

  test('the wind story is a gust she reacts to', async ({ page }) => {
    test.setTimeout(60000);
    const trace = await traceScenario(page, 'a-gust', 24);
    const firstWind = trace.findIndex((f) => f.wind > 0.5);
    const firstHold = trace.findIndex((f) => f.pose === 'hold-skirt');
    expect(firstWind, 'it blew').toBeGreaterThan(-1);
    expect(firstHold, 'she held on to things').toBeGreaterThan(-1);
    expect(firstHold).toBeGreaterThan(0);
  });
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

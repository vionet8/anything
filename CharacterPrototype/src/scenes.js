// The places she is photographed in.
//
// The scene used to be one hard-coded park built at module load: a green
// disc, a dirt path, some cone trees. That is fine as a backdrop for testing
// a pose and useless as a subject, and for a game about photography the
// background is half the photograph -- it decides what is behind her head,
// which way the light can come from, and what a wide shot is even of.
//
// So a scene is data: geometry plus the environment settings that go with it
// (sky, fog, fill light, sun colour, and the band of sun elevations that make
// sense there). main.js swaps between them; nothing here knows about her.
//
// Everything is built from primitives on purpose. The whole thing has to fit
// in a single published HTML file alongside a VRM, so there is no budget for
// textures or models -- what there is budget for is thinking about the
// composition, which is free.
import * as THREE from 'three';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import {
  grassTexture, sandTexture, wetSandTexture, asphaltTexture, pavementTexture,
  rippleNormal, facadeTexture, tiled,
} from './textures.js';

// Bakes a set of positioned parts into one geometry, so a thing made of
// twelve pieces costs one draw call instead of twelve. Worth doing wherever a
// group's parts never move relative to each other: the street was submitting
// three hundred and forty separate window panes, each with its own material,
// which is most of what a frame was being spent on.
function merged(parts) {
  const geometries = parts.map(({ geometry, position, rotation, scale }) => {
    const copy = geometry.clone();
    const matrix = new THREE.Matrix4().compose(
      position || new THREE.Vector3(),
      rotation
        ? new THREE.Quaternion().setFromEuler(rotation)
        : new THREE.Quaternion(),
      scale || new THREE.Vector3(1, 1, 1)
    );
    copy.applyMatrix4(matrix);
    geometry.dispose();
    return copy;
  });
  const result = BufferGeometryUtils.mergeGeometries(geometries, false);
  for (const geometry of geometries) geometry.dispose();
  return result;
}

// Deterministic per scene, so a place looks the same every time you go there.
// A park whose trees move when you reload is not a place.
function makeRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function disposeMaterial(material) {
  for (const value of Object.values(material)) {
    // Textures from textures.js are cached and handed to every scene that
    // wants them. Disposing one here frees a GPU upload the next scene is
    // still holding a reference to, and the next scene renders white.
    if (value && value.isTexture && !value.userData.shared) value.dispose();
  }
  material.dispose();
}

export function disposeScenery(group) {
  group.traverse((object) => {
    if (!object.isMesh) return;
    object.geometry.dispose();
    if (Array.isArray(object.material)) object.material.forEach(disposeMaterial);
    else disposeMaterial(object.material);
  });
}

// ---- Shared pieces ----

// A conifer, at the size a conifer is. The first version topped out at 3.8m,
// measured -- barely twice her height, which is not a tree, it is a shrub with
// ambition, and it is most of why the park read as a model village. A mature
// one is ten to fourteen metres with a trunk under half a metre thick, so the
// trunk cannot simply be scaled up with the rest: scaling the old one to
// height gave it a metre-wide bole.
function coneTree(random, trunkColor, leafColor, scale = 1) {
  const group = new THREE.Group();
  group.userData.prop = 'tree';
  const height = (10 + random() * 3.5) * scale;
  const trunkHeight = height * 0.3;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.14 * scale, 0.24 * scale, trunkHeight, 7),
    new THREE.MeshStandardMaterial({ color: trunkColor, roughness: 1 })
  );
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  group.add(trunk);

  // The crown is its own group so the wind can lean it without pulling the
  // trunk out of the ground -- see `sway` in the build results.
  const leafMat = new THREE.MeshStandardMaterial({ color: leafColor, roughness: 0.9 });
  const TIERS = 5;
  const crownBase = trunkHeight * 0.72;
  const crownHeight = height - crownBase;
  const tiers = [];
  for (let i = 0; i < TIERS; i++) {
    const t = i / (TIERS - 1);
    tiers.push({
      geometry: new THREE.ConeGeometry((2.5 - t * 1.7) * scale, crownHeight * 0.42, 9),
      position: new THREE.Vector3(0, crownBase + t * crownHeight * 0.76 + crownHeight * 0.18, 0),
    });
  }
  // The crown is its own group so the wind can lean it without pulling the
  // trunk out of the ground, but the tiers inside it are one mesh.
  const crown = new THREE.Group();
  const crownMesh = new THREE.Mesh(merged(tiers), leafMat);
  crownMesh.castShadow = true;
  crown.add(crownMesh);
  group.add(crown);
  group.userData.crown = crown;
  group.rotation.y = random() * Math.PI * 2;
  return group;
}

// A broadleaf, for streets and for mixing into the park. A row of conifers
// down a shopping street reads as a Christmas display; what actually lines a
// street is something pruned, round-crowned and about six metres.
function broadleafTree(random, scale = 1) {
  const group = new THREE.Group();
  group.userData.prop = 'broadleaf';
  const height = (5.4 + random() * 1.6) * scale;
  const trunkHeight = height * 0.42;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13 * scale, 0.19 * scale, trunkHeight, 7),
    new THREE.MeshStandardMaterial({ color: 0x6d5138, roughness: 1 })
  );
  trunk.position.y = trunkHeight / 2;
  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Group();
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x4f8a44, roughness: 0.92 });
  // Three overlapping lobes rather than one ball: a single sphere on a stick
  // is a lollipop, and the lobes catch the light differently enough to read
  // as foliage.
  // Sized and placed off the trunk rather than off constants: the crown fills
  // the height above the trunk, which is what keeps a "six metre tree" six
  // metres instead of the four it came out at when the lobes were pinned to
  // fixed offsets.
  const crownSpan = height - trunkHeight;
  const crownCentre = trunkHeight + crownSpan * 0.5;
  for (let i = 0; i < 4; i++) {
    const lobe = new THREE.Mesh(
      new THREE.IcosahedronGeometry(crownSpan * (0.38 - i * 0.035), 1),
      leafMat
    );
    const angle = (i / 4) * Math.PI * 2 + random();
    lobe.position.set(
      Math.sin(angle) * crownSpan * 0.19,
      crownCentre + ((i % 2) - 0.5) * crownSpan * 0.22,
      Math.cos(angle) * crownSpan * 0.19
    );
    lobe.scale.y = 0.86;
    lobe.castShadow = true;
    crown.add(lobe);
  }
  group.add(crown);
  group.userData.crown = crown;
  group.rotation.y = random() * Math.PI * 2;
  return group;
}

// Distant landforms, sunk so only their caps show.
//
// These have to be genuinely distant. Sitting them at fifty metres -- which is
// where the fog used to end -- made them a green wall standing just behind the
// park, and that single thing did more to make the whole place read as a model
// village than any object's size did. Real hills are hundreds of metres out
// and tens of metres tall; at fifty they are a fence.
function hillRing(random, count, color, radius, size, sink) {
  const group = new THREE.Group();
  const material = new THREE.MeshStandardMaterial({ color, roughness: 1 });
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + random() * 0.3;
    const distance = radius * (0.9 + random() * 0.2);
    // Kept within a quarter of the nominal size. The old +70% made one hill in
    // three nearly twice the others, and because a sphere's near face comes
    // forward as it grows, the big ones also stood a hundred metres closer --
    // which is how a ring meant to sit on the horizon ended up with a member
    // looming over the trees.
    const hill = new THREE.Mesh(new THREE.SphereGeometry(size * (0.8 + random() * 0.45), 12, 8), material);
    hill.position.set(Math.sin(angle) * distance, -sink, Math.cos(angle) * distance);
    hill.userData.prop = 'hill';
    group.add(hill);
  }
  return group;
}

// ---- 公園 ----
// The everyday one: somewhere you would actually take a friend's photograph.
// A path to stand on, trees to put behind her, and enough open sky that the
// sun can be anywhere.
function buildPark() {
  const random = makeRandom(42);
  const group = new THREE.Group();
  const sway = [];

  // Out to four hundred metres. It used to stop at sixty, which was invisible
  // only because the fog stopped at seventy-five -- and that shallow fog is
  // what made the world feel the size of a tennis court.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(400, 64),
    new THREE.MeshStandardMaterial({ map: tiled(grassTexture(), 280), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  const path = new THREE.Mesh(
    new THREE.PlaneGeometry(3.2, 40),
    new THREE.MeshStandardMaterial({ map: tiled(sandTexture(), 1, 12), color: 0xd7c8a4, roughness: 1 })
  );
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.01, 12);
  path.receiveShadow = true;
  group.add(path);

  // Trees start close. The first pass held them all back past fourteen
  // metres, and at the distance you actually photograph somebody from, that
  // left nothing behind her head but flat green -- a background with no
  // background in it.
  for (let i = 0; i < 34; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 6.5 + random() * 34;
    const x = Math.sin(angle) * radius;
    const z = Math.cos(angle) * radius;
    if (Math.abs(x) < 2.4 && z > -3 && z < 42) continue;   // keep the path clear
    if (Math.hypot(x, z) < 3) continue;                    // and room to stand
    const tree = random() < 0.45
      ? broadleafTree(random, 1.15 + random() * 0.5)
      : coneTree(random, 0x6b4a30, 0x3f7a3a, 0.85 + random() * 0.35);
    tree.position.set(x, 0, z);
    group.add(tree);
    sway.push(tree.userData.crown);
  }

  // Close enough to be a thing in the frame rather than distant scenery, and
  // on both sides of the path so there is one whichever way she turns.
  group.add(parkBench(3.6, 2.4, -1.9));
  group.add(parkBench(-3.9, 6.5, 1.4));

  // Flowering shrubs. These were flat coloured discs lying on the grass at
  // first, which from any normal camera height read as spilled paint rather
  // than as planting -- a flower has to have height or it is a texture.
  for (let i = 0; i < 22; i++) {
    const angle = random() * Math.PI * 2;
    const radius = 4.5 + random() * 16;
    const shrub = floweringShrub(random);
    shrub.position.set(Math.sin(angle) * radius, 0, Math.cos(angle) * radius);
    if (Math.abs(shrub.position.x) < 2.4 && shrub.position.z > -3 && shrub.position.z < 40) continue;
    group.add(shrub);
    sway.push(shrub);
  }

  // The wide shot needs a subject that is not her. A pond gives the far half
  // of the frame something to be about, and it reflects the sky, which is the
  // one bright thing at ground level.
  group.add(pond(-8.5, -6, 4.6, random));

  // Hills, not hummocks: caps eight to twenty metres standing at fifty-odd,
  // which is a horizon. The old ones were two-metre mounds and read as bumps
  // in a lawn.
  group.add(hillRing(random, 14, 0x74927a, 760, 135, 58));

  // Two park lamps by the path. Not many: the point of the park at night is
  // that there is almost nothing to light her with, which is a real and
  // teachable problem rather than an oversight.
  const nightGlow = [];
  const nightLights = [];
  for (const [x, z] of [[2.6, -1.5], [-2.6, 9]]) {
    const lamp = parkLamp();
    lamp.position.set(x, 0, z);
    group.add(lamp);
    nightGlow.push({ material: lamp.userData.globeMaterial, color: 0xffe3ac, intensity: 2.2 });
    const light = new THREE.PointLight(0xffdca8, 0, 10, 2);
    light.position.set(x, 2.9, z);
    light.userData.nightIntensity = 7;
    nightLights.push(light);
    group.add(light);
  }

  return { group, sway, nightGlow, nightLights };
}

function parkLamp() {
  const group = new THREE.Group();
  group.userData.prop = 'park lamp';
  const metal = new THREE.MeshStandardMaterial({ color: 0x33383f, roughness: 0.7 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.08, 2.8, 7), metal);
  post.position.y = 1.4;
  post.castShadow = true;
  group.add(post);
  const globeMaterial = new THREE.MeshStandardMaterial({ color: 0xf6eeda, roughness: 0.45 });
  const globe = new THREE.Mesh(new THREE.SphereGeometry(0.17, 9, 7), globeMaterial);
  globe.position.y = 2.92;
  group.add(globe);
  group.userData.globeMaterial = globeMaterial;
  return group;
}

function floweringShrub(random) {
  const group = new THREE.Group();
  group.userData.prop = 'shrub';
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x477f3e, roughness: 1 });
  const bush = new THREE.Mesh(new THREE.SphereGeometry(0.42 + random() * 0.2, 7, 5), leafMat);
  bush.scale.y = 0.72;
  bush.position.y = 0.3;
  bush.castShadow = true;
  group.add(bush);

  const petal = [0xe8738f, 0xf2c14e, 0xe9e3f5, 0xd06fc4][Math.floor(random() * 4)];
  const petalMat = new THREE.MeshStandardMaterial({ color: petal, roughness: 0.9 });
  for (let i = 0; i < 7; i++) {
    const flower = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 4), petalMat);
    const angle = random() * Math.PI * 2;
    const spread = 0.2 + random() * 0.24;
    flower.position.set(Math.sin(angle) * spread, 0.42 + random() * 0.18, Math.cos(angle) * spread);
    group.add(flower);
  }
  return group;
}

function pond(x, z, radius, random) {
  const group = new THREE.Group();
  group.userData.prop = 'pond';
  // Metalness stays at zero. A metallic surface with no environment map to
  // reflect renders black, which is what the first version of this pond did:
  // a hole in the lawn. The water reads as water from a low roughness and the
  // sun's specular alone.
  const water = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 40),
    new THREE.MeshStandardMaterial({
      color: 0x5393a8, roughness: 0.22, metalness: 0,
      normalMap: tiled(rippleNormal(), 3),
      normalScale: new THREE.Vector2(0.35, 0.35),
    })
  );
  water.userData.scroll = 0.012;
  water.rotation.x = -Math.PI / 2;
  water.position.y = 0.015;
  group.add(water);

  const rim = new THREE.Mesh(
    new THREE.RingGeometry(radius, radius + 0.45, 40),
    new THREE.MeshStandardMaterial({ color: 0x9c9382, roughness: 1 })
  );
  rim.rotation.x = -Math.PI / 2;
  rim.position.y = 0.03;
  rim.receiveShadow = true;
  group.add(rim);

  const reedMat = new THREE.MeshStandardMaterial({ color: 0x5f8f42, roughness: 1 });
  const reeds = [];
  for (let i = 0; i < 24; i++) {
    const angle = random() * Math.PI * 2;
    const height = 0.7 + random() * 0.5;
    reeds.push({
      geometry: new THREE.ConeGeometry(0.05, height, 4),
      position: new THREE.Vector3(
        Math.sin(angle) * (radius - 0.2), height / 2, Math.cos(angle) * (radius - 0.2)
      ),
    });
  }
  const reedMesh = new THREE.Mesh(merged(reeds), reedMat);
  reedMesh.castShadow = true;
  group.add(reedMesh);
  group.position.set(x, 0, z);
  return group;
}

function parkBench(x, z, rotation) {
  const group = new THREE.Group();
  group.userData.prop = 'bench';
  const wood = new THREE.MeshStandardMaterial({ color: 0xa8703f, roughness: 0.9 });
  const iron = new THREE.MeshStandardMaterial({ color: 0x3a3f47, roughness: 0.7 });

  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.05, 0.14), wood);
    slat.position.set(0, 0.44, -0.18 + i * 0.17);
    slat.castShadow = true;
    group.add(slat);
  }
  for (let i = 0; i < 3; i++) {
    const slat = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.14, 0.05), wood);
    slat.position.set(0, 0.58 + i * 0.17, -0.26);
    slat.rotation.x = -0.18;
    slat.castShadow = true;
    group.add(slat);
  }
  for (const side of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.44, 0.5), iron);
    leg.position.set(side * 0.78, 0.22, -0.02);
    leg.castShadow = true;
    group.add(leg);
  }
  group.position.set(x, 0, z);
  group.rotation.y = rotation;
  return group;
}

// ---- 海辺 ----
// Sand underfoot, sea in front. The point of this one is the light: a low sun
// over water is the hardest and best thing to photograph a face against, and
// the sea gives it a second, bigger source bouncing up.
//
// The shoreline is a straight line across the world, not a ring around her.
// The first version was a nine-metre disc of sand with water in every
// direction, and however correctly the palms and rocks were sized, a world
// that visibly curves away nine metres from your feet is a sandbar in a
// paperweight. A coast has one edge, and it runs off the sides of the frame.
function buildBeach() {
  const random = makeRandom(1071);
  const group = new THREE.Group();
  const sway = [];

  const SHORE = 10.5;            // where the water starts, ahead of her
  const REACH = 300;             // how far the sand and sea run to either side

  const sand = new THREE.Mesh(
    new THREE.PlaneGeometry(REACH * 2, REACH),
    new THREE.MeshStandardMaterial({ map: tiled(sandTexture(), 150, 75), roughness: 1 })
  );
  sand.rotation.x = -Math.PI / 2;
  sand.position.z = SHORE - REACH / 2;
  sand.receiveShadow = true;
  group.add(sand);

  // Wet sand: the same colour darker, in a band at the waterline. It is what
  // makes the edge read as a shoreline rather than as where the model stops.
  const wet = new THREE.Mesh(
    new THREE.PlaneGeometry(REACH * 2, 4.6),
    new THREE.MeshStandardMaterial({
      map: tiled(wetSandTexture(), 120, 1), color: 0xa2957c, roughness: 0.35,
    })
  );
  wet.rotation.x = -Math.PI / 2;
  wet.position.set(0, 0.012, SHORE - 2.3);
  group.add(wet);

  // The sea, as one big sheet with vertex colours: turquoise in the shallows,
  // deep blue further out, and hazed into the sky by the fog long before its
  // far edge. A single flat colour that stops short of the horizon reads as
  // painted card with a line ruled along the top of it.
  const SEA = 2800;
  // Segments bunched toward the shore. Spread evenly, the first row of
  // vertices lands a hundred metres out and the shallows never get drawn.
  const seaGeo = new THREE.PlaneGeometry(SEA * 2, SEA, 24, 48);
  const shallow = new THREE.Color(0x49b0bd);
  const deep = new THREE.Color(0x266a94);
  const colors = [];
  const position = seaGeo.attributes.position;
  for (let i = 0; i < position.count; i++) {
    // The plane is built in XY and laid flat by a -90 degree turn about X,
    // which sends its local +Y to world -Z. So local +Y is distance back
    // towards the shore, and the near edge -- the shallows -- is at +SEA/2.
    const even = (SEA / 2 - position.getY(i)) / SEA;
    const out = SEA * even * even;
    position.setY(i, SEA / 2 - out);
    const t = THREE.MathUtils.clamp(out / 110, 0, 1);
    const c = shallow.clone().lerp(deep, Math.sqrt(t));
    colors.push(c.r, c.g, c.b);
  }
  seaGeo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sea = new THREE.Mesh(seaGeo, new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.24, metalness: 0,
    normalMap: tiled(rippleNormal(), 320, 160),
    normalScale: new THREE.Vector2(0.5, 0.5),
  }));
  sea.rotation.x = -Math.PI / 2;
  position.needsUpdate = true;
  sea.position.set(0, -0.02, SHORE + SEA / 2);
  sea.userData.scroll = 0.02;
  group.add(sea);

  // Two lines of surf that run up the sand and back. Animated by main.js
  // through userData.surf -- the sea being the only still thing on a beach
  // is the giveaway that it is geometry.
  for (let i = 0; i < 2; i++) {
    const foam = new THREE.Mesh(
      new THREE.PlaneGeometry(REACH * 2, 0.9),
      new THREE.MeshStandardMaterial({
        color: 0xf6fbfb, roughness: 1, transparent: true, opacity: 0.75,
      })
    );
    foam.rotation.x = -Math.PI / 2;
    const home = SHORE - 1.1 - i * 0.9;
    foam.position.set(0, 0.02, home);
    foam.userData.surfPhase = i * Math.PI;
    foam.userData.surfHome = home;
    group.add(foam);
    if (!group.userData.surf) group.userData.surf = [];
    group.userData.surf.push(foam);
  }

  const rockMat = new THREE.MeshStandardMaterial({ color: 0x7d7669, roughness: 1 });
  for (let i = 0; i < 14; i++) {
    const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.14 + random() * 0.34, 0), rockMat);
    rock.position.set((random() - 0.5) * 34, 0.02 + random() * 0.08, SHORE - 1 - random() * 16);
    rock.rotation.set(random(), random(), random());
    rock.scale.y = 0.6 + random() * 0.4;
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  }

  // Palms back from the water, in a loose line along the top of the beach --
  // which is where they grow, and which gives a wide shot a far edge.
  for (let i = 0; i < 11; i++) {
    const palm = palmTree(random);
    palm.position.set((i - 5) * 6.5 + (random() - 0.5) * 4, 0, -6 - random() * 9);
    palm.scale.setScalar(0.9 + random() * 0.4);
    group.add(palm);
    sway.push(palm.userData.crown);
  }

  // A headland far out, so the horizon is a coast and not an empty ring.
  group.add(hillRing(random, 8, 0x64806e, 1180, 210, 95));

  // A jetty. Somewhere to stand that is not sand, and a line running out to
  // sea for a wide shot to be composed along.
  group.add(jetty());

  // The beach has no lighting of its own after dark on purpose. What it has
  // instead is the moon on the water, which is the shot.
  return { group, sway, nightGlow: [], nightLights: [] };
}

function jetty() {
  const group = new THREE.Group();
  group.userData.prop = 'jetty';
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6f4e, roughness: 0.95 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x6d573c, roughness: 1 });
  const LENGTH = 11;
  const planks = [];
  for (let i = 0; i < 26; i++) {
    planks.push({
      geometry: new THREE.BoxGeometry(1.7, 0.08, 0.34),
      position: new THREE.Vector3(0, 0.62, -3 - i * (LENGTH / 26)),
    });
  }
  const deck = new THREE.Mesh(merged(planks), wood);
  deck.castShadow = true;
  deck.receiveShadow = true;
  group.add(deck);

  const piles = [];
  for (let i = 0; i < 5; i++) {
    for (const side of [-1, 1]) {
      piles.push({
        geometry: new THREE.CylinderGeometry(0.09, 0.09, 1.4, 6),
        position: new THREE.Vector3(side * 0.72, 0, -3.4 - i * 2.5),
      });
    }
  }
  const pileMesh = new THREE.Mesh(merged(piles), dark);
  pileMesh.castShadow = true;
  group.add(pileMesh);
  // Pointed out to sea, which is +z now that the shoreline is a line.
  group.rotation.y = Math.PI + 0.24;
  group.position.z = 3.5;
  return group;
}

function palmTree(random) {
  const group = new THREE.Group();
  group.userData.prop = 'palm';
  const lean = (random() - 0.5) * 0.35;
  // Eight metres or so. Palms on a beach are tall and thin; the first pass
  // made them 4m, which put the fronds at head height.
  const TRUNK = 7.4 + random() * 1.8;
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.13, 0.26, TRUNK, 8),
    new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 1 })
  );
  trunk.position.y = TRUNK / 2;
  trunk.rotation.z = lean;
  trunk.castShadow = true;
  group.add(trunk);

  const crown = new THREE.Group();
  crown.position.set(Math.sin(lean) * -TRUNK * 0.5, TRUNK, 0);
  const frondMat = new THREE.MeshStandardMaterial({ color: 0x4b8442, roughness: 0.9, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const frond = new THREE.Mesh(new THREE.ConeGeometry(0.42, 3.4, 4), frondMat);
    const angle = (i / 9) * Math.PI * 2;
    frond.position.set(Math.sin(angle) * 1.3, -0.2, Math.cos(angle) * 1.3);
    frond.rotation.set(Math.cos(angle) * 1.15, -angle, -Math.sin(angle) * 1.15);
    frond.scale.set(1, 1, 0.35);
    frond.castShadow = true;
    crown.add(frond);
  }
  group.add(crown);
  group.userData.crown = crown;
  return group;
}

// ---- 街角 ----
// Buildings on both sides of a road. This one is here for the shadows: a
// street is the only place in the set where the light can be blocked, so
// where she stands along it changes the exposure problem completely.
function buildStreet() {
  const random = makeRandom(20250822);
  const group = new THREE.Group();
  const sway = [];
  // Filled in as the street is built. `nightGlow` is switched to emissive
  // after dark; `nightLights` are the handful of real lights that come on.
  const nightGlow = [];
  const nightLights = [];

  const ROAD_HALF = 4.2;
  const KERB = 0.14;

  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(300, 56),
    new THREE.MeshStandardMaterial({ map: tiled(asphaltTexture(), 170), roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  group.add(ground);

  for (const side of [-1, 1]) {
    const pavement = new THREE.Mesh(
      new THREE.BoxGeometry(5.5, KERB, 260),
      new THREE.MeshStandardMaterial({ map: tiled(pavementTexture(), 2, 95), roughness: 1 })
    );
    pavement.position.set(side * (ROAD_HALF + 2.75), KERB / 2, 0);
    pavement.receiveShadow = true;
    group.add(pavement);
  }

  // Centre line, dashed.
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xd8d2bd, roughness: 1 });
  const dashes = [];
  for (let i = -38; i <= 38; i++) {
    dashes.push({
      geometry: new THREE.PlaneGeometry(0.16, 1.6),
      position: new THREE.Vector3(0, 0.012, i * 3.2),
      rotation: new THREE.Euler(-Math.PI / 2, 0, 0),
    });
  }
  group.add(new THREE.Mesh(merged(dashes), lineMat));

  // A crossing, right where she stands. It gives a wide shot some geometry to
  // sit her on instead of an empty grey field.
  const stripes = [];
  for (let i = 0; i < 8; i++) {
    stripes.push({
      geometry: new THREE.PlaneGeometry(0.45, ROAD_HALF * 2 - 0.3),
      position: new THREE.Vector3(0, 0.014, -3.15 + i * 0.9),
      rotation: new THREE.Euler(-Math.PI / 2, 0, Math.PI / 2),
    });
  }
  group.add(new THREE.Mesh(merged(stripes), lineMat));

  const facadeColors = [0xb9a893, 0x9fa8ae, 0xc2a08c, 0x8d9a93, 0xcbbfa6];
  // Two window materials for the whole street rather than one per pane. Which
  // panes light up after dark is decided at build time by which of the two a
  // pane is given, so the variation survives without three hundred materials.
  const glassMat = new THREE.MeshStandardMaterial({
    color: 0x2b3a48, roughness: 0.18, metalness: 0.55,
  });
  const litGlassMat = new THREE.MeshStandardMaterial({
    color: 0x2b3a48, roughness: 0.18, metalness: 0.35,
  });
  nightGlow.push({ material: litGlassMat, color: 0xffdca8, intensity: 1.9 });
  for (const side of [-1, 1]) {
    let z = -95;
    while (z < 95) {
      const depth = 7 + random() * 7;
      const height = 7.5 + random() * 9;
      const width = 6 + random() * 4;
      const building = shopfront(
        width, height, depth,
        facadeColors[Math.floor(random() * facadeColors.length)],
        random, glassMat, litGlassMat
      );
      building.position.set(side * (ROAD_HALF + 5.5 + width / 2), 0, z + depth / 2);
      building.rotation.y = side < 0 ? Math.PI / 2 : -Math.PI / 2;
      group.add(building);
      z += depth + 0.6;
    }
  }

  for (const side of [-1, 1]) {
    for (let i = -7; i <= 7; i++) {
      const z = i * 11 + side * 5.5;
      const post = lampPost(side * (ROAD_HALF + 0.9), z);
      nightGlow.push({ material: post.userData.lampMaterial, color: 0xffe6b0, intensity: 2.4 });
      // Only the near ones get a real light. Fourteen point lights is a
      // different frame rate; three is the same picture, because the ones
      // fifty metres up the road were never lighting anything you can see.
      if (Math.abs(z) < 14) {
        const glow = new THREE.PointLight(0xffd79a, 0, 13, 2);
        glow.position.set(side * (ROAD_HALF + 0.35), 4.25, z);
        glow.userData.nightIntensity = 9;
        nightLights.push(glow);
        group.add(glow);
      }
      group.add(post);
    }
  }

  // Street trees on the pavement, the one soft thing in the frame.
  for (const side of [-1, 1]) {
    for (let i = -5; i <= 5; i++) {
      const tree = broadleafTree(random);
      tree.position.set(side * (ROAD_HALF + 3.6), KERB, i * 11 + 5.5 - side * 3);
      group.add(tree);
      sway.push(tree.userData.crown);
    }
  }

  // A vending machine. One saturated, self-lit object is what stops a grey
  // street being grey, and after dark it is the only warm thing at head
  // height that is not four metres up a pole.
  const machine = vendingMachine();
  machine.position.set(-(ROAD_HALF + 2.2), 0.14, -1.6);
  machine.rotation.y = Math.PI / 2;
  group.add(machine);
  nightGlow.push({ material: machine.userData.faceMaterial, color: 0xfff2d0, intensity: 1.7 });
  const machineLight = new THREE.PointLight(0xffeccb, 0, 5.5, 2);
  machineLight.position.set(-(ROAD_HALF + 1.3), 1.5, -1.6);
  machineLight.userData.nightIntensity = 3.2;
  nightLights.push(machineLight);
  group.add(machineLight);

  // Power lines. The cheapest single thing that turns a generic street into a
  // Japanese one -- and they cut across the sky, which is the half of the
  // frame a wide shot otherwise wastes.
  group.add(powerLines(ROAD_HALF + 1.4));

  return { group, sway, nightGlow, nightLights };
}

// Each pole with a crossarm, and a catenary between consecutive poles. The
// sag is a real hanging curve rather than a straight line, because a straight
// wire between two poles is the one thing that never happens.
function powerLines(offset) {
  const group = new THREE.Group();
  group.userData.prop = 'power lines';
  const poleMat = new THREE.MeshStandardMaterial({ color: 0x8d8578, roughness: 0.95 });
  const wireMat = new THREE.MeshStandardMaterial({ color: 0x1c1f24, roughness: 0.9 });
  const SPAN = 22;
  const HEIGHT = 9.8;   // a Japanese utility pole, not a fence post
  const positions = [-77, -55, -33, -11, 11, 33, 55, 77];

  for (const z of positions) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.17, HEIGHT, 7), poleMat);
    pole.position.set(-offset, HEIGHT / 2, z);
    pole.castShadow = true;
    group.add(pole);
    for (let i = 0; i < 2; i++) {
      const arm = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.09, 0.09), poleMat);
      arm.position.set(-offset, HEIGHT - 0.5 - i * 0.65, z);
      group.add(arm);
    }
  }

  const wireOffsets = [-0.6, 0, 0.6];
  for (let i = 0; i < positions.length - 1; i++) {
    for (let w = 0; w < wireOffsets.length; w++) {
      const y = HEIGHT - 0.5 - (w % 2) * 0.65;
      const points = [];
      for (let t = 0; t <= 12; t++) {
        const f = t / 12;
        const z = THREE.MathUtils.lerp(positions[i], positions[i + 1], f);
        const sag = Math.sin(f * Math.PI) * 0.55;
        points.push(new THREE.Vector3(-offset + wireOffsets[w], y - sag, z));
      }
      const wire = new THREE.Mesh(
        new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 12, 0.022, 4, false),
        wireMat
      );
      group.add(wire);
    }
  }
  // A second run crossing the road, so the wires are overhead rather than
  // only off to one side.
  for (const z of [-55, -11, 33]) {
    const points = [];
    for (let t = 0; t <= 10; t++) {
      const f = t / 10;
      points.push(new THREE.Vector3(
        THREE.MathUtils.lerp(-offset, offset, f),
        HEIGHT - 1.15 - Math.sin(f * Math.PI) * 0.42,
        z
      ));
    }
    group.add(new THREE.Mesh(
      new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 10, 0.02, 4, false),
      wireMat
    ));
  }
  return group;
}

function vendingMachine() {
  const group = new THREE.Group();
  group.userData.prop = 'vending machine';
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.05, 1.9, 0.72),
    new THREE.MeshStandardMaterial({ color: 0xc4362f, roughness: 0.6 })
  );
  body.position.y = 0.95;
  body.castShadow = true;
  group.add(body);

  // The lit display panel, kept as its own material so night can switch it.
  const faceMaterial = new THREE.MeshStandardMaterial({ color: 0xf4ecd8, roughness: 0.35 });
  const face = new THREE.Mesh(new THREE.PlaneGeometry(0.86, 1.12), faceMaterial);
  face.position.set(0, 1.24, 0.37);
  group.add(face);

  const tray = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 0.16, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x2b2b30, roughness: 0.7 })
  );
  tray.position.set(0, 0.42, 0.37);
  group.add(tray);

  group.userData.faceMaterial = faceMaterial;
  return group;
}

// A facade with a glazed ground floor and rows of windows above. The windows
// are geometry rather than a texture because there is no texture budget, and
// because real ones catch the sun and painted ones do not.
function shopfront(width, height, depth, color, random, glassMat, litGlassMat) {
  const group = new THREE.Group();
  group.userData.prop = 'building';
  const wallMat = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });

  const block = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), wallMat);
  block.position.y = height / 2;
  block.castShadow = true;
  block.receiveShadow = true;
  group.add(block);

  const front = depth / 2 + 0.02;
  const shop = new THREE.Mesh(new THREE.PlaneGeometry(width * 0.82, 2.6), glassMat);
  shop.position.set(0, 1.5, front);
  group.add(shop);

  const awning = new THREE.Mesh(
    new THREE.BoxGeometry(width * 0.88, 0.1, 1.1),
    new THREE.MeshStandardMaterial({ color: random() > 0.5 ? 0xb4553f : 0x3f6b7a, roughness: 0.9 })
  );
  awning.position.set(0, 3.05, front + 0.5);
  awning.rotation.x = 0.12;
  awning.castShadow = true;
  group.add(awning);

  // Panes are sorted into lit and unlit at build time and each set is baked
  // into a single geometry -- two draw calls per building instead of one per
  // window. Two thirds lit, not all of them: a block with every light burning
  // reads as a film set rather than as a street where people live.
  const rows = Math.max(1, Math.floor((height - 4) / 2.6));
  const columns = Math.max(2, Math.round(width / 2.2));
  const dark = [];
  const lit = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const pane = {
        geometry: new THREE.PlaneGeometry(0.95, 1.25),
        position: new THREE.Vector3(
          (c - (columns - 1) / 2) * (width / columns),
          4.2 + r * 2.6,
          front
        ),
      };
      (random() > 0.34 ? lit : dark).push(pane);
    }
  }
  if (dark.length) group.add(new THREE.Mesh(merged(dark), glassMat));
  if (lit.length) group.add(new THREE.Mesh(merged(lit), litGlassMat));
  return group;
}

function lampPost(x, z) {
  const group = new THREE.Group();
  group.userData.prop = 'street lamp';
  const metal = new THREE.MeshStandardMaterial({ color: 0x2f343b, roughness: 0.6 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 4.4, 7), metal);
  post.position.y = 2.2;
  post.castShadow = true;
  group.add(post);
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.07, 0.07), metal);
  arm.position.set(x > 0 ? -0.35 : 0.35, 4.35, 0);
  group.add(arm);
  const lampMaterial = new THREE.MeshStandardMaterial({ color: 0xf3ead2, roughness: 0.5 });
  const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.3), lampMaterial);
  lamp.position.set(x > 0 ? -0.68 : 0.68, 4.25, 0);
  group.add(lamp);
  group.position.set(x, 0.14, z);
  group.userData.lampMaterial = lampMaterial;
  return group;
}

// ---- Time of day ----
// The second axis, and for this game the more important one: the subject is
// light, and four hours of the day teach more than four more locations would.
//
// Written as a shared table plus a per-scene tint rather than as twelve
// hand-authored combinations. Twelve of anything hand-authored drift apart --
// you fix the fog in the evening park and forget the evening beach -- and the
// thing that actually differs between two places at the same hour is small:
// what colour the ground bounces, and how far you can see.
export const TIMES = [
  {
    key: 'morning',
    label: '朝',
    skyTop: 0x6fa8d8, skyHorizon: 0xf2e3d0,
    fogColor: 0xd8e2e4, fogScale: 0.85,
    hemiSky: 0xdce8fa, hemiIntensity: 0.55,
    sunColor: 0xffe4c4, sunIntensity: 2.2,
    elevation: [0.13, 0.24],
  },
  {
    key: 'noon',
    label: '昼',
    skyTop: 0x3f82cf, skyHorizon: 0xcfe4f2,
    fogColor: 0xc4d8e6, fogScale: 1.15,
    hemiSky: 0xe4f0ff, hemiIntensity: 0.55,
    sunColor: 0xfff8ec, sunIntensity: 3.1,
    elevation: [0.5, 0.72],
  },
  {
    key: 'golden',
    label: '夕',
    skyTop: 0x2f4a86, skyHorizon: 0xffab5c,
    fogColor: 0xe7ac79, fogScale: 0.95,
    hemiSky: 0xffd3a4, hemiIntensity: 0.42,
    sunColor: 0xff9440, sunIntensity: 2.7,
    elevation: [0.05, 0.13],
  },
  {
    key: 'night',
    label: '夜',
    skyTop: 0x080e20, skyHorizon: 0x27334f,
    fogColor: 0x18202f, fogScale: 0.62,
    // Both of these are low enough to look wrong on their own, and that is
    // deliberate: at night the lamps have to be doing the lighting, or the
    // scene is just a daytime render with a blue cast. Measured against the
    // face -- in the open she comes out under the brief's band, and next to a
    // light she lands in it, which is the entire lesson.
    hemiSky: 0x2c3a58, hemiIntensity: 0.1,
    // The moon, not the sun: cold, weak, and still casting a shadow, because
    // a night with no shadow at all reads as a flat filter over the daytime.
    sunColor: 0xa9bcdd, sunIntensity: 0.3,
    elevation: [0.4, 0.65],
    night: true,
  },
];

export const timeByKey = (key) => TIMES.find((entry) => entry.key === key) || TIMES[1];

// What each place contributes on top of the hour: the colour its ground
// throws back up, how far you can see there, and any narrowing of where the
// sun may sit. Sea haze goes further than street haze; a street at midday
// still cannot have the sun on the deck.
export const SCENES = [
  {
    key: 'park',
    label: '公園',
    build: buildPark,
    tint: {
      hemiGround: 0x6b8f5a,
      fogNear: 70, fogFar: 1500,
    },
  },
  {
    key: 'beach',
    label: '海辺',
    build: buildBeach,
    tint: {
      hemiGround: 0xa89a72,
      fogNear: 110, fogFar: 1600,
      // Sea haze is warm and pale at every hour, so the horizon keeps some of
      // its own colour rather than taking the sky's whole.
      horizon: 0xf0e6d2, horizonMix: 0.35,
      hemiBoost: 0.16,          // the water is a second, upward-facing source
    },
  },
  {
    key: 'street',
    label: '街角',
    build: buildStreet,
    tint: {
      hemiGround: 0x55585e,
      fogNear: 55, fogFar: 320,
      horizon: 0xdbe4ea, horizonMix: 0.25,
      // A low sun on a street spends its time behind a building, where there
      // is nothing the photographer can do about it. Kept off the deck.
      minElevation: 0.16,
    },
  },
];

export const sceneByKey = (key) => SCENES.find((entry) => entry.key === key) || SCENES[0];

const mixed = (a, b, t) => new THREE.Color(a).lerp(new THREE.Color(b), t).getHex();

// The flat environment object main.js consumes. Everything above is inputs.
export function resolveEnv(scene, time) {
  const tint = scene.tint;
  const horizon = tint.horizon
    ? mixed(time.skyHorizon, tint.horizon, tint.horizonMix)
    : time.skyHorizon;
  const [low, high] = time.elevation;
  return {
    skyTop: time.skyTop,
    skyHorizon: horizon,
    fog: {
      color: tint.fogTint ? mixed(time.fogColor, tint.fogTint, 0.35) : time.fogColor,
      near: tint.fogNear * time.fogScale,
      far: tint.fogFar * time.fogScale,
    },
    hemiSky: time.hemiSky,
    hemiGround: tint.hemiGround,
    hemiIntensity: time.hemiIntensity + (tint.hemiBoost || 0),
    sunColor: time.sunColor,
    sunIntensity: time.sunIntensity,
    sunElevation: [Math.max(low, tint.minElevation || 0), Math.max(high, tint.minElevation || 0)],
    night: !!time.night,
  };
}

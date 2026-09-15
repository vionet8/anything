#!/usr/bin/env python3
"""Let the hair fall, instead of carrying it around rigidly.

The grafted VRoid hair is 152 separate cards weighted 100% to the head bone,
which is fine while she is upright and useless the moment she is not: laid on
her back she wears the same shape she had standing, and it reads as a helmet
rather than as hair spread on the boards. No amount of extra strands fixes
that on its own -- rigid strands just give a more detailed helmet. What is
missing is that hair FALLS, and where it lands depends on what is under it.

So the cards are simulated. Each is a strip of quads with enough segments to
bend; the solver only needs to know which end is glued to her scalp, and what
it is allowed to land on.

Two things are worth knowing before changing any of this.

The roots are found per card, by distance to the head, not by a z threshold.
A strand that curves forward over her face has its root at the BACK of the
card and its tip near her chin, so "the top of the card" pins the wrong end,
and does it differently for every card. Distance to the head centre is the
same question for all 152 of them.

And she is laid down over time rather than dropped into place. A solver
started inside a collision does not recover from it -- the hair would be
launched out through her shoulder on the first frame. Starting her upright,
where the hair hangs clear of everything, and rotating her down over a second
of animation means the hair falls the way it would if she lay down, and the
spread comes out of the motion rather than having to be authored.
"""
import os
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

HAIR_MESHES = ("Hair001",)
HEAD_BONE = "J_Bip_C_Head"
PIN_GROUP = "HairRoots"

# How far from its closest-to-the-scalp vertex a card stays pinned. Below
# about 2cm single cards pivot on one vertex and windmill; much above 4cm the
# pinned part reaches past the crown and the hair stops moving at all.
ROOT_MARGIN = 0.030

# A card that never gets further than this from the scalp is not hair that
# falls -- it is the haircut. Simulating everything was tried first and the
# whole head collapsed into a flat white starburst on the boards, because the
# crown, the fringe and the side pieces are what hold the shape and they were
# falling too. Measured, the cards split cleanly into two populations: three
# quarters of them reach under 0.11 m, and the next ones up reach 0.54 m, with
# nothing in between. That gap is the haircut on one side and the long hair on
# the other, so it is where the line goes: 124 cards keep their shape, 28 fall.
RIGID_REACH = 0.250


def log(*a):
    print("[hairsim]", *a, flush=True)


def head_centre(arm):
    pb = arm.pose.bones[HEAD_BONE]
    return arm.matrix_world @ ((pb.head + pb.tail) / 2)


def mesh_islands(mesh):
    """Connected components, as lists of vertex indices."""
    adjacency = [[] for _ in range(len(mesh.vertices))]
    for edge in mesh.edges:
        a, b = edge.vertices
        adjacency[a].append(b)
        adjacency[b].append(a)
    seen = [False] * len(mesh.vertices)
    islands = []
    for start in range(len(mesh.vertices)):
        if seen[start]:
            continue
        stack, island = [start], []
        seen[start] = True
        while stack:
            current = stack.pop()
            island.append(current)
            for other in adjacency[current]:
                if not seen[other]:
                    seen[other] = True
                    stack.append(other)
        islands.append(island)
    return islands


def pin_roots(obj, centre, margin=ROOT_MARGIN, rigid_reach=RIGID_REACH,
              group_name=PIN_GROUP):
    """Weight each card's scalp end to 1, the rest to 0.

    Per card rather than globally: cards start at different depths under the
    hairline, so one distance threshold for the whole head either pins whole
    short cards solid or leaves long ones hanging by nothing.
    """
    mesh = obj.data
    group = obj.vertex_groups.get(group_name) or obj.vertex_groups.new(name=group_name)
    matrix = obj.matrix_world
    distance = [(matrix @ v.co - centre).length for v in mesh.vertices]

    pinned = rigid_cards = falling_cards = 0
    for island in mesh_islands(mesh):
        nearest = min(distance[i] for i in island)
        if max(distance[i] for i in island) - nearest <= rigid_reach:
            group.add(island, 1.0, "REPLACE")
            pinned += len(island)
            rigid_cards += 1
            continue
        roots = [i for i in island if distance[i] <= nearest + margin]
        group.add(roots, 1.0, "REPLACE")
        group.add([i for i in island if i not in set(roots)], 0.0, "REPLACE")
        pinned += len(roots)
        falling_cards += 1
    log(f"{obj.name}: {rigid_cards} cards held as the haircut, "
        f"{falling_cards} falling; {pinned} of {len(mesh.vertices)} vertices pinned")
    return group


# Hair is not cloth, and the give-away when it is simulated as cloth is that it
# behaves like a bedsheet: too floppy, too stretchy, and it drapes in folds.
# Stiff structurally with real bending resistance is what keeps a strand
# reading as a lock of hair rather than a ribbon.
CLOTH = dict(
    quality=6,
    mass=0.030,
    tension_stiffness=40.0,
    compression_stiffness=40.0,
    shear_stiffness=40.0,
    bending_stiffness=3.0,
    tension_damping=12.0,
    compression_damping=12.0,
    shear_damping=12.0,
    bending_damping=1.0,
    air_damping=3.0,
)
COLLISION_DISTANCE = 0.006
COLLISION_QUALITY = 3
SELF_COLLISION_DISTANCE = 0.005


def collider_collection(name, objects):
    """A collection the solver is allowed to collide against, and only that.

    Cloth collides with every Collision object in the scene unless it is told
    otherwise, and for a worn garment that is fatal: a robe rests ON her, so it
    starts touching her skin along its whole length, and a solver asked to
    resolve that pushes until the mesh leaves the building -- the first attempt
    threw sleeve vertices 13 metres. The garment does not need to collide with
    her at all, because the part that lies against her is pinned to her. It
    needs to collide with the deck.
    """
    collection = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if collection.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(collection)
    for obj in objects:
        if obj.name not in collection.objects:
            collection.objects.link(obj)
    return collection


def add_cloth(obj, pin_group=PIN_GROUP, settings=None, self_collision=True,
              colliders=None):
    modifier = obj.modifiers.new("HairCloth", "CLOTH")
    cloth = modifier.settings
    values = dict(CLOTH)
    values.update(settings or {})
    cloth.quality = values["quality"]
    cloth.mass = values["mass"]
    cloth.tension_stiffness = values["tension_stiffness"]
    cloth.compression_stiffness = values["compression_stiffness"]
    cloth.shear_stiffness = values["shear_stiffness"]
    cloth.bending_stiffness = values["bending_stiffness"]
    cloth.tension_damping = values["tension_damping"]
    cloth.compression_damping = values["compression_damping"]
    cloth.shear_damping = values["shear_damping"]
    cloth.bending_damping = values["bending_damping"]
    cloth.air_damping = values["air_damping"]
    cloth.vertex_group_mass = pin_group
    cloth.pin_stiffness = 1.0

    collision = modifier.collision_settings
    collision.use_collision = True
    collision.distance_min = COLLISION_DISTANCE
    collision.collision_quality = COLLISION_QUALITY
    # Self-collision on 9476 vertices costs more than it returns here: the
    # cards are thin and mostly parallel, so what it mainly does is jitter.
    # On, despite the cost. Without it the long cards pass straight through
    # each other and the hair ends up as a flat sheet on the boards with no
    # volume at all -- self-collision is what keeps a fanned-out mass of hair
    # looking like a mass rather than a stain. Only 28 cards simulate, so the
    # bill is affordable.
    collision.use_self_collision = self_collision
    collision.self_distance_min = SELF_COLLISION_DISTANCE
    collision.self_friction = 6.0
    if colliders is not None:
        collision.collection = colliders
    return modifier


def make_collider(obj, thickness=0.004):
    if any(m.type == "COLLISION" for m in obj.modifiers):
        return
    obj.modifiers.new("Collision", "COLLISION")
    obj.collision.thickness_outer = thickness
    obj.collision.damping = 0.4
    obj.collision.cloth_friction = 12.0


def hair_objects(names=HAIR_MESHES):
    return [o for o in bpy.data.objects if o.type == "MESH" and o.name in names]


def settle(frames, step_log=20):
    """Run the solver by stepping the scene, which is all a bake is headless."""
    scene = bpy.context.scene
    scene.frame_start = 1
    scene.frame_end = frames
    for frame in range(1, frames + 1):
        scene.frame_set(frame)
        if step_log and frame % step_log == 0:
            log(f"  settled to frame {frame}/{frames}")
    return frames


def _key(obj, path, frame, index=-1):
    obj.keyframe_insert(data_path=path, frame=frame, index=index)


def lay_down(root, arm, pose, rotation, location, fall=45, hold=6):
    """Animate her from standing to the target pose, so the hair falls into it.

    The solver cannot be handed a finished pose. Dropped straight into lying
    down, every card that ends up under her shoulder starts inside her
    shoulder, and a cloth solver's response to starting inside a collider is to
    fire the vertex out of it -- the hair explodes on frame one. Upright she is
    the shape the hair was modelled around, so nothing is interpenetrating, and
    the fall itself is what spreads it.

    `hold` frames of stillness first, so the solver starts from rest rather
    than from a standing start on frame one.
    """
    root.rotation_mode = "XYZ"
    for bone_name in pose:
        if bone_name in arm.pose.bones:
            arm.pose.bones[bone_name].rotation_mode = "XYZ"

    start_rotation = (0.0, 0.0, rotation[2])
    start_location = (location[0], location[1], 0.0)

    for frame in (1, hold):
        root.rotation_euler = start_rotation
        root.location = start_location
        _key(root, "rotation_euler", frame)
        _key(root, "location", frame)
        for bone_name in pose:
            pb = arm.pose.bones.get(bone_name)
            if pb is None:
                continue
            pb.rotation_euler = (0.0, 0.0, 0.0)
            pb.keyframe_insert(data_path="rotation_euler", frame=frame)

    end = hold + fall
    root.rotation_euler = rotation
    root.location = location
    _key(root, "rotation_euler", end)
    _key(root, "location", end)
    for bone_name, value in pose.items():
        pb = arm.pose.bones.get(bone_name)
        if pb is None:
            continue
        pb.rotation_euler = value
        pb.keyframe_insert(data_path="rotation_euler", frame=end)

    log(f"laid down over frames {hold}-{end}")
    return end


def drape(root, arm, pose, rotation, location, colliders=(),
          fall=45, hold=6, settle_frames=55, names=HAIR_MESHES):
    """The whole thing: pin, simulate, lay her down, and let it come to rest."""
    centre = head_centre(arm)
    hairs = hair_objects(names)
    if not hairs:
        log(f"WARNING: none of {names} present -- hair left rigid")
        return None
    for obj in hairs:
        pin_roots(obj, centre)
        add_cloth(obj)
    for obj in colliders:
        make_collider(obj)
    log(f"{len(hairs)} hair meshes simulated against {len(colliders)} colliders")

    end = lay_down(root, arm, pose, rotation, location, fall=fall, hold=hold)
    return settle(end + settle_frames)


# The engawa's own deck, as a plane. The built deck is planks with gaps and a
# thickness, and handing all of that to a collision solver costs far more than
# it returns -- what the hair needs to know is "there is a floor at z=0, and it
# stops at the edge". The extent matters: a plane running to infinity would
# hold hair up in mid-air out over the water, where it should fall past the
# boards instead.
DECK_Z = 0.0
DECK_X_HALF = 4.30
DECK_FRONT = -0.75
DECK_BACK = 1.65


def deck_collider(name="HairDeck"):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(
        [(-DECK_X_HALF, DECK_FRONT, DECK_Z), (DECK_X_HALF, DECK_FRONT, DECK_Z),
         (DECK_X_HALF, DECK_BACK, DECK_Z), (-DECK_X_HALF, DECK_BACK, DECK_Z)],
        [], [(0, 1, 2, 3)])
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    obj.hide_render = True
    return obj


# Cloth, unlike hair, is allowed to behave like cloth: softer, with much less
# bending resistance, so a sleeve hangs and gathers instead of holding its
# shape like a length of pipe.
GARMENT_CLOTH = dict(
    CLOTH,
    mass=0.20,
    tension_stiffness=15.0,
    compression_stiffness=15.0,
    shear_stiffness=15.0,
    bending_stiffness=0.20,
    air_damping=1.2,
    quality=10,
)


def pin_all_but(obj, loose_bones, group_name="ClothPins"):
    """Pin every vertex except those the given bones carry.

    A garment cannot be pinned the way hair is -- it has no roots. What it has
    is a part that is held against her by her own body, and a part that hangs
    free. Here the sleeves hang and everything else is held, which is the
    smallest change that fixes the sleeve without risking the robe sliding off
    her in the solver.
    """
    mesh = obj.data
    group = obj.vertex_groups.get(group_name) or obj.vertex_groups.new(name=group_name)
    names = [g.name for g in obj.vertex_groups]
    loose, held = [], []
    for vert in mesh.vertices:
        heaviest, weight = None, 0.0
        for entry in vert.groups:
            if entry.weight > weight:
                weight, heaviest = entry.weight, names[entry.group]
        (loose if heaviest in loose_bones else held).append(vert.index)
    group.add(held, 1.0, "REPLACE")
    if loose:
        group.add(loose, 0.0, "REPLACE")
    log(f"{obj.name}: {len(loose)} vertices free to hang, {len(held)} held")
    return group


# Below the elbow only. Freeing the whole arm chain frees the shoulder seam
# too, and a sleeve whose shoulder is not attached to anything does what a
# sleeve would: it slid down her arm and off, and both of them ended up lying
# on the deck as yellow puddles while she wore none.
# The forearm only. With the hand free as well, the cuff has nothing holding
# it and the solver draws the cloth out into spikes past her fingers.
SLEEVE_BONES = ("J_Bip_L_LowerArm", "J_Bip_R_LowerArm")


def add_garment_cloth(obj, loose_bones=SLEEVE_BONES, colliders=None):
    pin_all_but(obj, loose_bones)
    return add_cloth(obj, pin_group="ClothPins", settings=GARMENT_CLOTH,
                     self_collision=False, colliders=colliders)

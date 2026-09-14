"""Change her proportions by scaling bones, and check the result by measuring it.

The base model is a VRoid sample, and measured rather than eyeballed it comes
out at 6.90 head-counts: 1.545 m tall with a 0.224 m head, legs 57.7% of her
height. Stylised character proportions for this kind of art usually sit between
7.5 and 8.5 head-counts with legs nearer 60-62%, so her head is large and her
legs are short for the look, which is most of why she reads younger and rounder
than the reference art does.

That is a number, so it can be aimed at. Head-count moves by shrinking the head
or lengthening the body, and doing only one of them has a cost: shrink the head
alone far enough and it reads as a pinhead on an unchanged body; stretch the
body alone and she grows unreasonably tall. Mixing them, and taking the length
from the legs where this style carries it, is what keeps the silhouette
believable.

Everything here is bone scaling on the pose, so the skinned mesh -- body,
clothes, hair, ears -- follows without any vertex being touched by hand, and
measure() can confirm the result rather than trusting the arithmetic.

    blender --background --python tools/blender_proportions.py
"""
import os
import sys

import bpy
import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
OUT_DIR = os.path.join(PROJECT, "assets", "blender")

# Targets read off the body-type chart: (height in metres, head-counts).
TARGETS = {
    "anime": (1.50, 7.5),
    "bishoujo": (1.60, 8.0),
    "model": (1.70, 8.5),
}

HEAD_BONE = "J_Bip_C_Head"
LEG_BONES = ("J_Bip_L_UpperLeg", "J_Bip_R_UpperLeg",
             "J_Bip_L_LowerLeg", "J_Bip_R_LowerLeg")
FOOT_BONES = ("J_Bip_L_Foot", "J_Bip_R_Foot")
# Hair, ears and braids ride the head and must not count toward her height --
# measuring to the top of the hair makes a tall hairstyle read as a tall
# character, and every head-count derived from it is wrong.
NOT_BODY = ("Hair", "Ear", "Braid", "Yukata")


def log(*a):
    print("[proportions]", *a)


# --- Silhouette width --------------------------------------------------------
# Head-count alone does not stop a figure reading as a child, because a child is
# not just a short adult -- a child's torso is narrow and straight, and an adult
# woman's is wider at the shoulder and wider again at the hip with a waist drawn
# in between them. That contrast is what the eye reads as grown, so it is a
# profile of width against height rather than one number.
#
# Measured in the rest pose, in metres of height, as (z, width multiplier):
WIDTH_PROFILE = [
    (1.320, 1.00),   # neck -- untouched, or she gets a wrestler's collar
    (1.245, 1.15),   # shoulder
    (1.150, 1.08),   # ribs
    (1.020, 0.98),   # waist, drawn in against the two either side of it
    (0.900, 1.20),   # hip -- the widest point
    (0.820, 1.14),   # where the legs part; below this the torso rule stops
]
# Depth follows width at a fraction of it: a body that widens without deepening
# reads as flattened, like a figure pressed in a book.
DEPTH_SHARE = 0.55

# Below this the body is two legs rather than one torso, and the rule changes.
LEG_TOP_Z = 0.820
# Legs are thickened about their OWN axis, not about the body's. Scaling a leg
# outward from the centre line only moves it sideways -- it was doing nothing
# for the stick-thin look, which is a large part of why she still read as a
# doll. This is roughly where each leg's axis sits in the rest pose.
LEG_AXIS_X = 0.072
LEG_THICKEN = [
    (0.820, 1.38),   # top of the thigh
    (0.520, 1.24),   # knee
    (0.230, 1.20),   # calf
    (0.060, 1.04),   # ankle
]

# Arms, thickened about their own axis too. Untouched they stay stick-thin
# while the body fills out, which reads worse than either on its own -- the
# base model's arms are the narrowest thing on her. In the rest pose they lie
# along x at about this height, so the cross-section to scale is (y, z).
ARM_AXIS_Z = 1.222
ARM_START_X = 0.205
ARM_THICKEN = [
    (0.640, 1.10),   # wrist -- the far end, in |x| rather than z
    (0.205, 1.26),   # shoulder end
]

# The profile is applied to the torso only. In the rest pose her arms lie along
# x at roughly shoulder height, so scaling x there would stretch the arms
# outward -- lengthening them rather than thickening the body. The scaling
# fades out between these two, which puts the blend in the shoulder.
TORSO_HALF_WIDTH = 0.175
ARM_BLEND_END = 0.265
# Widening the body without widening what it wears pushes her through her own
# clothes, so this runs over every mesh that is not part of her head.
WIDEN_EXCLUDE = ("Face", "Hair", "Ear", "Braid", "Yukata")


def _profile_at(z, profile=WIDTH_PROFILE):
    """Linear interpolation down the table, flat outside its ends."""
    if z >= profile[0][0]:
        return profile[0][1]
    if z <= profile[-1][0]:
        return profile[-1][1]
    for (z0, w0), (z1, w1) in zip(profile, profile[1:]):
        if z1 <= z <= z0:
            t = (z0 - z) / (z0 - z1)
            return w0 + (w1 - w0) * t
    return 1.0


def widen_silhouette(arm, profile=WIDTH_PROFILE, depth_share=DEPTH_SHARE,
                     strength=1.0):
    """Give her an adult's width, as an edit to the rest mesh.

    Applied as an offset that fades out toward the arms rather than a flat
    multiply, so the torso broadens while the arms keep their length.
    """
    moved = 0
    for obj in character_meshes(arm):
        if any(k in obj.name for k in WIDEN_EXCLUDE):
            continue
        mesh = obj.data
        for vert in mesh.vertices:
            x, y, z = vert.co
            if z < LEG_TOP_Z:
                # Thicken each leg about its own axis, so it gets rounder
                # instead of merely moving further from its twin.
                gain = (_profile_at(z, LEG_THICKEN) - 1.0) * strength
                if abs(gain) < 1e-5:
                    continue
                axis = LEG_AXIS_X if x >= 0 else -LEG_AXIS_X
                vert.co = (axis + (x - axis) * (1 + gain),
                           y * (1 + gain),
                           z)
                moved += 1
                continue

            reach = abs(x)
            if reach >= ARM_START_X:
                # Arm: scale its cross-section about the arm's own axis. The
                # profile is read against |x| here, since an arm in the rest
                # pose runs along x rather than up z.
                span = (ARM_THICKEN[0][0] - reach) / (ARM_THICKEN[0][0] - ARM_THICKEN[1][0])
                span = min(max(span, 0.0), 1.0)
                arm_gain = (ARM_THICKEN[0][1] + span *
                            (ARM_THICKEN[1][1] - ARM_THICKEN[0][1]) - 1.0) * strength
                vert.co = (x,
                           y * (1 + arm_gain),
                           ARM_AXIS_Z + (z - ARM_AXIS_Z) * (1 + arm_gain))
                moved += 1
                continue

            gain = (_profile_at(z, profile) - 1.0) * strength
            if abs(gain) < 1e-5:
                continue
            if reach >= ARM_BLEND_END:
                continue
            if reach > TORSO_HALF_WIDTH:
                fade = 1.0 - (reach - TORSO_HALF_WIDTH) / (ARM_BLEND_END - TORSO_HALF_WIDTH)
            else:
                fade = 1.0
            vert.co = (x * (1 + gain * fade),
                       y * (1 + gain * depth_share * fade),
                       z)
            moved += 1
        mesh.update()
    log(f"widened {moved} vertices toward an adult silhouette")
    return moved


def character_meshes(arm):
    """Only the meshes that belong to this character.

    Explicitly, rather than by scanning the scene: measure() originally walked
    every mesh in bpy.data, which is correct exactly as long as the character
    is alone. Dropped into the engawa set it measured the deck, the house and
    the bamboo too and reported her as 8.7 m tall at 38.87 head-counts, and the
    solver then dutifully drove the scales to their clamps trying to fix it.
    """
    found = []
    for obj in bpy.data.objects:
        if obj.type != "MESH":
            continue
        if any(m.type == "ARMATURE" and m.object == arm for m in obj.modifiers):
            found.append(obj)
            continue
        parent = obj.parent
        while parent is not None:
            if parent == arm:
                found.append(obj)
                break
            parent = parent.parent
    return found


def _mesh_bounds(objects, pred):
    deps = bpy.context.evaluated_depsgraph_get()
    lo = hi = None
    for obj in objects:
        if not pred(obj.name):
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        matrix = np.array(ev.matrix_world)
        world = co @ matrix[:3, :3].T + matrix[:3, 3]
        low, high = world.min(axis=0), world.max(axis=0)
        lo = low if lo is None else np.minimum(lo, low)
        hi = high if hi is None else np.maximum(hi, high)
        ev.to_mesh_clear()
    return lo, hi


def measure(arm):
    """Height, head height, head-count and leg ratio, from the posed mesh."""
    meshes = character_meshes(arm)
    body_lo, body_hi = _mesh_bounds(
        meshes, lambda n: not any(k in n for k in NOT_BODY))
    face_lo, face_hi = _mesh_bounds(meshes, lambda n: n == "Face")
    height = float(body_hi[2] - body_lo[2])
    head = float(face_hi[2] - face_lo[2])
    hips = (arm.matrix_world @ arm.pose.bones["J_Bip_C_Hips"].head).z
    return {
        "height": height,
        "head": head,
        "head_count": height / head,
        "leg_ratio": (hips - float(body_lo[2])) / height,
        "floor": float(body_lo[2]),
    }


def report(label, m):
    log(f"{label:<10} height {m['height']:.3f} m   head {m['head']:.3f} m   "
        f"{m['head_count']:.2f} head-counts   legs {m['leg_ratio'] * 100:.1f}%")


def apply(arm, head_scale=1.0, leg_scale=1.0, keep_feet=True):
    """Shrink the head and lengthen the legs, on the pose.

    Legs scale along the bone's own Y, which is its length axis, so the thigh
    and shin stretch and everything below them travels down with the change.
    Feet opt out of inheriting it, or they grow into flippers as the legs get
    longer -- foot size is not part of what makes a silhouette read as taller.
    """
    for bone in LEG_BONES:
        pb = arm.pose.bones[bone]
        pb.scale = (1.0, leg_scale, 1.0)
    if keep_feet:
        for bone in FOOT_BONES:
            arm.pose.bones[bone].bone.inherit_scale = "NONE"

    arm.pose.bones[HEAD_BONE].scale = (head_scale,) * 3
    bpy.context.view_layer.update()


def solve(arm, target="bishoujo", head_share=0.55, iterations=14,
          damping=0.7, limits=(0.70, 1.45)):
    """Reach a target head-count by splitting the work between head and legs.

    head_share says how much of the correction comes from shrinking the head
    rather than lengthening the legs. Solved by measuring rather than by
    algebra: leg scaling moves her height, which moves the head-count it was
    meant to fix, so a closed form chases its own tail. Each pass measures,
    corrects a damped fraction of the remaining error, and measures again.

    The first version of this multiplied the leg scale by a flat 1.6 every
    pass on top of the correction -- a number with no reasoning behind it,
    which compounded to 16x over six passes and produced a 14.9 head-count
    figure on stilts. Hence the clamp: a scale outside `limits` is not a
    proportion tweak, it is a bug, and it should stop rather than converge on
    something absurd.
    """
    _, count_goal = TARGETS[target]
    head_scale = leg_scale = 1.0
    low, high = limits
    for step in range(iterations):
        current = measure(arm)
        error = count_goal / current["head_count"]
        if abs(error - 1.0) < 0.002:
            break
        head_scale = min(max(head_scale / error ** (head_share * damping), low), high)
        leg_scale = min(max(leg_scale * error ** ((1 - head_share) * damping), low), high)
        apply(arm, head_scale, leg_scale)
    final = measure(arm)
    if abs(final["head_count"] - count_goal) > 0.05:
        log(f"WARNING: stopped at {final['head_count']:.2f} head-counts, "
            f"wanted {count_goal} -- head {head_scale:.3f} legs {leg_scale:.3f} "
            f"(clamped to {low}-{high})")
    return head_scale, leg_scale


def fit_height(root, arm, target_height):
    """Scale the whole figure to an absolute height, feet still on the floor."""
    current = measure(arm)
    root.scale = tuple(s * (target_height / current["height"]) for s in root.scale)
    bpy.context.view_layer.update()
    current = measure(arm)
    root.location.z -= current["floor"]
    bpy.context.view_layer.update()


def restyle(root, arm, target="model", head_share=0.55, widen=True):
    before = measure(arm)
    report("before", before)
    if widen:
        # Width first: it edits the rest mesh, and the head-count solve that
        # follows measures the figure it actually produces.
        widen_silhouette(arm)
    head_scale, leg_scale = solve(arm, target, head_share)
    fit_height(root, arm, TARGETS[target][0])
    after = measure(arm)
    report("after", after)
    log(f"head scaled {head_scale:.3f}, legs {leg_scale:.3f}, "
        f"target '{target}' = {TARGETS[target][1]} head-counts "
        f"at {TARGETS[target][0]:.2f} m")
    return before, after


def _studio(target_height=1.75):
    """A plain front-on studio, framed on a standing figure of roughly this size."""
    from mathutils import Vector
    key = bpy.data.lights.new("Key", type="AREA")
    key.energy, key.size = 420, 2.0
    ko = bpy.data.objects.new("Key", key)
    bpy.context.scene.collection.objects.link(ko)
    ko.location = (1.4, 2.4, 2.4)
    ko.rotation_euler = (Vector((0, 0, 0.9)) - Vector(ko.location)
                         ).to_track_quat("-Z", "Y").to_euler()
    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.30, 0.32, 0.36, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    cam_data = bpy.data.cameras.new("C")
    cam_data.lens = 60
    cam = bpy.data.objects.new("C", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    # Fixed camera, deliberately: the whole point is comparing two figures, and
    # a camera that reframes for each one hides exactly the difference.
    cam.location = (0.0, 4.2, 0.88)
    cam.rotation_euler = (Vector((0, 0, 0.85)) - Vector(cam.location)
                          ).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False
    scene.cycles.samples = 70
    scene.render.resolution_x, scene.render.resolution_y = 620, 1000
    scene.view_settings.view_transform = "Filmic"


def _render(path):
    os.makedirs(OUT_DIR, exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("wrote", path)


if __name__ == "__main__":
    bpy.ops.wm.read_factory_settings(use_empty=True)
    import blender_character
    root, arm = blender_character.build_character()
    # The cardigan comes off for this comparison. It is a bulky garment and it
    # hides the silhouette these renders exist to show -- judging a body shape
    # through it is guesswork.
    import blender_garment
    blender_garment.strip_garment()

    for obj in bpy.data.objects:
        if obj.type == "MESH" and any(k in obj.name for k in NOT_BODY):
            obj.visible_shadow = False
    _studio()
    report("stock", measure(arm))
    _render(os.path.join(OUT_DIR, "proportions_before.png"))
    restyle(root, arm, "model")
    _render(os.path.join(OUT_DIR, "proportions_after.png"))

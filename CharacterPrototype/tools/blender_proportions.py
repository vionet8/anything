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
NOT_BODY = ("Hair", "Ear", "Braid")


def log(*a):
    print("[proportions]", *a)


def _mesh_bounds(pred):
    deps = bpy.context.evaluated_depsgraph_get()
    lo = hi = None
    for obj in bpy.data.objects:
        if obj.type != "MESH" or not pred(obj.name):
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
    body_lo, body_hi = _mesh_bounds(lambda n: not any(k in n for k in NOT_BODY))
    face_lo, face_hi = _mesh_bounds(lambda n: n == "Face")
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


def restyle(root, arm, target="bishoujo", head_share=0.55):
    before = measure(arm)
    report("before", before)
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
    for obj in bpy.data.objects:
        if obj.type == "MESH" and any(k in obj.name for k in NOT_BODY):
            obj.visible_shadow = False
    _studio()
    report("stock", measure(arm))
    _render(os.path.join(OUT_DIR, "proportions_before.png"))
    restyle(root, arm, "bishoujo")
    _render(os.path.join(OUT_DIR, "proportions_after.png"))

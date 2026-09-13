"""Pose the character, drop her into the engawa set, and render the shot.

Run:
  blender --background --python tools/blender_compose.py -- [options]

    --pose-only   skip the set, render her on a bare plane (fast pose iteration)
    --quick       low samples / small frame, for looking at a change
    --front       a second camera straight down the deck, to check the pose reads
                  from another angle before committing to a long render

The pose is data at the top of this file rather than code, because getting a
lying-down pose right without a viewport is a loop of nudge-render-look and
that loop should cost one number, not a code edit.

Axis conventions below are measured, not guessed (a probe rotated each bone 40
degrees per local axis and reported where the child joint moved in world space):

  she faces -Y standing, +Z is up, +X is her left as seen from the front
  UpperLeg  -X swings the thigh forward/up (knee toward chest); +Z abducts
  LowerLeg  +X bends the knee (heel toward seat) -- knees bend one way only
  UpperArm  +Z lowers the LEFT arm from T-pose, -Z lowers the RIGHT one
            +Y swings the left arm forward, -Y the right
  Neck/Head -X tips the head back (chin up); +X nods it forward
  Spine     +X curls her forward

The bind pose is a T-pose, so every arm angle here is measured from horizontal.
"""
import math
import os
import shutil
import sys

import bpy
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

FALLBACK_VRM = os.path.join(PROJECT, "assets", "char-e.vrm")
OUT_DIR = os.path.join(PROJECT, "assets", "blender")

D = math.radians

# --- The pose ---------------------------------------------------------------
# Lying on her back on the deck: knees up, head tipped back toward the camera,
# one arm flung out toward the cat and the other bent up beside her head.
#
# Read these as "from the T-pose bind", per bone, in her own frame -- the root
# transform below is what lays the whole posed figure down, so these stay
# authored as if she were standing.
POSE = {
    # Knees up. The thigh swing is the big one; without the matching knee bend
    # she reads as doing a leg raise rather than lying comfortably.
    "J_Bip_L_UpperLeg": (D(-51), 0, D(6)),
    "J_Bip_R_UpperLeg": (D(-58), 0, D(-10)),
    "J_Bip_L_LowerLeg": (D(118), 0, 0),
    "J_Bip_R_LowerLeg": (D(128), 0, 0),
    # Feet flat-ish on the deck rather than pointed, which reads as resting.
    "J_Bip_L_Foot": (D(18), 0, 0),
    "J_Bip_R_Foot": (D(14), 0, 0),

    # Arms. Left goes out and back along the deck past her head; right reaches
    # out to the side toward where the cat lies.
    "J_Bip_L_UpperArm": (0, D(-4), D(38)),
    "J_Bip_L_LowerArm": (0, D(-30), D(20)),
    "J_Bip_R_UpperArm": (0, D(-6), D(-64)),
    "J_Bip_R_LowerArm": (0, D(14), D(-16)),
    "J_Bip_L_Hand": (0, 0, D(10)),
    "J_Bip_R_Hand": (0, 0, D(-8)),

    # Head tipped back and turned slightly toward the camera. Split across neck
    # and head so the throat line curves instead of hinging at one joint.
    "J_Bip_C_Neck": (D(-30), 0, D(-8)),
    "J_Bip_C_Head": (D(-26), 0, D(-10)),

    # A little life in the torso: a slight arch and twist, so she isn't a plank.
    "J_Bip_C_Spine": (D(-5), 0, D(4)),
    "J_Bip_C_Chest": (D(-4), 0, D(3)),
}

# --- Where she lies ---------------------------------------------------------
# X=-90 lays her on her back (her front, -Y, rotates to face +Z); Z=180 then
# spins her about the vertical so her head points at the water and the camera
# rather than at the house. Blender's default XYZ euler applies X before Z,
# which is the order that keeps her on her back rather than face-down.
ROOT_ROTATION = (D(-90), 0, D(180))
ROOT_XY = (-0.15, 0.82)      # where on the deck she lies
LYING_HIP_HEIGHT = 0.135     # hip joint above the planks, lying on her back

# --- Camera -----------------------------------------------------------------
# The reference is a tall portrait frame from above and in front, looking down
# the length of her with the house behind and the water at the bottom edge.
CAM_LOC = (1.02, -1.52, 1.72)
CAM_AIM = (-0.12, -0.08, 0.20)
CAM_LENS = 38
CAM_FRONT_LOC = (2.6, -1.5, 1.5)
CAM_FRONT_AIM = (0.0, 0.30, 0.30)

RES = (1000, 1500)
SAMPLES = 220
QUICK_RES = (440, 660)
QUICK_SAMPLES = 28


def argv():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


def log(*a):
    print("[compose]", *a)


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_fallback_character():
    """Import char-e.vrm straight, for iterating before the real build exists."""
    tmp = os.path.join("/tmp", "_compose_char.glb")
    shutil.copyfile(FALLBACK_VRM, tmp)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=tmp)
    os.remove(tmp)
    added = [o for o in bpy.data.objects if o not in before]
    arm = next((o for o in added if o.type == "ARMATURE"), None)
    roots = [o for o in added if o.parent is None]
    return (roots[0] if roots else arm), arm


def load_character(force_fallback=False):
    """The real character if it has been built, otherwise the plain VRM.

    --fallback exists because the pose can be worked on against the plain VRM
    while the finished character is still being built elsewhere; iterating a
    pose against a half-built character means chasing someone else's
    in-progress state instead of your own.
    """
    if force_fallback:
        log("forced fallback: posing against char-e.vrm")
        return import_fallback_character()
    try:
        import blender_character
    except ImportError:
        log("blender_character.py not present -- falling back to char-e.vrm")
        return import_fallback_character()
    log("building character from blender_character.build_character()")
    return blender_character.build_character()


def apply_pose(arm):
    missing = []
    for bone_name, rotation in POSE.items():
        pb = arm.pose.bones.get(bone_name)
        if pb is None:
            missing.append(bone_name)
            continue
        pb.rotation_mode = "XYZ"
        pb.rotation_euler = rotation
    if missing:
        # Loudly: a renamed bone would otherwise just quietly not be posed, and
        # a figure that is 90% posed reads as a bug in the pose, not a typo.
        raise SystemExit(f"pose targets missing from rig: {missing}")
    bpy.context.view_layer.update()


def evaluated_bounds(root):
    """World-space (min, max) over the posed, deformed meshes under root."""
    deps = bpy.context.evaluated_depsgraph_get()
    lo = hi = None
    stack = [root]
    seen = set()
    while stack:
        obj = stack.pop()
        if obj.name in seen:
            continue
        seen.add(obj.name)
        stack.extend(obj.children)
        if obj.type != "MESH":
            continue
        # bound_box ignores armature deformation, so the posed figure has to be
        # measured from the evaluated mesh or she floats/sinks by the amount the
        # pose moved her.
        eval_obj = obj.evaluated_get(deps)
        mesh = eval_obj.to_mesh()
        for v in mesh.vertices:
            w = eval_obj.matrix_world @ v.co
            if lo is None:
                lo, hi = w.copy(), w.copy()
            else:
                lo.x, lo.y, lo.z = min(lo.x, w.x), min(lo.y, w.y), min(lo.z, w.z)
                hi.x, hi.y, hi.z = max(hi.x, w.x), max(hi.y, w.y), max(hi.z, w.z)
            if w.z < _lowest["z"]:
                _lowest.update(z=w.z, name=obj.name, at=(w.x, w.y))
        eval_obj.to_mesh_clear()
    return lo, hi


# Which mesh reaches deepest, tracked alongside the bounds: "something is 10cm
# under the deck" is not actionable, "her hair is 10cm under the deck" is.
_lowest = {"z": 1e9, "name": None, "at": (0, 0)}


def report_sinking(deck_z=0.0, tolerance=0.005):
    if _lowest["name"] is None:
        return
    depth = deck_z - _lowest["z"]
    if depth > tolerance:
        log(f"  SINKING: {_lowest['name']} reaches {depth:.3f} below the deck "
            f"at x={_lowest['at'][0]:+.2f} y={_lowest['at'][1]:+.2f}")
    else:
        log("  nothing sinks below the deck")


def lay_down(root, arm):
    apply_pose(arm)
    root.rotation_mode = "XYZ"
    root.rotation_euler = ROOT_ROTATION
    root.location = (ROOT_XY[0], ROOT_XY[1], 0.0)
    bpy.context.view_layer.update()

    # Rest her by the hips rather than by her lowest vertex. Dropping the whole
    # mesh onto its minimum leaves the figure hanging off whichever single point
    # happens to reach furthest -- an outflung fingertip did exactly that, and
    # propped her whole body 20cm above the planks. The hip height of someone
    # lying on their back is about half the depth of the pelvis, and that is a
    # number that stays true whatever the arms are doing.
    hips = arm.pose.bones.get("J_Bip_C_Hips")
    root.location.z += LYING_HIP_HEIGHT - (arm.matrix_world @ hips.head).z
    bpy.context.view_layer.update()

    _lowest.update(z=1e9, name=None, at=(0, 0))
    lo, hi = evaluated_bounds(root)
    log(f"posed bounds  x [{lo.x:+.2f} {hi.x:+.2f}]  "
        f"y [{lo.y:+.2f} {hi.y:+.2f}]  z [{lo.z:+.2f} {hi.z:+.2f}]")
    log(f"posed centre  ({(lo.x + hi.x) / 2:+.2f}, {(lo.y + hi.y) / 2:+.2f}, "
        f"{(lo.z + hi.z) / 2:+.2f})")
    report_sinking()
    report_joints(arm)
    return (lo + hi) / 2


# Where the joints should land for the shot, so a pose can be checked against
# numbers instead of squinting at a render: she lies with her head at -Y and
# her feet at +Y, so a relaxed knees-up pose wants the knee high (Z around
# 0.45-0.55) and the foot back down near the planks (Z under about 0.15).
JOINT_REPORT = ("J_Bip_C_Head", "J_Bip_C_Hips",
                "J_Bip_L_UpperLeg", "J_Bip_L_LowerLeg", "J_Bip_L_Foot",
                "J_Bip_R_LowerLeg", "J_Bip_R_Foot",
                "J_Bip_L_Hand", "J_Bip_R_Hand")


def report_joints(arm):
    for name in JOINT_REPORT:
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        w = arm.matrix_world @ pb.head
        log(f"  {name:<20} ({w.x:+.2f}, {w.y:+.2f}, {w.z:+.2f})")


def add_camera(loc, aim, lens):
    cam_data = bpy.data.cameras.new("Camera")
    cam_data.lens = lens
    cam = bpy.data.objects.new("Camera", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    direction = Vector(aim) - Vector(loc)
    cam.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam
    return cam


def bare_stage():
    """A plain lit floor, for judging the pose without the whole set."""
    bpy.ops.mesh.primitive_plane_add(size=14, location=(0, 0, 0))
    floor = bpy.context.object
    mat = bpy.data.materials.new("Stage")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (
        0.35, 0.30, 0.25, 1)
    floor.data.materials.append(mat)

    sun = bpy.data.lights.new("Sun", type="SUN")
    sun.energy = 3.2
    sun.angle = D(3)
    sun_obj = bpy.data.objects.new("Sun", sun)
    bpy.context.scene.collection.objects.link(sun_obj)
    sun_obj.rotation_euler = (D(52), 0, D(35))

    world = bpy.data.worlds.new("World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.5, 0.6, 0.75, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.9
    bpy.context.scene.world = world


def configure_render(quick):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    # This apt build ships without OpenImageDenoise -- enabling denoising is a
    # hard RuntimeError here, not a warning, so noise is fought with samples.
    scene.cycles.use_denoising = False
    scene.cycles.samples = QUICK_SAMPLES if quick else SAMPLES
    scene.render.resolution_x, scene.render.resolution_y = QUICK_RES if quick else RES
    scene.render.image_settings.file_format = "PNG"
    scene.view_settings.view_transform = "Filmic"


def render_to(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    log("wrote", path)


def main():
    args = argv()
    quick = "--quick" in args
    pose_only = "--pose-only" in args

    clear_scene()

    if pose_only:
        bare_stage()
    else:
        import blender_scene
        blender_scene.build_scene()
        if hasattr(blender_scene, "build_lighting"):
            blender_scene.build_lighting()

    root, arm = load_character(force_fallback="--fallback" in args)
    if arm is None:
        raise SystemExit("character has no armature -- cannot pose")
    centre = lay_down(root, arm)

    if "--measure" in args:
        # Tuning a pose is a search over joint positions, and reading those as
        # numbers converges far faster than rendering each guess and squinting.
        return

    configure_render(quick)

    tag = "pose" if pose_only else "shot"
    suffix = "-quick" if quick else ""
    front = "--front" in args
    loc, aim, lens = ((CAM_FRONT_LOC, CAM_FRONT_AIM, 45) if front
                      else (CAM_LOC, CAM_AIM, CAM_LENS))
    if pose_only:
        # Judging a pose means seeing all of her, so the bare stage aims itself
        # at what she actually occupies rather than at the shot's framing.
        aim = tuple(centre)
        offset = Vector(loc) - Vector(CAM_AIM if not front else CAM_FRONT_AIM)
        loc = tuple(Vector(aim) + offset * 0.85)
    add_camera(loc, aim, lens)
    render_to(os.path.join(OUT_DIR,
                           f"compose-{tag}{'-front' if front else ''}{suffix}.png"))


main()

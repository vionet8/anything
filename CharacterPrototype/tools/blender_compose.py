"""Pose the character, drop her into the engawa set, and render the shot.

Run:
  blender --background --python tools/blender_compose.py -- [options]

    --pose-only   skip the set, render her on a bare plane (fast pose iteration)
    --quick       low samples / small frame, for looking at a change
    --front       a second camera straight down the deck, to check the pose reads
                  from another angle before committing to a long render
    --bare        strip the garment instead of dressing her, so the silhouette
                  itself can be judged without cloth in the way
    --stock-body  skip the width and head-count work and use the sample's own
                  proportions

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
POSE_SEATED = {
    # Sitting on the edge of the engawa facing the water, legs hanging over it,
    # leaning back on her hands. This is the pose the shot uses.
    #
    # The legs hang rather than lying along the deck because thigh flexion on
    # this rig dips as it swings (the measured axis is tilted: -X carries the
    # knee forward AND down), so legs stretched out flat fought the boards the
    # whole way. Over the edge that dip is exactly what dangling legs do.
    #
    # It replaced a lying-on-her-back pose that matched the reference more
    # literally but could not be made to work: her hair is one rigid mesh
    # skinned to the head bone, with no bones of its own long enough to pose
    # (the hair joints are crown stubs -- 40 degrees moves a chain tip 7mm), so
    # laid on her back the whole length of it swung out across her body as a
    # stiff white fan. Sitting up, the same geometry hangs down her back and
    # behaves by construction rather than by tuning.
    "J_Bip_L_UpperLeg": (D(78), 0, D(5)),
    "J_Bip_R_UpperLeg": (D(80), 0, D(-7)),
    "J_Bip_L_LowerLeg": (D(-72), 0, 0),
    "J_Bip_R_LowerLeg": (D(-66), 0, 0),
    # Ankles loose, the way feet hang when they are carrying no weight.
    "J_Bip_L_Foot": (D(-14), 0, D(6)),
    "J_Bip_R_Foot": (D(-10), 0, D(-5)),

    # Arms planted behind her, taking her weight. Down from the T-pose, then
    # swung back so the hands land behind her hips rather than beside them.
    "J_Bip_L_UpperArm": (0, D(26), D(74)),
    "J_Bip_R_UpperArm": (0, D(-30), D(-72)),
    "J_Bip_L_LowerArm": (0, D(10), D(6)),
    "J_Bip_R_LowerArm": (0, D(-12), D(-8)),
    "J_Bip_L_Hand": (D(-20), 0, 0),
    "J_Bip_R_Hand": (D(-20), 0, 0),

    # Leaning back through the spine, chin up a little and turned toward the
    # camera -- the lean is what makes it lounging rather than sitting to
    # attention.
    # A shallow lean, not the deep one this pose wants. Rigid hair rides the
    # head, so every degree the torso goes back swings half a metre of hair
    # forward -- at 16 degrees it closed over her face like a curtain. Six
    # degrees still reads as leaning on her hands and leaves her face clear.
    "J_Bip_C_Spine": (D(6), 0, 0),
    "J_Bip_C_Chest": (D(4), 0, D(3)),
    # Chin down rather than up, which is not the lounging tilt it wants to be
    # but is the one her hair allows: the hair is rigid and rides the head, so
    # tipping her head back swings the whole length of it forward and hangs it
    # over her face like a curtain. Looking down at the water keeps it behind
    # her -- and is what someone sitting over a pond would be doing anyway.
    "J_Bip_C_Neck": (D(-7), 0, D(-10)),
    "J_Bip_C_Head": (D(-5), 0, D(-12)),
}

POSE_LYING = {
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
ROOT_ROTATION_LYING = (D(-90), 0, D(180))
# Seated she stays upright; she already faces -Y, which is the water and the
# camera, so she needs no yaw either.
ROOT_ROTATION_SEATED = (0, 0, D(180))
ROOT_XY_LYING = (-0.15, 0.82)
ROOT_XY_SEATED = (-0.10, -0.62)
HIP_HEIGHT = 0.12            # hip joint above the boards, pelvis resting on them
# Meshes allowed through the boards without the figure being lifted off them:
# the deck is opaque and the camera looks down at it, so clipped hair reads as
# hair spread on the planks.
DECORATIVE = ("Hair", "Ear")

# --- Camera -----------------------------------------------------------------
# From out over the water, looking back at the veranda: her at the edge, the
# house behind her, water in the foreground.
#
# The steep overhead angle the reference uses was right for a figure lying flat
# and wrong for this one -- on a seated figure it looked down at the top of her
# head and never found her face. Sitting up wants a camera near her own height.
CAM_LOC = (0.95, -2.60, 1.15)
CAM_AIM = (-0.10, -0.50, 0.42)
CAM_LENS = 45
CAM_FRONT_LOC = (2.6, -1.5, 1.5)
CAM_FRONT_AIM = (0.0, 0.30, 0.30)

RES = (1000, 1500)
SAMPLES = 220
QUICK_RES = (620, 930)
QUICK_SAMPLES = 55


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


# Her braids are grown rather than grafted: blender_hair generates them along a
# path, so they need no bones and no draping -- for a different pose the path
# is simply written differently. The colours match the silver the rest of her
# hair was recoloured to, and the ties pick up the blue already in her outfit.
BRAID_SILVER = (0.80, 0.81, 0.84)
BRAID_RIBBON = (0.16, 0.26, 0.58)


def _flat_material(name, colour, roughness=0.34):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    return mat


def add_braids(arm):
    import blender_hair
    return blender_hair.attach_braids(
        arm,
        _flat_material("BraidSilver", BRAID_SILVER),
        _flat_material("BraidRibbon", BRAID_RIBBON, roughness=0.45),
    )


# Which body-type target from the proportion chart she is built to. The stock
# VRoid sample measures 6.90 head-counts, which is a child's proportion and
# most of why she read younger than the reference art.
PROPORTION_TARGET = "model"


def widen_body(arm):
    """Broaden the torso and limbs, as an edit to the rest mesh.

    Split out from apply_proportions and run first because everything after it
    is measured against the body it produces: the garment reshape reads
    rest-mesh coordinates, and the head-count solve measures the figure that
    actually exists. Width only moves x and y, so the garment's z landmarks
    (shoulder line, arm centreline, hem) survive it unchanged -- which is why
    this runs before the cloth rather than after it.
    """
    import blender_proportions

    return blender_proportions.widen_silhouette(arm)


def dress(arm):
    """Pull the cardigan into a yukata and add what a cardigan cannot supply.

    Run before the head-count solve and before the pose. Before the solve
    because build_yukata authors its collar and sash in rest-pose world
    coordinates, and the solve rescales the figure around them -- built after,
    they would be sized for the body she used to have. Before the pose because
    the pieces hang off bones, so the rig carries them into it.
    """
    import blender_garment

    blender_garment.reshape_tops_into_yukata()
    return blender_garment.build_yukata(arm)


def apply_proportions(root, arm, target=PROPORTION_TARGET):
    """Retarget her head-count, then let the usual grounding put her back down.

    Called after the braids exist and before she is posed. After, because the
    braids hang off the head bone and so shrink with the head as they should --
    built afterwards they would be sized for a head that no longer exists.
    Before, because posing only writes rotations, so the scales set here
    survive it untouched.

    Only the bone scaling and the overall height scale are taken from
    blender_proportions; where her feet end up is left to place(), which
    already grounds her by hip height and now simply does it at her new size.
    """
    import blender_proportions

    before = blender_proportions.measure(arm)
    blender_proportions.solve(arm, target)
    height_goal = blender_proportions.TARGETS[target][0]
    mid = blender_proportions.measure(arm)
    root.scale = tuple(v * (height_goal / mid["height"]) for v in root.scale)
    bpy.context.view_layer.update()
    after = blender_proportions.measure(arm)
    log(f"proportions '{target}': {before['head_count']:.2f} -> "
        f"{after['head_count']:.2f} head-counts, "
        f"legs {before['leg_ratio'] * 100:.1f}% -> {after['leg_ratio'] * 100:.1f}%, "
        f"height {after['height']:.3f} m")


def silence_hair_shadows(root):
    """Stop the hair casting shadows, which is what the grey veils were.

    VRoid hair is dozens of overlapping transparent cards. Cycles traces every
    layer honestly, so the stack shadows itself into broad grey sheets that
    hang down her face and chest -- they survived a hard alpha cutoff on the
    cards because they were never a surface problem, and switching shadow
    casting off on the hair alone removes them completely (checked both ways).
    Nothing of value is lost: this is anime hair, whose shading is painted into
    the texture, and raytraced self-shadowing of stacked cards fights that
    rather than adding to it.
    """
    for obj in bpy.data.objects:
        if obj.type == "MESH" and any(k in obj.name
                                      for k in ("Hair", "Ear", "Braid")):
            obj.visible_shadow = False


def apply_pose(arm, pose):
    missing = []
    for bone_name, rotation in pose.items():
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


DECK_FRONT = -0.75   # matches blender_scene.py: the boards end over the water


def report_sinking(deck_z=0.0, tolerance=0.005):
    if _lowest["name"] is None:
        return
    if _lowest["at"][1] < DECK_FRONT:
        # Past the edge there are no boards to sink through -- that is the
        # water, and her legs hanging over it is the pose, not a fault.
        log("  nothing sinks through the boards (lowest point is past the edge)")
        return
    depth = deck_z - _lowest["z"]
    if depth > tolerance:
        log(f"  SINKING: {_lowest['name']} reaches {depth:.3f} below the deck "
            f"at x={_lowest['at'][0]:+.2f} y={_lowest['at'][1]:+.2f}")
    else:
        log("  nothing sinks below the deck")


def place(root, arm, lying):
    apply_pose(arm, POSE_LYING if lying else POSE_SEATED)
    root.rotation_mode = "XYZ"
    root.rotation_euler = ROOT_ROTATION_LYING if lying else ROOT_ROTATION_SEATED
    xy = ROOT_XY_LYING if lying else ROOT_XY_SEATED
    root.location = (xy[0], xy[1], 0.0)
    bpy.context.view_layer.update()

    # Rest her on her body, ignoring hair and ears. Whichever part of her is
    # lowest is what the deck should meet -- her seat and calves sitting, her
    # shoulders lying -- but hair and ears are decorative geometry that is
    # allowed to pass through the boards (the deck is opaque and the camera
    # looks down at it, so clipped hair just reads as hair spread on the
    # planks). Include them and the longest strand becomes a tent pole holding
    # the rest of her in the air.
    # One rule for both poses: her pelvis is what rests on the boards, so the
    # hip joint sits a fixed height above them. Resting her on her lowest
    # vertex instead was tried twice and failed twice -- once on an outflung
    # fingertip, once on a handful of vertices that extreme hip flexion had
    # flung clear of the body through linear blend skinning -- and both times
    # it left the whole figure hanging in the air. Hip height does not care
    # what her limbs are doing, which is the point: sitting at the edge her
    # legs hang BELOW the deck on purpose.
    hips = arm.pose.bones["J_Bip_C_Hips"]
    root.location.z += HIP_HEIGHT - (arm.matrix_world @ hips.head).z
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


# A rim light behind her was tried here and removed. Her skin and the sunlit
# boards sit in the same luminance band (face 205, deck 202 on a 0-255 median,
# with nothing clipping anywhere), so the frame's flatness is a separation
# problem rather than an exposure one -- but a rim cannot fix it in this set.
# The boards fill the space between her and the house, so any light placed to
# graze her edge lights them too: high and broad it raised both together, and
# low and tight behind her it put the deck AHEAD of her face (224 against 216).
# Her colours are what separate her here, not her value.


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
    if "--fallback" not in args:
        add_braids(arm)
        if "--stock-body" not in args:
            widen_body(arm)
        if "--bare" in args:
            import blender_garment
            blender_garment.strip_garment()
        else:
            dress(arm)
        if "--stock-body" not in args:
            apply_proportions(root, arm)
    silence_hair_shadows(root)
    if arm is None:
        raise SystemExit("character has no armature -- cannot pose")
    centre = place(root, arm, lying="--lying" in args)

    if "--objects" in args:
        for obj in sorted(bpy.data.objects, key=lambda o: o.name):
            if obj.type != "MESH":
                continue
            par = obj.parent.name if obj.parent else "-"
            bone = obj.parent_bone or "-"
            log(f"  {obj.name:<22} parent={par:<16} bone={bone:<18} "
                f"verts={len(obj.data.vertices)}")

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


if __name__ == "__main__":
    main()

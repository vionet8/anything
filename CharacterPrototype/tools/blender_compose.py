"""Pose the character, drop her into the engawa set, and render the shot.

Run:
  blender --background --python tools/blender_compose.py -- [options]

    --pose-only   skip the set, render her on a bare plane (fast pose iteration)
    --quick       low samples / small frame, for looking at a change
    --front       a second camera straight down the deck, to check the pose reads
                  from another angle before committing to a long render
    --lying       lay her on the deck instead of sitting her on the edge; the
                  hair is simulated as she goes down, since rigid hair cannot
                  lie down (--no-sim skips that, to see why)
    --head        frame her head from the shot camera's direction, to check
                  whether the face actually reads
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
  UpperLeg  +X swings the thigh forward/up (knee toward chest); +Z abducts
  LowerLeg  -X bends the knee (heel toward seat) -- knees bend one way only

  Both leg signs above were written down backwards, and stayed wrong long
  enough to be trusted. POSE_SEATED was authored against renders and uses the
  real signs (+78 thigh, -72 knee); POSE_LYING was authored against this
  comment and came out with its thighs swung backwards and both knees
  hyperextended past 115 degrees -- a doll, not a person. blender_anatomy.py
  now checks this rather than a comment: it measures which way the far end of
  each hinge travels and says so.
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
from mathutils import Matrix, Vector

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

_POSE_LYING_LEFT_DOWN = {
    # Lying on her side, so the legs stack rather than splay: the underneath
    # leg is nearly straight and the top one is drawn up over it.
    #
    # Every number here used to be sign-flipped. The thighs were swung
    # backwards and both knees bent the wrong way -- 116 and 126 degrees of
    # hyperextension -- because this pose was authored from a comment that had
    # both leg signs reversed. Check any change with blender_anatomy.audit().
    "J_Bip_L_UpperLeg": (D(20), 0, D(2)),
    # The top leg's Z is abduction, and its SIGN decides whether that leg
    # rests on the lower one or is driven through the deck: at -6 the right
    # shin ended 8 cm inside the boards, at +6 it lies 7 cm above them, on top
    # of the leg underneath, where a top leg belongs.
    "J_Bip_R_UpperLeg": (D(50), 0, D(6)),
    "J_Bip_L_LowerLeg": (D(-20), 0, 0),
    "J_Bip_R_LowerLeg": (D(-50), 0, 0),
    # Feet relaxed rather than flexed, which is what resting feet do. The ankle
    # angle barely moves the foot's lowest point, because that point is the
    # heel and the heel sits on the ankle's own axis -- so this is chosen for
    # how it looks, not to fix a contact.
    "J_Bip_L_Foot": (D(-16), 0, 0),
    "J_Bip_R_Foot": (D(-12), 0, 0),

    # The underneath arm reaches up along the boards past her head; the top arm
    # comes forward and rests across her front.
    #
    # On this rig the left arm's down-at-the-side is Z=+78 and the sign mirrors
    # between sides, so up-past-the-head is a large NEGATIVE Z. The first
    # version had +34 here, which is barely off the T-pose -- straight out
    # sideways -- and rolled onto her side that is straight DOWN: she spent the
    # whole shot balanced on that hand like a kickstand, hips and both legs
    # floating 30 cm above boards she was supposed to be lying on. It takes -96
    # rather than -80 for the forearm and hand to lie ON the deck instead of
    # through it.
    "J_Bip_L_UpperArm": (0, D(-20), D(-96)),
    "J_Bip_L_LowerArm": (0, D(-18), D(4)),
    "J_Bip_R_UpperArm": (0, D(12), D(-64)),
    "J_Bip_R_LowerArm": (0, D(38), D(-10)),
    "J_Bip_L_Hand": (0, 0, D(5)),
    "J_Bip_R_Hand": (0, 0, D(-8)),

    # Head lifted off the boards and turned toward the camera. Swept against
    # two numbers at once -- the angle between where her face points and where
    # the camera is, and the height of her nose above the planks -- because
    # aiming the face alone aims a face that may be lying ON the deck, which is
    # what the first version did: 17 degrees off the camera, nose at z=0.004,
    # and an ear 19 cm through the boards. On her side this lands near 10
    # degrees with the neck barely working.
    "J_Bip_C_Neck": (D(-10), 0, D(-10)),
    "J_Bip_C_Head": (D(-10), 0, D(-10)),

    # A little life in the torso: a slight arch and twist, so she isn't a plank.
    "J_Bip_C_Spine": (D(4), 0, D(3)),
    "J_Bip_C_Chest": (D(3), 0, D(2)),
}


def mirror_pose(pose):
    """Swap her left and right.

    Flexion is about X and keeps its sign; twist and abduction are about Y and
    Z and flip. That is just what mirroring a body does, and doing it in code
    beats doing it by hand: the pose above was solved with her LEFT side down,
    and the shot needs her rolled the other way so the bamboo overhanging the
    right of the frame is not across her face. Rolling her over without
    mirroring the pose swaps which leg is underneath while leaving the top
    leg's abduction pointing down -- the right shin went 19 cm into the boards.
    """
    mirrored = {}
    for name, (x, y, z) in pose.items():
        if "_L_" in name:
            other = name.replace("_L_", "_R_")
        elif "_R_" in name:
            other = name.replace("_R_", "_L_")
        else:
            other = name
        mirrored[other] = (x, -y, -z)
    return mirrored


# Not mirrored. Rolling her onto the other side was tried, to get her head out
# from under the foreground bamboo, and it cost the face: her hairstyle is not
# symmetric, so the side that carries the long hair ended up on top and it fell
# straight across her face. The bamboo is a framing device placed for the
# SEATED camera -- with a different camera it simply lands in the wrong place,
# so the bamboo moves and the pose stays as solved.
POSE_LYING = dict(_POSE_LYING_LEFT_DOWN)


# --- Where she lies ---------------------------------------------------------
# X=-90 lays her on her back (her front, -Y, rotates to face +Z); Z=180 then
# spins her about the vertical so her head points at the water and the camera
# rather than at the house. Blender's default XYZ euler applies X before Z,
# which is the order that keeps her on her back rather than face-down.
# How she lies, as the two things that are actually being decided: which way
# along the deck her head points, and how far she is rolled from flat on her
# back toward the camera. Euler triples are not decisions, they are the answer,
# so the rotation is built from these and the euler falls out.
#
# This is the third orientation tried and the first that works. Prone put her
# face 150 degrees from the camera and dropped every falling strand across it.
# Supine got the hair out of the way but cannot aim the face: flat on her back
# she looks at the sky, and the camera is not the sky -- the best the neck
# could manage was 60 degrees off, at the cost of a chin driven into her chest.
# On her side, facing the camera along the deck, the face comes within about
# 10 degrees with the neck barely doing anything, and the hair falls sideways
# onto the boards instead of onto her.
LYING_HEAD_DIR = (1.0, 0.0, 0.0)   # head toward +X
LYING_ROLL = D(88)                 # 0 is on her back, 90 is fully on her side


def lying_rotation(head_dir=LYING_HEAD_DIR, roll=LYING_ROLL):
    """Root euler for: head pointing head_dir, rolled `roll` from supine.

    Standing she is up +Z and faces +Y. Lying, her up becomes head_dir and her
    facing starts at +Z -- flat on her back -- and rolling turns that about
    head_dir.
    """
    up = Vector(head_dir).normalized()
    supine_face = Vector((0.0, 0.0, 1.0))
    if abs(up.dot(supine_face)) > 0.9:
        supine_face = Vector((0.0, 1.0, 0.0))
    supine_face = (supine_face - up * up.dot(supine_face)).normalized()
    facing = (Matrix.Rotation(roll, 3, up) @ supine_face).normalized()
    # Her RIGHT, not her left. Standing she faces +Y with her right hand at +X
    # (blender_character's convention), and +X cross +Y is +Z -- so right,
    # facing, up is the right-handed triple. Built from her left instead, the
    # matrix has determinant -1, and to_euler() on a mirror is not a rotation:
    # it put her head at -X when the caller asked for +X, and flipped her left
    # and right with it.
    right = facing.cross(up).normalized()
    # columns: where her standing right, forward and up end up
    return Matrix(((right.x, facing.x, up.x),
                   (right.y, facing.y, up.y),
                   (right.z, facing.z, up.z))).to_euler("XYZ")


ROOT_ROTATION_LYING = lying_rotation()
# Seated she stays upright; she already faces -Y, which is the water and the
# camera, so she needs no yaw either.
ROOT_ROTATION_SEATED = (0, 0, D(180))
# She lies along the boards with her head toward +X, so the root -- whose
# origin is at her soles -- goes a body-length back along -X to centre her in
# front of the camera, and close to the deck's front edge rather than back by
# the house.
ROOT_XY_LYING = (-0.70, 0.10)
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
# Lying down needs its own camera: the seated one is aimed at the height of a
# seated figure's chest and looks down past a lying one entirely. Lower, closer
# and turned along the boards, which is also the angle that puts her face
# rather than the top of her head toward the lens.
# Measured off where she actually ends up: lying along the boards she spans
# 1.94 m in x, and the first attempt at 2.4 m on a 50 mm lens covered 1.7 m of
# that, in a portrait frame -- so she was cropped at both ends and the camera
# was down at deck level looking along her. A figure lying down wants a
# landscape frame and a camera far enough back and high enough to look across
# her rather than down the length of her.
CAM_LYING_LOC = (0.35, -2.60, 1.40)
CAM_LYING_AIM = (0.26, 0.12, 0.18)
CAM_LYING_LENS = 42
RES_LYING = (1500, 1000)
QUICK_RES_LYING = (930, 620)

# The cat sleeps where she now lies, so it moves down the deck past her feet
# for this shot. Its own empty carries the whole animal.
CAT_LYING_XY = (-0.80, -0.52)
CAT_LYING_YAW = D(25)


# The foreground bamboo is framing, placed to reach into the corners of the
# SEATED shot. The lying camera is lower, wider and looking the other way along
# the deck, and the same branches then hang straight across her head instead of
# framing anything.
BAMBOO_LYING_SHIFT = (-2.30, 0.0, 0.35)


def move_framing_bamboo(shift=BAMBOO_LYING_SHIFT):
    moved = 0
    for obj in bpy.data.objects:
        if obj.name.startswith("Engawa_Bamboo_FG"):
            obj.location.x += shift[0]
            obj.location.y += shift[1]
            obj.location.z += shift[2]
            moved += 1
    bpy.context.view_layer.update()
    log(f"moved {moved} foreground bamboo pieces clear of her head")
    return moved


def move_cat(xy=CAT_LYING_XY, yaw=CAT_LYING_YAW):
    cat = bpy.data.objects.get("Cat")
    if cat is None:
        log("no Cat empty in the scene -- nothing to move")
        return None
    cat.location.x, cat.location.y = xy
    cat.rotation_mode = "XYZ"
    cat.rotation_euler.z = yaw
    bpy.context.view_layer.update()
    log(f"cat moved to ({xy[0]:+.2f}, {xy[1]:+.2f}) so she is not lying on it")
    return cat

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

    widened = blender_proportions.widen_silhouette(arm)
    # The jaw goes with it. Rounding only widens, never shortens, so the head
    # height the head-count solve measures against is left alone.
    blender_proportions.round_face(arm)
    return widened


def dress(arm, lying=False):
    """Pull the cardigan into a yukata and add what a cardigan cannot supply.

    Run before the head-count solve and before the pose. Before the solve
    because build_yukata authors its collar and sash in rest-pose world
    coordinates, and the solve rescales the figure around them -- built after,
    they would be sized for the body she used to have. Before the pose because
    the pieces hang off bones, so the rig carries them into it.
    """
    import blender_garment

    # The tamoto is shortened for the lying shot rather than simulated. Giving
    # the garment to the cloth solver was tried and does fix the sleeve, but at
    # full resolution the robe had stretched into flat ribbons, which is reason
    # enough on its own. A sleeve 10 cm deep instead of 26 simply does not
    # reach the boards from an outstretched arm, and the robe keeps the folds
    # it already had.
    #
    # An earlier version of this comment also blamed holes in the body under
    # the garment. That was wrong and worth correcting here, since it would
    # mis-steer anyone picking the simulation back up: the black marks by her
    # hip were the shoji lattice showing between her leg and the boards, plus
    # ordinary shadow, and deleting every Tops face lowers the open-edge count
    # in the torso rather than raising it. There is a body under the clothes.
    blender_garment.reshape_tops_into_yukata(
        hang=blender_garment.SLEEVE_HANG_LYING if lying
        else blender_garment.SLEEVE_HANG)
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


def drape_hair(root, arm, pose):
    """Lay her down with the solver running, so the hair falls as she does.

    Called after place() has worked out where she finishes, because the drape
    needs a destination to animate toward -- place() grounds her by hip height
    and that answer is what the fall ends at.

    Only worth doing lying down. Sitting up the hair hangs the way it was
    modelled to hang, which is what the cards are for; it is lying down that
    the rigid version cannot do, and it fails loudly -- the hair keeps the
    shape it had standing and fans out into a white shell over her face and
    half the deck.
    """
    import blender_hairsim

    rotation = tuple(root.rotation_euler)
    location = tuple(root.location)
    deck = blender_hairsim.deck_collider()
    colliders = [deck] + [o for o in bpy.data.objects
                          if o.type == "MESH" and o.name in ("Body", "Face")]

    # The long cards are sheared rather than simulated -- see shear_long_cards
    # -- and blender_hair.build_spread draws that hair back as thin locks.
    centre = blender_hairsim.head_centre(arm)
    for obj in blender_hairsim.hair_objects():
        blender_hairsim.shear_long_cards(obj, centre)

    return blender_hairsim.drape(root, arm, pose, rotation, location,
                                 colliders=colliders)


# The garment lives in the Body mesh, so "the lowest part of Body" is not her.
GARMENT_MATERIALS = ("Tops",)

def settle_cloth_on_deck(deck_z=0.0, materials=GARMENT_MATERIALS):
    """Stop the garment hanging through the boards.

    The yukata is rigid geometry following the arm bones, so the sleeve on her
    outstretched arm carries on downward when the arm reaches the deck -- about
    210 of its vertices end up 10-30 cm inside the planks. The hair had exactly
    this problem and the cloth solver answered it, but the garment is faces of
    the Body mesh rather than its own object, and a solver cannot be given half
    a mesh.

    So this is the cheap answer, and it is worth being plain about that: the
    posed result is baked down and any garment vertex below the boards is
    lifted onto them. Cloth lying on a floor really does flatten out against
    it, so a still frame reads correctly -- but nothing here is simulated, it
    will not pool or fold, and it is only valid for the frame it is run on.
    Splitting the garment into its own object and giving it to the solver is
    the real fix.

    Runs last, after the pose and the hair drape, because it applies modifiers.
    """
    deps = bpy.context.evaluated_depsgraph_get()
    lifted = 0
    for name in ("Body",):
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(deps)
        baked = bpy.data.meshes.new_from_object(evaluated)
        cloth = {i for i, slot in enumerate(obj.material_slots)
                 if slot.material and any(k in slot.material.name
                                          for k in materials)}
        garment = set()
        for poly in baked.polygons:
            if poly.material_index in cloth:
                garment.update(poly.vertices)

        matrix = obj.matrix_world
        inverse = matrix.inverted()
        for index in garment:
            vert = baked.vertices[index]
            world = matrix @ vert.co
            if world.z < deck_z:
                world.z = deck_z
                vert.co = inverse @ world
                lifted += 1
        baked.update()

        old = obj.data
        obj.data = baked
        obj.modifiers.clear()
        bpy.data.meshes.remove(old)
    log(f"lifted {lifted} garment vertices out of the deck")
    return lifted


def grow_hair_spread(arm):
    """Fan generated locks out from her head across the boards.

    Runs after the drape, since it is authored in world space and needs her
    head where it finally is. `away` is down-body from her head: the direction
    the hair trails is the one her body is NOT in.
    """
    import blender_hair

    head = arm.pose.bones["J_Bip_C_Head"]
    hips = arm.pose.bones["J_Bip_C_Hips"]
    origin = arm.matrix_world @ head.head
    down_body = (arm.matrix_world @ hips.head) - origin
    away = (-Vector((down_body.x, down_body.y, 0.0))).normalized()
    return blender_hair.build_spread(
        origin, away, material=_flat_material("SpreadSilver", BRAID_SILVER))


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


# What she rests ON. Lying down it is her torso that meets the boards, and only
# the torso is a reliable answer: the lowest point of her whole body was, in
# turn, a hanging sleeve, then a fingertip, then the shin of her top leg, and
# each of those grounded her by something that should have been resting ON the
# deck rather than defining where the deck is.
TORSO_BONES = ("J_Bip_C_Hips", "J_Bip_C_Spine",
               "J_Bip_C_Chest", "J_Bip_C_UpperChest")


def torso_floor(arm, percentile=1.0, torso_only=True):
    """Where her BODY meets the boards -- her skin, not what she is wearing.

    The yukata is faces of the Body mesh, and it hangs. Measuring Body whole
    made the lowest thing a dangling sleeve, so grounding lifted her until the
    sleeve touched: hips, knees and both feet ended up floating 30-40 cm over
    boards she was supposed to be lying on, while her shoulder pushed 14 cm
    through them at the other end.

    A low percentile rather than the outright minimum, which is what makes this
    survive the linear-blend skinning spikes that defeated grounding twice
    before.
    """
    import numpy as np

    deps = bpy.context.evaluated_depsgraph_get()
    heights = []
    for name in ("Body",) if torso_only else ("Body", "Face"):
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            continue
        ev = obj.evaluated_get(deps)
        mesh = ev.to_mesh()
        cloth = {i for i, slot in enumerate(ev.material_slots)
                 if slot.material and any(k in slot.material.name
                                          for k in GARMENT_MATERIALS)}
        co = np.empty(len(mesh.vertices) * 3)
        mesh.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        matrix = np.array(ev.matrix_world)
        world = co @ matrix[:3, :3].T + matrix[:3, 3]

        keep = np.ones(len(mesh.vertices), dtype=bool)
        for poly in mesh.polygons:
            if poly.material_index in cloth:
                keep[list(poly.vertices)] = False
        if torso_only:
            groups = [g.name for g in obj.vertex_groups]
            for index, vert in enumerate(obj.data.vertices):
                heaviest, weight = None, 0.0
                for g in vert.groups:
                    if g.weight > weight:
                        weight, heaviest = g.weight, groups[g.group]
                if heaviest not in TORSO_BONES:
                    keep[index] = False
        world = world[keep]
        if len(world):
            heights.append(world[:, 2])
        ev.to_mesh_clear()
    if not heights:
        return 0.0
    return float(np.percentile(np.concatenate(heights), percentile))


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
    if lying:
        # Lying down, what meets the boards is her back and her shoulder, and
        # hip height says nothing about where those are: grounding this pose by
        # the hip buried her 0.33 m into the deck. Her own lowest body vertices
        # are the right answer here -- taken as a low percentile rather than an
        # outright minimum, which is what makes it survive the skinning spikes
        # that defeated this twice before.
        root.location.z -= torso_floor(arm)
    else:
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


def configure_render(quick, lying=False):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    # This apt build ships without OpenImageDenoise -- enabling denoising is a
    # hard RuntimeError here, not a warning, so noise is fought with samples.
    scene.cycles.use_denoising = False
    scene.cycles.samples = QUICK_SAMPLES if quick else SAMPLES
    if lying:
        scene.render.resolution_x, scene.render.resolution_y = (
            QUICK_RES_LYING if quick else RES_LYING)
    else:
        scene.render.resolution_x, scene.render.resolution_y = (
            QUICK_RES if quick else RES)
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
            dress(arm, lying="--lying" in args)
        if "--stock-body" not in args:
            apply_proportions(root, arm)
    silence_hair_shadows(root)
    if arm is None:
        raise SystemExit("character has no armature -- cannot pose")
    centre = place(root, arm, lying="--lying" in args)
    if "--lying" in args:
        move_cat()
        move_framing_bamboo()
    if "--lying" in args and "--no-sim" not in args:
        drape_hair(root, arm, POSE_LYING)
        grow_hair_spread(arm)
        lo, hi = evaluated_bounds(root)
        centre = (lo + hi) / 2
        log(f"after the drape  x [{lo.x:+.2f} {hi.x:+.2f}]  "
            f"y [{lo.y:+.2f} {hi.y:+.2f}]  z [{lo.z:+.2f} {hi.z:+.2f}]")

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

    configure_render(quick, lying="--lying" in args)

    tag = "head" if "--head" in args else ("pose" if pose_only else "shot")
    suffix = "-quick" if quick else ""
    front = "--front" in args
    if front:
        loc, aim, lens = CAM_FRONT_LOC, CAM_FRONT_AIM, 45
    elif "--lying" in args:
        loc, aim, lens = CAM_LYING_LOC, CAM_LYING_AIM, CAM_LYING_LENS
    else:
        loc, aim, lens = CAM_LOC, CAM_AIM, CAM_LENS
    # Both re-aims below need the camera's DIRECTION, which is the vector from
    # the shot's aim to the shot's position -- so it has to be taken before aim
    # is reassigned to the new target. Taking it after (which is what the first
    # version did) measures from the new target to the old camera, and put the
    # lens half a metre from her ribs.
    direction = Vector(loc) - Vector(aim)
    if "--head" in args and arm is not None:
        # Whether her face is visible is the one question a wide shot cannot
        # answer -- at full figure her head is 60 px across and half of that is
        # hair. Same direction as the shot, just much closer.
        aim = tuple(arm.matrix_world @ arm.pose.bones["J_Bip_C_Head"].head)
        loc = tuple(Vector(aim) + direction.normalized() * 0.85)
        lens = 70
    elif pose_only:
        # Judging a pose means seeing all of her, so the bare stage aims at
        # what she actually occupies and stands back far enough to hold it.
        lo, hi = evaluated_bounds(root)
        span = max(hi.x - lo.x, hi.y - lo.y, hi.z - lo.z)
        aim = tuple(centre)
        loc = tuple(Vector(aim) + direction.normalized() * max(span * 1.9, 1.6))
    add_camera(loc, aim, lens)
    render_to(os.path.join(OUT_DIR,
                           f"compose-{tag}{'-front' if front else ''}{suffix}.png"))


if __name__ == "__main__":
    main()

"""Grow hair as geometry along a path, instead of posing hair that already exists.

The character's grafted hair is one rigid mesh skinned to the head bone, with
no bones of its own long enough to pose -- which is why laying her down swung
the whole length of it across her body as a stiff fan, and why the shot ended
up seated. Hair that is GENERATED does not have that problem: the path is an
input, so the same braid can hang down her back when she sits and lie spread
across the boards when she does not. No bones, no skinning, no draping
simulation -- the drape is the argument.

A braid is three strands helixing about a common axis, which is a formula
rather than a sculpt, so it is the part of the reference's hair that suits this
approach best.

Run standalone to render a test card of the shapes on their own:
    blender --background --python tools/blender_hair.py
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = os.path.join(PROJECT, "assets", "blender")

TAU = math.pi * 2

# Fraction of a braid's length over which the strands converge at the root.
ROOT_GATHER = 0.10


# --- Paths ------------------------------------------------------------------

def catmull_rom(points, samples_per_span=12):
    """Smooth a handful of control points into a dense, smooth polyline.

    Hair paths are nicer to author as four or five points than as a hundred,
    and a Catmull-Rom spline passes through every control point, so the numbers
    written in a path stay the numbers the hair actually goes through.
    """
    pts = [Vector(p) for p in points]
    # Phantom end points, so the first and last spans curve like the rest.
    pts = [pts[0] * 2 - pts[1]] + pts + [pts[-1] * 2 - pts[-2]]
    out = []
    for i in range(1, len(pts) - 2):
        p0, p1, p2, p3 = pts[i - 1], pts[i], pts[i + 1], pts[i + 2]
        for s in range(samples_per_span):
            t = s / samples_per_span
            t2, t3 = t * t, t * t * t
            out.append(0.5 * ((2 * p1)
                              + (-p0 + p2) * t
                              + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2
                              + (-p0 + 3 * p1 - 3 * p2 + p3) * t3))
    out.append(pts[-2].copy())
    return out


def parallel_frames(points):
    """A non-twisting (tangent, normal, binormal) frame at each point.

    Rotation-minimising rather than rebuilt from a fixed up-vector: a fixed up
    flips the frame over where the path turns vertical, which puts a visible
    kink in a braid exactly where hair usually turns -- at the back of a head.
    """
    tangents = []
    for i, _ in enumerate(points):
        if i == 0:
            t = points[1] - points[0]
        elif i == len(points) - 1:
            t = points[-1] - points[-2]
        else:
            t = points[i + 1] - points[i - 1]
        tangents.append(t.normalized())

    # Seed a normal perpendicular to the first tangent, then carry it along.
    seed = Vector((0, 0, 1))
    if abs(seed.dot(tangents[0])) > 0.9:
        seed = Vector((1, 0, 0))
    normal = (seed - tangents[0] * seed.dot(tangents[0])).normalized()

    frames = []
    for i, tangent in enumerate(tangents):
        if i > 0:
            previous = tangents[i - 1]
            axis = previous.cross(tangent)
            if axis.length > 1e-8:
                angle = math.atan2(axis.length, previous.dot(tangent))
                normal = (Matrix.Rotation(angle, 3, axis.normalized()) @ normal)
            normal = (normal - tangent * normal.dot(tangent)).normalized()
        frames.append((tangent, normal, tangent.cross(normal).normalized()))
    return frames


# --- Sweeping ---------------------------------------------------------------

def sweep_tube(bm, points, radii, segments=8, cap=True):
    """Sweep a circle of varying radius along a polyline."""
    frames = parallel_frames(points)
    rings = []
    for point, (_, normal, binormal), radius in zip(points, frames, radii):
        ring = []
        for s in range(segments):
            a = TAU * s / segments
            offset = normal * (math.cos(a) * radius) + binormal * (math.sin(a) * radius)
            ring.append(bm.verts.new(point + offset))
        rings.append(ring)

    for a, b in zip(rings, rings[1:]):
        for s in range(segments):
            n = (s + 1) % segments
            bm.faces.new((a[s], a[n], b[n], b[s]))

    if cap:
        for ring, reverse in ((rings[0], True), (rings[-1], False)):
            bm.faces.new(tuple(reversed(ring)) if reverse else tuple(ring))
    return rings


def taper(count, start, end, tip_fraction=0.22):
    """Radii along a lock: near-constant, then drawn to a point at the tip.

    Hair does not taper evenly from root to tip -- a lock holds its thickness
    most of the way and then finishes quickly, and a linear taper is the single
    thing that makes generated hair read as a carrot.
    """
    radii = []
    for i in range(count):
        t = i / max(count - 1, 1)
        if t < 1 - tip_fraction:
            radii.append(start + (end - start) * (t / (1 - tip_fraction)))
        else:
            u = (t - (1 - tip_fraction)) / tip_fraction
            radii.append(end * math.sqrt(max(1 - u * u, 0.0)))
    return radii


# --- Braid ------------------------------------------------------------------

def build_braid(name, path, braid_radius=0.026, strand_radius=0.021,
                turns=2.4, samples_per_span=14, segments=7, taper_to=0.45,
                flatten=0.62):
    """Three strands helixing about a path: a braid.

    Three numbers decide whether this reads as a plait or as a twisted rope,
    and the first attempt was a rope on all three:

    strand_radius is deliberately close to braid_radius, not half of it, so
    neighbouring strands overlap and pack. Strands that merely orbit a shared
    axis without touching read as three cords wound together.

    turns is low -- a braid crosses roughly once per one-and-a-half braid
    widths, which over a hair-length path is a couple of turns, not a
    half-dozen. Too many and it tightens into cord.

    flatten squashes the helix into an ellipse, because a braid is wider than
    it is deep: the strands sit side by side against the head rather than
    orbiting a circle.
    """
    spine = catmull_rom(path, samples_per_span)
    frames = parallel_frames(spine)
    count = len(spine)
    widths = taper(count, braid_radius, braid_radius * taper_to)
    thicks = taper(count, strand_radius, strand_radius * taper_to)
    # Gather the strands at the root. Left at full width they start as three
    # separate ends splayed apart, which is what an unplaited rope looks like,
    # not what hair looks like where it leaves the head.
    for i in range(count):
        t = i / max(count - 1, 1)
        if t < ROOT_GATHER:
            pinch = 0.18 + 0.82 * (t / ROOT_GATHER) ** 0.7
            widths[i] *= pinch
            thicks[i] *= 0.45 + 0.55 * pinch

    bm = bmesh.new()
    for strand in range(3):
        phase = TAU * strand / 3
        centres, radii = [], []
        for i, (point, (_, normal, binormal)) in enumerate(zip(spine, frames)):
            t = i / max(count - 1, 1)
            a = phase + TAU * turns * t
            centres.append(point
                           + normal * (math.cos(a) * widths[i])
                           + binormal * (math.sin(a) * widths[i] * flatten))
            radii.append(thicks[i])
        sweep_tube(bm, centres, radii, segments=segments)

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_lock(name, path, root_radius=0.018, tip_ratio=0.25,
               samples_per_span=14, segments=7, flatten=2.4):
    """One loose lock of hair: a flattened, tapered tube along a path.

    Flattened because hair falls in sheets rather than in ropes -- a round tube
    reads as a noodle from any angle that catches its silhouette.
    """
    spine = catmull_rom(path, samples_per_span)
    frames = parallel_frames(spine)
    count = len(spine)
    radii = taper(count, root_radius, root_radius * tip_ratio)

    bm = bmesh.new()
    rings = []
    for point, (_, normal, binormal), radius in zip(spine, frames, radii):
        ring = []
        for s in range(segments):
            a = TAU * s / segments
            offset = (normal * (math.cos(a) * radius * flatten)
                      + binormal * (math.sin(a) * radius))
            ring.append(bm.verts.new(point + offset))
        rings.append(ring)
    for a, b in zip(rings, rings[1:]):
        for s in range(segments):
            n = (s + 1) % segments
            bm.faces.new((a[s], a[n], b[n], b[s]))
    bm.faces.new(tuple(reversed(rings[0])))
    bm.faces.new(tuple(rings[-1]))

    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_ribbon_tie(name, centre, tangent, radius=0.026, thickness=0.011):
    """The band that closes a braid: a flattened ring around the path."""
    tangent = Vector(tangent).normalized()
    seed = Vector((0, 0, 1))
    if abs(seed.dot(tangent)) > 0.9:
        seed = Vector((1, 0, 0))
    normal = (seed - tangent * seed.dot(tangent)).normalized()
    binormal = tangent.cross(normal)

    ring_path, radii = [], []
    steps = 20
    for s in range(steps + 1):
        a = TAU * s / steps
        ring_path.append(Vector(centre)
                         + normal * (math.cos(a) * radius)
                         + binormal * (math.sin(a) * radius))
        radii.append(thickness)
    bm = bmesh.new()
    sweep_tube(bm, ring_path, radii, segments=6, cap=False)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    obj.scale = (1, 1, 1)
    bpy.context.scene.collection.objects.link(obj)
    return obj


# --- Attaching to a head ----------------------------------------------------

# Paths are written in the character's own standing world space, in metres,
# which is why they can be read as measurements: her head bone sits at about
# z=1.35, her temples about 0.075 either side of centre, and she faces +Y.
# Each braid leaves the temple, passes the jaw, and falls down her front.
# +Y is in FRONT of her -- she faces +Y, which is worth stating because writing
# these paths as if she faced -Y is what buried the first pair inside the hair
# already on her head instead of laying them over it.
BRAID_PATHS = {
    # Each path starts on the scalp rather than beside the ear, so the gathered
    # root is hidden under the hair already there instead of hanging off it.
    # Held wide of the jaw on purpose. Run closer in and the braid crosses her
    # cheek from the shot camera's angle, which costs the face to gain a braid.
    "L": [(0.054, -0.006, 1.404), (0.101, 0.040, 1.320), (0.104, 0.064, 1.224),
          (0.096, 0.072, 1.118), (0.086, 0.066, 1.012)],
    "R": [(-0.054, -0.006, 1.404), (-0.101, 0.038, 1.320), (-0.104, 0.062, 1.224),
          (-0.096, 0.070, 1.118), (-0.086, 0.064, 1.012)],
}
HEAD_BONE = "J_Bip_C_Head"


def parent_to_bone(obj, armature, bone_name):
    """Hang an object off a bone without it jumping when the parent is set.

    Bone parenting is relative to the bone's TAIL, so assigning the parent
    alone teleports the object by the bone's length. Re-assigning matrix_world
    afterwards makes Blender solve for the local matrix that keeps it put.
    """
    world = obj.matrix_world.copy()
    obj.parent = armature
    obj.parent_type = "BONE"
    obj.parent_bone = bone_name
    obj.matrix_world = world


def attach_braids(armature, material=None, ribbon_material=None, paths=None):
    """Build a braid per path and hang it off the head bone.

    Generated rather than posed, so the same call can hang them down her front
    while she sits and spread them over the boards while she lies down -- the
    path is the argument, and nothing has to drape.
    """
    made = []
    for key, path in (paths or BRAID_PATHS).items():
        braid = build_braid(f"Braid_{key}", path)
        if material:
            braid.data.materials.append(material)
        parent_to_bone(braid, armature, HEAD_BONE)
        made.append(braid)

        tip = Vector(path[-1])
        before = Vector(path[-2])
        # The tie sits just above the tip, where the plait is closed off.
        along = (tip - before).normalized()
        tie = build_ribbon_tie(f"BraidTie_{key}", tip - along * 0.035, along)
        if ribbon_material:
            tie.data.materials.append(ribbon_material)
        parent_to_bone(tie, armature, HEAD_BONE)
        made.append(tie)
    return made


# --- Standalone test --------------------------------------------------------

def _test_material(name, colour):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*colour, 1)
    bsdf.inputs["Roughness"].default_value = 0.32
    return mat


def _test_card():
    """Three shapes side by side, lit plainly, to judge the geometry alone."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    silver = _test_material("Silver", (0.78, 0.79, 0.82))
    ribbon = _test_material("Ribbon", (0.22, 0.34, 0.62))

    # A braid hanging straight, so the plait pattern is unobstructed.
    straight = build_braid("Braid_Straight",
                           [(-0.22, 0, 0.60), (-0.22, 0.01, 0.35),
                            (-0.22, 0.00, 0.10), (-0.22, -0.01, -0.14)])
    straight.data.materials.append(silver)
    tie = build_ribbon_tie("Tie", (-0.22, -0.004, -0.075), (0, -0.04, -0.24))
    tie.data.materials.append(ribbon)

    # A braid following a curve, which is where a badly framed sweep kinks.
    curved = build_braid("Braid_Curved",
                         [(0.0, 0, 0.60), (0.04, 0.06, 0.36),
                          (0.10, 0.02, 0.12), (0.06, -0.08, -0.08),
                          (0.0, -0.14, -0.20)])
    curved.data.materials.append(silver)

    # A loose lock, for the flatten/taper shape.
    lock = build_lock("Lock",
                      [(0.26, 0, 0.60), (0.29, 0.03, 0.34),
                       (0.27, 0.00, 0.08), (0.23, -0.05, -0.16)])
    lock.data.materials.append(silver)

    sun = bpy.data.lights.new("Key", type="AREA")
    sun.energy = 220
    sun.size = 1.4
    key = bpy.data.objects.new("Key", sun)
    bpy.context.scene.collection.objects.link(key)
    key.location = (0.9, -1.1, 1.3)
    key.rotation_euler = (Vector((0, 0, 0.2)) - Vector(key.location)
                          ).to_track_quat("-Z", "Y").to_euler()

    world = bpy.data.worlds.new("W")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.26, 0.28, 0.32, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 1.0
    bpy.context.scene.world = world

    cam_data = bpy.data.cameras.new("C")
    cam_data.lens = 42
    cam = bpy.data.objects.new("C", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (0.02, -1.55, 0.26)
    cam.rotation_euler = (Vector((0.02, 0, 0.22)) - Vector(cam.location)
                          ).to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = cam

    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.use_denoising = False      # not built into this Blender
    scene.cycles.samples = 90
    scene.render.resolution_x, scene.render.resolution_y = 900, 700
    scene.view_settings.view_transform = "Filmic"
    os.makedirs(OUT_DIR, exist_ok=True)
    scene.render.filepath = os.path.join(OUT_DIR, "hair_test.png")
    bpy.ops.render.render(write_still=True)
    print("[hair] wrote", scene.render.filepath)


if __name__ == "__main__":
    _test_card()

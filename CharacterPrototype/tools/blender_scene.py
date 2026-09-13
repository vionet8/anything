#!/usr/bin/env python3
"""Procedural Japanese summer engawa (veranda) environment, built headless in Blender.

This is the *set*, not the cast: a traditional house opening onto a wooden
veranda deck, with a koi pond directly below the deck edge, on a bright,
sticky summer afternoon. A character from another workstream gets dropped onto
the deck, so the world conventions below are contractual.

Usage
-----
As a module::

    import blender_scene
    root = blender_scene.build_scene()      # returns the "Scene_Engawa" empty
    blender_scene.build_lighting()          # separate, so it can be overridden

Standalone (builds + renders its own two test frames)::

    blender --background --python tools/blender_scene.py

World conventions (Blender Z-up, real-world metres)
---------------------------------------------------
  * Deck TOP SURFACE is exactly Z = 0.0. A character lying on the deck needs
    no vertical offset.
  * The deck edge (deck meets water) runs along the X axis at Y = DECK_FRONT.
  * +Y is "into the house" (interior, shoji, tatami). -Y is out over the water,
    toward the camera.
  * Water surface sits at Z = WATER_LEVEL (-0.8).
  * The rectangle X in [-1.2, 1.2], Y in [-0.4, 0.9] on the deck is kept clear
    of props -- that is the character's footprint.
  * Everything is parented (directly or indirectly) to a single empty named
    "Scene_Engawa", so the whole set can be moved or hidden as one.

Rendering notes for this environment (inherited from tools/blender_build.py)
---------------------------------------------------------------------------
  * Cycles only. Eevee mis-sorts the layered transparent quads (shoji paper,
    water, bamboo leaves) badly enough to be useless here.
  * Denoising must stay OFF -- this apt Blender build raises
    "RuntimeError: Build without OpenImageDenoiser". Compensate with samples.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector, Euler, Matrix

HERE = os.path.dirname(os.path.abspath(__file__))
PROJECT = os.path.dirname(HERE)
OUT_DIR = os.path.join(PROJECT, "assets", "blender")

# --------------------------------------------------------------------------
# World constants -- the contract with the character workstream.
# --------------------------------------------------------------------------
DECK_TOP = 0.0            # deck walking surface
DECK_THICK = 0.045        # plank thickness
DECK_FRONT = -0.75        # deck edge over the water (runs along X)
DECK_BACK = 1.65          # where the deck meets the house threshold
DECK_X = 4.30             # deck half-width
WATER_LEVEL = -0.80
POND_FLOOR = -2.30

TATAMI_TOP = 0.035        # interior floor, a touch proud of the deck
WALL_Y = 1.65             # plane of the sliding-door opening
BACK_WALL_Y = 4.40        # far interior wall (holds the renji window)
EAVE_Z = 2.62             # soffit height over the deck
EAVE_FRONT = -1.05        # how far the roof overhangs past the deck edge
POST_W = 0.11

CLEAR_X = (-1.2, 1.2)     # character footprint -- keep props out
CLEAR_Y = (-0.4, 0.9)

RENDER_SAMPLES = int(os.environ.get("ENGAWA_SAMPLES", "220"))
RENDER_SCALE = float(os.environ.get("ENGAWA_SCALE", "1.0"))

_created = []             # everything built this run, parented at the end
RNG = random.Random(20240811)


def log(*a):
    print("[engawa]", *a, flush=True)


# ==========================================================================
# Small mesh / material helpers
# ==========================================================================

def _register(obj):
    _created.append(obj)
    return obj


def new_object(name, mesh):
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return _register(obj)


def obj_from_bmesh(name, bm, smooth=False):
    mesh = bpy.data.meshes.new(name)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(mesh)
    bm.free()
    if smooth:
        for p in mesh.polygons:
            p.use_smooth = True
    return new_object(name, mesh)


def bm_box(bm, center, size, rot=None):
    """Axis-aligned (optionally rotated) box appended into an existing bmesh."""
    cx, cy, cz = center
    sx, sy, sz = (s / 2.0 for s in size)
    mat = Matrix.Translation(center)
    if rot is not None:
        mat = mat @ Euler(rot, "XYZ").to_matrix().to_4x4()
    verts = []
    for dx in (-sx, sx):
        for dy in (-sy, sy):
            for dz in (-sz, sz):
                verts.append(bm.verts.new(mat @ Vector((dx, dy, dz)) - Vector(center) + Vector(center)))
    # index order: (dx,dy,dz) -> 0..7 with dz fastest
    v = verts
    quads = [
        (0, 1, 3, 2),  # -x
        (4, 6, 7, 5),  # +x
        (0, 4, 5, 1),  # -y
        (2, 3, 7, 6),  # +y
        (1, 5, 7, 3),  # +z
        (0, 2, 6, 4),  # -z
    ]
    for q in quads:
        bm.faces.new([v[i] for i in q])
    return verts


def box_obj(name, center, size, rot=None, mat=None, smooth=False):
    bm = bmesh.new()
    bm_box(bm, center, size, rot)
    obj = obj_from_bmesh(name, bm, smooth=smooth)
    if rot is not None:
        # bm_box already baked the rotation about the box centre
        pass
    if mat:
        obj.data.materials.append(mat)
    return obj


def bm_cylinder(bm, center, radius, height, segments=20, axis="Z", rot=None,
                cap_ends=True, radius_top=None):
    """Cylinder / truncated cone appended into an existing bmesh."""
    if radius_top is None:
        radius_top = radius
    basis = {"Z": (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))),
             "Y": (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, 1, 0))),
             "X": (Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0)))}[axis]
    u, w, n = basis
    rm = Euler(rot, "XYZ").to_matrix() if rot else Matrix.Identity(3)
    c = Vector(center)
    lo, hi = [], []
    for i in range(segments):
        a = 2 * math.pi * i / segments
        off = (u * math.cos(a) + w * math.sin(a))
        lo.append(bm.verts.new(c + rm @ (off * radius - n * height / 2)))
        hi.append(bm.verts.new(c + rm @ (off * radius_top + n * height / 2)))
    for i in range(segments):
        j = (i + 1) % segments
        bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    if cap_ends:
        bm.faces.new(list(reversed(lo)))
        bm.faces.new(hi)
    return lo, hi


def cyl_obj(name, center, radius, height, segments=20, axis="Z", rot=None,
            mat=None, smooth=True, radius_top=None, cap_ends=True):
    bm = bmesh.new()
    bm_cylinder(bm, center, radius, height, segments, axis, rot,
                cap_ends=cap_ends, radius_top=radius_top)
    obj = obj_from_bmesh(name, bm, smooth=smooth)
    if mat:
        obj.data.materials.append(mat)
    return obj


def sphere_obj(name, center, radius, mat=None, scale=(1, 1, 1), subdiv=3, rot=None):
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=radius)
    rm = Euler(rot, "XYZ").to_matrix().to_4x4() if rot else Matrix.Identity(4)
    m = Matrix.Translation(center) @ rm @ Matrix.Diagonal(Vector(scale).to_4d())
    bmesh.ops.transform(bm, matrix=m, verts=bm.verts)
    obj = obj_from_bmesh(name, bm, smooth=True)
    if mat:
        obj.data.materials.append(mat)
    return obj


def plane_obj(name, center, size_x, size_y, mat=None, rot=None):
    bm = bmesh.new()
    sx, sy = size_x / 2, size_y / 2
    rm = Euler(rot, "XYZ").to_matrix() if rot else Matrix.Identity(3)
    c = Vector(center)
    vs = [bm.verts.new(c + rm @ Vector(p)) for p in
          ((-sx, -sy, 0), (sx, -sy, 0), (sx, sy, 0), (-sx, sy, 0))]
    bm.faces.new(vs)
    obj = obj_from_bmesh(name, bm)
    if mat:
        obj.data.materials.append(mat)
    return obj


def grid_obj(name, center, size_x, size_y, nx, ny, mat=None):
    """Subdivided plane -- needed where a displacement/bump wants real geometry."""
    bm = bmesh.new()
    verts = []
    for iy in range(ny + 1):
        row = []
        for ix in range(nx + 1):
            x = center[0] - size_x / 2 + size_x * ix / nx
            y = center[1] - size_y / 2 + size_y * iy / ny
            row.append(bm.verts.new((x, y, center[2])))
        verts.append(row)
    for iy in range(ny):
        for ix in range(nx):
            bm.faces.new((verts[iy][ix], verts[iy][ix + 1],
                          verts[iy + 1][ix + 1], verts[iy + 1][ix]))
    obj = obj_from_bmesh(name, bm)
    if mat:
        obj.data.materials.append(mat)
    return obj


# --- materials -------------------------------------------------------------

def make_mat(name, base=(0.8, 0.8, 0.8), rough=0.55, metallic=0.0, spec=0.5,
             alpha=1.0, transmission=0.0, ior=1.45, emission=None,
             emission_strength=0.0, sheen=0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (*base, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metallic
    for key in ("Specular", "Specular IOR Level"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = spec
            break
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = ior
    for key in ("Transmission", "Transmission Weight"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = transmission
            break
    if alpha < 1.0:
        bsdf.inputs["Alpha"].default_value = alpha
        mat.blend_method = "BLEND"
    if emission is not None:
        for key in ("Emission", "Emission Color"):
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = (*emission, 1.0)
                break
        if "Emission Strength" in bsdf.inputs:
            bsdf.inputs["Emission Strength"].default_value = emission_strength
    return mat


def mat_nodes(mat):
    return mat.node_tree, mat.node_tree.nodes["Principled BSDF"]


def add_noise_color(mat, col_a, col_b, scale=(1, 1, 1), noise_scale=6.0,
                    detail=6.0, distortion=0.0, ramp_lo=0.38, ramp_hi=0.62,
                    coords="Object", roughness_ramp=None):
    """Two-tone procedural colour driven by a (possibly anisotropic) noise."""
    nt, bsdf = mat_nodes(mat)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    tc.location = (-1100, 0)
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.location = (-900, 0)
    mapping.inputs["Scale"].default_value = scale
    nt.links.new(tc.outputs[coords], mapping.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.location = (-700, 0)
    noise.inputs["Scale"].default_value = noise_scale
    noise.inputs["Detail"].default_value = detail
    if "Distortion" in noise.inputs:
        noise.inputs["Distortion"].default_value = distortion
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.location = (-480, 0)
    ramp.color_ramp.elements[0].position = ramp_lo
    ramp.color_ramp.elements[0].color = (*col_a, 1.0)
    ramp.color_ramp.elements[1].position = ramp_hi
    ramp.color_ramp.elements[1].color = (*col_b, 1.0)
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    if roughness_ramp is not None:
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.location = (-480, -260)
        mr.inputs["To Min"].default_value = roughness_ramp[0]
        mr.inputs["To Max"].default_value = roughness_ramp[1]
        nt.links.new(noise.outputs["Fac"], mr.inputs["Value"])
        nt.links.new(mr.outputs["Result"], bsdf.inputs["Roughness"])
    return nt, noise, mapping


def add_bump(mat, source_out, strength=0.2, distance=0.02):
    nt, bsdf = mat_nodes(mat)
    bump = nt.nodes.new("ShaderNodeBump")
    bump.location = (-260, -400)
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = distance
    nt.links.new(source_out, bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return bump


# ==========================================================================
# Materials library
# ==========================================================================

MATS = {}


def build_materials():
    M = MATS

    # --- Deck planks: sun-bleached cedar. Grain streaks run along X (the
    # plank direction); a second, Y-fast noise gives each board its own tone
    # so the deck reads as boards rather than one striped sheet.
    m = make_mat("EngawaDeck", rough=0.62, spec=0.32)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.13, 5.0, 1.0)   # streak along X
    nt.links.new(tc.outputs["Object"], mapping.inputs["Vector"])
    grain = nt.nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 9.0
    grain.inputs["Detail"].default_value = 9.0
    grain.inputs["Roughness"].default_value = 0.62
    if "Distortion" in grain.inputs:
        grain.inputs["Distortion"].default_value = 1.6
    nt.links.new(mapping.outputs["Vector"], grain.inputs["Vector"])

    board_map = nt.nodes.new("ShaderNodeMapping")
    board_map.inputs["Scale"].default_value = (0.06, 6.6, 1.0)  # ~1 cell/plank
    nt.links.new(tc.outputs["Object"], board_map.inputs["Vector"])
    board = nt.nodes.new("ShaderNodeTexNoise")
    board.inputs["Scale"].default_value = 1.0
    board.inputs["Detail"].default_value = 1.0
    nt.links.new(board_map.outputs["Vector"], board.inputs["Vector"])

    mix = nt.nodes.new("ShaderNodeMixRGB")
    mix.blend_type = "MIX"
    mix.inputs["Fac"].default_value = 0.45
    nt.links.new(grain.outputs["Fac"], mix.inputs["Color1"])
    nt.links.new(board.outputs["Fac"], mix.inputs["Color2"])

    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    cr.elements[0].position = 0.26
    cr.elements[0].color = (0.286, 0.181, 0.098, 1.0)
    cr.elements[1].position = 0.74
    cr.elements[1].color = (0.640, 0.470, 0.290, 1.0)
    e = cr.elements.new(0.50)
    e.color = (0.470, 0.322, 0.186, 1.0)
    nt.links.new(mix.outputs["Color"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    add_bump(m, grain.outputs["Fac"], strength=0.28, distance=0.008)
    M["deck"] = m

    # --- Structural timber: darker, oiled, for posts / beams / joists.
    m = make_mat("EngawaTimber", rough=0.60, spec=0.30)
    add_noise_color(m, (0.132, 0.081, 0.046), (0.300, 0.196, 0.112),
                    scale=(0.25, 0.25, 3.0), noise_scale=7.0, detail=7.0,
                    distortion=1.2, ramp_lo=0.33, ramp_hi=0.70)
    M["timber"] = m

    # --- Lattice / frame wood: mid warm brown (shoji frames, renji slats).
    m = make_mat("EngawaLattice", rough=0.55, spec=0.32)
    add_noise_color(m, (0.205, 0.128, 0.070), (0.400, 0.268, 0.150),
                    scale=(2.0, 2.0, 0.35), noise_scale=6.0, detail=6.0,
                    distortion=1.0, ramp_lo=0.34, ramp_hi=0.70)
    M["lattice"] = m

    # --- Shoji paper: thin translucent washi. Backlit sheets are the whole
    # point of shoji, so this is a translucent BSDF, not just a white diffuse.
    m = bpy.data.materials.new("EngawaShoji")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    diff = nt.nodes.new("ShaderNodeBsdfDiffuse")
    diff.inputs["Color"].default_value = (0.885, 0.870, 0.820, 1.0)
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    trans.inputs["Color"].default_value = (0.930, 0.905, 0.820, 1.0)
    mixs = nt.nodes.new("ShaderNodeMixShader")
    mixs.inputs["Fac"].default_value = 0.55
    nt.links.new(diff.outputs[0], mixs.inputs[1])
    nt.links.new(trans.outputs[0], mixs.inputs[2])
    # faint fibre texture so the paper isn't a dead flat white
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 14.0, 6.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 24.0
    nz.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.40
    rr.color_ramp.elements[0].color = (0.845, 0.828, 0.775, 1.0)
    rr.color_ramp.elements[1].position = 0.62
    rr.color_ramp.elements[1].color = (0.930, 0.915, 0.868, 1.0)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], diff.inputs["Color"])
    nt.links.new(mixs.outputs[0], out.inputs["Surface"])
    M["shoji"] = m

    # --- Plaster wall (sunaba / earthen): warm grey.
    m = make_mat("EngawaPlaster", rough=0.92, spec=0.12)
    add_noise_color(m, (0.300, 0.278, 0.248), (0.420, 0.398, 0.363),
                    scale=(1, 1, 1), noise_scale=14.0, detail=8.0,
                    ramp_lo=0.40, ramp_hi=0.62)
    M["plaster"] = m

    # --- Tatami: pale green rush, with the weave running along X.
    m = make_mat("EngawaTatami", rough=0.80, spec=0.16)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 140.0, 1.0)   # fine weave rows
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "Y"
    wv.inputs["Scale"].default_value = 1.0
    wv.inputs["Distortion"].default_value = 1.2
    nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.30
    rr.color_ramp.elements[0].color = (0.470, 0.442, 0.252, 1.0)
    rr.color_ramp.elements[1].position = 0.80
    rr.color_ramp.elements[1].color = (0.640, 0.622, 0.398, 1.0)
    nt.links.new(wv.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    add_bump(m, wv.outputs["Fac"], strength=0.35, distance=0.004)
    M["tatami"] = m

    M["tatami_edge"] = make_mat("EngawaTatamiEdge", base=(0.115, 0.098, 0.078),
                                rough=0.72, spec=0.25)

    # --- Stone/concrete pier blocks under the deck edge.
    m = make_mat("EngawaStone", rough=0.90, spec=0.18)
    add_noise_color(m, (0.180, 0.180, 0.176), (0.330, 0.330, 0.318),
                    scale=(1, 1, 1), noise_scale=5.0, detail=9.0,
                    distortion=0.8, ramp_lo=0.35, ramp_hi=0.68)
    M["stone"] = m

    # --- Water. A closed box (surface at WATER_LEVEL, bed at POND_FLOOR) so
    # Volume Absorption actually has an interior to colour: depth reads as
    # depth, not as a flat green plastic sheet. Ripples come from a bump on
    # two crossed wave textures, not from displacement -- cheaper and the
    # highlights land the same.
    m = bpy.data.materials.new("EngawaWater")
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    bsdf.inputs["Base Color"].default_value = (1.0, 1.0, 1.0, 1.0)
    bsdf.inputs["Roughness"].default_value = 0.02
    if "IOR" in bsdf.inputs:
        bsdf.inputs["IOR"].default_value = 1.333
    for key in ("Transmission", "Transmission Weight"):
        if key in bsdf.inputs:
            bsdf.inputs[key].default_value = 1.0
            break
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0, 1.0, 1.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    w1 = nt.nodes.new("ShaderNodeTexWave")
    w1.wave_type = "RINGS"
    w1.rings_direction = "Z"
    w1.inputs["Scale"].default_value = 2.4
    w1.inputs["Distortion"].default_value = 6.0
    w1.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], w1.inputs["Vector"])
    n1 = nt.nodes.new("ShaderNodeTexNoise")
    n1.inputs["Scale"].default_value = 5.0
    n1.inputs["Detail"].default_value = 6.0
    nt.links.new(mp.outputs["Vector"], n1.inputs["Vector"])
    mixw = nt.nodes.new("ShaderNodeMixRGB")
    mixw.inputs["Fac"].default_value = 0.5
    nt.links.new(w1.outputs["Fac"], mixw.inputs["Color1"])
    nt.links.new(n1.outputs["Fac"], mixw.inputs["Color2"])
    add_bump(m, mixw.outputs["Color"], strength=0.30, distance=0.06)
    vol = nt.nodes.new("ShaderNodeVolumeAbsorption")
    vol.inputs["Color"].default_value = (0.255, 0.720, 0.600, 1.0)
    vol.inputs["Density"].default_value = 1.25
    sca = nt.nodes.new("ShaderNodeVolumeScatter")
    sca.inputs["Color"].default_value = (0.420, 0.780, 0.700, 1.0)
    sca.inputs["Density"].default_value = 0.16
    addv = nt.nodes.new("ShaderNodeAddShader")
    nt.links.new(vol.outputs[0], addv.inputs[0])
    nt.links.new(sca.outputs[0], addv.inputs[1])
    nt.links.new(addv.outputs[0], nt.nodes["Material Output"].inputs["Volume"])
    M["water"] = m

    # --- Pond bed: dark silty green-brown.
    m = make_mat("EngawaPondBed", rough=0.95, spec=0.05)
    add_noise_color(m, (0.030, 0.052, 0.040), (0.085, 0.110, 0.070),
                    scale=(1, 1, 1), noise_scale=3.5, detail=8.0,
                    ramp_lo=0.35, ramp_hi=0.70)
    M["pondbed"] = m

    # --- Koi.
    m = make_mat("EngawaKoi", rough=0.28, spec=0.6)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2.2, 6.0, 6.0)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 3.0
    nz.inputs["Detail"].default_value = 3.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.interpolation = "CONSTANT"
    rr.color_ramp.elements[0].position = 0.0
    rr.color_ramp.elements[0].color = (0.930, 0.900, 0.850, 1.0)
    e = rr.color_ramp.elements.new(0.52)
    e.color = (0.900, 0.240, 0.045, 1.0)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    M["koi"] = m
    M["koi_pale"] = make_mat("EngawaKoiPale", base=(0.880, 0.845, 0.760),
                             rough=0.30, spec=0.6)
    M["koi_fin"] = make_mat("EngawaKoiFin", base=(0.900, 0.870, 0.820),
                            rough=0.35, alpha=0.65)

    # --- Foliage.
    M["leaf_bamboo"] = _leaf_material("EngawaBambooLeaf", (0.055, 0.190, 0.038),
                                      (0.145, 0.360, 0.070))
    M["leaf_far"] = _leaf_material("EngawaFarLeaf", (0.060, 0.185, 0.055),
                                   (0.190, 0.420, 0.105))
    M["leaf_bonsai"] = _leaf_material("EngawaBonsaiLeaf", (0.035, 0.130, 0.030),
                                      (0.105, 0.270, 0.055))
    M["lilypad"] = _leaf_material("EngawaLilyPad", (0.055, 0.155, 0.060),
                                  (0.140, 0.290, 0.090), translucency=0.25)
    M["bamboo_culm"] = make_mat("EngawaBambooCulm", base=(0.330, 0.400, 0.130),
                                rough=0.42, spec=0.4)
    M["stem"] = make_mat("EngawaStem", base=(0.150, 0.190, 0.065), rough=0.65)
    M["bark"] = make_mat("EngawaBark", base=(0.075, 0.058, 0.042), rough=0.85)

    # --- Props.
    M["glass"] = make_mat("EngawaGlass", base=(0.96, 0.99, 0.97), rough=0.03,
                          transmission=1.0, ior=1.45)
    M["glass_blue"] = make_mat("EngawaGlassBlue", base=(0.62, 0.86, 0.95),
                               rough=0.05, transmission=1.0, ior=1.46)
    M["glass_pink"] = make_mat("EngawaGlassPink", base=(0.96, 0.70, 0.78),
                               rough=0.05, transmission=1.0, ior=1.46)
    M["tea"] = make_mat("EngawaTea", base=(0.480, 0.140, 0.030), rough=0.06,
                        transmission=0.92, ior=1.34)
    M["metal"] = make_mat("EngawaMetal", base=(0.760, 0.775, 0.790),
                          rough=0.24, metallic=1.0)
    M["metal_dark"] = make_mat("EngawaMetalDark", base=(0.320, 0.330, 0.340),
                               rough=0.38, metallic=1.0)
    M["fan_body"] = make_mat("EngawaFanBody", base=(0.330, 0.720, 0.660),
                             rough=0.30, spec=0.6)
    M["fan_blade"] = make_mat("EngawaFanBlade", base=(0.860, 0.895, 0.885),
                              rough=0.22, spec=0.6)
    M["cord"] = make_mat("EngawaCord", base=(0.870, 0.870, 0.860), rough=0.55)
    M["watermelon"] = _watermelon_material()
    M["melon_rind"] = make_mat("EngawaMelonRind", base=(0.210, 0.400, 0.120),
                               rough=0.35)
    M["oke"] = make_mat("EngawaOke", rough=0.58, spec=0.3)
    add_noise_color(M["oke"], (0.360, 0.240, 0.128), (0.620, 0.462, 0.272),
                    scale=(3.0, 3.0, 0.25), noise_scale=8.0, detail=7.0,
                    distortion=1.4, ramp_lo=0.32, ramp_hi=0.72)
    M["apple"] = make_mat("EngawaApple", base=(0.720, 0.140, 0.090), rough=0.22,
                          spec=0.6)
    M["grape"] = make_mat("EngawaGrape", base=(0.470, 0.600, 0.150), rough=0.20,
                          spec=0.6)
    M["plate"] = make_mat("EngawaPlate", base=(0.050, 0.048, 0.046), rough=0.25,
                          spec=0.6)
    M["ceramic"] = make_mat("EngawaCeramic", base=(0.480, 0.465, 0.430),
                            rough=0.32, spec=0.5)
    M["ceramic_dark"] = make_mat("EngawaCeramicDark", base=(0.120, 0.128, 0.132),
                                 rough=0.30, spec=0.55)
    M["brass"] = make_mat("EngawaBrass", base=(0.680, 0.520, 0.210), rough=0.28,
                          metallic=1.0)
    M["paper"] = make_mat("EngawaPaper", base=(0.900, 0.880, 0.830), rough=0.75,
                          spec=0.15)
    M["wrapper"] = make_mat("EngawaWrapper", base=(0.820, 0.865, 0.900),
                            rough=0.28, spec=0.7)
    M["soil"] = make_mat("EngawaSoil", base=(0.055, 0.042, 0.032), rough=0.95)
    M["lotus"] = make_mat("EngawaLotus", base=(0.940, 0.800, 0.830), rough=0.55,
                          spec=0.25)
    M["lotus_core"] = make_mat("EngawaLotusCore", base=(0.880, 0.760, 0.230),
                               rough=0.6)
    M["cushion"] = make_mat("EngawaCushion", base=(0.520, 0.440, 0.220),
                            rough=0.85, spec=0.2)
    return M


def _leaf_material(name, dark, light, translucency=0.40):
    """Leaves need to glow when backlit or they read as flat green cut-outs."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        if n.type != "OUTPUT_MATERIAL":
            nt.nodes.remove(n)
    out = nt.nodes["Material Output"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.2, 1.2, 1.2)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 2.6
    nz.inputs["Detail"].default_value = 4.0
    nt.links.new(mp.outputs["Vector"], nz.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.elements[0].position = 0.34
    rr.color_ramp.elements[0].color = (*dark, 1.0)
    rr.color_ramp.elements[1].position = 0.70
    rr.color_ramp.elements[1].color = (*light, 1.0)
    nt.links.new(nz.outputs["Fac"], rr.inputs["Fac"])

    diff = nt.nodes.new("ShaderNodeBsdfPrincipled")
    diff.inputs["Roughness"].default_value = 0.38
    for key in ("Specular", "Specular IOR Level"):
        if key in diff.inputs:
            diff.inputs[key].default_value = 0.45
            break
    nt.links.new(rr.outputs["Color"], diff.inputs["Base Color"])
    trans = nt.nodes.new("ShaderNodeBsdfTranslucent")
    nt.links.new(rr.outputs["Color"], trans.inputs["Color"])
    mixs = nt.nodes.new("ShaderNodeMixShader")
    mixs.inputs["Fac"].default_value = translucency
    nt.links.new(diff.outputs[0], mixs.inputs[1])
    nt.links.new(trans.outputs[0], mixs.inputs[2])
    nt.links.new(mixs.outputs[0], out.inputs["Surface"])
    return m


def _watermelon_material():
    m = make_mat("EngawaWatermelon", rough=0.30, spec=0.5)
    nt, bsdf = mat_nodes(m)
    tc = nt.nodes.new("ShaderNodeTexCoord")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (9.0, 9.0, 0.55)
    nt.links.new(tc.outputs["Object"], mp.inputs["Vector"])
    wv = nt.nodes.new("ShaderNodeTexWave")
    wv.wave_type = "BANDS"
    wv.bands_direction = "X"
    wv.inputs["Scale"].default_value = 1.0
    wv.inputs["Distortion"].default_value = 3.2
    wv.inputs["Detail"].default_value = 2.0
    nt.links.new(mp.outputs["Vector"], wv.inputs["Vector"])
    rr = nt.nodes.new("ShaderNodeValToRGB")
    rr.color_ramp.interpolation = "CONSTANT"
    rr.color_ramp.elements[0].position = 0.0
    rr.color_ramp.elements[0].color = (0.330, 0.560, 0.150, 1.0)
    e = rr.color_ramp.elements.new(0.46)
    e.color = (0.055, 0.185, 0.045, 1.0)
    nt.links.new(wv.outputs["Fac"], rr.inputs["Fac"])
    nt.links.new(rr.outputs["Color"], bsdf.inputs["Base Color"])
    return m

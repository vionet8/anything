#!/usr/bin/env python3
"""Headless Blender hair graft: AvatarSample_A's body wearing AvatarSample_B's
hairstyle, "like a wig" -- a genuine geometry swap, not another recolour.

Second half of the same comparison as blender_build.py (which restyles A's
own hair by recolouring it in place). This script isolates a different
variable: same face/body/outfit, same target pink, but a different haircut
grafted on, so the only visible change against char-blender.glb is the
hairstyle itself.

    blender --background --python tools/blender_wig.py

Reuses tools/blender_build.py's helpers directly (imported as a module) for
everything that doesn't change: HSV recolour, the unlit->Principled BSDF
rebuild, shade-smoothing, the relaxed-arms pose, the cove backdrop + 3-point
studio rig, camera framing, and Cycles settings.

What's new here:

  1. Imports A and B into the same scene.
  2. Finds each one's hair mesh by material name ("*_HAIR_NN", same pattern
     as before) and inspects how it's attached to its armature -- see
     find_hair_mesh()/graft_hair()'s docstring for what that turned out to be
     (both ship spring-bone-skinned, not rigidly parented).
  3. Deletes A's stock hair. Bakes B's hair mesh (apply its Armature modifier
     at bind pose, then detach) into a static, unskinned mesh, since a static
     beauty render never moves a bone anyway -- a spring-bone rig would
     render pixel-identical to a rigid graft here, at a fraction of the risk
     of porting joint names across two independently auto-named rigs.
  4. Aligns it to A's head: translates by the delta between the two models'
     J_Bip_C_Head bone positions and applies a small uniform scale from the
     two Face meshes' size ratio, both measured (not assumed), then parents
     it (plain object parenting -- there is nothing left to skin to) under
     A's armature for scene tidiness.
  5. Recolours the grafted hair to the same sakura pink as before, converts
     materials, poses, lights, frames, renders, exports -- via
     blender_build's own functions.

Outputs land in assets/blender/: beauty_wig_bust.png, beauty_wig_full.png,
char-blender-wig.glb.
"""

import math
import os
import shutil
import sys

import bpy
from mathutils import Matrix, Vector

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import blender_build as bb  # noqa: E402  (reuse recolour/material/render helpers)

PROJECT = bb.PROJECT
SOURCE_A = bb.SOURCE
SOURCE_B = os.path.join(PROJECT, "assets", "source", "AvatarSample_B.vrm")
OUT_DIR = bb.OUT_DIR
STAGE_A = "/tmp/blender_wig_A.glb"
STAGE_B = "/tmp/blender_wig_B.glb"


def log(*a):
    print("[blender_wig]", *a, flush=True)


def import_glb(src, stage):
    """Import and return the *names* (not direct references -- objects get
    deleted from under us right after, e.g. by drop_collider_helpers(), and
    a stale reference to a removed bpy_struct raises ReferenceError on the
    next attribute access) of only the objects this import created, found by
    diffing bpy.data.objects before/after. That's how A's and B's objects
    stay tellable apart even where names collide (both have a "Hair001", a
    "Body", ...)."""
    if os.path.exists(stage):
        os.remove(stage)
    shutil.copyfile(src, stage)
    before = set(bpy.data.objects.keys())
    bpy.ops.import_scene.gltf(filepath=stage)
    os.remove(stage)
    after = set(bpy.data.objects.keys())
    return sorted(after - before)


def live_objects(names):
    """Resolve a list of object names to live objects, dropping any that
    have since been deleted (e.g. by drop_collider_helpers())."""
    return [bpy.data.objects[n] for n in names if n in bpy.data.objects]


def find_hair_mesh(names):
    for obj in live_objects(names):
        if obj.type != "MESH":
            continue
        if any("HAIR_" in (slot.material.name if slot.material else "")
               for slot in obj.material_slots):
            return obj
    return None


def world_bbox(obj):
    mn = Vector((1e9, 1e9, 1e9))
    mx = Vector((-1e9, -1e9, -1e9))
    for c in obj.bound_box:
        wc = obj.matrix_world @ Vector(c)
        mn.x, mn.y, mn.z = min(mn.x, wc.x), min(mn.y, wc.y), min(mn.z, wc.z)
        mx.x, mx.y, mx.z = max(mx.x, wc.x), max(mx.y, wc.y), max(mx.z, wc.z)
    return mn, mx


def head_bone_world(armature_obj):
    pb = armature_obj.pose.bones["J_Bip_C_Head"]
    return armature_obj.matrix_world @ pb.head


def remove_object(obj):
    data = obj.data
    obj_type = obj.type
    bpy.data.objects.remove(obj, do_unlink=True)
    if data is None or data.users > 0:
        return
    if obj_type == "MESH":
        bpy.data.meshes.remove(data)
    elif obj_type == "ARMATURE":
        bpy.data.armatures.remove(data)


def graft_hair():
    """Swap A's hair mesh for B's.

    Rigid-parent vs. skinned, checked empirically before writing any of this
    (see the parent conversation): both A's and B's hair are skinned to a
    per-character spring-bone chain (vertex groups + an Armature modifier,
    joints named "HairJoint-<uuid>", auto-generated and different between
    the two files -- not a shared naming scheme, so there is no clean joint
    to graft B's onto A's). But nothing here ever poses or simulates those
    joints -- this is one still frame -- so an Armature modifier evaluated at
    bind pose and a rigid mesh placed at the same transform render pixel
    -identical. Simplest and most robust wins: bake B's hair at its rest
    pose, detach it from B's rig entirely, and place it rigidly on A.
    """
    a_objects = import_glb(SOURCE_A, STAGE_A)
    bb.drop_collider_helpers()

    a_armature = bpy.data.objects["Armature"]
    a_face = bpy.data.objects["Face"]
    a_hair = find_hair_mesh(a_objects)
    assert a_hair is not None, "couldn't find A's hair mesh"
    a_head_world = head_bone_world(a_armature)
    _, a_face_max = world_bbox(a_face)
    a_face_min, _ = world_bbox(a_face)
    a_face_height = a_face_max.z - a_face_min.z
    log(f"A hair: {a_hair.name} ({len(a_hair.data.vertices)} verts), "
        f"head bone world={tuple(a_head_world)}, face height={a_face_height:.4f}")
    remove_object(a_hair)

    b_objects = import_glb(SOURCE_B, STAGE_B)
    bb.drop_collider_helpers()  # B's Cube/Icosphere; A's were already gone

    b_live = live_objects(b_objects)
    b_armature = next(o for o in b_live if o.type == "ARMATURE")
    b_face = next(o for o in b_live if o.name.startswith("Face"))
    b_hair = find_hair_mesh(b_objects)
    assert b_hair is not None, "couldn't find B's hair mesh"
    b_head_world = head_bone_world(b_armature)
    b_face_min, b_face_max = world_bbox(b_face)
    b_face_height = b_face_max.z - b_face_min.z
    log(f"B hair: {b_hair.name} ({len(b_hair.data.vertices)} verts), "
        f"head bone world={tuple(b_head_world)}, face height={b_face_height:.4f}")

    rig_kind = "skinned to its own spring-bone chain (Armature modifier + vertex groups)"
    log(f"B hair rig: {rig_kind} -> baking at bind pose and detaching (rigid graft).")

    # Bake B's hair at bind pose (nothing has been posed yet, so this *is*
    # the rest shape) and detach it from B's rig.
    bpy.context.view_layer.objects.active = b_hair
    bpy.ops.object.select_all(action="DESELECT")
    b_hair.select_set(True)
    arm_mod = next((m for m in b_hair.modifiers if m.type == "ARMATURE"), None)
    if arm_mod:
        bpy.ops.object.modifier_apply(modifier=arm_mod.name)
    bpy.ops.object.parent_clear(type="CLEAR_KEEP_TRANSFORM")

    # Align to A's head: measured, not assumed. Translate B's head-bone point
    # onto A's, with a uniform scale from the two Face meshes' height ratio
    # (heads are otherwise a similar size here -- a handful of percent --
    # but it's measured per-run rather than hardcoded).
    scale = a_face_height / b_face_height
    log(f"fit: translate by {tuple(a_head_world - b_head_world)}, uniform scale {scale:.4f}")
    correction = (
        Matrix.Translation(a_head_world)
        @ Matrix.Diagonal((scale, scale, scale, 1.0))
        @ Matrix.Translation(-b_head_world)
    )
    b_hair.matrix_world = correction @ b_hair.matrix_world

    # The rest of B (its armature, body, face, and whatever colliders
    # drop_collider_helpers didn't already catch) was only needed to get the
    # hair mesh into its bind pose -- drop it.
    for obj in live_objects(b_objects):
        if obj is b_hair:
            continue
        remove_object(obj)

    aligned_world = b_hair.matrix_world.copy()
    b_hair.name = "Hair001"
    b_hair.parent = a_armature
    b_hair.matrix_parent_inverse = a_armature.matrix_world.inverted()
    b_hair.matrix_world = aligned_world  # re-assert: parenting alone would not move it (A's
                                          # armature is at identity), but do this explicitly
                                          # rather than rely on that happening to be true.
    return b_hair


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    b_hair = graft_hair()

    # Recolour the grafted hair to the same sakura pink as char-blender.glb,
    # while materials are still in their as-imported unlit form (same order
    # as blender_build.recolour_all()).
    hair_mats = [s.material for s in b_hair.material_slots if s.material and "HAIR_" in s.material.name]
    total_px = 0
    images_done = set()
    for mat in hair_mats:
        img = bb.get_base_color_image(mat)
        if img and img.name not in images_done:
            total_px += bb.recolour_hair_image(img)
            images_done.add(img.name)
    log(f"grafted hair materials: {len(hair_mats)}, images recoloured: {len(images_done)}, "
        f"pixels touched: {total_px}")

    bb.convert_all_materials()
    bb.shade_smooth_all()
    bb.pose_relaxed_arms()

    mn, mx = bb.character_bounds()
    log("character bounds:", tuple(mn), tuple(mx))

    bb.build_cove_backdrop(mn, mx)
    bb.build_lighting(mn, mx)
    bb.configure_render_engine()

    height = mx.z - mn.z
    y_mid = (mn.y + mx.y) / 2

    bust_lens = 100
    bust_top = mx.z + height * 0.04
    bust_bottom = mn.z + height * 0.66
    bust_dist = bb.vertical_fit_distance(bust_lens, bust_top - bust_bottom, target_frac=0.97)
    bust_mid_z = (bust_top + bust_bottom) / 2
    bb.setup_camera("BustCam", (0.0, mx.y + bust_dist, bust_mid_z), (0, y_mid, bust_mid_z), lens=bust_lens)
    bb.render_to(os.path.join(OUT_DIR, "beauty_wig_bust.png"), 1024, 1280)

    full_lens = 50
    full_top = mx.z + height * 0.07
    full_bottom = mn.z - height * 0.025
    full_dist = bb.vertical_fit_distance(full_lens, full_top - full_bottom, target_frac=0.88)
    full_mid_z = (full_top + full_bottom) / 2
    full_target_z = mn.z + height * 0.52
    yaw = math.radians(35)
    full_cam = (full_dist * math.sin(yaw), y_mid + full_dist * math.cos(yaw), full_mid_z)
    bb.setup_camera("FullCam", full_cam, (0, y_mid, full_target_z), lens=full_lens)
    bb.render_to(os.path.join(OUT_DIR, "beauty_wig_full.png"), 1080, 1440)

    out = os.path.join(OUT_DIR, "char-blender-wig.glb")
    bpy.ops.object.select_all(action="DESELECT")
    for obj in bpy.data.objects:
        if obj.type == "ARMATURE" or (obj.type == "MESH" and obj.name in bb.CHARACTER_MESH_NAMES):
            obj.select_set(True)
    bpy.ops.export_scene.gltf(
        filepath=out,
        use_selection=True,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_skins=True,
        export_animations=False,
        export_morph=True,
        export_materials="EXPORT",
        export_image_format="AUTO",
    )
    log(f"exported {out} ({os.path.getsize(out)/1048576:.2f} MB)")
    log("done")


if __name__ == "__main__":
    main()

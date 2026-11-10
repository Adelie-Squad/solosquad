"""Shared helpers for the SoloSquad office kit (docs/design/office-asset-contract.md).

Blender is Z-up; the glTF exporter turns it Y-up, so glTF +Z (the open front of the
room, the way a seated agent faces) is Blender -Y. Everything here is built in Blender
axes: X right, -Y front, Z up. 1 unit = 1 m.
"""
import math

import bmesh
import bpy
from mathutils import Matrix, Vector

# ---------------------------------------------------------------------------
# Palette — material name = palette key. Light theme values (sRGB hex).
# The web swaps colours per theme by material name; these are the light values.
# ---------------------------------------------------------------------------
PALETTE = {
    'clay.wall': '#F4F1EA',
    'clay.floor': '#ECE7DE',
    'clay.furniture': '#F7F5F0',
    'clay.wood': '#D8C3A2',
    'clay.plant': '#8DB36B',
    'clay.screen': '#2C74E0',
    'clay.lamp_bulb': '#FFF4DE',
    'team_sticker': '#8A8371',  # painted by the web per team
    'team_accent': '#8A8371',   # painted by the web per team
    'penguin.body': '#2B2A26',
    'penguin.face': '#F3F0EA',
    'penguin.cheek': '#E01FAE',
    'penguin.eye': '#151410',
    'penguin.beak': '#FBF9F4',    # white felt, outlined by a black stitch
    'penguin.feet': '#151410',
    'penguin.stitch': '#151410',  # black thread (front edge + beak edge)
    'prop.gold': '#C9A227',
    'prop.wood': '#D8C3A2',   # fixed prop wood (clipboard, brush); not re-tinted per theme
    'prop.black': '#2B2A26',
    'prop.paper': '#F4F1EA',
    'prop.metal': '#8A8371',
    'prop.lens': '#C9DDF6',
    'prop.helmet': '#F0C640',
}

EVENING = {
    'clay.backdrop': '#15161B',
    'clay.wall': '#2B2D37',
    'clay.floor': '#23252E',
    'clay.furniture': '#3A3C47',
    'clay.wood': '#5A4E3E',
    'clay.plant': '#4E6A3A',
    'clay.screen': '#8FB8FF',
    'clay.lamp_bulb': '#FFC56B',
    'penguin.body': '#474855',   # lifted so the silhouette reads in the dark
}

TEAM_COLORS = {
    'core': '#C9A227',
    'product': '#2C74E0',
    'engineering': '#9AC22D',
    'business': '#9B6A3C',
    'brand': '#E01FAE',
}


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_rgba(h, alpha=1.0):
    h = h.lstrip('#')
    return tuple(srgb_to_linear(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4)) + (alpha,)


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def material(name, hex_color=None, roughness=0.9, emission=None, strength=0.0):
    """Get or create a matte clay material named by its palette key."""
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = principled(mat)
    col = hex_rgba(hex_color or PALETTE.get(name, '#FF00FF'))
    bsdf.inputs['Base Color'].default_value = col
    bsdf.inputs['Roughness'].default_value = roughness
    bsdf.inputs['Metallic'].default_value = 0.0
    if 'Specular IOR Level' in bsdf.inputs:
        # glTF default (0.5): anything else adds KHR_materials_specular; at roughness 0.9
        # the highlight is negligible
        bsdf.inputs['Specular IOR Level'].default_value = 0.5
    if emission is not None:
        bsdf.inputs['Emission Color'].default_value = hex_rgba(emission)
    bsdf.inputs['Emission Strength'].default_value = strength
    mat.diffuse_color = col
    return mat


def set_color(name, hex_color):
    mat = bpy.data.materials.get(name)
    if mat:
        principled(mat).inputs['Base Color'].default_value = hex_rgba(hex_color)
        mat.diffuse_color = hex_rgba(hex_color)


def set_emission(name, hex_color, strength):
    mat = bpy.data.materials.get(name)
    if mat:
        b = principled(mat)
        b.inputs['Emission Color'].default_value = hex_rgba(hex_color)
        b.inputs['Emission Strength'].default_value = strength


# ---------------------------------------------------------------------------
# Collections / objects
# ---------------------------------------------------------------------------

def collection(name, parent=None):
    col = bpy.data.collections.get(name)
    if col is None:
        col = bpy.data.collections.new(name)
        (parent or bpy.context.scene.collection).children.link(col)
    return col


def clear_collection(name):
    col = bpy.data.collections.get(name)
    if not col:
        return
    for ob in list(col.all_objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for child in list(col.children_recursive):
        bpy.data.collections.remove(child)
    bpy.data.collections.remove(col)
    purge_orphans()


def purge_orphans():
    for _ in range(3):
        for block in (bpy.data.meshes, bpy.data.curves, bpy.data.armatures, bpy.data.actions):
            for d in list(block):
                if d.users == 0:
                    block.remove(d)


def link(ob, col):
    for c in list(ob.users_collection):
        c.objects.unlink(ob)
    col.objects.link(ob)
    return ob


def empty(name, col, loc=(0, 0, 0), parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.1
    ob.location = loc
    col.objects.link(ob)
    if parent:
        ob.parent = parent
    return ob


def mesh_object(name, bm, col, mat=None, loc=(0, 0, 0), smooth=True):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    col.objects.link(ob)
    if mat:
        me.materials.append(mat)
    if smooth:
        me.shade_smooth()
    return ob


# ---------------------------------------------------------------------------
# Primitive builders (bmesh) — soft clay shapes
# ---------------------------------------------------------------------------

def rounded_box(size, radius, segments=3, edge_filter=None):
    """Box centred on origin with bevelled (rounded) edges. edge_filter(v0, v1) picks
    which edges to round (default all) - tiled pieces round only their exposed edges so
    neighbouring tiles meet without a groove."""
    sx, sy, sz = size
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(sx, sy, sz), verts=bm.verts)
    r = min(radius, min(size) * 0.49)
    if r > 0:
        edges = [e for e in bm.edges
                 if edge_filter is None or edge_filter(e.verts[0].co, e.verts[1].co)]
        if edges:
            bmesh.ops.bevel(bm, geom=edges, offset=r, segments=segments,
                            profile=0.5, affect='EDGES', clamp_overlap=True)
    return bm


def box(name, size, loc, col, mat, radius=0.02, segments=3, edge_filter=None):
    ob = mesh_object(name, rounded_box(size, radius, segments, edge_filter), col, mat, loc)
    set_auto_smooth(ob)
    return ob


def cylinder(name, radius, depth, loc, col, mat, segments=32, bevel=0.01):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments,
                          radius1=radius, radius2=radius, depth=depth)
    if bevel > 0:
        rim = [e for e in bm.edges if len(e.link_faces) == 2 and
               abs(e.link_faces[0].normal.dot(e.link_faces[1].normal)) < 0.5]
        bmesh.ops.bevel(bm, geom=rim, offset=bevel, segments=3, profile=0.5, affect='EDGES')
    ob = mesh_object(name, bm, col, mat, loc)
    set_auto_smooth(ob)
    return ob


def ellipsoid(name, radii, loc, col, mat, segs=32, rings=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segs, v_segments=rings, radius=1.0)
    bmesh.ops.scale(bm, vec=radii, verts=bm.verts)
    return mesh_object(name, bm, col, mat, loc)


def set_auto_smooth(ob, angle=40):
    """Smooth shading but keep hard creases (Blender 4.1+ 'smooth by angle')."""
    me = ob.data
    me.shade_smooth()
    try:
        with bpy.context.temp_override(object=ob, active_object=ob, selected_objects=[ob],
                                       selected_editable_objects=[ob]):
            bpy.ops.object.shade_smooth_by_angle(angle=math.radians(angle))
    except Exception:
        pass


def join(objs, name):
    """Join objects into the first one, keep its name."""
    objs = [o for o in objs if o]
    base = objs[0]
    with bpy.context.temp_override(active_object=base, object=base,
                                   selected_objects=objs, selected_editable_objects=objs):
        bpy.ops.object.join()
    base.name = name
    base.data.name = name
    return base


def apply_modifiers(ob):
    dg = bpy.context.evaluated_depsgraph_get()
    ev = ob.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev)
    old = ob.data
    ob.modifiers.clear()
    ob.data = me
    me.name = old.name
    if old.users == 0:
        bpy.data.meshes.remove(old)

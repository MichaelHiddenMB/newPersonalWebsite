"""Builds the Lumon MDR desk pod from Severance and exports it for the site.

Run inside Blender (Scripting tab, or via Blender MCP):
    path = "<repo>/scripts/blender/severance_desk.py"
    exec(open(path).read(), {"__file__": path})
    build()
    export("<repo>/public/models/severance-desk.glb")

Units are meters, Blender is Z-up; the glTF exporter converts to three.js Y-up
(Blender -Y, the side you sit on, becomes +Z in three.js).
"""
import math
import os

import bmesh
import bpy
from mathutils import Matrix, Vector

# Keycard front artwork, rendered from badge/badge.html.
BADGE_TEXTURE = os.path.join(os.path.dirname(os.path.abspath(globals().get("__file__", "."))),
                             "badge", "badge.png")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def srgb(hex_str):
    """Hex sRGB -> linear RGB tuple (Blender colors are linear)."""
    h = hex_str.lstrip("#")
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def material(name, color, rough=0.5, metal=0.0, emit=None, emit_strength=0.0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    try:
        m.use_nodes = True
    except Exception:
        pass
    bsdf = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    rgb = srgb(color)
    bsdf.inputs["Base Color"].default_value = (*rgb, 1.0)
    bsdf.inputs["Roughness"].default_value = rough
    bsdf.inputs["Metallic"].default_value = metal
    if emit:
        bsdf.inputs["Emission Color"].default_value = (*srgb(emit), 1.0)
        bsdf.inputs["Emission Strength"].default_value = emit_strength
    m.diffuse_color = (*rgb, 1.0)
    return m


def badge_material():
    """Keycard plastic with the MDR artwork as its base color texture."""
    m = material("Keycard", "#0B4596", rough=0.35)
    if not os.path.exists(BADGE_TEXTURE):
        return m
    nt = m.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    tex = next((n for n in nt.nodes if n.type == "TEX_IMAGE"), None) or nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(BADGE_TEXTURE, check_existing=True)
    tex.image.pack()
    tex.location = (bsdf.location.x - 350, bsdf.location.y)
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    return m


def link(ob, parent):
    bpy.context.scene.collection.objects.link(ob)
    if parent is not None:
        ob.parent = parent
    return ob


def empty(name, loc=(0, 0, 0), rot_z=0.0, parent=None):
    ob = bpy.data.objects.new(name, None)
    ob.empty_display_size = 0.2
    ob.location = loc
    ob.rotation_euler = (0, 0, rot_z)
    return link(ob, parent)


def finish_mesh(ob, mat, bevel=0.0, segments=2, smooth=True):
    ob.data.materials.append(mat)
    if smooth:
        for p in ob.data.polygons:
            p.use_smooth = True
    if bevel > 0:
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = "ANGLE"
        mod.harden_normals = True
    return ob


def box(name, size, loc, mat, parent=None, bevel=0.0, segments=2, rot=(0, 0, 0)):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = bpy.data.objects.new(name, me)
    ob.location = loc
    ob.rotation_euler = rot
    link(ob, parent)
    return finish_mesh(ob, mat, bevel, segments, smooth=bevel > 0)


def boxes(name, items, mat, parent=None, bevel=0.0):
    """Many boxes merged into one mesh (keys, legs...) -> one draw call."""
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    for size, loc, *rest in items:
        rot_z = rest[0] if rest else 0.0
        geom = bmesh.ops.create_cube(bm, size=1.0)
        verts = geom["verts"]
        bmesh.ops.scale(bm, vec=Vector(size), verts=verts)
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(rot_z, 3, "Z"), verts=verts)
        bmesh.ops.translate(bm, vec=Vector(loc), verts=verts)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    return finish_mesh(ob, mat, bevel, 2, smooth=bevel > 0)


def cylinder(name, radius, depth, loc, mat, parent=None, axis="Z", radius2=None,
             segments=32, bevel=0.0, cap=True):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=cap, cap_tris=False, segments=segments,
                          radius1=radius, radius2=radius if radius2 is None else radius2,
                          depth=depth)
    if axis == "X":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "Y"), verts=bm.verts)
    elif axis == "Y":
        bmesh.ops.rotate(bm, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi / 2, 3, "X"), verts=bm.verts)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    finish_mesh(ob, mat, bevel, 2, smooth=True)
    if bevel == 0 and cap:
        # Flat caps + smooth sides: harden via a tiny bevel to avoid shading smear.
        mod = ob.modifiers.new("Bevel", "BEVEL")
        mod.width = min(radius, depth) * 0.08
        mod.segments = 1
        mod.limit_method = "ANGLE"
        mod.harden_normals = True
    return ob


def sphere(name, radius, loc, mat, parent=None):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=radius)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    return finish_mesh(ob, mat, smooth=True)


def tube(name, points, radius, mat, parent=None):
    """A bent metal tube along a polyline, baked to a mesh."""
    cu = bpy.data.curves.new(name + "_curve", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 3
    cu.use_fill_caps = True
    sp = cu.splines.new("BEZIER")
    sp.bezier_points.add(len(points) - 1)
    for bp, p in zip(sp.bezier_points, points):
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = "AUTO"
    cu.resolution_u = 8
    tmp = bpy.data.objects.new(name + "_tmp", cu)
    bpy.context.scene.collection.objects.link(tmp)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(tmp.evaluated_get(dg))
    bpy.data.objects.remove(tmp)
    bpy.data.curves.remove(cu)
    me.name = name
    ob = link(bpy.data.objects.new(name, me), parent)
    return finish_mesh(ob, mat, smooth=True)


def rounded_rect_pts(w, h, r, cx=0.0, cy=0.0, seg=6):
    pts = []
    for qx, qy, a0 in ((1, 1, 0), (-1, 1, 90), (-1, -1, 180), (1, -1, 270)):
        ox, oy = cx + qx * (w / 2 - r), cy + qy * (h / 2 - r)
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((ox + r * math.cos(a), oy + r * math.sin(a)))
    return pts


def card_mesh(name, w, h, thick, r, slot, loc, mat, parent=None):
    """Rounded card with a real lanyard slot cut through it, facing -Y.

    UVs map the card face 0..1 so a full-card texture lines up. `slot` is
    (width, height, distance of slot center from the top edge).
    """
    sw, sh, sd = slot
    bm = bmesh.new()
    edges = []
    for pts in (rounded_rect_pts(w, h, r), rounded_rect_pts(sw, sh, sh / 2 - 1e-4, 0, h / 2 - sd, 4)):
        vs = [bm.verts.new((x, y, 0)) for x, y in pts]
        edges += [bm.edges.new((vs[i], vs[(i + 1) % len(vs)])) for i in range(len(vs))]
    bmesh.ops.triangle_fill(bm, use_beauty=True, use_dissolve=False, edges=edges)
    faces = list(bm.faces)
    ext = bmesh.ops.extrude_face_region(bm, geom=faces)
    bmesh.ops.translate(bm, vec=(0, 0, thick),
                        verts=[e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    uv = bm.loops.layers.uv.new("UVMap")
    for f in bm.faces:
        for lp in f.loops:
            x, y = lp.vert.co.x, lp.vert.co.y
            # The back face (normal -Z) is seen mirrored; flip it so art is never backwards there.
            u = (x + w / 2) / w
            lp[uv].uv = (u if f.normal.z >= 0 else 1 - u, (y + h / 2) / h)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    ob.rotation_euler = (math.pi / 2, 0, 0)  # +Z face -> -Y (toward the viewer)
    return finish_mesh(ob, mat, smooth=False)


def ribbon(name, path, width, thick, mat, parent=None):
    """Flat strap (lanyard) following `path` [(x, y, z)...]; width runs along X."""
    me = bpy.data.meshes.new(name)
    verts, faces = [], []
    for i, (x, y, z) in enumerate(path):
        verts += [(x - width / 2, y, z), (x + width / 2, y, z)]
        if i:
            a = 2 * (i - 1)
            faces.append((a, a + 1, a + 3, a + 2))
    me.from_pydata(verts, [], faces)
    ob = link(bpy.data.objects.new(name, me), parent)
    finish_mesh(ob, mat, smooth=True)
    sol = ob.modifiers.new("Thickness", "SOLIDIFY")
    sol.thickness = thick
    sol.offset = 0
    return ob


def wire_loop(name, center, rx, rz, radius, mat, parent=None, plane="XZ", n=12):
    """Closed wire loop (split ring / clip eye) in the XZ or YZ plane."""
    cx, cy, cz = center
    pts = []
    for i in range(n + 1):
        a = 2 * math.pi * i / n
        u, v = rx * math.cos(a), rz * math.sin(a)
        pts.append((cx + u, cy, cz + v) if plane == "XZ" else (cx, cy + u, cz + v))
    return tube(name, pts, radius, mat, parent)


def rounded_slab(name, w, d, h, r, loc, mat, parent=None, seg=8):
    """Flat rounded rectangle (chair mat)."""
    pts = []
    for cx, cy, a0 in ((w / 2 - r, d / 2 - r, 0), (-w / 2 + r, d / 2 - r, 90),
                       (-w / 2 + r, -d / 2 + r, 180), (w / 2 - r, -d / 2 + r, 270)):
        for i in range(seg + 1):
            a = math.radians(a0 + 90 * i / seg)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    bottom = [bm.verts.new((x, y, 0)) for x, y in pts]
    face = bm.faces.new(bottom)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    top = [e for e in ext["geom"] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, vec=(0, 0, h), verts=top)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    return finish_mesh(ob, mat, smooth=False)


def screen_plane(name, w, h, loc, mat, parent=None):
    """Front-facing (-Y) quad with 0..1 UVs; origin at its center."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([(-w / 2, 0, -h / 2), (w / 2, 0, -h / 2), (w / 2, 0, h / 2), (-w / 2, 0, h / 2)],
                   [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for loop, co in zip(uv.data, ((0, 0), (1, 0), (1, 1), (0, 1))):
        loop.uv = co
    ob = link(bpy.data.objects.new(name, me), parent)
    ob.location = loc
    return finish_mesh(ob, mat, smooth=False)


# ---------------------------------------------------------------------------
# Materials (colors sampled from the reference stills)
# ---------------------------------------------------------------------------


def make_materials():
    return {
        "desk": material("DeskWhite", "#E8EBE8", rough=0.32),
        "drawer": material("DrawerWhite", "#E1E4E1", rough=0.36),
        "felt": material("FeltGreen", "#2D4C3B", rough=0.95),
        "trim": material("TrimWhite", "#E4E6E3", rough=0.4),
        "metal": material("BrushedMetal", "#9AA0A1", rough=0.3, metal=0.8),
        "chair_fabric": material("ChairFabric", "#434A4F", rough=0.92),
        "chair_frame": material("ChairFrame", "#5F7179", rough=0.35, metal=0.6),
        "black": material("BlackPlastic", "#18191B", rough=0.45),
        "crt": material("CRTShell", "#EDEDE8", rough=0.3),
        "bezel": material("CRTBezel", "#1E566E", rough=0.4),
        "screen": material("ScreenGlass", "#0C1716", rough=0.15, emit="#5E9C93", emit_strength=0.35),
        "kb_plate": material("KeyboardPlate", "#1D5A6F", rough=0.45),
        "key_cyan": material("KeyCyan", "#3DBBD8", rough=0.4),
        "key_blue": material("KeyBlue", "#2B7EC2", rough=0.4),
        "navy": material("Navy", "#1D3E6B", rough=0.4),
        "tissue": material("TissueBox", "#86D5E0", rough=0.5),
        "pink": material("NotePink", "#F0A9B6", rough=0.7),
        "paper": material("Paper", "#F3F3EF", rough=0.8),
        "sketch": material("Sketch", "#B9BDBA", rough=0.8),
        "floor_mat": material("ChairMat", "#48524F", rough=0.3),
        "lamp": material("LampWhite", "#F0F0EC", rough=0.35),
        "lanyard": material("Lanyard", "#0D47A8", rough=0.85),
        "badge": badge_material(),
    }


# ---------------------------------------------------------------------------
# Pieces
# ---------------------------------------------------------------------------

DESK_TOP_Z = 0.75
DIV_BOTTOM, DIV_TOP = 0.50, 1.42
ARM = 1.74  # half-length of each divider arm


def divider(name, length, center, along_x, M, parent):
    """Felt panel with white trim; runs along X (or Y) and is centered at `center`."""
    grp = empty(name, center, 0 if along_x else math.pi / 2, parent)
    h = DIV_TOP - DIV_BOTTOM
    zc = (DIV_TOP + DIV_BOTTOM) / 2 - center[2]
    t = 0.035
    box(name + "_Felt", (length - 2 * t, 0.045, h - 2 * t), (0, 0, zc), M["felt"], grp)
    rails = [
        ((length, 0.06, t), (0, 0, zc + h / 2 - t / 2)),
        ((length, 0.06, t), (0, 0, zc - h / 2 + t / 2)),
        ((t, 0.06, h), (-length / 2 + t / 2, 0, zc)),
        ((t, 0.06, h), (length / 2 - t / 2, 0, zc)),
    ]
    boxes(name + "_Trim", rails, M["trim"], grp, bevel=0.006)
    return grp


def desk(name, rot_z, M, parent):
    """One desk of the pinwheel. Local frame: desk in x>0, y<0 quadrant, you sit at -Y."""
    grp = empty(name, (0, 0, 0), rot_z, parent)
    x0, x1 = 0.06, 1.66
    y0, y1 = -0.86, -0.06
    cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
    box(name + "_Top", (x1 - x0, y1 - y0, 0.06), (cx, cy, DESK_TOP_Z - 0.03), M["desk"], grp,
        bevel=0.012, segments=3)

    # Floating drawer pedestal on the right.
    px, pw, pd = 1.39, 0.46, 0.70
    pz0, pz1 = 0.30, DESK_TOP_Z - 0.06
    box(name + "_Pedestal", (pw, pd, pz1 - pz0), (px, -0.47, (pz0 + pz1) / 2), M["desk"], grp,
        bevel=0.008)
    front_y = -0.47 - pd / 2 - 0.006
    gap = 0.008
    top_h = 0.13
    bot_h = (pz1 - pz0) - top_h - 3 * gap
    boxes(name + "_Drawers", [
        ((pw - 2 * gap, 0.014, top_h), (px, front_y, pz1 - gap - top_h / 2)),
        ((pw - 2 * gap, 0.014, bot_h), (px, front_y, pz0 + gap + bot_h / 2)),
    ], M["drawer"], grp, bevel=0.004)

    # Single post + round foot holding the pedestal up.
    cylinder(name + "_Post", 0.028, pz0 - 0.02, (px, -0.30, (pz0 + 0.02) / 2), M["metal"], grp)
    cylinder(name + "_Foot", 0.17, 0.018, (px, -0.30, 0.009), M["metal"], grp, segments=48)
    return grp


def chair(name, loc, rot_z, M, parent):
    """Office chair facing +Y in its local frame."""
    grp = empty(name, loc, rot_z, parent)
    legs, casters = [], []
    for i in range(5):
        a = math.radians(90 + i * 72)
        r = 0.16
        legs.append(((0.30, 0.035, 0.025), (r * math.cos(a), r * math.sin(a), 0.075), a))
        casters.append((0.30 * math.cos(a), 0.30 * math.sin(a)))
    boxes(name + "_Base", legs, M["black"], grp, bevel=0.006)
    for i, (x, y) in enumerate(casters):
        cylinder(f"{name}_Caster{i}", 0.026, 0.022, (x, y, 0.028), M["black"], grp, axis="X",
                 segments=16)
    cylinder(name + "_Gas", 0.024, 0.34, (0, 0, 0.25), M["black"], grp)
    box(name + "_Seat", (0.46, 0.44, 0.07), (0, 0.02, 0.46), M["chair_fabric"], grp,
        bevel=0.03, segments=4)
    box(name + "_Back", (0.44, 0.05, 0.30), (0, -0.23, 0.76), M["chair_fabric"], grp,
        bevel=0.022, segments=4, rot=(math.radians(-8), 0, 0))
    for side in (-1, 1):
        x = side * 0.25
        tube(f"{name}_Arm{'L' if side < 0 else 'R'}",
             [(x, 0.17, 0.46), (x, 0.14, 0.64), (x, -0.12, 0.66), (x * 0.93, -0.23, 0.70)],
             0.011, M["chair_frame"], grp)
    return grp


def computer(M, parent):
    """Lumon-style CRT terminal + trackball keyboard. `Screen` is the named display quad."""
    grp = empty("Computer", (0.86, -0.30, DESK_TOP_Z), 0, parent)
    # Stand
    box("CRT_Stand", (0.30, 0.26, 0.05), (0, 0.0, 0.025), M["crt"], grp, bevel=0.02, segments=3)
    box("CRT_Neck", (0.14, 0.12, 0.04), (0, 0.02, 0.065), M["crt"], grp, bevel=0.01)
    # Shell (rounded back body) + front frame
    zc = 0.085 + 0.185
    box("CRT_Shell", (0.44, 0.34, 0.35), (0, 0.04, zc), M["crt"], grp, bevel=0.07, segments=6)
    box("CRT_Frame", (0.47, 0.06, 0.37), (0, -0.16, zc), M["crt"], grp, bevel=0.025, segments=4)
    box("CRT_Bezel", (0.415, 0.012, 0.315), (0, -0.187, zc), M["bezel"], grp, bevel=0.012,
        segments=3)
    # Glass: slightly left of center, knob on the right like the show prop.
    sx, sz = -0.03, zc + 0.01
    box("CRT_GlassRim", (0.29, 0.01, 0.225), (sx, -0.192, sz), M["black"], grp, bevel=0.012,
        segments=3)
    screen_plane("Screen", 0.27, 0.205, (sx, -0.199, sz), M["screen"], grp)
    cylinder("CRT_Knob", 0.011, 0.012, (0.17, -0.196, zc - 0.10), M["black"], grp, axis="Y",
             segments=20)
    sphere("CRT_Camera", 0.006, (0, -0.193, zc + 0.14), M["black"], grp)
    for side in (-1, 1):
        cylinder(f"CRT_SideKnob{'L' if side < 0 else 'R'}", 0.034, 0.03,
                 (side * 0.25, -0.05, zc + 0.03), M["black"], grp, axis="X", segments=24)

    keycard(M, grp, top_z=zc + 0.185, front_y=-0.19)

    # Keyboard
    kb = empty("Keyboard", (0, -0.39, 0), 0, grp)
    box("KB_Base", (0.62, 0.23, 0.035), (0, 0, 0.0175), M["crt"], kb, bevel=0.012, segments=3)
    box("KB_Plate", (0.58, 0.19, 0.01), (0, 0.005, 0.036), M["kb_plate"], kb, bevel=0.004)
    pitch, ks, kh = 0.0205, 0.0165, 0.012
    zk = 0.041 + kh / 2
    cyan, blue = [], []
    main_x0 = -0.255
    for row in range(4):
        n = 13 - (row == 3) * 1
        off = (0, 0.005, 0.010, 0.015)[row]
        y = 0.052 - row * pitch
        for i in range(n):
            x = main_x0 + off + i * pitch
            (blue if (i == 0 or i == n - 1) else cyan).append(((ks, ks, kh), (x, y, zk)))
    # Space bar row
    y = 0.052 - 4 * pitch
    blue.append(((ks, ks, kh), (main_x0 + 0.02, y, zk)))
    cyan.append(((0.14, ks, kh), (main_x0 + 0.13, y, zk)))
    blue.append(((ks * 1.6, ks, kh), (main_x0 + 0.245, y, zk)))
    # Numpad
    for row in range(5):
        for col in range(3):
            cyan.append(((ks, ks, kh), (0.075 + col * pitch, 0.052 - row * pitch, zk)))
    boxes("KB_KeysCyan", cyan, M["key_cyan"], kb, bevel=0.0025)
    boxes("KB_KeysBlue", blue, M["key_blue"], kb, bevel=0.0025)
    # Trackball in a recessed ring
    cylinder("KB_BallRing", 0.03, 0.006, (0.205, 0.0, 0.043), M["black"], kb, segments=32)
    sphere("KB_Trackball", 0.024, (0.205, 0.0, 0.045), M["black"], kb)
    return grp


def keycard(M, parent, top_z, front_y, x=0.112):
    """MDR keycard on a lanyard slung over the CRT, hanging down the front.

    `x` puts it over the top-right corner of the glass, just overlapping the screen.
    """
    face_y = front_y - 0.0125  # card plane, in front of the glass and the Screen quad

    # Shell (see computer()): rounded box, top at top_z - 0.01, back face y=0.21, bevel 0.07,
    # flat for |x| <= 0.15. Near the sides the rounding shrinks, so follow it.
    bevel, flat_half, back_y = 0.07, 0.15, 0.21
    round_cz = top_z - 0.01 - bevel
    round_cy = back_y - bevel

    for i, (sx, dy) in enumerate(((-0.01, 0.0), (0.01, -0.0012))):
        px = x + sx
        d = max(0.0, abs(px) - flat_half)
        r_eff = math.sqrt(bevel ** 2 - d ** 2) + 0.0015
        shell_z = round_cz + r_eff
        # Wrap the frame's rounded top-front edge (bevel radius ~0.025).
        r = 0.026
        cy, cz = front_y + 0.025, top_z - 0.025
        front_arc = [(px, cy - r * math.cos(math.radians(a)) + (dy if a == 0 else 0),
                      cz + r * math.sin(math.radians(a))) for a in (0, 30, 60, 90)]
        back_arc = [(px, round_cy + r_eff * math.sin(math.radians(a)), round_cz + r_eff * math.cos(math.radians(a)))
                    for a in (30, 60, 90)]
        hang_y = round_cy + r_eff
        path = [(x, front_y - 0.0035 + dy, top_z - 0.024),
                (x + sx * 0.4, front_y - 0.0025 + dy, top_z - 0.013)]
        path += front_arc
        path += [(px, front_y + 0.035, top_z + 0.001),
                 (px, -0.06, shell_z),
                 (px, round_cy, shell_z)]
        path += back_arc
        path += [(px, hang_y, 0.30), (px, hang_y + 0.004, 0.20), (px, hang_y + 0.008, 0.12)]
        ribbon(f"Lanyard_Strand{i}", path, 0.014, 0.0008, M["lanyard"], parent)

    # Hardware: crimp end -> split ring -> snap hook through the card slot.
    crimp_z = top_z - 0.027
    box("Lanyard_Crimp", (0.016, 0.0045, 0.011), (x, front_y - 0.0035, crimp_z), M["metal"], parent,
        bevel=0.0012)
    ring_z = crimp_z - 0.0095
    wire_loop("Lanyard_Ring", (x, front_y - 0.0072, ring_z), 0.0045, 0.0045, 0.0009, M["metal"], parent)
    hook_top = ring_z - 0.0035
    hook_bot = hook_top - 0.024
    wire_loop("Lanyard_Hook", (x, face_y, (hook_top + hook_bot) / 2), 0.0032, (hook_top - hook_bot) / 2,
              0.0011, M["metal"], parent, plane="YZ")

    # The card itself: 54 x 86 mm, slot 7 mm below the top edge, pivoting on the hook.
    w, h, slot_down = 0.054, 0.086, 0.007
    pivot = empty("Keycard", (x, face_y, hook_bot + 0.0012), 0, parent)
    pivot.rotation_euler = (0, math.radians(-2.5), 0)
    card_mesh("Keycard_Card", w, h, 0.0012, 0.0035, (0.014, 0.003, slot_down),
              (0, 0.0006, -(h / 2 - slot_down)), M["badge"], pivot)


def desk_items(M, parent):
    grp = empty("DeskItems", (0, 0, DESK_TOP_Z), 0, parent)
    # Pencil cup with pens + scissors-ish handles
    box("PencilCup", (0.075, 0.075, 0.095), (0.20, -0.47, 0.0475), M["drawer"], grp, bevel=0.004)
    for i, (dx, dy, col) in enumerate(((-0.015, 0.01, "navy"), (0.012, -0.01, "key_blue"),
                                      (0.0, 0.015, "black"), (0.018, 0.012, "key_cyan"))):
        cylinder(f"Pen{i}", 0.004, 0.14, (0.20 + dx, -0.47 + dy, 0.09), M[col], grp, segments=8)
    # Lumon mug
    cylinder("Mug", 0.042, 0.1, (0.33, -0.56, 0.05), M["crt"], grp, segments=32)
    tube("MugHandle", [(0.33 - 0.04, -0.56, 0.08), (0.33 - 0.075, -0.56, 0.065),
                       (0.33 - 0.075, -0.56, 0.035), (0.33 - 0.04, -0.56, 0.025)],
         0.007, M["crt"], grp)
    cylinder("MugCoffee", 0.038, 0.004, (0.33, -0.56, 0.092), M["key_blue"], grp, segments=32)
    # Desk lamp
    lamp = empty("Lamp", (0.47, -0.22, 0), 0, grp)
    cylinder("Lamp_Base", 0.07, 0.022, (0, 0, 0.011), M["lamp"], lamp, segments=40)
    cylinder("Lamp_Pole", 0.007, 0.30, (0, 0, 0.17), M["lamp"], lamp, segments=12)
    shade = cylinder("Lamp_Shade", 0.06, 0.12, (0, -0.03, 0.31), M["lamp"], lamp,
                     radius2=0.028, segments=32)
    shade.rotation_euler = (math.radians(-25), 0, 0)
    # Right side of the desk
    box("TapeDispenser", (0.045, 0.075, 0.06), (1.20, -0.30, 0.03), M["navy"], grp, bevel=0.006)
    box("Stapler", (0.05, 0.17, 0.045), (1.38, -0.26, 0.0225), M["navy"], grp, bevel=0.008,
        rot=(0, 0, math.radians(-12)))
    box("TissueBox", (0.14, 0.11, 0.08), (1.52, -0.56, 0.04), M["tissue"], grp, bevel=0.006)
    box("TissueTuft", (0.04, 0.03, 0.03), (1.52, -0.56, 0.088), M["paper"], grp, bevel=0.012)
    box("Notebook", (0.10, 0.14, 0.008), (1.26, -0.69, 0.004), M["navy"], grp, bevel=0.002,
        rot=(0, 0, math.radians(8)))
    boxes("StickyNotes", [((0.06, 0.04, 0.006), (1.38, -0.50, 0.003))], M["pink"], grp)
    box("StickyNotesBlue", (0.07, 0.07, 0.004), (1.36, -0.66, 0.002), M["tissue"], grp)
    cylinder("Pen", 0.004, 0.14, (1.46, -0.70, 0.004), M["metal"], grp, axis="X", segments=8)
    return grp


def posters(M, parent):
    """Framed caricature sketches pinned on the divider behind the hero desk."""
    grp = empty("Posters", (0, 0, 0), 0, parent)
    y = -0.0235
    for i, x in enumerate((0.30, 1.42)):
        box(f"Poster{i}", (0.17, 0.004, 0.22), (x, y - 0.002, 1.12), M["paper"], grp)
        box(f"Poster{i}_Sketch", (0.12, 0.002, 0.13), (x, y - 0.005, 1.13), M["sketch"], grp)
    return grp


# ---------------------------------------------------------------------------
# Build + export
# ---------------------------------------------------------------------------


def clear_scene():
    for ob in list(bpy.data.objects):
        bpy.data.objects.remove(ob, do_unlink=True)
    for coll in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.lights,
                 bpy.data.cameras):
        for block in list(coll):
            if block.users == 0:
                coll.remove(block)


def build():
    clear_scene()
    M = make_materials()
    root = empty("SeveranceDesk")

    # Cross of dividers with a center post.
    divider("Divider_X", ARM * 2, (0, 0, 0), True, M, root)
    divider("Divider_YPos", ARM - 0.03, (0, (ARM + 0.03) / 2, 0), False, M, root)
    divider("Divider_YNeg", ARM - 0.03, (0, -(ARM + 0.03) / 2, 0), False, M, root)
    box("Divider_CenterPost", (0.07, 0.07, DIV_TOP - DIV_BOTTOM + 0.01),
        (0, 0, (DIV_TOP + DIV_BOTTOM) / 2 + 0.005), M["trim"], root, bevel=0.006)

    # Four desks in a pinwheel; Desk_0 is the one facing the camera.
    for i in range(4):
        rz = i * math.pi / 2
        desk(f"Desk_{i}", rz, M, root)
        rot = Matrix.Rotation(rz, 3, "Z")
        chair(f"Chair_{i}", rot @ Vector((0.80, -1.22, 0)), rz, M, root)
        mat_loc = rot @ Vector((0.84, -1.26, 0))
        slab = rounded_slab(f"ChairMat_{i}", 0.95, 0.95, 0.006, 0.14, mat_loc, M["floor_mat"], root)
        slab.rotation_euler = (0, 0, rz)

    computer(M, root)
    desk_items(M, root)
    posters(M, root)
    return root


def export(path):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        export_apply=True,
        export_yup=True,
        export_lights=False,
        export_cameras=False,
    )

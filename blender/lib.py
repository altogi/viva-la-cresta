"""Shared helpers for the build scripts: a clean scene, materials, images drawn with numpy, export."""

import math
import os

import bpy
import numpy as np

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, "public", "models")
PREVIEWS = os.path.join(ROOT, "blender", "previews")


def reset():
    """An empty scene in metres (Blender: Z up; glTF export turns it into Y up)."""
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for block in (bpy.data.meshes, bpy.data.materials, bpy.data.images, bpy.data.textures, bpy.data.curves, bpy.data.cameras, bpy.data.lights):
        for item in list(block):
            if item.users == 0:
                block.remove(item)
    for coll in list(bpy.data.collections):
        bpy.data.collections.remove(coll)


def collection(name: str):
    coll = bpy.data.collections.get(name) or bpy.data.collections.new(name)
    if coll.name not in bpy.context.scene.collection.children:
        bpy.context.scene.collection.children.link(coll)
    return coll


def material(name, color=(0.8, 0.8, 0.8), roughness=0.8, metallic=0.0, image=None, alpha_clip=False, emission=None):
    """A Principled BSDF material that exports cleanly to glTF."""
    # Reused by name: rebuilt in place, so objects already using it keep it.
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    mat.node_tree.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if image is not None:
        tex = nodes.new("ShaderNodeTexImage")
        tex.image = image
        mat.node_tree.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        if alpha_clip:
            mat.node_tree.links.new(tex.outputs["Alpha"], bsdf.inputs["Alpha"])
            mat.blend_method = "CLIP" if hasattr(mat, "blend_method") else mat.blend_method
            mat.surface_render_method = "DITHERED"
            mat.use_backface_culling = False
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = (*emission, 1)
        bsdf.inputs["Emission Strength"].default_value = 1.0
    return mat


def image_from_array(name: str, rgba: np.ndarray, path: str | None = None):
    """A Blender image from an (h, w, 4) float array in 0..1 (row 0 at the top), packed into the file."""
    h, w = rgba.shape[:2]
    img = bpy.data.images.get(name)
    if img is None or img.size[0] != w or img.size[1] != h:
        if img is not None:
            bpy.data.images.remove(img)
        img = bpy.data.images.new(name, w, h, alpha=True)
    img.pixels.foreach_set(np.ascontiguousarray(rgba[::-1]).astype(np.float32).ravel())
    img.update()
    if path:
        img.filepath_raw = path
        img.file_format = "PNG"
        img.save()
    img.pack()
    return img


def stroke(img: np.ndarray, x0, y0, x1, y1, color, width, soft=1.0):
    """Draw an anti-aliased line into an (h, w, 4) array (alpha-over)."""
    h, w = img.shape[:2]
    pad = width + 2
    xa, xb = int(max(0, min(x0, x1) - pad)), int(min(w, max(x0, x1) + pad + 1))
    ya, yb = int(max(0, min(y0, y1) - pad)), int(min(h, max(y0, y1) + pad + 1))
    if xa >= xb or ya >= yb:
        return
    ys, xs = np.mgrid[ya:yb, xa:xb]
    dx, dy = x1 - x0, y1 - y0
    length2 = dx * dx + dy * dy + 1e-9
    t = np.clip(((xs - x0) * dx + (ys - y0) * dy) / length2, 0, 1)
    d = np.hypot(xs - (x0 + t * dx), ys - (y0 + t * dy))
    a = np.clip((width / 2 + soft / 2 - d) / soft, 0, 1) * color[3]
    region = img[ya:yb, xa:xb]
    for c in range(3):
        region[..., c] = region[..., c] * (1 - a) + color[c] * a
    region[..., 3] = region[..., 3] + a * (1 - region[..., 3])


def blob(img: np.ndarray, x, y, r, color, soft=2.0):
    """A soft round dab (snow clumps)."""
    h, w = img.shape[:2]
    xa, xb = int(max(0, x - r - soft)), int(min(w, x + r + soft + 1))
    ya, yb = int(max(0, y - r - soft)), int(min(h, y + r + soft + 1))
    if xa >= xb or ya >= yb:
        return
    ys, xs = np.mgrid[ya:yb, xa:xb]
    d = np.hypot(xs - x, ys - y)
    a = np.clip((r - d) / soft + 0.5, 0, 1) * color[3]
    region = img[ya:yb, xa:xb]
    for c in range(3):
        region[..., c] = region[..., c] * (1 - a) + color[c] * a
    region[..., 3] = region[..., 3] + a * (1 - region[..., 3])


def mesh_object(name, verts, faces, uvs=None, mat=None, coll=None, smooth=False):
    """An object from vertex and face lists; `uvs` is one (u, v) per face corner, in face order."""
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    if uvs is not None:
        layer = me.uv_layers.new(name="UVMap")
        for i, uv in enumerate(uvs):
            layer.data[i].uv = uv
    me.update()
    if smooth:
        me.shade_smooth()
    obj = bpy.data.objects.new(name, me)
    if mat is not None:
        if isinstance(mat, (list, tuple)):
            for m in mat:
                me.materials.append(m)
        else:
            me.materials.append(mat)
    (coll or bpy.context.scene.collection).objects.link(obj)
    return obj


def join(objects, name):
    """Join objects into one (keeping materials)."""
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.name = name
    obj.data.name = name
    return obj


def export_glb(filename: str, objects):
    """Export just these objects to public/models/<filename> (Y up, materials, packed images)."""
    os.makedirs(MODELS, exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    for o in objects:
        o.select_set(True)
    path = os.path.join(MODELS, filename)
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_image_format="WEBP",
        export_texcoords=True,
        export_normals=True,
        export_materials="EXPORT",
    )
    return {"file": path, "bytes": os.path.getsize(path)}


def preview(filename: str, camera_from, camera_to, size=(900, 900), lens=50, sun=(0.6, 0.2, 0.8), sky=(0.55, 0.7, 0.95), strength=1.0, ground=True):
    """Render a quick look at the scene to blender/previews/<filename> (Eevee)."""
    os.makedirs(PREVIEWS, exist_ok=True)
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "AgX"
    world = scene.world or bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (*sky, 1)
    bg.inputs["Strength"].default_value = strength
    for o in list(bpy.data.objects):
        if o.name.startswith("_preview"):
            bpy.data.objects.remove(o)
    cam_data = bpy.data.cameras.new("_preview_cam")
    cam_data.lens = lens
    cam_data.clip_end = 20000
    cam = bpy.data.objects.new("_preview_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = camera_from
    direction = np.array(camera_to) - np.array(camera_from)
    rot = direction_to_euler(direction)
    cam.rotation_euler = rot
    scene.camera = cam
    light_data = bpy.data.lights.new("_preview_sun", "SUN")
    light_data.energy = 4.0
    light = bpy.data.objects.new("_preview_sun", light_data)
    light.rotation_euler = direction_to_euler(-np.array(sun))
    scene.collection.objects.link(light)
    if ground:
        bpy.ops.mesh.primitive_plane_add(size=400, location=(0, 0, 0))
        plane = bpy.context.active_object
        plane.name = "_preview_ground"
        plane.data.materials.append(material("_preview_snow", (0.92, 0.94, 0.97), 0.9))
    path = os.path.join(PREVIEWS, filename)
    scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    for o in list(bpy.data.objects):
        if o.name.startswith("_preview"):
            bpy.data.objects.remove(o)
    return path


def direction_to_euler(d):
    """Euler rotation that points a camera or light (looking down its -Z) along direction d."""
    from mathutils import Vector

    return Vector(d).to_track_quat("-Z", "Y").to_euler()


def render_impostor(obj, filename, size=512, height=None):
    """Render an object side-on (orthographic, transparent background) to an image: a billboard for far away."""
    import bpy as _bpy
    scene = _bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = size // 2
    scene.render.resolution_y = size
    scene.render.film_transparent = True
    scene.view_settings.view_transform = "Standard"
    world = scene.world or _bpy.data.worlds.new("World")
    scene.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes.get("Background")
    bg.inputs["Color"].default_value = (0.75, 0.82, 0.95, 1)
    bg.inputs["Strength"].default_value = 0.8
    h = height or obj.dimensions.z
    cam_data = _bpy.data.cameras.new("_imp_cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = h * 1.04
    cam = _bpy.data.objects.new("_imp_cam", cam_data)
    scene.collection.objects.link(cam)
    cam.location = (obj.location.x, obj.location.y - 100, obj.location.z + h * 0.5)
    cam.rotation_euler = (math.pi / 2, 0, 0)
    scene.camera = cam
    sun_data = _bpy.data.lights.new("_imp_sun", "SUN")
    sun_data.energy = 3.5
    sun = _bpy.data.objects.new("_imp_sun", sun_data)
    sun.rotation_euler = (math.radians(50), 0, math.radians(-30))
    scene.collection.objects.link(sun)
    path = os.path.join(PREVIEWS, filename)
    os.makedirs(PREVIEWS, exist_ok=True)
    scene.render.filepath = path
    _bpy.ops.render.render(write_still=True)
    _bpy.data.objects.remove(cam)
    _bpy.data.objects.remove(sun)
    scene.render.film_transparent = False
    img = _bpy.data.images.load(path, check_existing=False)
    img.pack()
    return img

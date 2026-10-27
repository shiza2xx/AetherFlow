"""Read-only Blender albedo extraction for source-pinned texture markup.

Only a direct image -> Principled Base Color -> active Material Output path is
accepted. Unsupported graph branches are reported instead of guessed.
"""
import bpy, hashlib, json, os, sys, struct, math
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from texture_source_memory import cached_image_target, decoded_pixel_hash

def digest_bytes(value): return hashlib.sha256(value).hexdigest()
def digest(path):
    value = hashlib.sha256()
    with open(path, 'rb') as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b''): value.update(block)
    return value.hexdigest()
def fail(message): raise ValueError(message)
def active_principled(material):
    nodes = material.node_tree.nodes
    outputs = [n for n in nodes if n.bl_idname == 'ShaderNodeOutputMaterial' and n.is_active_output]
    if len(outputs) != 1: return None
    surface = outputs[0].inputs.get('Surface')
    if not surface or len(surface.links) != 1: return None
    source = surface.links[0].from_node
    return source if source.bl_idname == 'ShaderNodeBsdfPrincipled' else None
def uv_digest(layer):
    value = hashlib.sha256()
    for loop in layer.data:
        value.update(struct.pack('<2d', float(loop.uv.x), float(loop.uv.y)))
    return value.hexdigest()
def preview_uv_signature(mesh, layer):
    # glTF flips V and changes Blender's local up axis. Pair each loop UV with
    # its source vertex coordinate so a UV permutation cannot preserve proof.
    def q6(value):
        scaled = int(math.floor(float(value) * 1000000.0 + 0.5))
        magnitude = abs(scaled)
        return ('-' if scaled < 0 else '') + str(magnitude // 1000000) + '.' + ('%06d' % (magnitude % 1000000))
    pairs=sorted(set('%s,%s,%s|%s,%s'%(q6(mesh.vertices[mesh_loop.vertex_index].co.x),q6(mesh.vertices[mesh_loop.vertex_index].co.z),q6(-float(mesh.vertices[mesh_loop.vertex_index].co.y)),q6(uv_loop.uv.x),q6(1.0-float(uv_loop.uv.y))) for mesh_loop, uv_loop in zip(mesh.loops, layer.data)))
    value=2166136261
    for byte in (';'.join(pairs)).encode('ascii'):
        value=((value^byte)*16777619)&0xffffffff
    return '%08x'%value
def normal_map_metadata(principled, obj, base_binding):
    normal = principled.inputs.get('Normal')
    if not normal or len(normal.links) != 1: return None
    node = normal.links[0].from_node
    if node.bl_idname != 'ShaderNodeNormalMap' or getattr(node, 'space', None) != 'TANGENT':
        return {'status': 'unsupported-normal-graph', 'reason': 'Normal input is not a direct tangent-space Normal Map node.'}
    color = node.inputs.get('Color')
    if not color or len(color.links) != 1 or color.links[0].from_node.bl_idname != 'ShaderNodeTexImage':
        return {'status': 'unsupported-normal-graph', 'reason': 'Tangent normal map is not connected directly to a supported image texture.'}
    tex = color.links[0].from_node; image = tex.image
    if not image or image.source == 'TILED': return {'status': 'unsupported-normal-graph', 'reason': 'Tangent normal image is missing or uses unsupported UDIM tiles.'}
    width, height = int(image.size[0]), int(image.size[1])
    if width < 1 or height < 1 or width * height > 16777216: return {'status': 'unsupported-normal-graph', 'reason': 'Normal image dimensions exceed the 16,777,216 pixel limit.'}
    vector = tex.inputs.get('Vector'); uv_set = ''
    if vector and vector.is_linked:
        if len(vector.links) != 1 or vector.links[0].from_node.bl_idname != 'ShaderNodeUVMap': return {'status': 'unsupported-normal-graph', 'reason': 'Normal image uses an unsupported vector or mapping node.'}
        uv_set = vector.links[0].from_node.uv_map
    if not uv_set:
        active = obj.data.uv_layers.active; uv_set = active.name if active else ''
    layer = obj.data.uv_layers.get(uv_set) if uv_set else None
    if not layer: return {'status': 'unsupported-normal-graph', 'reason': 'The normal image UV set is missing.'}
    uv_index = list(obj.data.uv_layers).index(layer)
    if uv_index > 1: return {'status': 'unsupported-normal-graph', 'reason': 'The displayed preview exposes only the first two UV sets.'}
    wrap = {'REPEAT': 'repeat', 'EXTEND': 'clamp', 'MIRROR': 'mirror'}.get(tex.extension)
    if wrap is None: return {'status': 'unsupported-normal-graph', 'reason': 'The normal image sampler mode is unsupported.'}
    binding = {'meshName': obj.name, 'meshDataName': obj.data.name, 'materialName': base_binding['materialName'],
               'materialSlot': base_binding['materialSlot'], 'uvSet': uv_set, 'uvIndex': uv_index,
               'uvDigest': uv_digest(layer), 'displayUvSignature': preview_uv_signature(obj.data, layer),
               'uvMatrix': [1,0,0,0,1,0,0,0,1], 'flipY': True, 'wrapS': wrap, 'wrapT': wrap,
               'imageNodeName': tex.name, 'normalMapNodeName': node.name}
    same_mapping = all(binding[key] == base_binding[key] for key in ('uvSet', 'uvIndex', 'uvMatrix', 'flipY', 'wrapS', 'wrapT'))
    return {'status': 'verified' if same_mapping else 'different-uv-mapping',
            'reason': '' if same_mapping else 'Normal and albedo use different UV or sampler mappings; derive no mask until an exact surface correspondence is available.',
            'imageName': image.name, 'width': width, 'height': height, 'binding': binding}
def packed_png(image, width, height):
    packed = image.packed_file
    if packed:
        raw = bytes(packed.data)
        if raw[:8] == b'\x89PNG\r\n\x1a\n' and len(raw) >= 24 and struct.unpack('>II', raw[16:24]) == (width, height):
            return raw, 'packed-png', digest_bytes(raw)
        return None, 'packed-non-png', digest_bytes(raw)
    return None, 'external-or-unpacked', None
def main():
    cfg = json.load(open(sys.argv[sys.argv.index('--') + 1], encoding='utf-8'))
    source = os.path.abspath(cfg['source'])
    if digest(source) != cfg['sourceHash']: fail('Managed .blend source hash changed before extraction.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    bpy.ops.wm.open_mainfile(filepath=source)
    bpy.context.preferences.filepaths.use_scripts_auto_execute = False
    out_dir = os.path.abspath(cfg['outputDirectory']); os.makedirs(out_dir, exist_ok=False)
    targets, rejected = {}, []
    for obj in bpy.context.scene.objects:
        if obj.type != 'MESH': continue
        for slot_index, slot in enumerate(obj.material_slots):
            material = slot.material
            if not material or not material.use_nodes or not material.node_tree: continue
            principled = active_principled(material)
            if not principled:
                rejected.append({'mesh': obj.name, 'material': material.name, 'reason': 'Active output is not connected directly to a supported Principled BSDF.'}); continue
            base = principled.inputs.get('Base Color')
            if not base or len(base.links) != 1 or base.links[0].from_node.bl_idname != 'ShaderNodeTexImage':
                if base and base.is_linked: rejected.append({'mesh': obj.name, 'material': material.name, 'reason': 'Base Color graph is not a direct supported image texture.'})
                continue
            tex = base.links[0].from_node; image = tex.image
            if not image:
                rejected.append({'mesh': obj.name, 'material': material.name, 'reason': 'Base Color image is missing.'}); continue
            if image.source == 'TILED': rejected.append({'image': image.name, 'mesh': obj.name, 'material': material.name, 'reason': 'UDIM tiles are not supported.'}); continue
            width, height = int(image.size[0]), int(image.size[1])
            if width < 1 or height < 1 or width * height > 16777216:
                rejected.append({'image': image.name, 'mesh': obj.name, 'material': material.name, 'reason': 'Image dimensions exceed the 16,777,216 pixel limit.'}); continue
            vector = tex.inputs.get('Vector'); uv_set = ''
            if vector and vector.is_linked:
                if len(vector.links) != 1 or vector.links[0].from_node.bl_idname != 'ShaderNodeUVMap':
                    rejected.append({'image': image.name, 'mesh': obj.name, 'material': material.name, 'reason': 'Image uses an unsupported vector or mapping node.'}); continue
                uv_set = vector.links[0].from_node.uv_map
            if not uv_set:
                layer = obj.data.uv_layers.active
                uv_set = layer.name if layer else ''
            layer = obj.data.uv_layers.get(uv_set) if uv_set else None
            if not layer:
                rejected.append({'image': image.name, 'mesh': obj.name, 'material': material.name, 'reason': 'The bound UV set is missing.'}); continue
            uv_index = list(obj.data.uv_layers).index(layer)
            if uv_index > 1:
                rejected.append({'image': image.name, 'mesh': obj.name, 'material': material.name, 'reason': 'The displayed Blender preview exposes only the first two UV sets.'}); continue
            wrap = {'REPEAT': 'repeat', 'EXTEND': 'clamp', 'MIRROR': 'mirror'}.get(tex.extension)
            if wrap is None:
                rejected.append({'image': image.name, 'mesh': obj.name, 'material': material.name, 'reason': 'The image sampler mode is unsupported.'}); continue
            key = str(image.as_pointer())
            def create_target():
                packed, source_kind, source_hash = packed_png(image, width, height)
                filename = 'texture-%03d.png' % (len(targets) + 1)
                output = os.path.join(out_dir, filename)
                if packed is not None:
                    with open(output, 'xb') as stream: stream.write(packed)
                    conversion = 'byte-identical-packed-png'
                else:
                    previous_path, previous_format = image.filepath_raw, image.file_format
                    try:
                        image.filepath_raw = output; image.file_format = 'PNG'; image.save()
                    finally:
                        image.filepath_raw, image.file_format = previous_path, previous_format
                    conversion = 'lossless-png-decode-reencode-from-blender-image'
                del packed
                return {'imageName': image.name, 'width': width, 'height': height, 'channel': 'albedo', 'normalBindings': [],
                        'decodedPixelHash': decoded_pixel_hash(image.pixels), 'bindings': [],
                        'filename': filename, 'sourceBytesHash': source_hash,
                        'sourceStorage': source_kind, 'conversion': conversion}
            target = cached_image_target(targets, key, create_target)
            binding = {'meshName': obj.name, 'meshDataName': obj.data.name, 'materialName': material.name, 'materialSlot': slot_index, 'uvSet': uv_set, 'uvIndex': uv_index, 'uvDigest': uv_digest(layer), 'displayUvSignature': preview_uv_signature(obj.data, layer), 'uvMatrix': [1,0,0,0,1,0,0,0,1], 'flipY': True, 'wrapS': wrap, 'wrapT': wrap, 'imageNodeName': tex.name, 'materialOutputName': next(n.name for n in material.node_tree.nodes if n.bl_idname == 'ShaderNodeOutputMaterial' and n.is_active_output)}
            if not any(row['meshName'] == obj.name and row['materialSlot'] == slot_index and row['uvSet'] == uv_set for row in target['bindings']): target['bindings'].append(binding)
            normal_info = normal_map_metadata(principled, obj, binding)
            if normal_info and not any(row.get('binding',{}).get('meshName') == obj.name and row.get('binding',{}).get('materialSlot') == slot_index and row.get('imageName') == normal_info.get('imageName') for row in target['normalBindings']):
                target['normalBindings'].append(normal_info)
    results=[]
    for target in targets.values():
        if not target['bindings']: continue
        filename=target['filename']; output=os.path.join(out_dir,filename)
        if not os.path.isfile(output) or os.path.getsize(output)<32: fail('Blender did not save a full-resolution PNG for '+target['imageName'])
        if digest(source)!=cfg['sourceHash']: fail('Managed .blend source changed during read-only texture extraction.')
        target.update({'outputHash':digest(output),'outputBytes':os.path.getsize(output)})
        results.append(target)
    with open(cfg['report'],'w',encoding='utf-8') as stream:
        json.dump({'schemaVersion':1,'sourceHash':cfg['sourceHash'],'blenderVersion':bpy.app.version_string,'targets':results,'rejected':rejected,'readOnly':True},stream,indent=2)
if __name__ == '__main__': main()

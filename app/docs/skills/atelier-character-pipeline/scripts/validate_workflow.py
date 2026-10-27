"""Independent Atelier model checks. Run only through the trusted --disable-autoexec runner."""
import bpy, sys, os, json, hashlib, struct, zipfile, tempfile, shutil, pathlib, re, time, ctypes, base64, zlib, math
from mathutils import Matrix,Vector,Quaternion
sys.path.insert(0,os.path.dirname(os.path.abspath(__file__)))
from preservation_fingerprint import animation_fingerprint, image_pixel_fingerprint, image_component_fingerprint, material_graph_snapshot, sampled_animation_state, clear_image_fingerprint_cache, read_only_image_capture, IMAGE_FINGERPRINT_VERSION, _IMAGE_FINGERPRINT_STATS

_MATERIAL_SIGNATURE_CACHE={}
_IMAGE_BUFFER_RELEASES=0
VALIDATOR_VERSION=10
WEIGHT_FINGERPRINT_VERSION=2
BLENDER_WORKING_SET_LIMIT_BYTES=int(os.environ.get('ATELIER_BLENDER_WORKING_SET_LIMIT_BYTES',str(6*1024*1024*1024)))

def sha_file(path):
    h=hashlib.sha256()
    with open(path,'rb') as f:
        for block in iter(lambda:f.read(1024*1024),b''): h.update(block)
    return h.hexdigest()
def digest(value): return hashlib.sha256(value).hexdigest()
def enforce_blender_memory_budget(stage):
    if os.name!='nt':return
    import ctypes.wintypes
    class Counters(ctypes.Structure):
        _fields_=[('cb',ctypes.wintypes.DWORD),('PageFaultCount',ctypes.wintypes.DWORD),('PeakWorkingSetSize',ctypes.c_size_t),('WorkingSetSize',ctypes.c_size_t),('QuotaPeakPagedPoolUsage',ctypes.c_size_t),('QuotaPagedPoolUsage',ctypes.c_size_t),('QuotaPeakNonPagedPoolUsage',ctypes.c_size_t),('QuotaNonPagedPoolUsage',ctypes.c_size_t),('PagefileUsage',ctypes.c_size_t),('PeakPagefileUsage',ctypes.c_size_t)]
    counters=Counters();counters.cb=ctypes.sizeof(counters)
    get_current_process=ctypes.windll.kernel32.GetCurrentProcess;get_current_process.restype=ctypes.wintypes.HANDLE
    get_memory_info=ctypes.windll.psapi.GetProcessMemoryInfo;get_memory_info.argtypes=[ctypes.wintypes.HANDLE,ctypes.POINTER(Counters),ctypes.wintypes.DWORD];get_memory_info.restype=ctypes.wintypes.BOOL
    if not get_memory_info(get_current_process(),ctypes.byref(counters),counters.cb):raise RuntimeError('Unable to enforce the configured Blender working-set budget.')
    if int(counters.WorkingSetSize)>BLENDER_WORKING_SET_LIMIT_BYTES:raise MemoryError('Blender working set exceeded the '+str(BLENDER_WORKING_SET_LIMIT_BYTES)+'-byte E1 budget during '+stage+'; operation stopped before candidate publication.')
def glb_image_placeholder_uri():
    def chunk(kind,data):return struct.pack('>I',len(data))+kind+data+struct.pack('>I',zlib.crc32(kind+data)&0xffffffff)
    raw=b'\x89PNG\r\n\x1a\n'+chunk(b'IHDR',struct.pack('>IIBBBBB',1,1,8,6,0,0,0))+chunk(b'IDAT',zlib.compress(b'\x00\x80\x80\x80\xff'))+chunk(b'IEND',b'')
    return 'data:image/png;base64,'+base64.b64encode(raw).decode('ascii')
def inside(root,path):
    root=os.path.realpath(root); path=os.path.realpath(path)
    if os.path.commonpath([root,path])!=root: raise ValueError('Validator input escaped its operation root.')
    return path
def active_principled(material):
    if not material or not material.use_nodes:return None
    links=material.node_tree.links
    outputs=[n for n in material.node_tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial' and n.is_active_output]
    if len(outputs)!=1:return None
    surface=outputs[0].inputs.get('Surface')
    links_to=[l for l in links if l.to_node==outputs[0] and l.to_socket==surface]
    if len(links_to)!=1 or links_to[0].from_node.bl_idname!='ShaderNodeBsdfPrincipled':return None
    return links_to[0].from_node
def gltf_export_principled(material):
    """Mirror Blender's pinned glTF exporter: first Principled linked to active output."""
    if not material or not material.use_nodes:return None
    tree=material.node_tree;outputs=[n for n in tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial' and n.is_active_output]
    if len(outputs)!=1:return None
    reachable=set();pending=[outputs[0]]
    while pending:
        node=pending.pop()
        if node in reachable:continue
        reachable.add(node);pending.extend(link.from_node for link in tree.links if link.to_node==node)
    return next((node for node in tree.nodes if node.bl_idname=='ShaderNodeBsdfPrincipled' and node in reachable),None)
def active_surface_is_direct_principled(material,principled):
    if not material or not principled:return False
    outputs=[n for n in material.node_tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial' and n.is_active_output]
    return len(outputs)==1 and any(link.from_node==principled and link.to_node==outputs[0] and link.to_socket==outputs[0].inputs.get('Surface') for link in material.node_tree.links)
def pbr_channel_signature(material):
    if not material or not material.use_nodes:return None
    nodes=material.node_tree.nodes;links=material.node_tree.links;principled=gltf_export_principled(material)
    if not principled:return None
    result={}
    for channel,socket_name in (('albedo','Base Color'),('roughness','Roughness'),('metallic','Metallic')):
        socket=principled.inputs.get(socket_name);link=next((x for x in links if x.to_node==principled and x.to_socket==socket),None)
        component=None;image_node=None
        if link and link.from_node.bl_idname=='ShaderNodeSeparateColor':
            component=link.from_socket.name;split=link.from_node.inputs.get('Color');upstream=next((x for x in links if x.to_node==link.from_node and x.to_socket==split),None)
            if upstream and upstream.from_node.bl_idname=='ShaderNodeTexImage':image_node=upstream.from_node
        if link and link.from_node.bl_idname=='ShaderNodeTexImage' and link.from_node.image:
            image_node=link.from_node
        if image_node and image_node.image:
            # glTF's required metallic/roughness encoding reads B for Metallic
            # and G for Roughness when these scalar sockets are linked directly
            # to an RGB image. The exporter packs those semantic components into
            # the same fixed channels, so compare component pixels rather than
            # unrelated full source-image channels.
            if component is None and channel=='roughness':component='Green'
            if component is None and channel=='metallic':component='Blue'
            im=image_node.image
            pixels=image_component_fingerprint(im,component) if component else image_pixel_fingerprint(im)
            if component and channel in ('roughness','metallic'):
                pixels['component']='Green' if channel=='roughness' else 'Blue'
            result[channel]={'kind':'image-component' if component else 'image','pixels':pixels,'source':im.source}
        else:
            value=socket.default_value
            try:value=[round(float(v),8) for v in value]
            except (TypeError,ValueError):value=round(float(value),8)
            result[channel]={'kind':'constant','value':value}
    normal_input=principled.inputs.get('Normal');normal_link=next((x for x in links if x.to_node==principled and x.to_socket==normal_input),None)
    if normal_link and normal_link.from_node.bl_idname=='ShaderNodeNormalMap':
        color=normal_link.from_node.inputs.get('Color');image_link=next((x for x in links if x.to_node==normal_link.from_node and x.to_socket==color),None)
        if image_link and image_link.from_node.bl_idname=='ShaderNodeTexImage' and image_link.from_node.image:
            im=image_link.from_node.image;result['normal']={'kind':'image','pixels':image_pixel_fingerprint(im),'source':im.source}
        else:result['normal']={'kind':'normal-node','space':normal_link.from_node.space,'strength':round(float(normal_link.from_node.inputs['Strength'].default_value),8)}
    else:result['normal']={'kind':'unbound' if normal_link is None else 'unsupported'}
    return result
def pbr_material_semantics(material):
    """Return the source routes the glTF PBR comparison must preserve."""
    principled=gltf_export_principled(material)
    if principled is None:return None
    links=material.node_tree.links
    routes={}
    for channel,socket_name in (('albedo','Base Color'),('roughness','Roughness'),('metallic','Metallic')):
        socket=principled.inputs.get(socket_name);link=next((x for x in links if x.to_node==principled and x.to_socket==socket),None)
        node=link.from_node if link else None
        if node and node.bl_idname=='ShaderNodeSeparateColor':
            color=node.inputs.get('Color');upstream=next((x for x in links if x.to_node==node and x.to_socket==color),None);node=upstream.from_node if upstream else None
        if node and node.bl_idname=='ShaderNodeTexImage':
            vector=node.inputs.get('Vector');vector_link=next((x for x in links if x.to_node==node and x.to_socket==vector),None)
            routes[channel]=vector_link.from_node.uv_map if vector_link and vector_link.from_node.bl_idname=='ShaderNodeUVMap' else ('__unsupported__' if vector_link else None)
    normal=principled.inputs.get('Normal');normal_link=next((x for x in links if x.to_node==principled and x.to_socket==normal),None);strength=None;space=None
    if normal_link and normal_link.from_node.bl_idname=='ShaderNodeNormalMap':
        normal_node=normal_link.from_node;strength=round(float(normal_node.inputs['Strength'].default_value),8);space=normal_node.space
        color=normal_node.inputs.get('Color');image_link=next((x for x in links if x.to_node==normal_node and x.to_socket==color),None)
        if image_link and image_link.from_node.bl_idname=='ShaderNodeTexImage':
            image=image_link.from_node;vector=image.inputs.get('Vector');vector_link=next((x for x in links if x.to_node==image and x.to_socket==vector),None)
            routes['normal']=vector_link.from_node.uv_map if vector_link and vector_link.from_node.bl_idname=='ShaderNodeUVMap' else ('__unsupported__' if vector_link else None)
    return {'textureUvMaps':routes,'normalSpace':space,'normalStrength':strength,'directPrincipledSurface':active_surface_is_direct_principled(material,principled)}
@read_only_image_capture
def material_signature(material):
    if not material:return None
    # The datablock pointer is stable across in-place node/default/link edits.
    # Rebuild this compact indexed graph each time; image payloads still use the
    # explicitly scoped read-only capture cache below. A pointer-only cache can
    # otherwise certify a changed material from an earlier graph snapshot.
    graph=material_graph_snapshot(material,include_image_pixels=True)
    return {'name':material.name,'schemaVersion':2,'settings':graph.get('settings',{}),'nodes':graph['nodes'],'links':graph['links'],'pbrChannels':pbr_channel_signature(material),'pbrSemantics':pbr_material_semantics(material),'fingerprintVersion':IMAGE_FINGERPRINT_VERSION}
def connected_material_images(material):
    if not material or not material.use_nodes:return set()
    tree=material.node_tree;connected=set();pending=[n for n in tree.nodes if n.bl_idname=='ShaderNodeOutputMaterial' and n.is_active_output]
    while pending:
        node=pending.pop()
        if node in connected:continue
        connected.add(node);pending.extend(link.from_node for link in tree.links if link.to_node==node)
    return {node.image for node in connected if node.bl_idname=='ShaderNodeTexImage' and node.image}
@read_only_image_capture
def fingerprint_materials_and_release_images(scene_objects):
    """Fingerprint only face-used material graphs for active-render equivalence.

    Unused slots and their image history remain in the managed editable BLEND;
    they are not decoded as if they affected the final rendered surface.
    """
    global _IMAGE_BUFFER_RELEASES
    materials=[];seen=set();references={};images_by_material={}
    for obj in scene_objects:
        if obj.type!='MESH':continue
        used={int(poly.material_index) for poly in obj.data.polygons}
        for slot_index,material in enumerate(obj.data.materials):
            if slot_index not in used:continue
            if not material or int(material.as_pointer()) in seen:continue
            seen.add(int(material.as_pointer()));materials.append(material);images=connected_material_images(material);images_by_material[int(material.as_pointer())]=images
            for image in images:references[int(image.as_pointer())]=references.get(int(image.as_pointer()),0)+1
    for index,material in enumerate(materials):
        enforce_blender_memory_budget('active-material graph fingerprint')
        material_signature(material)
        for image in images_by_material[int(material.as_pointer())]:
            pointer=int(image.as_pointer());references[pointer]-=1
            if references[pointer]==0:
                try:image.buffers_free();_IMAGE_BUFFER_RELEASES+=1
                except (ReferenceError,RuntimeError):pass
        if index%max(1,len(materials)//4)==0:progress(37+min(3,int(4*(index+1)/max(1,len(materials)))),'Hashing connected images for material '+str(index+1)+' of '+str(len(materials))+'; released '+str(_IMAGE_BUFFER_RELEASES)+' image buffers')
def clear_scene():
    clear_image_fingerprint_cache();_MATERIAL_SIGNATURE_CACHE.clear()
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
def load(path):
    ext=pathlib.Path(path).suffix.lower()
    if ext=='.blend': bpy.ops.wm.open_mainfile(filepath=path)
    elif ext in ('.glb','.gltf'): bpy.ops.import_scene.gltf(filepath=path,merge_vertices=False)
    elif ext=='.fbx': bpy.ops.import_scene.fbx(filepath=path,automatic_bone_orientation=False)
    elif ext=='.obj': bpy.ops.wm.obj_import(filepath=path)
    else: raise ValueError('Independent check accepts BLEND, GLB/glTF, FBX or OBJ model bytes.')
    bpy.context.preferences.filepaths.use_scripts_auto_execute=False
def declared_gltf_mesh_nodes(path):
    ext=pathlib.Path(path).suffix.lower()
    if ext=='.glb':
        raw=open(path,'rb').read();pos=12;document=None
        while pos<len(raw):
            size,kind=struct.unpack_from('<II',raw,pos);pos+=8;chunk=raw[pos:pos+size];pos+=size
            if kind==0x4E4F534A:document=json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
    elif ext=='.gltf':document=json.load(open(path,encoding='utf8'))
    else:return None
    meshes=document.get('meshes',[]);return {str(meshes[node['mesh']].get('name') or node.get('name') or 'Mesh') for node in document.get('nodes',[]) if 'mesh' in node and 0<=node['mesh']<len(meshes)}
def glb_validation_copy(path,root):
    """Keep mesh/skin/action bytes intact while using 1x1 decoder sentinels for scene import.

    The independent material validator decodes original GLB image views separately;
    this temporary importer copy prevents Blender holding every full atlas twice.
    """
    raw=open(path,'rb').read()
    if raw[:4]!=b'glTF' or struct.unpack_from('<I',raw,4)[0]!=2:raise ValueError('Validation copy requires GLB v2.')
    pos=12;chunks=[];document=None
    while pos<len(raw):
        size,kind=struct.unpack_from('<II',raw,pos);pos+=8;chunk=raw[pos:pos+size];pos+=size
        if kind==0x4E4F534A:document=json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
        else:chunks.append((kind,chunk))
    if document is None:raise ValueError('GLB JSON chunk is missing.')
    placeholder=glb_image_placeholder_uri()
    for image in document.get('images',[]):
        image.pop('bufferView',None);image['uri']=placeholder;image['mimeType']='image/png'
    json_bytes=json.dumps(document,separators=(',',':'),ensure_ascii=False).encode('utf-8');json_bytes+=b' '*((-len(json_bytes))%4)
    all_chunks=[(0x4E4F534A,json_bytes),*chunks];body=b''.join(struct.pack('<II',len(chunk),kind)+chunk for kind,chunk in all_chunks)
    result=b'glTF'+struct.pack('<II',2,12+len(body))+body
    target=os.path.join(root,'candidate-validation-import.glb')
    with open(target,'wb') as output:output.write(result)
    return target
def parse_glb_triangles(path,uv_layer_names,skinned_accessor_space=False):
    raw=open(path,'rb').read()
    if raw[:4]!=b'glTF' or struct.unpack_from('<I',raw,4)[0]!=2 or struct.unpack_from('<I',raw,8)[0]!=len(raw):raise ValueError('Actual assembly export is not a valid GLB v2 container.')
    pos=12; document=None; binary=None
    while pos<len(raw):
        size,kind=struct.unpack_from('<II',raw,pos);pos+=8;chunk=raw[pos:pos+size];pos+=size
        if kind==0x4E4F534A:document=json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
        elif kind==0x004E4942:binary=chunk
    if document is None or binary is None or len(document.get('buffers',[]))!=1:raise ValueError('GLB container must include one JSON and one binary buffer.')
    types={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}; formats={5120:('b',1),5121:('B',1),5122:('h',2),5123:('H',2),5125:('I',4),5126:('f',4)}
    def accessor(index):
        a=document['accessors'][index]
        if 'sparse' in a:raise ValueError('Sparse GLB accessors are not supported by correspondence validation.')
        view=document['bufferViews'][a['bufferView']]; fmt,width=formats[a['componentType']]; count=types[a['type']]; step=view.get('byteStride',width*count); offset=view.get('byteOffset',0)+a.get('byteOffset',0); values=[]
        for i in range(a['count']):
            row=struct.unpack_from('<'+fmt*count,binary,offset+i*step)
            if a.get('normalized') and fmt!='f':
                if fmt in ('b','h'):row=tuple(max(-1.0,x/((1<<(width*8-1))-1)) for x in row)
                else:row=tuple(x/((1<<(width*8))-1) for x in row)
            values.append(row[0] if count==1 else tuple(row))
        return values
    nodes=document.get('nodes',[]); parents={}
    for i,node in enumerate(nodes):
        for child in node.get('children',[]):
            if child in parents:raise ValueError('GLB node hierarchy has a multiple-parent ambiguity.')
            parents[child]=i
    local=[]
    for node in nodes:
        if 'matrix' in node:
            a=node['matrix'];local.append(Matrix([[a[c*4+r] for c in range(4)] for r in range(4)]))
        else:
            t=node.get('translation',(0,0,0));r=node.get('rotation',(0,0,0,1));s=node.get('scale',(1,1,1));local.append(Matrix.Translation(Vector(t))@Quaternion((r[3],r[0],r[1],r[2])).to_matrix().to_4x4()@Matrix.Diagonal((s[0],s[1],s[2],1)))
    world={}
    def world_matrix(i,visiting=None):
        if i in world:return world[i]
        visiting=visiting or set()
        if i in visiting:raise ValueError('GLB node hierarchy contains a cycle.')
        visiting.add(i);result=(world_matrix(parents[i],visiting) if i in parents else Matrix.Identity(4))@local[i];visiting.remove(i);world[i]=result;return result
    for i in range(len(nodes)):world_matrix(i)
    # glTF node worlds are expressed in the Y-up document basis. Static
    # accessors must return to Blender's Z-up world before matching source
    # loop corners; omitting this conversion can pair a valid UV corner with a
    # different symmetric-mesh position after the axis rotation.
    gltf_to_blender=Matrix(((1,0,0,0),(0,0,-1,0),(0,1,0,0),(0,0,0,1)))
    skins=document.get('skins',[]);triangles=[];material_names=[m.get('name','') for m in document.get('materials',[])];used_materials=set()
    for node_index,node in enumerate(nodes):
        if 'mesh' not in node:continue
        skin=skins[node['skin']]['joints'] if 'skin' in node and node['skin']<len(skins) else []
        matrix=world[node_index]
        mesh_document=document['meshes'][node['mesh']];mesh_name=str(node.get('name') or mesh_document.get('name') or 'Mesh')
        mesh_uv_names=uv_layer_names.get(mesh_name,[]) if isinstance(uv_layer_names,dict) else uv_layer_names
        for primitive in mesh_document.get('primitives',[]):
            attrs=primitive.get('attributes',{}); required=('POSITION','NORMAL','TEXCOORD_0')
            if any(name not in attrs for name in required):raise ValueError('GLB primitive lacks position, normal or first UV attributes.')
            positions=accessor(attrs['POSITION']);normals=accessor(attrs['NORMAL']);uvattrs=sorted((int(m.group(1)),name) for name in attrs if (m:=re.fullmatch(r'TEXCOORD_(\d+)',name)));uvmaps=[accessor(attrs[x[1]]) for x in uvattrs];indices=accessor(primitive['indices']) if 'indices' in primitive else list(range(len(positions)))
            if primitive.get('mode',4)!=4 or len(indices)%3:raise ValueError('GLB assembly must use triangle-list primitives.')
            material_index=primitive.get('material');material=material_names[material_index] if material_index is not None and material_index<len(material_names) else None;used_materials.add(material)
            joint_attrs=sorted((int(m.group(1)),name) for name in attrs if (m:=re.fullmatch(r'JOINTS_(\d+)',name)))
            weight_attrs=sorted((int(m.group(1)),name) for name in attrs if (m:=re.fullmatch(r'WEIGHTS_(\d+)',name)))
            if len(joint_attrs)!=len(weight_attrs) or [x[0] for x in joint_attrs]!=[x[0] for x in weight_attrs]:raise ValueError('GLB joint/weight accessor sets are incomplete.')
            joints=[accessor(attrs[x[1]]) for x in joint_attrs];weights=[accessor(attrs[x[1]]) for x in weight_attrs]
            for start in range(0,len(indices),3):
                corners=[]
                for vi in indices[start:start+3]:
                    if vi>=len(positions):raise ValueError('GLB index references an absent vertex.')
                    if skinned_accessor_space and 'skin' in node:
                        # Blender's exporter writes skinned accessors in the
                        # source object world basis and the skin palette/node
                        # matrices return that baked basis at bind. Compare
                        # these stored corners after the explicit glTF Y-up
                        # inverse, separately from Blender importer evaluation.
                        point=Vector((positions[vi][0],-positions[vi][2],positions[vi][1]));normal=Vector((normals[vi][0],-normals[vi][2],normals[vi][1])).normalized()
                    else:
                        blender_world=gltf_to_blender@matrix
                        point=blender_world@Vector((*positions[vi],1));normal=(blender_world.to_3x3().inverted().transposed()@Vector(normals[vi])).normalized()
                    influences={}
                    for ji,wi in zip(joints,weights):
                        for joint,weight in zip(ji[vi],wi[vi]):
                            if weight>0.0:
                                if joint>=len(skin):raise ValueError('GLB vertex references an absent skin joint.')
                                bone=nodes[skin[joint]].get('name',str(skin[joint]));influences[bone]=influences.get(bone,0.0)+float(weight)
                    uv_values={mesh_uv_names[i] if i<len(mesh_uv_names) else 'TEXCOORD_'+str(uvattrs[i][0]):[round(float(uvmaps[i][vi][0]),7),round(1.0-float(uvmaps[i][vi][1]),7)] for i in range(len(uvmaps))}
                    corners.append({'position':[round(float(x),7) for x in point[:3]],'normal':[round(float(x),6) for x in normal],'uv':uv_values,'weights':sorted((name,weight) for name,weight in influences.items())})
                triangles.append({'mesh':mesh_name,'material':material,'corners':corners})
    return {'triangles':triangles,'materials':sorted(x for x in used_materials if x)}
def validate_glb_skin_binding(source,path):
    """Bind exported joints, IBM accessors and baked mesh basis to the source rig."""
    raw=open(path,'rb').read();pos=12;document=None;binary=None
    while pos<len(raw):
        size,kind=struct.unpack_from('<II',raw,pos);pos+=8;chunk=raw[pos:pos+size];pos+=size
        if kind==0x4E4F534A:document=json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
        elif kind==0x004E4942:binary=chunk
    if document is None or binary is None:raise ValueError('GLB skin-binding verification requires JSON and BIN chunks.')
    nodes=document.get('nodes',[]);parents={}
    for i,node in enumerate(nodes):
        for child in node.get('children',[]):
            if child in parents:raise ValueError('GLB skin-binding hierarchy has multiple parents.')
            parents[child]=i
    local=[]
    for node in nodes:
        if 'matrix' in node:
            values=node['matrix'];local.append(Matrix([[values[c*4+r] for c in range(4)] for r in range(4)]))
        else:
            t=node.get('translation',(0,0,0));q=node.get('rotation',(0,0,0,1));s=node.get('scale',(1,1,1))
            local.append(Matrix.Translation(Vector(t))@Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4()@Matrix.Diagonal((s[0],s[1],s[2],1)))
    world={}
    def world_matrix(index,visiting=None):
        if index not in world:
            visiting=visiting or set()
            if index in visiting:raise ValueError('GLB static attachment hierarchy contains a cycle.')
            visiting.add(index);world[index]=(world_matrix(parents[index],visiting) if index in parents else Matrix.Identity(4))@local[index];visiting.remove(index)
        return world[index]
    for index in range(len(nodes)):world_matrix(index)
    world={}
    def world_matrix(index,visiting=None):
        if index not in world:
            visiting=visiting or set()
            if index in visiting:raise ValueError('GLB skin-binding hierarchy contains a cycle.')
            visiting.add(index);world[index]=(world_matrix(parents[index],visiting) if index in parents else Matrix.Identity(4))@local[index];visiting.remove(index)
        return world[index]
    for index in range(len(nodes)):world_matrix(index)
    def read_matrices(accessor_index):
        accessor=document['accessors'][accessor_index]
        if accessor.get('type')!='MAT4' or accessor.get('componentType')!=5126 or 'sparse' in accessor:raise ValueError('GLB inverse-bind matrices must be dense FLOAT MAT4 accessors.')
        view=document['bufferViews'][accessor['bufferView']];stride=view.get('byteStride',64);offset=view.get('byteOffset',0)+accessor.get('byteOffset',0);result=[]
        for i in range(accessor['count']):
            values=struct.unpack_from('<16f',binary,offset+i*stride);result.append(Matrix([[values[c*4+r] for c in range(4)] for r in range(4)]))
        return result
    def delta(a,b):return max(abs(float(a[r][c])-float(b[r][c])) for r in range(4) for c in range(4))
    basis=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    source_arms={row['object']:row for row in source.get('armatures',[])};source_meshes=source.get('meshes',{});verified=[]
    for node_index,node in enumerate(nodes):
        if 'mesh' not in node or 'skin' not in node:continue
        name=str(node.get('name') or document['meshes'][node['mesh']].get('name') or 'Mesh');mesh=source_meshes.get(name)
        if not mesh or not mesh.get('skinned'):raise ValueError('GLB skin node has no matching source skinned mesh: '+name)
        armature_names=mesh.get('armatureObjects',[])
        if len(armature_names)!=1 or armature_names[0] not in source_arms:raise ValueError('Source mesh must bind exactly one named source armature: '+name)
        armature=source_arms[armature_names[0]];skin=document.get('skins',[])[node['skin']];joint_indices=skin.get('joints',[])
        joint_names=[nodes[index].get('name') for index in joint_indices]
        bones={bone['name']:bone for bone in armature['bones']}
        if len(joint_indices)!=len(bones) or set(joint_names)!=set(bones):raise ValueError('GLB skin joint names/count differ from the bound source armature: '+name)
        if skin.get('skeleton') is not None and nodes[skin['skeleton']].get('name')!=armature_names[0]:raise ValueError('GLB skin skeleton root differs from its bound source armature: '+name)
        mesh_world_source=Matrix([mesh['objectMatrix'][i:i+4] for i in range(0,16,4)])
        mesh_world_error=delta(world[node_index],basis@mesh_world_source@basis.inverted())
        if mesh_world_error>0.00002:raise ValueError('GLB skinned mesh node world transform differs from the explicit source Blender-to-glTF basis: '+name)
        ibms=read_matrices(skin['inverseBindMatrices']) if 'inverseBindMatrices' in skin else []
        if len(ibms)!=len(joint_indices):raise ValueError('GLB inverse-bind accessor count differs from its skin joint palette: '+name)
        maximum_rest_error=0.0;maximum_bind_identity_error=0.0
        for joint_index,ibm in zip(joint_indices,ibms):
            joint=nodes[joint_index];joint_name=joint.get('name');bone=bones[joint_name]
            expected_world=basis@Matrix(armature['world'])@Matrix(bone['rest']);rest_error=delta(world[joint_index],expected_world)
            if rest_error>0.00002:raise ValueError('GLB joint world matrix differs from its source rest transform/basis: '+joint_name)
            if bone.get('parent'):
                parent_index=parents.get(joint_index)
                if parent_index is None or nodes[parent_index].get('name')!=bone['parent']:raise ValueError('GLB joint parent binding differs from source hierarchy: '+joint_name)
            bind_error=delta(world[joint_index]@ibm,Matrix.Identity(4))
            if bind_error>0.00002:raise ValueError('GLB inverse-bind matrix does not cancel the bound joint world in the exporter world-baked accessor basis: '+joint_name)
            maximum_rest_error=max(maximum_rest_error,rest_error);maximum_bind_identity_error=max(maximum_bind_identity_error,bind_error)
        verified.append({'mesh':name,'armature':armature_names[0],'meshNodeIndex':node_index,'skinIndex':node['skin'],'jointCount':len(joint_indices),'basis':'left-multiplied Blender Z-up to glTF Y-up matrix','meshNodeWorldMaxDelta':mesh_world_error,'jointRestWorldMaxDelta':maximum_rest_error,'jointWorldTimesIBMIdentityMaxDelta':maximum_bind_identity_error,'accessorSpace':'source object world baked; jointWorld*IBM=identity at bind'})
    if not verified or len(verified)!=sum(1 for mesh in source_meshes.values() if mesh.get('skinned')):raise ValueError('Every source skinned mesh must bind exactly one independently verified GLB skin node.')
    return {'verifiedSkinCount':len(verified),'skins':verified}
def validate_glb_bone_attachments(source,path,animation):
    """Prove static bone-parented mesh transforms and their inherited clip motion."""
    attachments=source.get('boneAttachments',[])
    if not attachments:return {'verifiedAttachmentCount':0,'attachments':[]}
    raw=open(path,'rb').read();pos=12;document=None
    while pos<len(raw):
        size,kind=struct.unpack_from('<II',raw,pos);pos+=8;chunk=raw[pos:pos+size];pos+=size
        if kind==0x4E4F534A:document=json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
    if document is None:raise ValueError('Bone-parented static mesh proof requires the actual GLB JSON hierarchy.')
    nodes=document.get('nodes',[]);parents={}
    for index,node in enumerate(nodes):
        for child in node.get('children',[]):
            if child in parents:raise ValueError('GLB static attachment hierarchy has a multiple-parent ambiguity.')
            parents[child]=index
    local=[]
    for node in nodes:
        if 'matrix' in node:
            values=node['matrix'];local.append(Matrix([[values[c*4+r] for c in range(4)] for r in range(4)]))
        else:
            t=node.get('translation',(0,0,0));q=node.get('rotation',(0,0,0,1));s=node.get('scale',(1,1,1))
            local.append(Matrix.Translation(Vector(t))@Quaternion((q[3],q[0],q[1],q[2])).to_matrix().to_4x4()@Matrix.Diagonal((s[0],s[1],s[2],1)))
    world={}
    def world_matrix(index,visiting=None):
        if index not in world:
            visiting=visiting or set()
            if index in visiting:raise ValueError('GLB static attachment hierarchy contains a cycle.')
            visiting.add(index);world[index]=(world_matrix(parents[index],visiting) if index in parents else Matrix.Identity(4))@local[index];visiting.remove(index)
        return world[index]
    for index in range(len(nodes)):world_matrix(index)
    basis=Matrix(((1,0,0,0),(0,0,1,0),(0,-1,0,0),(0,0,0,1)))
    def delta(a,b):return max(abs(float(a[r][c])-float(b[r][c])) for r in range(4) for c in range(4))
    verified=[]
    for attachment in attachments:
        mesh_name=attachment['mesh'];armature=attachment['armature'];bone=attachment['bone']
        mesh_nodes=[i for i,node in enumerate(nodes) if 'mesh' in node and node.get('name')==mesh_name]
        if len(mesh_nodes)!=1:raise ValueError('Bone-parented source mesh does not have one exact named GLB node: '+mesh_name)
        node_index=mesh_nodes[0];parent_index=parents.get(node_index)
        if parent_index is None or nodes[parent_index].get('name')!=bone:raise ValueError('GLB static mesh is detached from its source parent bone: '+mesh_name+'/'+bone)
        rig_nodes=[i for i,node in enumerate(nodes) if node.get('name')==armature and 'mesh' not in node]
        if len(rig_nodes)!=1:raise ValueError('Bone-parented source mesh has no unique GLB armature node: '+mesh_name+'/'+armature)
        rig_index=rig_nodes[0];ancestor=parent_index;ancestry=[]
        while ancestor is not None:
            ancestry.append(ancestor)
            if ancestor==rig_index:break
            ancestor=parents.get(ancestor)
        if not ancestry or ancestry[-1]!=rig_index:raise ValueError('GLB static attachment bone is outside its source armature node hierarchy: '+mesh_name+'/'+bone)
        skins=[skin for skin in document.get('skins',[]) if skin.get('name')==armature or any(nodes[j].get('name')==bone for j in skin.get('joints',[]) if 0<=j<len(nodes)) and rig_index in [parents.get(j) for j in skin.get('joints',[]) if 0<=j<len(nodes)]]
        if not skins or not any(parent_index in skin.get('joints',[]) for skin in skins):raise ValueError('GLB static attachment parent is not a joint in the bound source armature skin: '+mesh_name+'/'+bone)
        # A GLB has a serialized default node pose plus animation clips. A
        # bone-parented rigid attachment's default node matrix is the exact
        # authored export-start action/frame, while its rest matrix is kept
        # separately for editable-source and rig-binding proof.
        source_world=Matrix(attachment['exportInitialObjectWorld']);expected_world=basis@source_world@basis.inverted();world_delta=delta(world[node_index],expected_world)
        if world_delta>0.00002:raise ValueError('GLB static attachment node world transform differs from its complete source bone-parented object transform in the declared axis basis: '+mesh_name+'/'+bone+' delta='+repr(world_delta))
        clip_rows=[row for row in animation.get('clipTransforms',[]) if row.get('object')==armature]
        required_rows=[row for row in source.get('sampledAnimations',[]) if row.get('object')==armature and row.get('frames')]
        if len(clip_rows)!=len(required_rows):raise ValueError('Bone-parented accessory does not have complete sampled source/candidate clip coverage: '+mesh_name)
        clip_evidence=[]
        for required in required_rows:
            row=next((item for item in clip_rows if item.get('action')==required['action'] and item.get('sourceSlot')==required.get('slot')),None)
            if row is None or bone not in row.get('boneNames',[]) or row.get('frames')!=required.get('frames') or len(row.get('frameDeltas',[]))!=len(required['frames']):raise ValueError('Bone-parented accessory clip does not prove its parent bone at every required frame: '+mesh_name+'/'+required['action']+'/'+bone)
            clip_evidence.append({'action':row['action'],'sourceSlot':row.get('sourceSlot'),'candidateSlot':row.get('candidateSlot'),'frames':list(row['frames']),'parentBone':bone,'parentBoneSampled':True})
        verified.append({'mesh':mesh_name,'armature':armature,'parentBone':bone,'sourceBindAction':attachment['action'],'sourceBindSlot':attachment.get('slot'),'sourceBindFrame':attachment['frame'],'exportInitialAction':attachment.get('exportInitialAction'),'exportInitialSlot':attachment.get('exportInitialSlot'),'exportInitialFrame':attachment.get('exportInitialFrame'),'sourceRestObjectWorld':attachment['objectWorld'],'sourceExportInitialObjectWorld':attachment['exportInitialObjectWorld'],'sourceParentInverse':attachment['parentInverse'],'sourceObjectBasis':attachment['objectBasis'],'sourceParentBoneWorld':attachment['parentBoneWorld'],'sourceBoneRelativeObject':attachment['boneRelativeObject'],'glbMeshNodeIndex':node_index,'glbParentJointNodeIndex':parent_index,'glbArmatureNodeIndex':rig_index,'glbLocalMatrix':[[float(v) for v in row] for row in local[node_index]],'glbNodeWorld':[[float(v) for v in row] for row in world[node_index]],'glbNodeWorldExpectedFromSource':[[float(v) for v in row] for row in expected_world],'maxAbsNodeWorldTransformDelta':world_delta,'clipCoverage':clip_evidence})
    return {'verifiedAttachmentCount':len(verified),'basis':'node-local GLTF Y-up matrix conjugated through explicit Blender Z-up basis; parent joint sampled from every required source clip','attachments':verified}
def evaluated_bind_normal_resolver(source):
    snapshots=source.get('evaluatedBindNormals',{});blobs={};offsets={};counts={}
    for name,row in snapshots.items():
        blobs[name]=zlib.decompress(base64.b64decode(row['normalsZlibBase64']));counts[name]=row['cornerCount']
    cursors={}
    for polygon in source['polygons']:
        name=polygon['mesh'];face=polygon['face'];offsets[(name,face)]=cursors.get(name,0);cursors[name]=offsets[(name,face)]+len(polygon['corners'])
    for name,count in counts.items():
        if len(blobs[name])!=count*12 or cursors.get(name,0)!=count:raise ValueError('Source evaluated bind-normal bytes do not cover the full skinned mesh loop set: '+name)
        row=snapshots[name]
        # Armature-rest is an explicit bind basis, not an animation clip. A
        # valid source may have no active action (including no T-pose action);
        # frame/action/slot are still serialized and compared when present.
        if row.get('worldSpace') is not True or row.get('frame') is None or row.get('basis')!='armature-rest':raise ValueError('Source evaluated bind-normal snapshot is missing its world/frame/rest-basis correspondence: '+name)
    def resolve(polygon,corner_index,fallback):
        key=(polygon['mesh'],polygon['face']);name=key[0]
        if name not in blobs:return fallback
        offset=(offsets[key]+corner_index)*12
        return struct.unpack_from('<3f',blobs[name],offset)
    return resolve
def parse_glb_material_channels(path,root):
    raw=open(path,'rb').read();pos=12;document=None;binary=None
    while pos<len(raw):
        size,kind=struct.unpack_from('<II',raw,pos);pos+=8;chunk=raw[pos:pos+size];pos+=size
        if kind==0x4E4F534A:document=json.loads(chunk.decode('utf-8').rstrip(' \t\r\n\0'))
        elif kind==0x004E4942:binary=chunk
    if document is None or binary is None:raise ValueError('Final GLB material verification requires actual JSON and BIN chunks.')
    decoded={}
    def image_fingerprint(index,colorspace,component=None):
        key=(index,colorspace,component)
        if key in decoded:return decoded[key]
        images=document.get('images',[]);textures=document.get('textures',[])
        if index<0 or index>=len(images):raise ValueError('GLB material references an absent texture.')
        image=images[index]
        if 'bufferView' in image:
            view=document['bufferViews'][image['bufferView']];data=binary[view.get('byteOffset',0):view.get('byteOffset',0)+view['byteLength']]
        elif str(image.get('uri','')).startswith('data:'):
            data=base64.b64decode(image['uri'].split(',',1)[1])
        else:raise ValueError('Final GLB image uses an unsupported external URI.')
        extension={"image/png":".png","image/jpeg":".jpg","image/webp":".webp"}.get(image.get('mimeType'))
        if not extension:raise ValueError('Final GLB image has an unsupported MIME type.')
        temp=os.path.join(root,'glb-image-'+str(index)+'-'+str(len(decoded))+extension)
        with open(temp,'wb') as f:f.write(data)
        try:
            clear_image_fingerprint_cache();loaded=bpy.data.images.load(temp,check_existing=False);loaded.colorspace_settings.name=colorspace
            value=image_component_fingerprint(loaded,component,colorspace) if component else image_pixel_fingerprint(loaded,colorspace)
            bpy.data.images.remove(loaded);decoded[key]=value
        finally:
            try:os.remove(temp)
            except OSError:pass
        return decoded[key]
    textures=document.get('textures',[]);result={}
    for material in document.get('materials',[]):
        pbr=material.get('pbrMetallicRoughness',{});base_texture=pbr.get('baseColorTexture');mr_texture=pbr.get('metallicRoughnessTexture');normal_texture=material.get('normalTexture')
        channels={}
        if base_texture:
            texture=textures[base_texture['index']];channels['albedo']={'kind':'image','pixels':image_fingerprint(texture['source'],'sRGB'),'source':'FILE'}
        else:channels['albedo']={'kind':'constant','value':[round(float(x),8) for x in pbr.get('baseColorFactor',[1,1,1,1])]}
        if mr_texture:
            texture=textures[mr_texture['index']];source=texture['source']
            channels['roughness']={'kind':'image-component','pixels':image_fingerprint(source,'Non-Color','Green'),'source':'FILE'}
            channels['metallic']={'kind':'image-component','pixels':image_fingerprint(source,'Non-Color','Blue'),'source':'FILE'}
        else:
            channels['roughness']={'kind':'constant','value':round(float(pbr.get('roughnessFactor',1.0)),8)}
            channels['metallic']={'kind':'constant','value':round(float(pbr.get('metallicFactor',1.0)),8)}
        if normal_texture:
            texture=textures[normal_texture['index']];channels['normal']={'kind':'image','pixels':image_fingerprint(texture['source'],'Non-Color'),'source':'FILE'}
        else:channels['normal']={'kind':'unbound'}
        result[material.get('name','')]={'channels':channels,'textureCoordinates':{key:int(info.get('texCoord',0)) for key,info in [('albedo',base_texture),('roughness',mr_texture),('metallic',mr_texture),('normal',normal_texture)] if info},'factors':{'albedo':pbr.get('baseColorFactor',[1,1,1,1]),'roughness':pbr.get('roughnessFactor',1.0),'metallic':pbr.get('metallicFactor',1.0),'normalScale':normal_texture.get('scale',1.0) if normal_texture else None}}
    return result
def validate_gltf_material_channels(source,glb_materials,oriented_triangles=None,export_triangles=None):
    """Compare used source material semantics against the format's packed channels."""
    used_by_mesh={}
    for polygon in source.get('polygons',[]):
        if polygon.get('material'):
            used_by_mesh.setdefault(polygon['mesh'],set()).add(polygon['material'])
    source_materials={}
    mesh_rows={}
    for mesh_name,mesh in source.get('meshes',{}).items():
        mesh_rows[mesh_name]=mesh
        for material in mesh.get('materialData',[]):
            if material and material.get('name') in used_by_mesh.get(mesh_name,set()):
                name=material['name'];prior=source_materials.get(name)
                if prior and prior!=material:raise ValueError('One used source material has conflicting per-mesh semantic fingerprints: '+name)
                source_materials[name]=material
    if set(source_materials)!=set(glb_materials):
        raise ValueError('Used source material names differ from the actual GLB face assignments: '+repr({'source':sorted(source_materials),'glb':sorted(glb_materials)}))
    if oriented_triangles is not None and export_triangles is not None:
        face_material={(x['mesh'],x['face']):x.get('material') for x in source.get('polygons',[])};source_counts={};exported_counts={}
        for tri in oriented_triangles:
            key=(tri['mesh'],tri['face'])
            if key not in face_material:raise ValueError('Source oriented triangle has no polygon/material binding: '+repr(key))
            name=face_material[key];source_counts[name]=source_counts.get(name,0)+1
        for tri in export_triangles:
            name=tri.get('material');exported_counts[name]=exported_counts.get(name,0)+1
        if source_counts!=exported_counts:raise ValueError('GLB material assignment triangle coverage differs from the source face assignments: '+repr({'source':source_counts,'glb':exported_counts}))
    summary=[];limitations=[]
    for name,material in sorted(source_materials.items()):
        channels=material.get('pbrChannels');semantics=material.get('pbrSemantics');actual=glb_materials[name]
        if not isinstance(channels,dict) or set(channels)!= {'albedo','roughness','metallic','normal'} or semantics is None:
            raise ValueError('Used source material has unsupported or incomplete connected PBR semantics: '+name)
        if not semantics.get('directPrincipledSurface'):
            limitations.append({'material':name,'reason':'active composite surface graph is outside standard glTF metallic-roughness PBR','sourceGraph':{'nodes':material.get('nodes',[]),'links':material.get('links',[]),'semantics':semantics},'glbChannels':actual['channels'],'glbFactors':actual['factors'],'glbTextureCoordinates':actual['textureCoordinates']})
            summary.append({'material':name,'channels':sorted(channels),'uvIndices':{},'normalSpace':semantics.get('normalSpace'),'normalStrength':semantics.get('normalStrength'),'equivalent':False})
            continue
        if channels!=actual['channels']:
            raise ValueError('GLB packed material channel pixels/colorspace differ from the used source semantics: '+repr({'material':name,'source':channels,'glb':actual['channels']}))
        expected_factors={}
        for channel in ('albedo','roughness','metallic'):
            row=channels[channel]
            expected_factors[channel]=row.get('value') if row.get('kind')=='constant' else ([1.0,1.0,1.0,1.0] if channel=='albedo' else 1.0)
        normal=channels['normal'];normal_strength=semantics.get('normalStrength') if normal.get('kind')=='image' else None
        expected_factors['normalScale']=normal_strength
        for channel,expected in expected_factors.items():
            observed=actual['factors'].get(channel)
            if expected is None:
                if observed is not None:raise ValueError('GLB material adds a channel factor absent from the source: '+name+'/'+channel)
                continue
            left=[float(x) for x in expected] if isinstance(expected,(list,tuple)) else [float(expected)]
            right=[float(x) for x in observed] if isinstance(observed,(list,tuple)) else [float(observed)] if observed is not None else []
            if len(left)!=len(right) or not close_row(left,right,1e-5):raise ValueError('GLB PBR factor differs from its source node socket: '+name+'/'+channel)
        if normal.get('kind')=='image' and semantics.get('normalSpace')!='TANGENT':
            raise ValueError('GLB tangent-space normal texture cannot preserve a non-tangent source Normal Map: '+name)
        expected_uv={}
        for channel,row in channels.items():
            if row.get('kind') not in ('image','image-component'):continue
            maps=semantics['textureUvMaps'];source_uv=maps.get(channel)
            for mesh_name,assigned in used_by_mesh.items():
                if name not in assigned:continue
                mesh=mesh_rows[mesh_name];uv_layers=mesh.get('uvLayers',[])
                if source_uv=='__unsupported__':raise ValueError('Used source PBR texture route cannot be represented by a glTF TEXCOORD set: '+repr({'material':name,'mesh':mesh_name,'channel':channel}))
                if source_uv is None:source_uv=mesh.get('activeUvLayer')
                if source_uv not in uv_layers:raise ValueError('Used source PBR texture route does not resolve to a real mesh UV set: '+repr({'material':name,'mesh':mesh_name,'channel':channel,'uvMap':source_uv}))
                expected_uv.setdefault(channel,set()).add(uv_layers.index(source_uv))
        for channel,indices in expected_uv.items():
            if len(indices)!=1 or actual['textureCoordinates'].get(channel)!=next(iter(indices)):
                raise ValueError('GLB texture-coordinate index differs from the used source material UV route: '+repr({'material':name,'channel':channel,'sourceIndices':sorted(indices),'glb':actual['textureCoordinates'].get(channel)}))
        if set(actual['textureCoordinates'])!=set(expected_uv):raise ValueError('GLB material references an unexpected or omitted PBR texture coordinate: '+name)
        summary.append({'material':name,'channels':sorted(channels),'uvIndices':{k:sorted(v) for k,v in expected_uv.items()},'normalSpace':semantics.get('normalSpace'),'normalStrength':normal_strength,'equivalent':True})
    return {'usedMaterialCount':len(summary),'materials':summary,'materialLimitations':limitations,'allUsedMaterialsEquivalent':not limitations}
def mesh_fingerprint(obj,full=True,used_materials_only=False):
    m=obj.data
    v=b''.join(struct.pack('<3d',*x.co) for x in m.vertices)
    edges=b''.join(struct.pack('<2I',*e.vertices) for e in m.edges)
    faces=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.vertices)
    corners=b''.join(struct.pack('<I',i) for p in m.polygons for i in p.loop_indices)
    uv=b''.join(struct.pack('<2d',*x.uv) for layer in m.uv_layers for x in layer.data)
    normals=b''.join(struct.pack('<3d',*x.vector) for x in m.corner_normals)
    used_slots=sorted({int(p.material_index) for p in m.polygons}) if used_materials_only else list(range(len(m.materials)))
    materials=json.dumps({'slots':[[i,material_signature(m.materials[i]) if full and i<len(m.materials) else m.materials[i].name if i<len(m.materials) and m.materials[i] else None] for i in used_slots],'polygons':[p.material_index for p in m.polygons]},sort_keys=True,separators=(',',':')).encode()
    return {'vertices':len(m.vertices),'edges':len(m.edges),'polygons':len(m.polygons),'loops':len(m.loops),
        'geometry':digest(v+edges+faces+corners),'uv':digest(uv),'normals':digest(normals),'materials':digest(materials),
        'uvLayers':[x.name for x in m.uv_layers],'activeUvLayer':(m.uv_layers.active_render or m.uv_layers.active).name if (m.uv_layers.active_render or m.uv_layers.active) else None,'materialNames':[m.materials[i].name if i<len(m.materials) and m.materials[i] else None for i in used_slots],
        'materialSlots':used_slots,'materialData':[material_signature(m.materials[i]) if i<len(m.materials) else None for i in used_slots] if full else [],
        'faceVertexCounts':[len(p.vertices) for p in m.polygons]}
def weight_snapshot(obj,keep_rows=True):
    groups=[g.name for g in obj.vertex_groups]; output=[] if keep_rows else None; max_influences=0; invalid=0; normalized=0; zero=0; digest_state=hashlib.sha256()
    if keep_rows:digest_state.update(b'[')
    for v in obj.data.vertices:
        row=sorted((groups[x.group],float(x.weight)) for x in v.groups if x.weight>0.0)
        total=sum(w for _,w in row); max_influences=max(max_influences,len(row))
        if not row: zero+=1
        elif abs(total-1)<=.001: normalized+=1
        else: invalid+=1
        # Match the legacy JSON-list digest without retaining all per-vertex
        # Python tuples. This digest version is declared in every validator result.
        if keep_rows:
            if v.index:digest_state.update(b',')
            digest_state.update(json.dumps(row,separators=(',',':')).encode())
            output.append(row)
        else:
            if v.index:digest_state.update(b',')
            digest_state.update(json.dumps(row,separators=(',',':')).encode())
    if keep_rows:digest_state.update(b']')
    return output,max_influences,invalid,normalized,zero,digest_state.hexdigest()
def activate_bind_pose(scene_objects,animation_frame_map,samples):
    scene=bpy.context.scene;bindings=[];rest_arms=[]
    for arm in [obj for obj in scene_objects if obj.type=='ARMATURE']:
        # Final-source GLB accessors and the imported hierarchy's default
        # node state both represent bind/rest geometry. A fixture T-pose action
        # is sampled independently as motion; evaluating it here would mix
        # posed bone-parented attachments with raw exporter-basis skin vertices.
        if arm.animation_data:
            arm.animation_data.action=None
            arm.animation_data.use_nla=False
            for track in arm.animation_data.nla_tracks:track.mute=True
        rest_arms.append(arm)
        bindings.append({'object':arm.name,'action':None,'sourceSlot':None,'slot':None,'frame':int(scene.frame_start),'basis':'armature-rest'})
    if bindings:scene.frame_set(scene.frame_start);bpy.context.view_layer.update()
    return bindings
def export_initial_bone_attachment_snapshot(scene_objects):
    """Capture authored rigid bone attachments at the actual export-start state."""
    scene=bpy.context.scene;old_frame=scene.frame_current;old_sub=scene.frame_subframe;result={}
    try:
        scene.frame_set(scene.frame_start);bpy.context.view_layer.update()
        for obj in scene_objects:
            if obj.type!='MESH' or obj.parent_type!='BONE' or not obj.parent:continue
            arm=obj.parent;ad=arm.animation_data
            result[obj.name]={'objectWorld':[[float(v) for v in row] for row in obj.matrix_world],
                'frame':int(scene.frame_current),'action':ad.action.name if ad and ad.action else None,
                'slot':getattr(ad.action_slot,'identifier',None) if ad and ad.action_slot else None}
    finally:
        scene.frame_set(old_frame,subframe=old_sub);bpy.context.view_layer.update()
    return result
def bone_attachment_snapshot(scene_objects,bind_context,export_initial):
    bindings={row['object']:row for row in bind_context};result=[]
    for obj in scene_objects:
        if obj.type!='MESH' or obj.parent_type!='BONE' or not obj.parent:continue
        arm=obj.parent;bone=arm.pose.bones.get(obj.parent_bone)
        if arm.type!='ARMATURE' or bone is None:raise ValueError('Bone-parented static mesh has no resolvable armature pose bone: '+obj.name)
        context=bindings.get(arm.name)
        if context is None:raise ValueError('Bone-parented static mesh has no derived rest/bind context: '+obj.name)
        parent_world=arm.matrix_world@bone.matrix;relative=parent_world.inverted_safe()@obj.matrix_world
        initial=export_initial.get(obj.name)
        if initial is None:raise ValueError('Bone-parented static mesh is missing its authored export-start transform: '+obj.name)
        result.append({'mesh':obj.name,'armature':arm.name,'bone':obj.parent_bone,'frame':context['frame'],'action':context['action'],'slot':context.get('slot'),'basis':context.get('basis'),'parentInverse':[[float(v) for v in row] for row in obj.matrix_parent_inverse],'objectBasis':[[float(v) for v in row] for row in obj.matrix_basis],'parentBoneWorld':[[float(v) for v in row] for row in parent_world],'objectWorld':[[float(v) for v in row] for row in obj.matrix_world],'boneRelativeObject':[[float(v) for v in row] for row in relative],'exportInitialObjectWorld':initial['objectWorld'],'exportInitialFrame':initial['frame'],'exportInitialAction':initial['action'],'exportInitialSlot':initial['slot']})
    return result
def evaluated_bind_normal_snapshot(scene_objects,samples):
    scene=bpy.context.scene;frame=scene.frame_current;bindings=[];rest_basis=[]
    for arm in [obj for obj in scene_objects if obj.type=='ARMATURE']:
        ad=arm.animation_data
        bindings.append((arm,ad.action if ad else None,getattr(ad,'action_slot',None) if ad else None,ad.use_nla if ad else None,[track.mute for track in ad.nla_tracks] if ad else []))
    try:
        for arm,old_action,old_slot,old_nla,old_mutes in bindings:
            if arm.animation_data:
                arm.animation_data.action=None
                if hasattr(arm.animation_data,'action_slot'):
                    try:arm.animation_data.action_slot=None
                    except (TypeError,RuntimeError):pass
                arm.animation_data.use_nla=False
                for track in arm.animation_data.nla_tracks:track.mute=True
            rest_basis.append(arm.name)
        # The raw GLB NORMAL accessor is compared in the authored armature-rest
        # export basis. T-pose and other actions are sampled independently as
        # motion; evaluating one here would mix unlike pose states.
        scene.frame_set(scene.frame_start)
        depsgraph=bpy.context.evaluated_depsgraph_get();result={}
        for obj in scene_objects:
            if obj.type!='MESH' or not any(mod.type=='ARMATURE' for mod in obj.modifiers):continue
            evaluated=obj.evaluated_get(depsgraph);mesh=evaluated.to_mesh(preserve_all_data_layers=True,depsgraph=depsgraph)
            try:
                if len(mesh.polygons)!=len(obj.data.polygons) or len(mesh.loops)!=len(obj.data.loops):raise ValueError('Evaluated bind-normal snapshot changed mesh loop topology: '+obj.name)
                values=[]
                for loop in mesh.loops:
                    normal=(evaluated.matrix_world.to_3x3().inverted().transposed()@mesh.corner_normals[loop.index].vector).normalized()
                    values.extend(float(value) for value in normal)
                packed=struct.pack('<'+str(len(values))+'f',*values)
                arm=next((mod.object for mod in obj.modifiers if mod.type=='ARMATURE' and mod.object),None)
                action=arm.animation_data.action if arm and arm.animation_data else None
                result[obj.name]={'frame':int(scene.frame_current),'action':action.name if action else None,'slot':getattr(getattr(arm.animation_data,'action_slot',None),'identifier',None) if arm and arm.animation_data else None,'basis':'armature-rest','cornerCount':len(mesh.loops),'worldSpace':True,'normalFormat':'little-endian float32 XYZ by polygon loop order','normalsZlibBase64':base64.b64encode(zlib.compress(packed,3)).decode('ascii')}
            finally:evaluated.to_mesh_clear()
    finally:
        scene.frame_set(frame)
        for arm,action,slot,use_nla,mutes in bindings:
            if not arm.animation_data:continue
            arm.animation_data.action=action
            if action and slot and hasattr(arm.animation_data,'action_slot'):arm.animation_data.action_slot=slot
            arm.animation_data.use_nla=use_nla
            for track,mute in zip(arm.animation_data.nla_tracks,mutes):track.mute=mute
        bpy.context.view_layer.update()
    return result
@read_only_image_capture
def scene_snapshot(path,include_samples=False,quick=False,representation='full',animation_frame_map=None,animation_time_mapping='scene-relative'):
    started=time.perf_counter()
    want_face_records=representation in ('full','assembly','returned-rig')
    want_polygons=representation in ('full','assembly','final-source','returned-rig')
    want_triangles=representation in ('full','final-fbx-output','final-glb-output')
    want_oriented_triangles=representation=='final-source'
    keep_weight_rows=representation in ('full','assembly','weights','returned-rig')
    phase=time.perf_counter();allowed_mesh_nodes=declared_gltf_mesh_nodes(path);clear_scene();progress(36,'Loading '+pathlib.Path(path).name+' for '+representation+' preservation');load(path);load_seconds=time.perf_counter()-phase;progress(37,'Loaded '+pathlib.Path(path).name+' in '+str(round(load_seconds,1))+' seconds; fingerprinting preservation data')
    meshes={}; armatures=[]; triangles=[]; polygons=[]; oriented_triangles=[]; scene_objects=list(bpy.context.scene.objects)
    samples=sampled_animation_state(animation_frame_map,animation_time_mapping) if include_samples else []
    export_initial_attachments=export_initial_bone_attachment_snapshot(scene_objects) if representation=='final-source' and include_samples else {}
    evaluated_bind_context=activate_bind_pose(scene_objects,animation_frame_map,samples) if representation in ('final-source','final-glb-output') and include_samples else []
    evaluated_bind_normals=evaluated_bind_normal_snapshot(scene_objects,samples) if representation=='final-source' and include_samples else {}
    bone_attachments=bone_attachment_snapshot(scene_objects,evaluated_bind_context,export_initial_attachments) if representation=='final-source' and include_samples else []
    mesh_objects=[obj for obj in scene_objects if obj.type=='MESH']
    export_attachment_matrices={row['mesh']:Matrix(row['exportInitialObjectWorld']) for row in bone_attachments}
    before_releases=_IMAGE_BUFFER_RELEASES
    if not quick:fingerprint_materials_and_release_images(scene_objects)
    for object_index,obj in enumerate(scene_objects):
        if object_index%8==0:enforce_blender_memory_budget('scene preservation snapshot')
        if obj.type=='MESH':
            if allowed_mesh_nodes is not None and obj.name not in allowed_mesh_nodes and obj.data.name not in allowed_mesh_nodes:continue
            facts=mesh_fingerprint(obj,not quick,representation in ('final-source','final-glb-output')); weights,mx,bad,norm,zero,weight_hash=weight_snapshot(obj,keep_weight_rows)
            facts.update({'name':obj.name,'meshName':obj.data.name,'objectMatrix':[round(float(v),9) for row in obj.matrix_world for v in row],
                'skinned':any(mod.type=='ARMATURE' for mod in obj.modifiers),
                'armatureObjects':[mod.object.name for mod in obj.modifiers if mod.type=='ARMATURE' and mod.object],
                'weightFingerprintVersion':WEIGHT_FINGERPRINT_VERSION,
                'weightFingerprint':weight_hash,'weights':weights,
                'maxInfluences':mx,'invalidWeightVertices':bad,'normalizedWeightVertices':norm,'zeroWeightVertices':zero,
                'groupNames':[g.name for g in obj.vertex_groups],
                'faceLineage':[[int(obj.data.attributes['atelier_source_ordinal'].data[p.index].value),int(obj.data.attributes['atelier_source_face'].data[p.index].value)] for p in obj.data.polygons] if not quick and obj.data.attributes.get('atelier_source_ordinal') and obj.data.attributes.get('atelier_source_face') else None,
                'pointLineage':[[int(obj.data.attributes['atelier_source_point_ordinal'].data[v.index].value),int(obj.data.attributes['atelier_source_vertex'].data[v.index].value)] for v in obj.data.vertices] if obj.data.attributes.get('atelier_source_point_ordinal') and obj.data.attributes.get('atelier_source_vertex') else None,
                'faceRecords':[] if not want_face_records else [{'vertices':[[round(float(c),7) for c in (obj.matrix_world@obj.data.vertices[obj.data.loops[li].vertex_index].co)] for li in p.loop_indices],'normals':[[round(float(c),4) for c in ((obj.matrix_world.to_3x3().inverted().transposed()@obj.data.corner_normals[li].vector).normalized())] for li in p.loop_indices],'uv':{layer.name:[[round(float(c),7) for c in layer.data[li].uv] for li in p.loop_indices] for layer in obj.data.uv_layers},'material':obj.data.materials[p.material_index].name if p.material_index<len(obj.data.materials) and obj.data.materials[p.material_index] else None} for p in obj.data.polygons]})
            groups=[g.name for g in obj.vertex_groups]
            triangle_object=obj;triangle_mesh=obj.data;triangle_matrix=export_attachment_matrices.get(obj.name,obj.matrix_world);evaluated_object=None
            if want_triangles and representation=='final-glb-output' and any(mod.type=='ARMATURE' for mod in obj.modifiers):
                depsgraph=bpy.context.evaluated_depsgraph_get();evaluated_object=obj.evaluated_get(depsgraph);triangle_mesh=evaluated_object.to_mesh(preserve_all_data_layers=True,depsgraph=depsgraph);triangle_matrix=evaluated_object.matrix_world
                if len(triangle_mesh.polygons)!=len(obj.data.polygons) or len(triangle_mesh.loops)!=len(obj.data.loops):evaluated_object.to_mesh_clear();raise ValueError('Evaluated GLB skin changed source triangle loop topology: '+obj.name)
            if want_triangles: triangle_mesh.calc_loop_triangles()
            if want_oriented_triangles:obj.data.calc_loop_triangles()
            if want_oriented_triangles:
                for tri in obj.data.loop_triangles:
                    polygon=obj.data.polygons[tri.polygon_index]
                    oriented_triangles.append({'mesh':obj.name,'face':polygon.index,'corners':[int(loop_index-polygon.loop_start) for loop_index in tri.loops]})
            for tri in (triangle_mesh.loop_triangles if want_triangles else []):
                poly=triangle_mesh.polygons[tri.polygon_index]; material=obj.data.materials[poly.material_index].name if poly.material_index<len(obj.data.materials) and obj.data.materials[poly.material_index] else None; corners=[]
                for li in tri.loops:
                    vi=triangle_mesh.loops[li].vertex_index
                    vertex=obj.data.vertices[vi]; weights=sorted((groups[g.group],float(g.weight)) for g in vertex.groups if g.weight>0.0)
                    pos=triangle_matrix@triangle_mesh.vertices[vi].co; normal=(triangle_matrix.to_3x3().inverted().transposed()@triangle_mesh.corner_normals[li].vector).normalized()
                    corners.append({'position':[round(float(x),7) for x in pos],'normal':[round(float(x),6) for x in normal],'uv':{layer.name:[round(float(x),7) for x in triangle_mesh.uv_layers[layer.name].data[li].uv] for layer in obj.data.uv_layers},'weights':weights})
                triangles.append({'mesh':obj.name,'material':material,'corners':corners})
            if evaluated_object is not None:evaluated_object.to_mesh_clear()
            for poly in (obj.data.polygons if want_polygons else []):
                material=obj.data.materials[poly.material_index].name if poly.material_index<len(obj.data.materials) and obj.data.materials[poly.material_index] else None; corners=[]
                for li in poly.loop_indices:
                    vi=obj.data.loops[li].vertex_index
                    vertex=obj.data.vertices[vi]; pos=obj.matrix_world@vertex.co; normal=(obj.matrix_world.to_3x3().inverted().transposed()@obj.data.corner_normals[li].vector).normalized()
                    corners.append({'position':[round(float(x),7) for x in pos],'normal':[round(float(x),6) for x in normal],'uv':{layer.name:[round(float(x),7) for x in layer.data[li].uv] for layer in obj.data.uv_layers},'weights':sorted((groups[g.group],float(g.weight)) for g in vertex.groups if g.weight>0.0)})
                polygons.append({'mesh':obj.name,'face':poly.index,'material':material,'corners':corners})
            meshes[obj.name]=facts
        elif obj.type=='ARMATURE':
            armatures.append({'name':obj.name,'bones':[{'name':b.name,'parent':b.parent.name if b.parent else None,
                'matrix':[round(float(v),9) for row in b.matrix_local for v in row]} for b in obj.data.bones]})
        if object_index%max(1,len(scene_objects)//3)==0:progress(38+min(3,int(4*(object_index+1)/max(1,len(scene_objects)))),'Fingerprinting object '+str(object_index+1)+' of '+str(len(scene_objects))+'; '+str(len(meshes))+' meshes, '+str(len(polygons))+' detailed polygons')
    progress(42,'Fingerprinting rig, materials and scene motion for '+pathlib.Path(path).name)
    phase=time.perf_counter();preservation=animation_fingerprint();animation_seconds=time.perf_counter()-phase;armatures=preservation['payload']['armatures'];actions=preservation['payload']['actions']
    progress(49,'Finished '+representation+' scene snapshot in '+str(round(time.perf_counter()-started,1))+' seconds')
    hierarchy={obj.name:{'type':obj.type,'parent':obj.parent.name if obj.parent else None,
        'local':[round(float(x),9) for row in obj.matrix_basis for x in row],
        'parentInverse':[round(float(x),9) for row in obj.matrix_parent_inverse for x in row],
        'animated':bool(obj.animation_data),
        'constraints':[(c.name,c.type,bool(c.mute),round(float(c.influence),8)) for c in obj.constraints],
        'drivers':[(d.data_path,d.array_index,d.driver.type,d.driver.expression) for d in obj.animation_data.drivers] if obj.animation_data else []}
        for obj in scene_objects} if representation=='returned-rig' else None
    return {'fingerprintVersion':IMAGE_FINGERPRINT_VERSION,'weightFingerprintVersion':WEIGHT_FINGERPRINT_VERSION,'rigObjectState':hierarchy,'profiling':{'loadSeconds':round(load_seconds,3),'animationFingerprintSeconds':round(animation_seconds,3),'imageHashSeconds':round(float(_IMAGE_FINGERPRINT_STATS['seconds']),3),'imageHashPasses':int(_IMAGE_FINGERPRINT_STATS['hashPasses']),'uniqueImagesHashed':int(_IMAGE_FINGERPRINT_STATS['uniqueImages']),'imageCacheHits':int(_IMAGE_FINGERPRINT_STATS['cacheHits']),'imagePixelsHashed':int(_IMAGE_FINGERPRINT_STATS['pixels']),'releasedImageBuffers':_IMAGE_BUFFER_RELEASES-before_releases,'snapshotSeconds':round(time.perf_counter()-started,3),'meshCount':len(meshes),'representation':representation},'meshes':meshes,'armatures':armatures,'boneCount':sum(len(a['bones']) for a in armatures),
        'restPoseFingerprint':digest(json.dumps(armatures,sort_keys=True,separators=(',',':')).encode()),'actions':actions,'animationFingerprint':preservation['fingerprint'],'animationState':preservation['payload'],'sampledAnimations':samples,'evaluatedBindNormals':evaluated_bind_normals,'evaluatedBindContext':evaluated_bind_context,'boneAttachments':bone_attachments,'triangles':triangles,'orientedTriangles':oriented_triangles,'polygons':polygons,'totalVertices':sum(m['vertices'] for m in meshes.values()),
        'maxInfluences':max([m['maxInfluences'] for m in meshes.values()] or [0]),
        'invalidWeightVertices':sum(m['invalidWeightVertices'] for m in meshes.values()),
        'normalizedWeightVertices':sum(m['normalizedWeightVertices'] for m in meshes.values()),
        'zeroWeightVertices':sum(m['zeroWeightVertices'] for m in meshes.values())}
def read_report(path,cfg):
    value=json.load(open(path,encoding='utf8'))
    if not isinstance(value,dict): raise ValueError('Candidate evidence must be a JSON object.')
    if value.get('schemaVersion')==1: return value
    # The app-owned source-preserving exporter emits its own schema-v2
    # provenance manifest. Guided final-export validation consumes that exact
    # manifest as evidence; accepting arbitrary v2 reports here would weaken
    # the existing schema-v1 candidate-report contract for every other check.
    expected=cfg.get('inputHashes',[cfg.get('inputHash')])
    valid_export=(cfg.get('mode')=='final-export' and value.get('schemaVersion')==2
        and value.get('operation')=='source-preserving-export'
        and value.get('autoexec')=='disabled-by-runner'
        and value.get('sourceUnmodified') is True and value.get('outputReopened') is True
        and value.get('sourceHash')==cfg.get('inputHash')
        and value.get('inputHashes')==expected and value.get('outputHash')==cfg.get('outputHash')
        and value.get('profile') in ('rigged-unity','editable-source','static-ancillary')
        and value.get('format') in ('blend','glb','fbx','obj')
        and isinstance(value.get('sourceObjects'),dict) and isinstance(value.get('reopenedOutput'),dict))
    if not valid_export: raise ValueError('Candidate evidence must be a schema-v1 report or the matching trusted schema-v2 source-preserving export manifest.')
    return value
def validate_segmentation(cfg, report, output):
    if report.get('inputHashes')!=cfg.get('inputHashes',[cfg['inputHash']]) or report.get('outputHash')!=cfg['outputHash']: raise ValueError('Segmentation report hashes do not match registered stage inputs.')
    actual_topology_fingerprint=digest(json.dumps(output['meshes'],sort_keys=True,separators=(',',':')).encode())
    if report.get('outputTopologyFingerprint')!=actual_topology_fingerprint: raise ValueError('Segmentation topology fingerprint does not describe the actual output bytes: '+repr({'reported':report.get('outputTopologyFingerprint'),'actual':actual_topology_fingerprint,'meshNames':sorted(output['meshes'])}))
    segments=report.get('segments')
    if not isinstance(segments,list) or not segments: raise ValueError('Segmentation requires named face partitions.')
    expected={name:set(range(mesh['polygons'])) for name,mesh in output['meshes'].items()}; seen={name:set() for name in expected}; names=set()
    for segment in segments:
        if not isinstance(segment,dict) or not segment.get('name') or segment['name'] in names: raise ValueError('Segmentation names must be unique and nonempty.')
        names.add(segment['name']); mesh=segment.get('meshName'); indices=segment.get('faceIndices')
        if mesh not in expected or not isinstance(indices,list) or not indices or any(type(i)is not int or i not in expected[mesh] for i in indices): raise ValueError('Segmentation face map references absent mesh faces.')
        if seen[mesh].intersection(indices): raise ValueError('Segmentation face partitions overlap.')
        seen[mesh].update(indices)
    if seen!=expected: raise ValueError('Segmentation face partitions must cover every output face exactly once.')
    return {'segments':len(segments),'faces':sum(len(x) for x in seen.values()),'topologyFingerprint':report['outputTopologyFingerprint']}
def validate_materials(cfg,report,output):
    if report.get('inputHashes')!=cfg.get('inputHashes',[cfg['inputHash']]) or report.get('outputHash')!=cfg['outputHash']: raise ValueError('PBR manifest hashes do not match registered stage inputs.')
    with zipfile.ZipFile(cfg['package']) as z:
        entries={}; total=0
        for info in z.infolist():
            name=info.filename.replace('\\','/')
            if name.startswith('/') or ':' in name or any(x in ('','..','.') for x in name.rstrip('/').split('/')) or info.file_size>64*1024*1024 or info.external_attr>>16 & 0o170000==0o120000: raise ValueError('PBR archive contains an unsafe path, link, or oversized entry.')
            if name.endswith('/'): continue
            if name in entries: raise ValueError('PBR archive contains duplicate logical paths.')
            total+=info.file_size
            if total>512*1024*1024: raise ValueError('PBR archive expands beyond the validation limit.')
            entries[name]=z.read(info)
    required=('albedo','normal','roughness','metallic'); bindings=report.get('bindings')
    if not isinstance(bindings,list) or not bindings: raise ValueError('PBR requires typed per-mesh/material channel bindings; channel images alone cannot pass.')
    snapshot_by_mesh={x.get('mesh'):x.get('fingerprint') for x in report.get('uvSnapshots',[]) if isinstance(x,dict)}
    actual_meshes={m['name']:m for m in output['meshes'].values()}; seen=set(); validated=[]
    for mesh_name,mesh in actual_meshes.items():
        if not mesh.get('uvLayers'): raise ValueError('PBR materialization requires a UV layer on every textured mesh: '+mesh_name)
        assigned=set()
        # Read authoritative polygon assignments from the candidate in the same scene.
        obj=bpy.data.objects.get(mesh_name)
        if obj is None: raise ValueError('PBR materialized mesh disappeared during validation.')
        assigned={obj.data.materials[p.material_index].name for p in obj.data.polygons if p.material_index<len(obj.data.materials) and obj.data.materials[p.material_index]}
        if not assigned: raise ValueError('PBR materialized mesh has no assigned material: '+mesh_name)
        if snapshot_by_mesh.get(mesh_name)!=mesh['uv']: raise ValueError('PBR UV snapshot does not match the actual candidate model: '+mesh_name)
        rows=[x for x in bindings if x.get('mesh')==mesh_name]
        if {x.get('material') for x in rows}!=assigned: raise ValueError('PBR bindings must cover each and only each material assigned to mesh '+mesh_name)
        for binding in rows:
            material_name=binding['material']; key=(mesh_name,material_name)
            if key in seen: raise ValueError('Duplicate PBR mesh/material binding.')
            seen.add(key); uv_layer=binding.get('uvLayer'); mat=next((x for x in mesh.get('materialData',[]) if x and x.get('name')==material_name),None)
            if not mat or uv_layer not in mesh['uvLayers'] or not mat.get('nodes'): raise ValueError('PBR binding lacks an actual node material or valid UV layer: '+repr(key))
            nodes={n['name']:n for n in mat['nodes']}; links=mat.get('links',[]); node_ids={n['name']:n['index'] for n in mat['nodes']}
            active_outputs=[n for n in mat['nodes'] if n['type']=='ShaderNodeOutputMaterial' and n.get('activeOutput')]
            active_surface=[link for link in links if active_outputs and link['toNode']==node_ids[active_outputs[0]['name']] and link['toIdentifier']=='Surface']
            principled=next((n for n in mat['nodes'] if n['type']=='ShaderNodeBsdfPrincipled' and active_surface and n['index']==active_surface[0]['fromNode'] and n['outputs'][active_surface[0]['fromSocket']]['identifier']=='BSDF'),None)
            if len(active_outputs)!=1 or principled is None: raise ValueError('Unsupported material representation: active Material Output Surface must be driven directly by the declared Principled BSDF.')
            channel_rows=binding.get('channels')
            if not isinstance(channel_rows,dict) or set(channel_rows)!=set(required): raise ValueError('PBR material binding must explicitly map albedo, normal, roughness and metallic channels.')
            for channel in required:
                row=channel_rows[channel]
                component=row.get('component')
                if not isinstance(row,dict) or row.get('logicalPath') not in entries or sha_file_bytes(entries[row['logicalPath']])!=row.get('sha256'): raise ValueError('PBR channel bytes are absent or fail their reported hash: '+channel)
                image_node=nodes.get(row.get('imageNode',''))
                if not image_node or image_node.get('type')!='ShaderNodeTexImage' or not image_node.get('image'): raise ValueError('PBR channel must bind an actual Image Texture node: '+repr(key)+'/'+channel)
                vector_index=next((i for i,socket in enumerate(image_node['inputs']) if socket['name']=='Vector'),None)
                vector_links=[link for link in links if link['toNode']==image_node['index'] and link['toSocket']==vector_index] if vector_index is not None else []
                active_uv=mesh.get('activeUvLayer')
                if len(vector_links)>1: raise ValueError('PBR texture has ambiguous UV routing: '+repr(key)+'/'+channel)
                if vector_links:
                    uv_node=next((node for node in mat['nodes'] if node['index']==vector_links[0]['fromNode']),None)
                    if not uv_node or uv_node['type']!='ShaderNodeUVMap' or uv_node['outputs'][vector_links[0]['fromSocket']]['identifier']!='UV': raise ValueError('PBR texture uses unsupported generated/object/procedural coordinates; explicit UV Map routing is required.')
                    routed_uv=uv_node['properties'].get('uv_map')
                else:
                    routed_uv=active_uv
                if not active_uv or uv_layer!=routed_uv or uv_layer!=active_uv: raise ValueError('PBR manifest UV layer does not match the actual image coordinate route and active render UV layer: '+repr({'mesh':mesh_name,'material':material_name,'channel':channel,'manifest':uv_layer,'routed':routed_uv,'activeRender':active_uv}))
                if not image_node['image'].get('packed'): raise ValueError('PBR texture is not packed into the managed model; register its dependency and repack before validation.')
                content=image_node['image'].get('content');actual_image=content;component_index={'Red':0,'Green':1,'Blue':2,'Alpha':3,'R':0,'G':1,'B':2,'A':3}.get(component);actual=({'size':content['size'],'colorspace':image_node['image']['colorspace'],'component':component,'pixels':content.get('components',{}).get(str(component_index)),'fingerprintVersion':IMAGE_FINGERPRINT_VERSION} if content and component else content)
                if not actual_image or image_node['image'].get('colorspace')!=row.get('colorspace'): raise ValueError('PBR colorspace does not match its typed manifest for '+channel)
                source_socket='Color'
                def linked(source_node,source_socket,target_node,target_socket):
                    si=next((i for i,s in enumerate(source_node['outputs']) if s['name']==source_socket or s['identifier']==source_socket),None);ti=next((i for i,s in enumerate(target_node['inputs']) if s['name']==target_socket or s['identifier']==target_socket),None)
                    if si is None or ti is None:return False
                    return any(l['fromNode']==source_node['index'] and l['fromSocket']==si and l['toNode']==target_node['index'] and l['toSocket']==ti for l in links)
                if channel in ('albedo','roughness','metallic') and component is None:
                    socket={'albedo':'Base Color','roughness':'Roughness','metallic':'Metallic'}[channel]
                    if not linked(image_node,source_socket,principled,socket): raise ValueError('PBR channel image is not connected to the declared Principled channel: '+channel)
                elif channel in ('roughness','metallic'):
                    socket={'roughness':'Roughness','metallic':'Metallic'}[channel]
                    split_nodes=[n for n in mat['nodes'] if n['type']=='ShaderNodeSeparateColor' and linked(image_node,'Color',n,'Color') and linked(n,component,principled,socket)]
                    if component not in ('Green','Blue') or not split_nodes: raise ValueError('Metallic-roughness channel must use a connected glTF-compatible Green/Blue channel from the packed image: '+channel)
                else:
                    normal_nodes=[n for n in mat['nodes'] if n['type']=='ShaderNodeNormalMap' and linked(image_node,source_socket,n,'Color') and linked(n,'Normal',principled,'Normal')]
                    if not normal_nodes: raise ValueError('Normal image must feed a Normal Map node connected to Principled Normal.')
                tmp=os.path.join(os.path.dirname(cfg['package']),'.pbr-channel-'+hashlib.sha256((mesh_name+material_name+channel).encode()).hexdigest()+pathlib.Path(row['logicalPath']).suffix)
                with open(tmp,'wb') as f:f.write(entries[row['logicalPath']])
                try:
                    expected_image=bpy.data.images.load(tmp,check_existing=False); expected_image.colorspace_settings.name=row['colorspace']
                    expected=image_component_fingerprint(expected_image,component,row['colorspace']) if component else image_pixel_fingerprint(expected_image,row['colorspace']); bpy.data.images.remove(expected_image)
                finally:
                    try:os.remove(tmp)
                    except OSError:pass
                if actual!=expected: raise ValueError('PBR package image pixels/dimensions do not match the actual connected model texture: '+channel)
            validated.append({'mesh':mesh_name,'material':material_name,'uvLayer':uv_layer,'channels':sorted(required)})
    if len(seen)!=len(bindings): raise ValueError('PBR manifest contains an unbound or foreign mesh/material row.')
    return {'bindings':validated,'boundMeshMaterials':len(validated),'uvMeshes':len(snapshot_by_mesh)}
def sha_file_bytes(data): return hashlib.sha256(data).hexdigest()
def joined_face_equal(before,after):
    if not before or not after or before.get('vertices')!=after.get('vertices') or before.get('uv')!=after.get('uv') or before.get('material')!=after.get('material') or len(before.get('normals',[]))!=len(after.get('normals',[])): return False
    return all(len(a)==len(b) and max((abs(x-y) for x,y in zip(a,b)),default=0)<=0.001 for a,b in zip(before['normals'],after['normals']))
def close_row(a,b,tolerance):
    return len(a)==len(b) and all(abs(float(x)-float(y))<=tolerance for x,y in zip(a,b))
def gltf_import_basis_polygons(polygons):
    """Express Blender source polygons in the Y-up basis returned by GLB import."""
    converted=[]
    for polygon in polygons:
        row=dict(polygon);corners=[]
        for corner in polygon['corners']:
            value=dict(corner);x,y,z=corner['position'];nx,ny,nz=corner['normal']
            value['position']=[x,-z,y];value['normal']=[nx,-nz,ny];corners.append(value)
        row['corners']=corners;converted.append(row)
    return converted
def gltf_accessor_blender_basis(triangles):
    """Convert node-world GLTF coordinates/normals back to Blender Z-up basis."""
    converted=[]
    for triangle in triangles:
        row=dict(triangle);corners=[]
        for corner in triangle['corners']:
            value=dict(corner);x,y,z=corner['position'];nx,ny,nz=corner['normal']
            # GLTF node-world coordinates are Y-up. Apply the inverse of the
            # exporter axis basis after its complete node hierarchy, matching
            # the source object's authored Blender-world basis.
            value['position']=[x,-z,y];value['normal']=[nx,-nz,ny];corners.append(value)
        row['corners']=corners;converted.append(row)
    return converted
def corner_equal(a,b,normal_tolerance=0.002,compare_normals=True):
    if not close_row(a['position'],b['position'],1e-5) or compare_normals and not close_row(a['normal'],b['normal'],normal_tolerance):return False
    if a['uv'].keys()!=b['uv'].keys() or any(not close_row(a['uv'][k],b['uv'][k],1e-5) for k in a['uv']):return False
    # Joint support is structural: every positive source influence must remain,
    # even when its value is smaller than the numeric comparison tolerance.
    wa={name:value for name,value in a['weights'] if float(value)>0.0};wb={name:value for name,value in b['weights'] if float(value)>0.0}
    source_total=sum(wa.values());target_total=sum(wb.values())
    if source_total>0 and target_total>0:wa={name:value/source_total for name,value in wa.items()};wb={name:value/target_total for name,value in wb.items()}
    return wa.keys()==wb.keys() and all(abs(wa[k]-wb[k])<=0.000002 for k in wa)
def triangle_correspondence(source_triangles,export_triangles,normal_tolerance=0.002,check_winding=True,compare_normals=True,normal_stats=None,source_normal_resolver=None,oriented_triangles=None,winding_stats=None,return_mapping=True):
    """Map reimported triangles to source polygons and prove each face is exactly triangulated."""
    if sum(len(p['corners'])-2 for p in source_triangles)!=len(export_triangles):raise ValueError('GLB reimport triangle count differs from joined candidate.')
    assigned=[[] for _ in source_triangles]; mapping=[]
    source_loop_triangles={}
    for ordinal,row in enumerate(oriented_triangles or []):source_loop_triangles.setdefault((row['mesh'],row['face']),[]).append((ordinal,tuple(row['corners'])))
    used_source_loop_triangles=set()
    # Build a bounded spatial incidence index. A triangle can only correspond to a
    # polygon containing all three of its corner positions; do not scan the full
    # source polygon set for every imported triangle.
    def position_key(corner):return tuple(round(float(x)/1e-5) for x in corner['position'])
    incidence={}
    for pi,poly in enumerate(source_triangles):
        for corner in poly['corners']:
            incidence.setdefault((poly['material'],position_key(corner)),set()).add(pi)
    def incident_polygons(corner,material):
        # Quantized bins accelerate lookup, but values within tolerance can land
        # on opposite sides of a bin boundary. Search adjacent bins, then retain
        # the strict corner_equal comparison below as the authoritative check.
        center=position_key(corner);found=set()
        for x in (-1,0,1):
            for y in (-1,0,1):
                for z in (-1,0,1):found.update(incidence.get((material,(center[0]+x,center[1]+y,center[2]+z)),()))
        return found
    for ti,triangle in enumerate(export_triangles):
        if ti and ti%25000==0:progress(min(89,70+int(19*ti/max(1,len(export_triangles)))),'Mapped '+str(ti)+' / '+str(len(export_triangles))+' actual exported triangles')
        matches=[]
        sets=[incident_polygons(c,triangle['material']) for c in triangle['corners']]
        candidates=set.intersection(*sets) if sets and all(sets) else set()
        for pi in candidates:
            poly=source_triangles[pi]
            if triangle['material']!=poly['material'] or len(poly['corners'])<3 or len(poly['corners'])-2<=len(assigned[pi]):continue
            corner_indices=[]
            for actual in triangle['corners']:
                matching_corner_ids=[i for i,expected in enumerate(poly['corners']) if corner_equal(expected,actual,normal_tolerance,compare_normals)]
                if len(matching_corner_ids)!=1:break
                corner_indices.append(matching_corner_ids[0])
            if len(corner_indices)==3 and len(set(corner_indices))==3:matches.append((pi,corner_indices))
        if not matches:
            position_candidates=[]
            for pi in sorted(candidates)[:5]:
                poly=source_triangles[pi];rows=[]
                for actual in triangle['corners']:
                    nearest=sorted(((max(abs(float(x)-float(y)) for x,y in zip(expected['position'],actual['position'])),i,expected) for i,expected in enumerate(poly['corners'])),key=lambda x:x[0])[:1]
                    if nearest:rows.append({'positionDelta':nearest[0][0],'source':nearest[0][2],'target':actual})
                position_candidates.append({'mesh':poly['mesh'],'face':poly['face'],'corners':rows})
            raise ValueError('GLB triangle corner cannot be mapped uniquely to joined polygon geometry/UV/normal/material/weights (triangle '+str(ti)+'); target='+repr(triangle)+' positionCandidates='+repr(position_candidates))
        pi,corner_indices=sorted(matches,key=lambda x:(len(assigned[x[0]])/(len(source_triangles[x[0]]['corners'])-2),source_triangles[x[0]]['mesh'],source_triangles[x[0]]['face']))[0]
        if normal_stats is not None:
            poly=source_triangles[pi]
            for source_index,actual in zip(corner_indices,triangle['corners']):
                expected=poly['corners'][source_index];source_normal=source_normal_resolver(poly,source_index,expected['normal']) if source_normal_resolver else expected['normal'];target_normal=actual['normal'];delta=max(abs(float(x)-float(y)) for x,y in zip(source_normal,target_normal))
                source_length=math.sqrt(sum(float(x)*float(x) for x in source_normal));target_length=math.sqrt(sum(float(x)*float(x) for x in target_normal))
                if source_length<0.9999 or source_length>1.0001 or target_length<0.9999 or target_length>1.0001:raise ValueError('Raw GLB/source normal is not unit length within the measured 1e-4 representation bound (triangle '+str(ti)+', source corner '+str(source_index)+', lengths '+repr((source_length,target_length))+').')
                cosine=sum(float(x)*float(y) for x,y in zip(source_normal,target_normal))/(source_length*target_length);angle=math.acos(max(-1.0,min(1.0,cosine)))
                normal_stats['cornerCount']=normal_stats.get('cornerCount',0)+1
                normal_stats['maxAngularErrorRadians']=max(normal_stats.get('maxAngularErrorRadians',0.0),angle)
                normal_stats['maxAngularErrorDegrees']=max(normal_stats.get('maxAngularErrorDegrees',0.0),math.degrees(angle))
                normal_stats['maxSourceUnitLengthDelta']=max(normal_stats.get('maxSourceUnitLengthDelta',0.0),abs(source_length-1.0))
                normal_stats['maxAccessorUnitLengthDelta']=max(normal_stats.get('maxAccessorUnitLengthDelta',0.0),abs(target_length-1.0))
                if delta>normal_stats.get('maxAbsComponentDelta',-1.0):
                    normal_stats['maxAbsComponentDelta']=delta
                    normal_stats['maximum']={'mesh':poly['mesh'],'face':poly['face'],'triangle':ti,'sourceCorner':source_index,'sourceNormal':source_normal,'importedNormal':target_normal,'sourceUnitLength':source_length,'accessorUnitLength':target_length,'angularErrorRadians':angle,'angularErrorDegrees':math.degrees(angle)}
        # GLB coordinate conversion is already reversed by Blender reimport. In
        # that common space, an unexplained negative orientation is a real winding
        # change; a mirrored source must be declared and pre-normalized upstream.
        p=[source_triangles[pi]['corners'][i]['position'] for i in corner_indices]
        a=[p[1][i]-p[0][i] for i in range(3)];b=[p[2][i]-p[0][i] for i in range(3)]
        cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
        source=[c['position'] for c in source_triangles[pi]['corners']];normal=[0.0,0.0,0.0]
        for k,point in enumerate(source):
            nxt=source[(k+1)%len(source)];normal[0]+=(point[1]-nxt[1])*(point[2]+nxt[2]);normal[1]+=(point[2]-nxt[2])*(point[0]+nxt[0]);normal[2]+=(point[0]-nxt[0])*(point[1]+nxt[1])
        # Winding belongs to the source face's ordered positions. Authored split
        # normals are validated independently as a shading channel; they may
        # intentionally oppose polygon winding and must not redefine topology.
        cross_length=sum(x*x for x in cross)**0.5;normal_length=sum(x*x for x in normal)**0.5
        orientation=sum(cross[i]*normal[i] for i in range(3));orientation_scale=cross_length*normal_length
        if check_winding:
            expected_triangles=source_loop_triangles.get((poly['mesh'],poly['face']),[])
            same_source_set=[(ordinal,row) for ordinal,row in expected_triangles if set(row)==set(corner_indices)]
            if same_source_set:
                if len(same_source_set)!=1:raise ValueError('GLB triangle ambiguously matches duplicate Blender source loop triangles (mesh '+str(poly['mesh'])+', face '+str(poly['face'])+', triangle '+str(ti)+', matches '+repr(same_source_set)+').')
                source_ordinal,source_order=same_source_set[0]
                cyclic_match=any(tuple(corner_indices)==source_order[offset:]+source_order[:offset] for offset in range(3))
                if not cyclic_match:raise ValueError('GLB triangle order is reversed relative to the matching Blender source loop triangle (mesh '+str(poly['mesh'])+', face '+str(poly['face'])+', triangle '+str(ti)+', source '+repr(source_order)+', candidate '+repr(corner_indices)+').')
                if source_ordinal in used_source_loop_triangles:raise ValueError('Multiple GLB triangles mapped to the same Blender source loop triangle (mesh '+str(poly['mesh'])+', face '+str(poly['face'])+', source triangle '+str(source_ordinal)+').')
                used_source_loop_triangles.add(source_ordinal)
                if winding_stats is not None:winding_stats['sourceLoopTriangleMatches']=winding_stats.get('sourceLoopTriangleMatches',0)+1
                if cross_length<=1e-4 and winding_stats is not None:winding_stats['degenerateSourceLoopMatches']=winding_stats.get('degenerateSourceLoopMatches',0)+1
            elif oriented_triangles is not None:
                raise ValueError('GLB triangle corner set does not match any actual Blender source loop triangle (mesh '+str(poly['mesh'])+', face '+str(poly['face'])+', triangle '+str(ti)+', candidate '+repr(corner_indices)+', source '+repr(expected_triangles)+').')
            else:
                if cross_length<=1e-4 or normal_length<=1e-12 or abs(orientation)<=max(1e-12,orientation_scale*1e-8):raise ValueError('GLB triangle winding is ambiguous against degenerate/near-orthogonal geometry and has no matching source loop triangle (mesh '+str(poly['mesh'])+', face '+str(poly['face'])+', triangle '+str(ti)+', mapped corners '+repr(corner_indices)+', candidate area vector length '+repr(cross_length)+', source Newell length '+repr(normal_length)+', orientation '+repr(orientation)+').')
                if orientation<0:raise ValueError('GLB triangle winding is reversed relative to the source ordered polygon (mesh '+str(poly['mesh'])+', face '+str(poly['face'])+', triangle '+str(ti)+', mapped corners '+repr(corner_indices)+', orientation '+repr(orientation)+').')
                if winding_stats is not None:winding_stats['unmatchedTriangulationNewellChecks']=winding_stats.get('unmatchedTriangulationNewellChecks',0)+1
        assigned[pi].append(corner_indices)
        if return_mapping:mapping.append({'joinedMesh':source_triangles[pi]['mesh'],'joinedFace':source_triangles[pi]['face'],'glbTriangle':ti,'sourceCorners':corner_indices})
    def area3(points):
        total=[0.0,0.0,0.0]
        for i,p in enumerate(points):
            q=points[(i+1)%len(points)];total[0]+=(p[1]-q[1])*(p[2]+q[2]);total[1]+=(p[2]-q[2])*(p[0]+q[0]);total[2]+=(p[0]-q[0])*(p[1]+q[1])
        return (sum(x*x for x in total)**0.5)*0.5
    for pi,poly in enumerate(source_triangles):
        corners=poly['corners'];triangles=assigned[pi];n=len(corners)
        if len(triangles)!=n-2:raise ValueError('GLB triangle coverage does not provide the expected triangulation for '+poly['mesh']+' face '+str(poly['face']))
        edge_counts={}
        for tri in triangles:
            for a,b in ((tri[0],tri[1]),(tri[1],tri[2]),(tri[2],tri[0])):
                edge=tuple(sorted((a,b)));edge_counts[edge]=edge_counts.get(edge,0)+1
        boundary={tuple(sorted((i,(i+1)%n))) for i in range(n)}
        if any(edge_counts.get(e)!=1 for e in boundary) or any(count!=(1 if edge in boundary else 2) for edge,count in edge_counts.items()) or set(edge_counts)-boundary and any(edge_counts[e]!=2 for e in set(edge_counts)-boundary):
            raise ValueError('GLB triangles do not form the exact source face boundary and interior-edge correspondence for '+poly['mesh']+' face '+str(poly['face']))
        source_area=area3([c['position'] for c in corners]); triangle_area=0.0
        for tri in triangles:
            p=[corners[i]['position'] for i in tri];a=[p[1][i]-p[0][i] for i in range(3)];b=[p[2][i]-p[0][i] for i in range(3)];cross=[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];triangle_area+=(sum(x*x for x in cross)**0.5)*0.5
        # Newell area is exact for planar faces. On a non-planar n-gon, different
        # valid diagonals can have different surface area despite identical
        # corners and exact boundary/interior-edge coverage, so apply this check
        # only when the source face is planar within its coordinate precision.
        nlen=sum(x*x for x in normal)**0.5
        if nlen>1e-12:
            origin=corners[0]['position'];extent=max((sum((a-b)**2 for a,b in zip(c['position'],origin))**0.5 for c in corners),default=0.0)
            deviation=max((abs(sum(normal[i]*(c['position'][i]-origin[i]) for i in range(3)))/nlen for c in corners),default=0.0)
            if deviation<=max(1e-6,extent*1e-6) and abs(source_area-triangle_area)>max(1e-6,source_area*1e-5):raise ValueError('GLB triangulation surface area differs from planar source face.')
    if oriented_triangles is not None and len(used_source_loop_triangles)!=len(oriented_triangles):raise ValueError('Candidate GLB did not map one-to-one onto every actual Blender source loop triangle.')
    return mapping if return_mapping else len(export_triangles)
def verify_exported_animation(source,exported,basis='gltf'):
    if len(source['armatures'])!=len(exported['armatures']):raise ValueError('GLB reimport changed the number of armatures.')
    target={a['object']:a for a in exported['armatures']}
    source_armatures={a['object']:a for a in source['armatures']}; target_armatures={a['object']:a for a in exported['armatures']}
    for before in source['armatures']:
        after=target.get(before['object'])
        if not after:raise ValueError('GLB reimport changed armature identity: '+repr({'source':before['object'],'targetNames':list(target)}))
        source_hierarchy={b['name']:b['parent'] for b in before['bones']};target_hierarchy={b['name']:b['parent'] for b in after['bones']}
        if source_hierarchy!=target_hierarchy:raise ValueError('GLB reimport changed joint names or parent hierarchy: '+repr({'armature':before['object'],'sourceBoneCount':len(source_hierarchy),'candidateBoneCount':len(target_hierarchy),'missing':sorted(set(source_hierarchy)-set(target_hierarchy))[:20],'extra':sorted(set(target_hierarchy)-set(source_hierarchy))[:20],'reparented':{name:{'source':source_hierarchy[name],'candidate':target_hierarchy[name]} for name in source_hierarchy.keys()&target_hierarchy.keys() if source_hierarchy[name]!=target_hierarchy[name]}}))
        if not close_row([v for row in before['world'] for v in row],[v for row in after['world'] for v in row],0.002):raise ValueError('GLB reimport changed the armature object world transform.')
        source_bones={b['name']:b for b in before['bones']};target_bones={b['name']:b for b in after['bones']}
        for bone in before['bones']:
            # Both values here are Blender reimport snapshots. The importer has
            # already converted glTF joint coordinates back into Blender's
            # basis; applying the glTF axis matrix a second time compares unlike
            # representations and falsely rejects the unchanged source rest.
            expected_rest=Matrix(after['world'])@Matrix(bone['rest']);actual_rest=Matrix(after['world'])@Matrix(target_bones[bone['name']]['rest'])
            if not close_row([v for row in expected_rest for v in row],[v for row in actual_rest for v in row],0.002):raise ValueError('Blender-reimported rest joint differs from the source rest in the common scene basis for '+before['object']+'/'+bone['name'])
            if bone['parent']:
                parent=bone['parent'];a=Matrix(source_bones[parent]['rest']).inverted_safe()@Matrix(bone['rest']);b=Matrix(target_bones[parent]['rest']).inverted_safe()@Matrix(target_bones[bone['name']]['rest'])
                if not close_row([v for row in a for v in row],[v for row in b for v in row],0.002):raise ValueError('GLB reimport changed parent-relative rest transform for '+before['object']+'/'+bone['name'])
    actual_by_clip={}
    for row in exported['sampledAnimations']:actual_by_clip.setdefault((row['object'],row['action']),[]).append(row)
    required=[x for x in source['sampledAnimations'] if x.get('frames')];source_keys=[(x['object'],x['action']) for x in required]
    if len(set(source_keys))!=len(source_keys):raise ValueError('Source clip/action bindings are ambiguous and cannot be independently matched to GLB slots.')
    clip_transform_evidence=[];rest_transform_evidence=[]
    for action in required:
        candidates=actual_by_clip.get((action['object'],action['action']),[]);other=candidates[0] if len(candidates)==1 else None
        expected_times=action.get('sampleTimesSeconds');actual_times=other.get('sampleTimesSeconds') if other else None
        if not other or other.get('sourceSlot')!=action.get('slot') or not expected_times or len(expected_times)!=len(actual_times or []) or any(abs(float(a)-float(b))>1e-5 for a,b in zip(expected_times,actual_times or [])):raise ValueError('GLB reimport removed, ambiguously rebound, or retimed a required bound action clip in normalized seconds: '+action['action'])
        names=action.get('boneNames',[])
        if names!=other.get('boneNames'):raise ValueError('GLB action changed its animated bone binding: '+action['action'])
        source_bytes=zlib.decompress(base64.b64decode(action['poseDataZlibF32']));target_bytes=zlib.decompress(base64.b64decode(other['poseDataZlibF32']))
        stride=len(names)*64
        if not names or len(source_bytes)!=len(action['frames'])*stride or len(target_bytes)!=len(other['frames'])*stride:raise ValueError('GLB animation pose samples are incomplete or malformed: '+action['action'])
        source_armature=source_armatures.get(action['object']);target_armature=target_armatures.get(action['object'])
        if not source_armature or not target_armature:raise ValueError('GLB animation is not bound to the expected armature object: '+action['object'])
        source_rest={bone['name']:Matrix(source_armature['world'])@Matrix(bone['rest']) for bone in source_armature['bones']};target_rest={bone['name']:Matrix(target_armature['world'])@Matrix(bone['rest']) for bone in target_armature['bones']}
        clip_max_delta=0.0;frame_evidence=[]
        for sample_index,frame in enumerate(action['frames']):
            frame_max_delta=0.0
            source_offset=sample_index*stride;target_offset=sample_index*stride
            for bone_index,bone in enumerate(names):
                a=struct.unpack_from('<16f',source_bytes,source_offset+bone_index*64);b=struct.unpack_from('<16f',target_bytes,target_offset+bone_index*64)
                source_pose=Matrix([a[i:i+4] for i in range(0,16,4)]);target_pose=Matrix([b[i:i+4] for i in range(0,16,4)])
                source_delta=source_rest[bone].inverted_safe()@source_pose;target_delta=target_rest[bone].inverted_safe()@target_pose
                delta=max(abs(float(x)-float(y)) for x,y in zip([v for row in source_delta for v in row],[v for row in target_delta for v in row]));frame_max_delta=max(frame_max_delta,delta)
                if delta>0.002:raise ValueError('GLB action sampled rest-relative pose differs for '+action['action']+'/'+bone+' at frame '+str(frame)+'; max component delta='+repr(delta)+' source='+repr([v for row in source_delta for v in row])+' candidate='+repr([v for row in target_delta for v in row]))
            clip_max_delta=max(clip_max_delta,frame_max_delta);frame_evidence.append({'frame':frame,'maxAbsComponentDelta':frame_max_delta})
        clip_transform_evidence.append({'object':action['object'],'action':action['action'],'sourceSlot':action.get('slot'),'candidateSlot':other.get('slot'),'frames':list(action['frames']),'sourceTimeMapping':{'mapping':action.get('timeMapping','scene-relative'),'fps':action.get('fps'),'fpsBase':action.get('fpsBase'),'frameStart':action.get('frameStart'),'frames':list(action['frames']),'timesSeconds':list(expected_times)},'candidateTimeMapping':{'mapping':other.get('timeMapping','scene-relative'),'fps':other.get('fps'),'fpsBase':other.get('fpsBase'),'frameStart':other.get('frameStart'),'frames':list(other.get('frames',[])),'timesSeconds':list(actual_times)},'boneNames':list(names),'sourcePoseZlibF32':action['poseDataZlibF32'],'candidatePoseZlibF32':other['poseDataZlibF32'],'maxAbsRestRelativeComponentDelta':clip_max_delta,'frameDeltas':frame_evidence})
    for before in source['armatures']:
        after=target_armatures[before['object']];candidate_bones={bone['name']:bone for bone in after['bones']};candidate_world=Matrix(after['world']);
        for bone in before['bones']:
            source_rest=Matrix(before['world'])@Matrix(bone['rest']);candidate_rest=candidate_world@Matrix(candidate_bones[bone['name']]['rest']);expected_rest=candidate_world@Matrix(bone['rest']);delta=max(abs(float(x)-float(y)) for x,y in zip([v for row in expected_rest for v in row],[v for row in candidate_rest for v in row]))
            rest_transform_evidence.append({'object':before['object'],'bone':bone['name'],'sourceRestWorld':[[float(v) for v in row] for row in source_rest],'candidateRestWorld':[[float(v) for v in row] for row in candidate_rest],'candidateExpectedRestWorld':[[float(v) for v in row] for row in expected_rest],'maxAbsBasisAdjustedComponentDelta':delta})
    return {'armatures':len(source['armatures']),'sampledActions':len(required),'sampledFrames':sum(len(x['frames']) for x in required),'clipCoverage':[{'object':x['object'],'action':x['action'],'sourceSlot':x.get('slot'),'candidateSlot':next((row.get('slot') for row in actual_by_clip.get((x['object'],x['action']),[]) if row.get('sourceSlot')==x.get('slot')),None),'frames':len(x['frames']),'sourceFPS':x.get('fps'),'sourceFPSBase':x.get('fpsBase'),'sourceFrameStart':x.get('frameStart'),'timesSeconds':list(x.get('sampleTimesSeconds',[]))} for x in required],'poseTolerance':0.002,'poseSpace':'per-bone rest-relative local delta in independently reimported Blender scene basis; raw GLB node/skin/inverse-bind mapping is validated separately; declared format: '+basis,'clipTransforms':clip_transform_evidence,'restTransforms':rest_transform_evidence}
def validate_assembly(cfg,report,source,output,exported=None):
    if report.get('operation')=='assembly-join':
        weight_policy=report.get('weightExportPolicy') or {}
        if report.get('inputHashes')!=[cfg.get('inputHash')] or report.get('exportHash')!=cfg.get('assemblyExportHash') or report.get('exportHash') not in cfg.get('inputHashes',[]) or report.get('outputHash')!=cfg['outputHash'] or report.get('newBaselineRequired') is not True or report.get('faceLineageVerifiedAfterReopen') is not True or report.get('exportReimportImported') is not True or report.get('exportFormat')!='glb' or report.get('exportAllInfluences') is not True or weight_policy.get('adapter')!='blender-gltf-all-positive-influences-v1' or weight_policy.get('sourceSHA256')!='fa36dec52271bd7bbde8bd9e75357698e5574b5f32ab993c454f585b895a1c6e' or weight_policy.get('adaptedCutoff')!=0: raise ValueError('Assembly join report is not bound to inputs, actual GLB reimport, all-positive influence export, or explicit new-baseline rules.')
        if exported is None or report.get('exportHash')!=cfg.get('assemblyExportHash') or report.get('sourceTriangleCount')!=sum(len(p['corners'])-2 for p in output['polygons']) or len(exported['rawTriangles'])!=report.get('sourceTriangleCount') or report.get('sourceMaterials')!=exported['rawMaterials']: raise ValueError('Independent assembly validation cannot verify actual GLB accessor bytes or source face/material inventory.')
        rows=report.get('objects'); joined=output['meshes'].get(report.get('joinedObject'))
        if not isinstance(rows,list) or len(rows)<2 or not joined or len(output['meshes'])!=1 or not isinstance(joined.get('faceLineage'),list) or not isinstance(joined.get('pointLineage'),list): raise ValueError('Joined candidate or per-face/vertex lineage is missing.')
        expected={i:set() for i in range(len(rows))}
        source_meshes={}
        for row in rows:
            source_mesh=source['meshes'].get(row.get('object'))
            if row.get('ordinal') not in expected or row.get('faces')<=0 or not source_mesh or source_mesh['polygons']!=row['faces'] or source_mesh['vertices']!=row.get('vertices'): raise ValueError('Join source manifest does not match its actual upstream meshes.')
            expected[row['ordinal']]=set(range(row['faces']))
            source_meshes[row['ordinal']]=source_mesh
        actual={i:[] for i in expected}
        output_faces={}
        for ordinal,face in joined['faceLineage']:
            if ordinal not in actual: raise ValueError('Joined mesh lineage references an undeclared source.')
            actual[ordinal].append(face)
        for output_index,(ordinal,face) in enumerate(joined['faceLineage']): output_faces[(ordinal,face)]=joined['faceRecords'][output_index]
        manifest_map=report.get('sourceFaceMap')
        if not isinstance(manifest_map,dict) or set(manifest_map)!=set(str(i) for i in expected): raise ValueError('Assembly source-face manifest is missing a declared source mapping.')
        for output_index,(ordinal,face) in enumerate(joined['faceLineage']):
            rows_for_source=manifest_map.get(str(ordinal),[])
            if not any(row.get('sourceFace')==face and row.get('outputFace')==output_index for row in rows_for_source): raise ValueError('Assembly source-face manifest does not match actual joined face lineage.')
        for i in expected:
            if len(actual[i])!=len(expected[i]) or set(actual[i])!=expected[i]: raise ValueError('Joined mesh per-face lineage is incomplete, duplicated, or reordered.')
            before=source_meshes[i]
            for face in expected[i]:
                if not joined_face_equal(before['faceRecords'][face],output_faces[(i,face)]): raise ValueError('Joined output changed source face geometry, UV corners, corner normals, or material identity.')
        point_seen={i:set() for i in expected}
        for output_index,(ordinal,vertex) in enumerate(joined['pointLineage']):
            if ordinal not in point_seen or vertex<0 or vertex>=source_meshes[ordinal]['vertices'] or vertex in point_seen[ordinal]: raise ValueError('Joined point lineage is invalid or duplicated.')
            point_seen[ordinal].add(vertex)
            if joined['weights'][output_index]!=source_meshes[ordinal]['weights'][vertex]: raise ValueError('Assembly join changed source vertex weights.')
        if any(point_seen[i]!=set(range(source_meshes[i]['vertices'])) for i in point_seen): raise ValueError('Assembly join vertex mapping is incomplete.')
        if source['animationFingerprint']!=output['animationFingerprint']: raise ValueError('Assembly join changed authoritative animation curves, bindings, NLA state, armature world transforms, or rest pose.')
        if report.get('animationFingerprint')!=output['animationFingerprint']: raise ValueError('Assembly report animation fingerprint does not match the serialized joined candidate.')
        glb_mappings=triangle_correspondence(output['polygons'],exported['rawTriangles'])
        source_materials={m['name']:m.get('pbrChannels') for mesh in output['meshes'].values() for m in mesh.get('materialData',[]) if m}
        exported_materials={m['name']:m.get('pbrChannels') for mesh in exported['meshes'].values() for m in mesh.get('materialData',[]) if m}
        if source_materials.keys()!=exported_materials.keys() or any(source_materials[name]!=exported_materials[name] for name in source_materials):raise ValueError('GLB reimport changed PBR channel identity, connected image content, colorspace, or material constants: '+repr({'source':source_materials,'exported':exported_materials}))
        animation=verify_exported_animation(output,exported)
        return {'mappings':sum(len(v) for v in actual.values()),'sourceMeshes':len(rows),'joinedObject':report['joinedObject'],'glbTriangleMappings':glb_mappings,'materialChannelIdentity':source_materials,'geometryTolerance':1e-5,'normalTolerance':0.002,'weightTolerance':0.002,'uvConvention':'GLB V coordinate inverted once to Blender UV basis','animationFingerprint':output['animationFingerprint'],'glbAnimationVerification':animation,'newBaselineRequired':True}
    if report.get('inputHashes')!=cfg.get('inputHashes',[cfg['inputHash']]) or report.get('outputHash')!=cfg['outputHash']: raise ValueError('Assembly report hashes do not match registered stage inputs.')
    mappings=report.get('objectMappings')
    if not isinstance(mappings,list) or not mappings: raise ValueError('Assembly requires explicit object correspondence mappings.')
    used=set(); used_outputs=set()
    for mapping in mappings:
        source_name=mapping.get('sourceObject'); output_name=mapping.get('outputObject')
        a=source['meshes'].get(source_name); b=output['meshes'].get(output_name)
        if not a or not b or mapping.get('sourceFingerprint')!=a['geometry'] or mapping.get('outputFingerprint')!=b['geometry'] or a['geometry']!=b['geometry'] or a['uv']!=b['uv'] or a['normals']!=b['normals'] or a['materials']!=b['materials']: raise ValueError('Assembly mapping is not backed by equal actual source/output topology, corner normal, UV and material fingerprints.')
        if source_name in used or output_name in used_outputs: raise ValueError('Assembly correspondence must be one-to-one; duplicate mapping is ambiguous.')
        used.add(source_name); used_outputs.add(output_name)
    if used!=set(source['meshes']): raise ValueError('Assembly report must map every source mesh exactly.')
    if used_outputs!=set(output['meshes']): raise ValueError('Assembly report must account for every output mesh exactly.')
    return {'mappings':len(mappings),'sourceMeshes':len(source['meshes'])}
def validate_returned_rig(source,output,baseline):
    """Check rig preservation against the return, surfaces against the pre-rig baseline."""
    from mathutils.kdtree import KDTree
    if not source or source['boneCount']<=0 or source['boneCount']!=output['boneCount']:
        raise ValueError('Returned-rig audit requires the same nonempty authoritative skeleton.')
    if set(source['meshes'])!=set(output['meshes']):
        raise ValueError('Material restoration changed the returned rig mesh identity set.')
    def animation_core(scene):
        core=json.loads(json.dumps(scene['animationState']))
        for armature in core['armatures']:armature.pop('world',None)
        return core
    if animation_core(source)!=animation_core(output):
        raise ValueError('Material restoration changed returned rest bones, actions, slots or NLA bindings.')
    alignment=None
    for name,before in source['meshes'].items():
        after=output['meshes'][name]
        for field in ('geometry','weightFingerprint','groupNames','skinned','armatureObjects'):
            if before[field]!=after[field]:
                raise ValueError('Material restoration changed returned '+field+': '+name)
        a=Matrix([before['objectMatrix'][i:i+4] for i in range(0,16,4)])
        b=Matrix([after['objectMatrix'][i:i+4] for i in range(0,16,4)])
        proposed=b@a.inverted()
        if alignment is None:alignment=proposed
        if any(abs(proposed[r][c]-alignment[r][c])>1e-5 for r in range(4) for c in range(4)):
            raise ValueError('Returned rig objects do not share one global alignment.')
    if alignment is None:raise ValueError('Returned rig has no mesh.')
    scale=alignment[0][0]
    if not math.isfinite(scale) or scale<=0 or any(abs(alignment[r][c]-(scale if r==c else 0))>1e-5 for r in range(3) for c in range(3)) or any(abs(alignment[3][c]-(1 if c==3 else 0))>1e-5 for c in range(4)):
        raise ValueError('Returned-rig alignment includes rotation, reflection, shear or nonuniform scale.')
    for before,after in zip(source['armatures'],output['armatures']):
        if before['object']!=after['object']:
            raise ValueError('Returned armature identity changed.')
        a=Matrix(before['world']);b=Matrix(after['world']);expected=alignment@a
        if any(abs(b[r][c]-expected[r][c])>1e-5 for r in range(4) for c in range(4)):
            raise ValueError('Returned armature did not receive the common static alignment.')
    states=source.get('rigObjectState') or {};actual=output.get('rigObjectState') or {}
    if not states or not actual:raise ValueError('Independent returned-rig hierarchy snapshot is missing.')
    extra=set(actual)-set(states)
    aligned=any(abs(alignment[r][c]-(1 if r==c else 0))>1e-7 for r in range(4) for c in range(4))
    if set(states)-set(actual) or len(extra)!=(1 if aligned else 0):
        raise ValueError('Returned hierarchy gained or lost unapproved objects.')
    root=next(iter(extra)) if extra else None
    if root:
        state=actual[root]
        if state['type']!='EMPTY' or state['parent'] or state['animated'] or state['constraints'] or state['drivers']:
            raise ValueError('Global rig alignment must use one static unanimated parent.')
        if any(abs(state['local'][4*r+c]-alignment[r][c])>1e-5 for r in range(4) for c in range(4)):
            raise ValueError('Static rig parent does not match the proven global alignment.')
    for name,before in states.items():
        after=actual[name]
        if aligned and (before['constraints'] or before['drivers']):
            raise ValueError('Aligning constrained/driven returned objects needs an explicit motion audit.')
        for field in ('type','animated','constraints','drivers'):
            if before[field]!=after[field]:raise ValueError('Returned hierarchy control changed: '+name)
        if after['parent']!=(root if root and before['parent'] is None else before['parent']):
            raise ValueError('Returned hierarchy was reparented beyond the one static alignment root.')
        for field in ('local','parentInverse'):
            if any(abs(a-b)>1e-7 for a,b in zip(before[field],after[field])):
                raise ValueError('Returned local transform controls changed: '+name)
    def material_map(scene):
        result={}
        for mesh in scene['meshes'].values():
            for material in mesh['materialData']:
                if material is None:continue
                value=json.loads(json.dumps(material));name=value.pop('name')
                for node in value.get('nodes',[]):
                    node.pop('name',None)
                    if node.get('image'):
                        node['image'].pop('name',None);node['image'].pop('packed',None)
                result[name]=value
        return result
    materials=material_map(baseline);restored_materials=material_map(output)
    points=[];point_ids={};faces={}
    for poly in baseline['polygons']:
        if len(poly['corners'])!=3:raise ValueError('Returned-rig audit baseline must already be triangulated.')
        indices=[]
        for corner in poly['corners']:
            key=tuple(round(float(v),7) for v in corner['position'])
            if key not in point_ids:point_ids[key]=len(points);points.append(key)
            indices.append(point_ids[key])
        key=tuple(sorted(indices))
        if len(set(indices))!=3 or key in faces:raise ValueError('Baseline has ambiguous coincident or degenerate faces.')
        faces[key]=(poly,indices)
    tree=KDTree(len(points))
    for index,point in enumerate(points):tree.insert(point,index)
    tree.balance();used=set();maximum=0.0
    for poly in output['polygons']:
        ids=[]
        for corner in poly['corners']:
            found=tree.find_range(Vector(corner['position']),1e-5)
            if len(found)!=1:raise ValueError('Restored surface has missing or ambiguous baseline positions.')
            ids.append(found[0][1]);maximum=max(maximum,found[0][2])
        key=tuple(sorted(ids))
        if len(ids)!=3 or key not in faces or key in used:raise ValueError('Restored surface changed, duplicated or omitted baseline faces.')
        expected,source_ids=faces[key];used.add(key)
        if not any(ids==source_ids[i:]+source_ids[:i] for i in range(3)):
            raise ValueError('Restored surface reversed a baseline face.')
        if materials.get(expected['material'])!=restored_materials.get(poly['material']):
            raise ValueError('Restored material graph, connected image bytes or PBR channels differ from baseline.')
        expected_uv=baseline['meshes'][expected['mesh']]['activeUvLayer']
        actual_uv=output['meshes'][poly['mesh']]['activeUvLayer']
        for corner,index in zip(poly['corners'],ids):
            original=expected['corners'][source_ids.index(index)]
            for layer,uv in original['uv'].items():
                if layer not in corner['uv'] or any(abs(a-b)>1e-6 for a,b in zip(uv,corner['uv'][layer])):
                    raise ValueError('Restored UV corner data differs from its actual baseline face.')
            if expected_uv not in original['uv'] or actual_uv not in corner['uv'] or any(abs(a-b)>1e-6 for a,b in zip(original['uv'][expected_uv],corner['uv'][actual_uv])):
                raise ValueError('Restored active UV interpretation differs from baseline.')
            if any(abs(a-b)>0.002 for a,b in zip(original['normal'],corner['normal'])):
                raise ValueError('Restored corner normals differ from baseline.')
    if used!=set(faces):raise ValueError('Restored rig is missing baseline surface faces.')
    return {'boneCount':output['boneCount'],'returnedRigCorePreserved':True,'weightsPreserved':True,
            'baselineSurfaceProven':True,'mappedFaces':len(used),'maxPositionError':maximum,
            'staticAlignmentParent':root,'alignment':[[float(v) for v in row] for row in alignment],
            'cornerNormalsRestored':True,'materialGraphsAndImagesPreserved':True}

def validate_guided_model_health(source,output,kind):
    """Read-only technical audit; visual/local-mask approval is a separate decision."""
    if not source or source['boneCount']<=0 or output['boneCount']!=source['boneCount']:
        raise ValueError('Guided model audit requires the accepted upstream rig and its complete skeleton.')
    if source['animationFingerprint']!=output['animationFingerprint']:
        raise ValueError('Guided repair changed rig rest data, world transforms, actions or animation bindings.')
    if set(source['meshes'])!=set(output['meshes']):
        raise ValueError('Guided repair changed the authoritative mesh set.')
    def finite(value):
        if isinstance(value,float):return math.isfinite(value)
        if isinstance(value,dict):return all(finite(item) for item in value.values())
        if isinstance(value,list):return all(finite(item) for item in value)
        return True
    material_count=0;image_count=0;weighted_vertices=0
    for name,before in source['meshes'].items():
        after=output['meshes'][name]
        for field in ('geometry','uv','normals','skinned','armatureObjects'):
            if before[field]!=after[field]:raise ValueError('Guided repair changed protected '+field+': '+name)
        if kind=='materials' and (before['weightFingerprint']!=after['weightFingerprint'] or before['groupNames']!=after['groupNames']):
            raise ValueError('Texture repair changed authoritative skin weights: '+name)
        if kind=='weights' and before['materials']!=after['materials']:
            raise ValueError('Weight repair changed material graphs, images or face assignments: '+name)
        if kind=='weights':
            bone_names={bone['name'] for armature in output['armatures'] for bone in armature['bones']}
            if after['invalidWeightVertices'] or after['skinned'] and after['zeroWeightVertices']:
                raise ValueError('Skinned vertices must have finite, nonnegative, normalized positive weights: '+name)
            for row in after['weights']:
                if any(not math.isfinite(weight) or weight<0 for _,weight in row):
                    raise ValueError('Weights contain invalid numeric values: '+name)
                if any(group not in bone_names for group,weight in row if weight>0):
                    raise ValueError('Deform weights refer to an unavailable rig bone: '+name)
            weighted_vertices+=after['vertices']-after['zeroWeightVertices']
        if kind=='materials':
            if not after['uvLayers'] or not after['activeUvLayer']:
                raise ValueError('Texture audit requires valid active UV coordinates: '+name)
            materials={item['name']:item for item in after['materialData'] if item}
            assigned={face['material'] for face in after['faceRecords']}
            if not assigned or None in assigned or not assigned.issubset(materials):
                raise ValueError('A model face has no actual assigned material: '+name)
            for material_name in assigned:
                material=materials[material_name];semantics=material.get('pbrSemantics') or {}
                if not finite(material) or not semantics.get('directPrincipledSurface') or not material.get('pbrChannels'):
                    raise ValueError('Texture audit requires a finite supported connected PBR surface: '+material_name)
                for uv in semantics.get('textureUvMaps',{}).values():
                    if uv and uv not in after['uvLayers']:
                        raise ValueError('Texture channel references an unavailable UV layer: '+material_name)
                for node in material.get('nodes',[]):
                    image=node.get('image')
                    if image and image.get('payloadSHA256'):
                        if not image.get('content') or any(int(n)<=0 for n in image['size']):
                            raise ValueError('A connected texture has no actual decoded content: '+material_name)
                        image_count+=1
                normal=(material.get('pbrChannels') or {}).get('normal') or {}
                if normal.get('kind')=='unsupported':
                    raise ValueError('Normal channel uses an unsupported route: '+material_name)
                if normal.get('kind')=='image' and semantics.get('normalSpace')!='TANGENT':
                    raise ValueError('Unity-facing normal images require tangent-space routing: '+material_name)
                material_count+=1
    return {'profile':'guided-model-health','kind':kind,'meshCount':len(output['meshes']),
            'boneCount':output['boneCount'],'protectedGeometryUvNormalsPreserved':True,
            'rigAndAnimationPreserved':True,'weightsPreserved':kind=='materials',
            'materialGraphsAndImagesPreserved':kind=='weights','auditedMaterials':material_count,
            'decodedConnectedTextures':image_count,'weightedVertices':weighted_vertices,
            'localMaskPreservation':'not asserted by this technical health audit',
            'appearance':'requires human visual review'}

def validate_rig(source,output):
    if source['boneCount'] and output['animationFingerprint']!=source['animationFingerprint']: raise ValueError('Rig operation changed authoritative animation curves, bindings, NLA state, armature world transforms, or rest pose.')
    if source['boneCount'] and output['boneCount']<source['boneCount']: raise ValueError('Rig operation removed upstream bones.')
    for name,before in source['meshes'].items():
        after=output['meshes'].get(name)
        if not after or before['geometry']!=after['geometry'] or before['uv']!=after['uv'] or before['normals']!=after['normals'] or before['materials']!=after['materials']: raise ValueError('Rig operation changed upstream mesh geometry, corner normals, UVs, or materials.')
        if before['weightFingerprint']!=after['weightFingerprint']: raise ValueError('Rig operation changed authoritative upstream vertex weights.')
    if output['boneCount']<=0: raise ValueError('Rigged candidate has no armature.')
    return {'boneCount':output['boneCount'],'restPoseFingerprint':output['restPoseFingerprint'],'actions':output['actions'],'weightsPreserved':True}
def validate_weights(cfg,report,source,output):
    if report.get('inputHashes')!=cfg.get('inputHashes',[cfg['inputHash']]) or report.get('outputHash')!=cfg['outputHash']: raise ValueError('Weight report hashes do not match registered stage inputs.')
    edits=report.get('editedVertices')
    if not isinstance(edits,dict): raise ValueError('Weight report must list edited vertex IDs by mesh.')
    if source['animationFingerprint']!=output['animationFingerprint']: raise ValueError('Weight repair changed animation curves, bindings, NLA state, armature world transforms, or rest pose.')
    if set(source['meshes'])!=set(output['meshes']): raise ValueError('Weight repair changed the mesh set.')
    cap=report.get('maxInfluences')
    if cap is not None and (type(cap)is not int or cap<1 or cap>8): raise ValueError('Explicit influence cap must be in the range 1–8.')
    for name,before in source['meshes'].items():
        after=output['meshes'][name]; changed=set(edits.get(name,[]))
        if before['geometry']!=after['geometry'] or before['uv']!=after['uv'] or before['normals']!=after['normals'] or before['materials']!=after['materials']: raise ValueError('Weight repair changed topology, corner normals, UVs, or material assignments.')
        if any(type(i)is not int or i<0 or i>=before['vertices'] for i in changed): raise ValueError('Edited vertex index falls outside the source mesh.')
        for index in range(before['vertices']):
            row=after['weights'][index]; total=sum(w for _,w in row)
            if not row:
                if index in changed or before['weights'][index]: raise ValueError('A weighted or explicitly edited vertex lost all weights.')
                continue
            if any(not isinstance(w,(int,float)) or w<0 for _,w in row) or abs(total-1)>0.001: raise ValueError('Every weighted output vertex must have normalized finite nonnegative weights; '+name+' vertex '+str(index)+' has '+repr(row)+'.')
            if index not in changed and before['weights'][index]!=row: raise ValueError('Weight repair changed an unselected vertex.')
            if cap is not None and len(row)>cap: raise ValueError('Output exceeds the explicitly selected influence cap.')
    return {'editedVertices':sum(len(v) for v in edits.values()),'maxInfluences':output['maxInfluences'],'unmodifiedWeightsPreserved':True}
def validate_final(cfg,report,source,output):
    materialLimitations=[];fmt=report.get('format');skin_binding=None;material_channel_verification=None;accessor_normal_stats={};imported_normal_stats={};winding_stats={}
    if report.get('outputHash')!=cfg['outputHash'] or report.get('inputHashes')!=cfg['inputHashes']: raise ValueError('Final export manifest does not match the managed candidate bytes and inputs.')
    if not output['meshes']: raise ValueError('Final export contains no decodable mesh.')
    profile=report.get('profile');mappings=[]
    if profile not in ('rigged-unity','editable-source','static-ancillary'):raise ValueError('Final export report must declare its rigged-unity, editable-source or static-ancillary profile.')
    if profile=='rigged-unity':
        if source is None or source['boneCount']<=0 or output['boneCount']<=0:raise ValueError('Rigged Unity final export requires an authoritative rigged upstream master and an actual rigged export; static OBJ is an ancillary profile only.')
        if not source.get('polygons') or not output.get('meshes'):raise ValueError('Rigged final comparison requires actual source polygons and a reimported model scene.')
        fmt=report.get('format')
        weight_policy=report.get('weightExportPolicy') or {}
        if fmt=='glb' and (weight_policy.get('adapter')!='blender-gltf-all-positive-influences-v1' or weight_policy.get('sourceSHA256')!='fa36dec52271bd7bbde8bd9e75357698e5574b5f32ab993c454f585b895a1c6e' or weight_policy.get('stockCutoff')!=0.0001 or weight_policy.get('adaptedCutoff')!=0):raise ValueError('GLB evidence does not bind the reviewed all-positive influence exporter adaptation.')
        if fmt=='glb':
            skin_binding=validate_glb_skin_binding(source,cfg['candidate'])
            skinned_names={name for name,row in source['meshes'].items() if row.get('skinned')}
            source_bind_normals=source.get('evaluatedBindNormals',{})
            target_bind_context=output.get('evaluatedBindContext',[])
            source_bind_rows={name:row for name,row in source_bind_normals.items()}
            if not source_bind_rows or not target_bind_context:raise ValueError('GLB evaluated-normal proof requires serialized source and imported candidate bind-pose action/frame bindings.')
            for binding in target_bind_context:
                source_binding=next((row for name,row in source_bind_rows.items() if source['meshes'][name].get('armatureObjects')==[binding['object']]),None)
                source_identity={key:source_binding.get(key) for key in ('action','slot','frame','basis','cornerCount')} if source_binding else None
                target_identity={key:binding.get(key) for key in ('action','sourceSlot','frame','basis')}
                if source_binding is None or source_identity['basis']!='armature-rest' or target_identity['basis']!='armature-rest' or (source_identity.get('action'),source_identity.get('slot'),source_identity.get('frame'))!=(target_identity.get('action'),target_identity.get('sourceSlot'),target_identity.get('frame')):raise ValueError('GLB raw-normal comparison requires matching serialized armature-rest action/slot/frame bindings (action may be null for a valid rest-only source): '+repr({'source':source_identity,'candidate':target_identity}))
            source_bind_normal_resolver=evaluated_bind_normal_resolver(source)
            imported_skin=[triangle for triangle in output['triangles'] if triangle.get('mesh') in skinned_names]
            skin_source=[polygon for polygon in source['polygons'] if polygon['mesh'] in skinned_names]
            expected_skin_triangles=sum(len(polygon['corners'])-2 for polygon in skin_source)
            if len(imported_skin)!=expected_skin_triangles:raise ValueError('Blender GLB reimport changed the evaluated skinned triangle count.')
            # The stored NORMAL accessor is the format-native source-basis
            # reference; Blender's evaluated importer skinning has its own
            # representation error, measured separately below. Reimported
            # positions, UVs, positive joint support, material and complete
            # triangle coverage remain independently validated against source;
            # winding is validated on the raw accessor tuples below.
            triangle_correspondence(skin_source,imported_skin,normal_tolerance=0.0,check_winding=False,compare_normals=False,normal_stats=imported_normal_stats,source_normal_resolver=source_bind_normal_resolver)
            del imported_skin,skin_source
            output['triangles']=[]
            uv_layers={name:mesh['uvLayers'] for name,mesh in source['meshes'].items()};raw_export=parse_glb_triangles(cfg['candidate'],uv_layers,skinned_accessor_space=True)
            # parse_glb_triangles already resolves complete node-world matrices and applies the single GLTF-Y-up to Blender-Z-up basis conversion for static and world-baked skinned accessors. A second conversion rotates/reflects static sword corners and falsely reports UV/geometry loss.
            accessor_static=[triangle for triangle in raw_export['triangles'] if triangle.get('mesh') not in skinned_names]
            accessor_skin=[triangle for triangle in raw_export['triangles'] if triangle.get('mesh') in skinned_names]
            export_triangles=accessor_skin+accessor_static
            expected_source_triangles=sum(len(polygon['corners'])-2 for polygon in source['polygons'])
            if len(raw_export['triangles'])!=expected_source_triangles:raise ValueError('GLB accessor triangle count differs from the oriented source polygon set.')
            if len(source.get('orientedTriangles',[]))!=expected_source_triangles:raise ValueError('Source Blender loop-triangle orientation inventory does not cover every final-export triangle.')
        elif fmt=='fbx':export_triangles=output['triangles']
        else:raise ValueError('Rigged Unity deliverables must be an independently inspectable GLB or FBX; editable BLEND is a separate source profile.')
        correspondence_source=source['polygons']
        # Every candidate triangle is compared to the source polygon corner
        # inventory and, when the triangulation matches, the independently
        # captured Blender loop-triangle orientation. Newell is only a strict
        # fallback for alternate nondegenerate triangulations.
        # Raw accessor normals are FLOAT32 and the independent source corner
        # normals are transformed/normalized through Blender's double-precision
        # mesh path. The measured difference is represented at 1e-4 per component;
        # this remains separate from evaluated-importer normal semantics below.
        mappings=triangle_correspondence(correspondence_source,export_triangles,normal_tolerance=0.0001 if fmt=='glb' else 0.002,check_winding=True,normal_stats=accessor_normal_stats if fmt=='glb' else None,oriented_triangles=source.get('orientedTriangles') if fmt=='glb' else None,winding_stats=winding_stats,return_mapping=False)
        if fmt=='glb' and winding_stats.get('sourceLoopTriangleMatches',0)+winding_stats.get('unmatchedTriangulationNewellChecks',0)!=len(export_triangles):raise ValueError('GLB winding proof did not account for every oriented candidate triangle.')
        glb_materials=parse_glb_material_channels(cfg['candidate'],cfg['root']) if fmt=='glb' else None
        source_materials={m['name']:m.get('pbrChannels') for mesh in source['meshes'].values() for m in mesh.get('materialData',[]) if m}
        output_materials={name:row['channels'] for name,row in glb_materials.items()} if glb_materials is not None else {m['name']:m.get('pbrChannels') for mesh in output['meshes'].values() for m in mesh.get('materialData',[]) if m}
        if fmt=='fbx':
            if source_materials.keys()!=output_materials.keys():raise ValueError('FBX reimport changed material identity.')
            for name,before in source_materials.items():
                after=output_materials[name] or {}
                for channel in ('albedo','normal'):
                    if before.get(channel)!=after.get(channel):raise ValueError('FBX reimport changed supported '+channel+' material content for '+name)
                for channel in ('roughness','metallic'):
                    if before.get(channel)!=after.get(channel):materialLimitations.append({'material':name,'channel':channel,'source':before.get(channel),'fbxReimport':after.get(channel),'reason':'FBX material interchange cannot represent this connected Principled channel; retained separately in the editable BLEND source export.'})
        if fmt=='glb':
            material_channel_verification=validate_gltf_material_channels(source,glb_materials,source.get('orientedTriangles'),export_triangles)
            materialLimitations.extend(material_channel_verification.get('materialLimitations',[]))
        if source['boneCount']!=output['boneCount']:
            raise ValueError('Final export rig bone count differs from the accepted upstream master.')
        animation=verify_exported_animation(source,output,'gltf' if fmt=='glb' else 'fbx')
        static_bone_attachments=validate_glb_bone_attachments(source,cfg['candidate'],animation) if fmt=='glb' else None
    elif profile=='editable-source':
        if report.get('format')!='blend' or source is None or source['boneCount']<=0 or output['boneCount']<=0:raise ValueError('Editable-source profile requires an authoritative rigged upstream source and actual BLEND output.')
        if source['meshes'].keys()!=output['meshes'].keys():raise ValueError('Editable BLEND changed the source mesh identity set.')
        for name,before in source['meshes'].items():
            after=output['meshes'][name]
            for key in ('geometry','uv','normals','materials','weightFingerprint'):
                if before[key]!=after[key]:raise ValueError('Editable BLEND changed source '+key+' fingerprint: '+name)
        if source['animationFingerprint']!=output['animationFingerprint']:raise ValueError('Editable BLEND changed rig rest data, animation curves, or bindings.')
        mappings=[];animation={'armatures':output['boneCount'],'sampledActions':len(output['actions']),'sampledFrames':0,'profile':'editable-source','exactSceneFingerprint':True}
    elif profile!='static-ancillary':raise ValueError('Final export profile must be rigged-unity, editable-source, or explicitly static-ancillary.')
    else: animation={'armatures':0,'sampledActions':0,'sampledFrames':0,'profile':'static-ancillary'}
    delivery_rejected=fmt=='glb' and bool(material_channel_verification and material_channel_verification.get('materialLimitations'))
    return {'format':fmt,'meshCount':len(output['meshes']),'sourceMeshCount':len(source['meshes']) if source else 0,'triangleCorrespondence':mappings if profile=='rigged-unity' else 0,'windingVerification':winding_stats if fmt=='glb' else None,'boneCount':output['boneCount'],'actionNames':[x['name'] for x in output['actions']],'animationFingerprint':output['animationFingerprint'],'profile':profile,'matchesAcceptedMaster':profile=='rigged-unity' and not materialLimitations and not delivery_rejected,'animationVerification':animation,'staticBoneAttachmentVerification':static_bone_attachments if profile=='rigged-unity' else None,'materialChannelVerification':material_channel_verification,'materialLimitations':materialLimitations,'fullMaterialEquivalence':not materialLimitations and not delivery_rejected,'deliveryDecision':'rejected-material-loss' if delivery_rejected else 'accepted' if profile=='rigged-unity' and not materialLimitations else 'limited-format' if materialLimitations else 'accepted','skinBindingVerification':skin_binding,'normalEquivalence':{'accessorBasis':'raw glTF Y-up NORMAL -> Blender source-world [x,-z,y]','accessorMaxAbsComponentTolerance':0.0001,'toleranceBasis':'uniform representation-specific Blender source transform/normalization versus FLOAT32 raw accessor; every corresponding corner must be unit length and direction checked; maximum component and angular errors are measured','accessorNormalDelta':accessor_normal_stats,'importerEvaluatedNormalDelta':imported_normal_stats,'importerEvaluatedNormalsClaimedIdentical':False} if fmt=='glb' else None,'weightEquivalence':{'sourceInfluences':'all positive influences; exact positive joint-support sets','normalizedWeightDeltaTolerance':0.000002,'exportPolicy':weight_policy} if fmt=='glb' else {'sourceInfluences':'all positive influences','normalizedWeightDeltaTolerance':0.000002}}
def progress(percent,message): print('ATELIER_PROGRESS|'+str(percent)+'|'+message,flush=True)
def peak_working_set_bytes():
    try:
        import ctypes.wintypes
        class PROCESS_MEMORY_COUNTERS(ctypes.Structure):
            _fields_=[('cb',ctypes.wintypes.DWORD),('PageFaultCount',ctypes.wintypes.DWORD),('PeakWorkingSetSize',ctypes.c_size_t),('WorkingSetSize',ctypes.c_size_t),('QuotaPeakPagedPoolUsage',ctypes.c_size_t),('QuotaPagedPoolUsage',ctypes.c_size_t),('QuotaPeakNonPagedPoolUsage',ctypes.c_size_t),('QuotaNonPagedPoolUsage',ctypes.c_size_t),('PagefileUsage',ctypes.c_size_t),('PeakPagefileUsage',ctypes.c_size_t)]
        counters=PROCESS_MEMORY_COUNTERS();counters.cb=ctypes.sizeof(counters)
        get_current_process=ctypes.windll.kernel32.GetCurrentProcess;get_current_process.restype=ctypes.wintypes.HANDLE
        get_memory_info=ctypes.windll.psapi.GetProcessMemoryInfo;get_memory_info.argtypes=[ctypes.wintypes.HANDLE,ctypes.POINTER(PROCESS_MEMORY_COUNTERS),ctypes.wintypes.DWORD];get_memory_info.restype=ctypes.wintypes.BOOL
        if get_memory_info(get_current_process(),ctypes.byref(counters),counters.cb):return int(counters.PeakWorkingSetSize)
    except Exception:pass
    return None
def main():
    run_started=time.perf_counter();phases={}
    progress(10,'Preparing isolated managed-byte validation')
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8'))
    root=os.path.realpath(cfg['root']); output_path=inside(root,cfg['outputReport']); expected=cfg['inputHash']; target=inside(root,cfg['candidate'])
    if sha_file(target)!=cfg.get('candidateModelHash',cfg['outputHash']): raise ValueError('Candidate model bytes changed after Atelier registered their immutable hash.')
    mode=cfg['mode']; report=read_report(inside(root,cfg['evidence']),cfg) if cfg.get('evidence') else {}; include_samples=mode=='assembly'; quick=mode in ('weights','rig','final-export')
    include_samples=mode in ('assembly','final-export');quick=mode in ('weights','rig')
    progress(35,'Loading and fingerprinting actual candidate bytes')
    scene_started=time.perf_counter();source_path=inside(root,cfg['source']) if cfg.get('source') else None
    animation_time_mapping='scene-relative'
    if mode=='final-export':
        fmt=report.get('format');output_rep='final-fbx-output' if fmt=='fbx' else 'final-glb-output' if fmt=='glb' else 'metadata';source_rep='final-source'
        if fmt=='glb':animation_time_mapping='gltf-absolute-frame'
    elif mode=='assembly':output_rep=source_rep='assembly'
    elif mode=='weights' and cfg.get('guidedModelAudit') is not True:output_rep=source_rep='weights'
    elif mode=='rig' and cfg.get('geometryBaseline'):
        output_rep=source_rep='returned-rig';quick=False
    elif cfg.get('guidedModelAudit') is True and mode in ('materials','weights'):
        output_rep=source_rep='assembly';quick=False
    else:output_rep=source_rep='metadata'
    if source_path and sha_file(source_path)!=sha_file(target):
        source=scene_snapshot(source_path,include_samples,quick,source_rep,animation_time_mapping=animation_time_mapping)
        frame_map={(x['object'],x['action'],x.get('slot')):{'timesSeconds':x.get('sampleTimesSeconds',[]),'timeMapping':x.get('timeMapping',animation_time_mapping)} for x in source.get('sampledAnimations',[])} if include_samples else None
        progress(52,'Accepted source fingerprinted; mapping required source clip frames onto candidate')
        snapshot_target=glb_validation_copy(target,root) if mode=='final-export' and fmt=='glb' else target
        output=scene_snapshot(snapshot_target,include_samples,quick,output_rep,frame_map,animation_time_mapping)
    else:
        output=scene_snapshot(target,include_samples,quick,output_rep)
        source=output if source_path else None
    progress(64,'Candidate scene fingerprinted; validating accepted upstream master')
    exported=scene_snapshot(inside(root,cfg['assemblyExport']),include_samples,False,'metadata') if cfg.get('assemblyExport') else None
    phases['scenesSeconds']=round(time.perf_counter()-scene_started,3)
    if exported is not None:
        joined=output['meshes'].get(next(iter(output['meshes']),''),{});raw_export=parse_glb_triangles(inside(root,cfg['assemblyExport']),joined.get('uvLayers',[]));exported['rawTriangles']=raw_export['triangles'];exported['rawMaterials']=raw_export['materials']
    progress(70,'Comparing independent stage invariants and evidence')
    if cfg.get('guidedModelAudit') is True and mode in ('materials','weights'):
        if not source_path or sha_file(source_path)!=cfg['inputHash'] or cfg['inputHash'] not in cfg.get('inputHashes',[]):
            raise ValueError('Guided model audit source is missing from the actual managed input hashes.')
        detail=validate_guided_model_health(source,output,mode)
    elif mode=='segmentation': detail=validate_segmentation(cfg,report,output)
    elif mode=='materials': detail=validate_materials(cfg,report,output)
    elif mode=='assembly': detail=validate_assembly(cfg,report,source,output,exported)
    elif mode=='rig' and cfg.get('geometryBaseline'):
        baseline_path=inside(root,cfg['geometryBaseline'])
        if sha_file(baseline_path)!=cfg.get('geometryBaselineHash') or cfg.get('geometryBaselineHash') not in cfg.get('inputHashes',[]):
            raise ValueError('Returned-rig baseline bytes do not match the declared managed input hash.')
        if not source_path or sha_file(source_path)!=cfg['inputHash'] or cfg['inputHash'] not in cfg.get('inputHashes',[]):
            raise ValueError('Authoritative returned-rig bytes do not match their declared managed hash.')
        baseline=scene_snapshot(baseline_path,False,False,'assembly')
        detail=validate_returned_rig(source,output,baseline)
    elif mode=='rig': detail=validate_rig(source,output)
    elif mode=='weights': detail=validate_weights(cfg,report,source,output)
    elif mode=='final-export': detail=validate_final(cfg,report,source,output)
    else: raise ValueError('Unknown independent workflow validation mode.')
    phases['totalSeconds']=round(time.perf_counter()-run_started,3);detail['profiling']={'validatorVersion':VALIDATOR_VERSION,'fingerprintVersion':IMAGE_FINGERPRINT_VERSION,'weightFingerprintVersion':WEIGHT_FINGERPRINT_VERSION,'phaseSeconds':phases,'candidateSnapshot':output.get('profiling'),'sourceSnapshot':source.get('profiling') if source else None,'exportSnapshot':exported.get('profiling') if exported else None,'peakWorkingSetBytes':peak_working_set_bytes()}
    accepted=detail.get('deliveryDecision')!='rejected-material-loss'
    result={'schemaVersion':1,'validatorVersion':VALIDATOR_VERSION,'fingerprintVersion':IMAGE_FINGERPRINT_VERSION,'weightFingerprintVersion':WEIGHT_FINGERPRINT_VERSION,'checkKey':cfg['checkKey'],'mode':mode,'ok':accepted,'inputHashes':cfg.get('inputHashes',[expected]),'outputHash':cfg['outputHash'],'modelHash':cfg.get('candidateModelHash',cfg['outputHash']),'autoexec':'disabled','blenderVersion':bpy.app.version_string,'details':detail}
    progress(95,'Independent checks completed; recording matching-byte report')
    with open(output_path,'w',encoding='utf8') as f: json.dump(result,f,indent=2)
if __name__=='__main__': main()













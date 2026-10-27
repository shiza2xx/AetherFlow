"""Version-pinned runtime adapter for Blender's glTF influence cutoff."""
import bpy,hashlib,inspect,os
from contextlib import contextmanager

_PRIMITIVE_SOURCE_SHA256='fa36dec52271bd7bbde8bd9e75357698e5574b5f32ab993c454f585b895a1c6e'

@contextmanager
def temporary_armature_mesh_parents_for_gltf(objects):
    """Make modifier-bound meshes discoverable to Blender's glTF skin exporter.

    Blender's glTF exporter only emits a skin when the armature is also the
    mesh's parent. A valid modifier-only Blender rig otherwise produces
    JOINTS/WEIGHTS accessors without a skin palette. These scenes are disposable
    export copies; preserve each world transform while adding the required
    temporary parent and reject ambiguous/conflicting rig relationships.
    """
    objects=list(objects)
    included=set(objects)
    prepared=[]
    scene=bpy.context.scene
    frame=(scene.frame_current,scene.frame_subframe)
    for obj in objects:
        if obj.type!='MESH':
            continue
        modifiers=[modifier for modifier in obj.modifiers if modifier.type=='ARMATURE' and modifier.object]
        if not modifiers:
            continue
        targets={modifier.object for modifier in modifiers}
        if len(targets)!=1:
            raise ValueError('GLB export requires one unambiguous armature modifier per skinned mesh.')
        armature=next(iter(targets))
        if armature.type!='ARMATURE' or armature not in included:
            raise ValueError('GLB export requires the mesh armature modifier target in the same export selection.')
        if obj.parent is armature:
            continue
        if obj.parent is not None:
            raise ValueError('GLB export cannot preserve a mesh parent that conflicts with its armature modifier target.')
        if obj.animation_data and (obj.animation_data.action or len(obj.animation_data.nla_tracks)) or len(obj.constraints):
            raise ValueError('GLB export cannot temporarily parent an independently animated or constrained mesh to its armature.')
        world=obj.matrix_world.copy()
        prepared.append((obj,obj.parent,obj.parent_type,obj.parent_bone,obj.matrix_parent_inverse.copy(),obj.matrix_basis.copy(),world))
    try:
        for obj,parent,parent_type,parent_bone,parent_inverse,basis,world in prepared:
            obj.parent=next(modifier.object for modifier in obj.modifiers if modifier.type=='ARMATURE' and modifier.object)
            obj.parent_type='OBJECT'
            obj.parent_bone=''
            obj.matrix_world=world
        bpy.context.view_layer.update()
        yield [row[0].name for row in prepared]
    finally:
        for obj,parent,parent_type,parent_bone,parent_inverse,basis,world in reversed(prepared):
            obj.parent=parent
            obj.parent_type=parent_type
            obj.parent_bone=parent_bone
            obj.matrix_parent_inverse=parent_inverse
            obj.matrix_basis=basis
            obj.matrix_world=world
        scene.frame_set(frame[0],subframe=frame[1])
        bpy.context.view_layer.update()

def install_all_positive_influence_adapter():
    if tuple(bpy.app.version)!=(5,2,2):
        raise RuntimeError('All-positive glTF skin export adapter is pinned to Blender 5.2.2; got '+bpy.app.version_string)
    from io_scene_gltf2.blender.exp.primitive_extract import PrimitiveCreator
    original=PrimitiveCreator._PrimitiveCreator__get_bone_data
    source_path=os.path.abspath(inspect.getsourcefile(original))
    digest=hashlib.sha256(open(source_path,'rb').read()).hexdigest()
    if digest!=_PRIMITIVE_SOURCE_SHA256:
        raise RuntimeError('Bundled glTF influence extractor source hash differs from the reviewed 5.2.2 implementation; refusing to patch.')
    source=inspect.getsource(original)
    if 'min_influence = 0.0001' not in source or 'self.vert_bones.append(bones)' not in source:
        raise RuntimeError('Bundled glTF influence extractor no longer matches the reviewed cutoff implementation.')

    def all_positive_influences(self):
        self.need_neutral_bone=False
        min_influence=0.0
        joint_name_to_index={joint.name:index for index,joint in enumerate(self.skin.joints)}
        group_to_joint=[joint_name_to_index.get(group.name) for group in self.blender_vertex_groups]
        self.vert_bones=[]
        max_num_influences=0
        for vertex in self.blender_mesh.vertices:
            bones=[]
            for group_element in vertex.groups:
                weight=group_element.weight
                if weight<=min_influence:continue
                try:joint=group_to_joint[group_element.group]
                except Exception:continue
                if joint is None:continue
                bones.append((joint,weight))
            bones.sort(key=lambda value:value[1],reverse=True)
            if not bones:
                bones=((len(self.skin.joints),1.0),)
                self.need_neutral_bone=True
            self.vert_bones.append(bones)
            max_num_influences=max(max_num_influences,len(bones))
        self.num_joint_sets=(max_num_influences+3)//4

    PrimitiveCreator._PrimitiveCreator__get_bone_data=all_positive_influences
    return {'adapter':'blender-gltf-all-positive-influences-v1','blenderVersion':bpy.app.version_string,'sourceModule':source_path,'sourceSHA256':digest,'stockCutoff':0.0001,'adaptedCutoff':0.0,'retainedRule':'all finite positive source group influences; zero remains omitted'}

def export_glb_preserving_all_weights(filepath,**kwargs):
    policy=install_all_positive_influence_adapter()
    bpy.ops.export_scene.gltf(filepath=filepath,export_format='GLB',export_all_influences=True,**kwargs)
    return policy

"""Create a factual starter manifest from actual managed candidate bytes; never marks a check passed."""
import bpy,sys,json,hashlib,os,importlib.util,zipfile,pathlib
HERE=os.path.dirname(os.path.abspath(__file__));sys.path.insert(0,HERE)
spec=importlib.util.spec_from_file_location('atelier_validate',os.path.join(HERE,'validate_workflow.py')); validator=importlib.util.module_from_spec(spec);spec.loader.exec_module(validator)
def main():
    cfg=json.load(open(sys.argv[sys.argv.index('--')+1],encoding='utf8')); mode=cfg['mode']; candidate=os.path.abspath(cfg['candidate']); output_hash=validator.sha_file(candidate)
    representation='metadata' if mode=='segmentation' else 'full'
    scene=validator.scene_snapshot(candidate,quick=mode in ('weights','rig','final-export'),representation=representation); manifest={'schemaVersion':1,'mode':mode,'inputHashes':[cfg['inputHash']],'outputHash':output_hash}
    if mode=='segmentation':
        manifest['outputTopologyFingerprint']=validator.digest(json.dumps(scene['meshes'],sort_keys=True,separators=(',',':')).encode());manifest['segments']=[{'name':name,'meshName':name,'faceIndices':list(range(row['polygons']))} for name,row in scene['meshes'].items()]
    elif mode=='assembly':
        source=validator.scene_snapshot(os.path.abspath(cfg['source']));manifest['objectMappings']=[{'sourceObject':name,'outputObject':name,'sourceFingerprint':row['geometry'],'outputFingerprint':scene['meshes'][name]['geometry']} for name,row in source['meshes'].items() if name in scene['meshes']]
    elif mode=='weights':
        source=scene if cfg['inputHash']==output_hash else validator.scene_snapshot(os.path.abspath(cfg['source']),quick=True);manifest['editedVertices']={name:[] for name in source['meshes']}
    elif mode=='materials':
        manifest['uvSnapshots']=[{'mesh':row['name'],'fingerprint':row['uv']} for row in scene['meshes'].values()]
        package=os.path.abspath(cfg['package']);manifest['inputHashes'].append(validator.sha_file(package));manifest['channels']={}
        entries={}
        with zipfile.ZipFile(package) as archive:
            for name in archive.namelist():
                if name.endswith('/'): continue
                entries[name]=archive.read(name)
                base=pathlib.Path(name).stem.lower()
                for channel in ('albedo','normal','roughness','metallic'):
                    if base==channel and channel not in manifest['channels']:manifest['channels'][channel]={'logicalPath':name,'sha256':hashlib.sha256(archive.read(name)).hexdigest()}
        if set(manifest['channels'])!={'albedo','normal','roughness','metallic'}:raise ValueError('PBR ZIP must contain albedo, normal, roughness and metallic images.')
        bindings=[];required=('albedo','normal','roughness','metallic')
        for obj in [o for o in bpy.context.scene.objects if o.type=='MESH']:
            assigned=sorted({obj.data.materials[p.material_index] for p in obj.data.polygons if p.material_index<len(obj.data.materials) and obj.data.materials[p.material_index]},key=lambda x:x.name)
            for material in assigned:
                if not material.use_nodes:raise ValueError('PBR materialized model requires node materials.')
                principled=next((n for n in material.node_tree.nodes if n.bl_idname=='ShaderNodeBsdfPrincipled'),None)
                if not principled:raise ValueError('PBR materialized model requires Principled BSDF.')
                channels={}
                for channel in required:
                    destination={'albedo':'Base Color','roughness':'Roughness','metallic':'Metallic'}.get(channel)
                    target=next((link.from_node for link in material.node_tree.links if destination and link.to_node==principled and link.to_socket.name==destination),None)
                    component=None
                    if channel in ('roughness','metallic') and target and target.bl_idname=='ShaderNodeSeparateColor':
                        component=next((link.from_socket.name for link in material.node_tree.links if link.from_node==target and link.to_node==principled and link.to_socket.name==destination),None)
                        target=next((link.from_node for link in material.node_tree.links if link.to_node==target and link.to_socket.name=='Color'),None)
                    if channel=='normal':
                        normal=next((n for n in material.node_tree.nodes if n.bl_idname=='ShaderNodeNormalMap' and any(l.from_node==n and l.to_node==principled and l.to_socket.name=='Normal' for l in material.node_tree.links)),None)
                        target=next((l.from_node for l in material.node_tree.links if normal and l.to_node==normal and l.to_socket.name=='Color'),None)
                    if not target or target.bl_idname!='ShaderNodeTexImage' or not target.image:raise ValueError('Cannot seed binding for unconnected PBR channel '+channel)
                    image=target.image; logical=next((n for n in entries if pathlib.Path(n).stem.lower()==channel),None)
                    if not logical:raise ValueError('PBR channel archive entry is missing: '+channel)
                    # The seeder declares the candidate's actual image node; the independent gate decodes and compares bytes.
                    channels[channel]={'logicalPath':logical,'sha256':hashlib.sha256(entries[logical]).hexdigest(),'imageNode':target.name,'colorspace':image.colorspace_settings.name,**({'component':component} if component else {})}
                bindings.append({'mesh':obj.name,'material':material.name,'uvLayer':obj.data.uv_layers.active.name if obj.data.uv_layers.active else None,'channels':channels})
        manifest['bindings']=bindings
    else: raise ValueError('Evidence seeding supports segmentation, assembly, materials and weights.')
    with open(cfg['output'],'w',encoding='utf8') as f: json.dump(manifest,f,indent=2)
if __name__=='__main__': main()

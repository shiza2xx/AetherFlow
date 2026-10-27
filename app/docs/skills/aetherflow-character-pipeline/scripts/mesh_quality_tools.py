"""Explicit, read-only Blender mesh observations and disposable weight normalization.

Commands run in a separate background Blender process. ``compare`` is standard
Python and compares only the fields named in the snapshot contract. Nothing in
this module opens a file or mutates a scene at import time.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import shutil
import sys
import tempfile

SNAPSHOT_SCHEMA = "atelier.mesh-quality.snapshot.v1"
REPORT_SCHEMA = "atelier.mesh-quality.report.v1"
UNVERIFIED = [
    "armature rest/pose matrices and parent transforms",
    "drivers, constraints, Geometry Nodes and modifier configuration",
    "material nodes, texture image content and external dependencies",
    "non-deform/mask groups, vertex-group locks and shape playback settings in snapshots",
    "evaluated geometry, animation, contacts and appearance",
    "exported files and behavior in the target application",
]

def _bpy():
    try:
        import bpy
    except ImportError as error:
        raise RuntimeError("This command needs Blender Python; compare also works in ordinary Python") from error
    return bpy

def _meshes(objects):
    result=list(objects)
    if not result: raise ValueError("Choose at least one explicit mesh")
    names=set()
    for obj in result:
        if obj is None or getattr(obj,"type",None)!="MESH": raise ValueError("Every target must be a mesh")
        if getattr(obj,"mode",None)!="OBJECT": raise ValueError("Targets must be in Object Mode")
        if obj.name in names: raise ValueError("Duplicate target: "+obj.name)
        names.add(obj.name)
    return sorted(result,key=lambda item:item.name)

def _deform_names(rig):
    if rig is None:return None
    if getattr(rig,"type",None)!="ARMATURE":raise ValueError("The explicit rig must be an armature")
    return {bone.name for bone in rig.data.bones if bone.use_deform}

def _coords(points): return [tuple(float(v) for v in point.co) for point in points]
def _finite(values): return all(math.isfinite(v) for v in values)
def _stable(value):
    if isinstance(value,float) and not math.isfinite(value):return {"nonfinite":"NaN" if math.isnan(value) else "+Infinity" if value>0 else "-Infinity"}
    if isinstance(value,dict):return {str(k):_stable(v) for k,v in value.items()}
    if isinstance(value,(list,tuple)):return [_stable(v) for v in value]
    return value
def _digest(value):return hashlib.sha256(json.dumps(_stable(value),sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()).hexdigest()
def _file_hash(path):
    digest=hashlib.sha256()
    with Path(path).open("rb") as source:
        for block in iter(lambda:source.read(1024*1024),b""):digest.update(block)
    return digest.hexdigest()
def _component(value,count):return {"count":count,"sha256":_digest(value)}
def _area(a,b,c):
    ab=[b[i]-a[i] for i in range(3)];ac=[c[i]-a[i] for i in range(3)]
    cross=(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0])
    return math.sqrt(sum(x*x for x in cross))*0.5
def _weights(obj,names):
    group_names={g.index:g.name for g in obj.vertex_groups}
    return [sorted((group_names[e.group],float(e.weight)) for e in vertex.groups if group_names.get(e.group) in names) for vertex in obj.data.vertices]
def _audit_weights(obj,names,tolerance,limit):
    if names is None:return {"status":"not_verified","reason":"No explicit rig was supplied"}
    bad={k:[] for k in ("unweighted","invalid_values","not_normalized","over_limit")};max_error=0.0;max_count=0
    for index,row in enumerate(_weights(obj,names)):
        values=[v for _,v in row]
        if any(not math.isfinite(v) or v<0 or v>1 for v in values):bad["invalid_values"].append(index);continue
        positive=[v for v in values if v>0];count=len(positive);max_count=max(max_count,count);error=abs(sum(positive)-1);max_error=max(max_error,error)
        if not positive:bad["unweighted"].append(index)
        elif error>tolerance:bad["not_normalized"].append(index)
        if count>limit:bad["over_limit"].append(index)
    return {"status":"inspected","deform_bones_only":True,"counts":{k:len(v) for k,v in bad.items()},"indices":bad,"max_sum_error":max_error,"max_influences_observed":max_count,"requested_influence_limit":limit,"sum_tolerance":tolerance}

def audit_meshes(objects,armature=None,*,area_epsilon=1e-12,uv_epsilon=1e-12,weight_tolerance=1e-4,max_influences=4):
    meshes=_meshes(objects);bones=_deform_names(armature)
    for value,label in ((area_epsilon,"area_epsilon"),(uv_epsilon,"uv_epsilon"),(weight_tolerance,"weight_tolerance")):
        if not isinstance(value,(int,float)) or not math.isfinite(value) or value<0:raise ValueError(label+" must be finite and nonnegative")
    if isinstance(max_influences,bool) or not isinstance(max_influences,int) or max_influences<1:raise ValueError("max_influences must be a positive integer")
    out={}
    for obj in meshes:
        mesh=obj.data;points=_coords(mesh.vertices);nonfinite=[i for i,p in enumerate(points) if not _finite(p)];edge_uses={};seen=set();duplicate=[]
        for face in mesh.polygons:
            ids=tuple(face.vertices);key=tuple(sorted(ids))
            if key in seen:duplicate.append(face.index)
            seen.add(key)
            for a,b in zip(ids,ids[1:]+ids[:1]):edge=tuple(sorted((a,b)));edge_uses[edge]=edge_uses.get(edge,0)+1
        mesh.calc_loop_triangles();triangles=list(mesh.loop_triangles);degenerate=[]
        for tri in triangles:
            tri_points=[points[i] for i in tri.vertices]
            if all(_finite(p) for p in tri_points) and _area(*tri_points)<=area_epsilon:degenerate.append(tri.index)
        uv_report={}
        for layer in mesh.uv_layers:
            coords=[tuple(float(v) for v in item.uv) for item in layer.data]
            invalid=[i for i,p in enumerate(coords) if not _finite(p)];outside=[i for i,p in enumerate(coords) if _finite(p) and any(v<0 or v>1 for v in p)];collapsed=[]
            for tri in triangles:
                a,b,c=(coords[i] for i in tri.loops)
                if all(_finite(p) for p in (a,b,c)) and abs((b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]))*.5<=uv_epsilon:collapsed.append(tri.index)
            uv_report[layer.name]={"loops":len(coords),"nonfinite_loops":invalid,"outside_0_1_loops":outside,"degenerate_triangles":collapsed}
        shape=[];keys=mesh.shape_keys
        if keys:
            blocks=list(keys.key_blocks)
            for key in blocks:
                values=_coords(key.data);reference=key.relative_key;valid=reference is not None and any(reference==item for item in blocks);base=_coords(reference.data) if valid else [];valid_counts=len(values)==len(points)==len(base);invalid=[i for i,p in enumerate(values) if not _finite(p)];changes=maximum=None
                if valid_counts and not invalid and all(_finite(p) for p in base):
                    deltas=[math.dist(p,q) for p,q in zip(values,base)];changes=sum(delta>1e-7 for delta in deltas);maximum=max(deltas,default=0.0)
                shape.append({"name":key.name,"is_basis":key==blocks[0],"vertices":len(values),"vertex_count_matches":len(values)==len(points),"relative_key":reference.name if valid else None,"relative_key_valid":valid,"nonfinite_vertices":invalid,"changed_vertices":changes,"max_relative_delta":maximum,"empty_relative_key":changes==0 if changes is not None and key!=blocks[0] and keys.use_relative else None})
        out[obj.name]={"geometry":{"vertices":len(points),"edges":len(mesh.edges),"faces":len(mesh.polygons),"triangles":len(triangles),"nonfinite_vertices":nonfinite,"degenerate_triangles":degenerate,"duplicate_index_faces":duplicate,"boundary_edges":sum(v==1 for v in edge_uses.values()),"branch_edges":sum(v>2 for v in edge_uses.values()),"wire_edges":sum(tuple(sorted(e.vertices)) not in edge_uses for e in mesh.edges)},"uv_missing":not bool(mesh.uv_layers),"uv_layers":uv_report,"weights":_audit_weights(obj,bones,weight_tolerance,max_influences),"shape_keys":shape,"shape_key_mode":"RELATIVE" if keys and keys.use_relative else "ABSOLUTE" if keys else None}
    return {"schema":REPORT_SCHEMA,"command":"audit","status":"inspected","meshes":out,"rig":armature.name if armature else None,"tolerances":{"triangle_area_local_units_squared":area_epsilon,"uv_triangle_area":uv_epsilon},"notes":["Base meshes only; no automatic appearance grade.","Boundary edges, UV ranges/repeats and empty keys can be intentional.","Degenerate areas use local object coordinates; object scale is not applied.","Duplicate faces mean the same vertex IDs, not spatially coincident separate vertices."],"unverified":list(UNVERIFIED)}

def snapshot_meshes(objects,armature=None,*,source_path=None):
    meshes=_meshes(objects);bones=_deform_names(armature);source_path=source_path or _bpy().data.filepath
    if not source_path or not Path(source_path).is_file():raise ValueError("Snapshot needs an existing source blend for its input SHA")
    result={}
    for obj in meshes:
        mesh=obj.data;points=_coords(mesh.vertices);fields={"coordinates":_component(points,len(points)),"topology":_component({"vertices":len(points),"edges":[tuple(e.vertices) for e in mesh.edges],"faces":[tuple(f.vertices) for f in mesh.polygons]},len(mesh.polygons)),"uv":{layer.name:_component([tuple(float(v) for v in p.uv) for p in layer.data],len(layer.data)) for layer in mesh.uv_layers},"weights":{"status":"not_verified","reason":"No explicit rig was supplied"},"shape_keys":{},"material_slots":_component({"slots":[(slot.material.name if slot.material else None,slot.link) for slot in obj.material_slots],"polygon_material_indices":[p.material_index for p in mesh.polygons]},len(obj.material_slots))}
        if bones is not None:fields["weights"]={"status":"captured","deform_bones":sorted(bones),**_component(_weights(obj,bones),len(points))}
        if mesh.shape_keys:
            if not mesh.shape_keys.use_relative:raise ValueError("Absolute shape key playback is not supported by this snapshot: "+obj.name)
            blocks=list(mesh.shape_keys.key_blocks)
            for key in blocks:
                values=_coords(key.data);ref=key.relative_key
                if ref is None or not any(ref==item for item in blocks):raise ValueError("Shape key reference is invalid: "+obj.name+"/"+key.name)
                base=_coords(ref.data)
                if len(values)!=len(points) or len(base)!=len(values):raise ValueError("Shape key count/reference mismatch: "+obj.name+"/"+key.name)
                delta=[tuple(v-b for v,b in zip(p,q)) for p,q in zip(values,base)];fields["shape_keys"][key.name]={"relative_key":ref.name,"is_basis":key==blocks[0],**_component({"coordinates":values,"relative_deltas":delta},len(values))}
        result[obj.name]=fields
    return {"schema":SNAPSHOT_SCHEMA,"source":{"name":Path(source_path).name,"sha256":_file_hash(source_path)},"rig":armature.name if armature else None,"meshes":result,"comparison":"Exact captured content, local coordinates and indexed connectivity; no rounding or name normalization.","notes":["Source SHA identifies the input file, not proof that current in-memory data was saved to it.","Material slots capture names/order/link mode and polygon assignments, not nodes or image content.","Shape hashes include key coordinates and deltas against their declared relative key, including Basis coordinates.","Shape values, mute flags and playback settings are not captured; absolute keys are refused.","Mesh names, vertex order, face order and group names remain significant."],"unverified":list(UNVERIFIED)}

def _validate_snapshot(value):
    sha=lambda x:isinstance(x,str) and len(x)==64 and all(c in "0123456789abcdefABCDEF" for c in x)
    if not isinstance(value,dict) or value.get("schema")!=SNAPSHOT_SCHEMA or not isinstance(value.get("meshes"),dict) or not value["meshes"]:raise ValueError("Expected a nonempty "+SNAPSHOT_SCHEMA)
    if not isinstance(value.get("source"),dict) or not sha(value["source"].get("sha256")) or not isinstance(value["source"].get("name"),str):raise ValueError("Snapshot source SHA is missing")
    required={"coordinates","topology","uv","weights","shape_keys","material_slots"}
    def component(row,extra=()):return isinstance(row,dict) and set(row)==({"count","sha256"}|set(extra)) and isinstance(row.get("count"),int) and not isinstance(row.get("count"),bool) and row["count"]>=0 and sha(row.get("sha256"))
    for name,fields in value["meshes"].items():
        if not isinstance(name,str) or not isinstance(fields,dict) or set(fields)!=required:raise ValueError("Unexpected or missing snapshot fields")
        for key in ("coordinates","topology","material_slots"):
            if not component(fields[key]):raise ValueError("Invalid snapshot component: "+key)
        if not isinstance(fields["uv"],dict) or not isinstance(fields["shape_keys"],dict) or not isinstance(fields["weights"],dict):raise ValueError("Invalid snapshot collection")
        if any(not isinstance(k,str) or not component(v) for k,v in fields["uv"].items()):raise ValueError("Invalid UV snapshot component")
        for key,row in fields["shape_keys"].items():
            if not isinstance(key,str) or not component(row,("relative_key","is_basis")) or not isinstance(row["relative_key"],str) or not isinstance(row["is_basis"],bool) or row["count"]!=fields["coordinates"]["count"]:raise ValueError("Invalid shape key snapshot component")
        weights=fields["weights"]
        if weights.get("status")=="captured":
            if not component(weights,("status","deform_bones")) or not isinstance(weights["deform_bones"],list) or weights["deform_bones"]!=sorted(set(weights["deform_bones"])) or not all(isinstance(x,str) for x in weights["deform_bones"]) or weights["count"]!=fields["coordinates"]["count"]:raise ValueError("Invalid deform weight snapshot component")
        elif weights.get("status")!="not_verified" or set(weights)!={"status","reason"} or not isinstance(weights["reason"],str):raise ValueError("Invalid unverified weight snapshot component")

def compare_snapshots(left,right):
    _validate_snapshot(left);_validate_snapshot(right);before,after=left["meshes"],right["meshes"];differences=[]
    for name in sorted(set(before)|set(after)):
        if name not in before or name not in after:differences.append({"mesh":name,"field":"target","change":"added" if name in after else "removed"});continue
        for field in sorted(before[name]):
            if before[name][field]!=after[name][field]:differences.append({"mesh":name,"field":field,"before":before[name][field],"after":after[name][field]})
    if left.get("rig")!=right.get("rig"):differences.append({"mesh":None,"field":"explicit_rig","before":left.get("rig"),"after":right.get("rig")})
    unknown=list(UNVERIFIED)
    if any(f["weights"].get("status")!="captured" for snap in (left,right) for f in snap["meshes"].values()):unknown.append("deform weights on meshes without an explicit rig")
    return {"schema":REPORT_SCHEMA,"command":"compare","status":"different" if differences else "equal_captured_fields","equal":not differences,"differences":differences,"sources":[left["source"],right["source"]],"unverified":unknown,"notes":["Equal means only captured fields; not all Blender data or visual equivalence.","Different input file SHA alone is not a mesh content difference."]}

def normalize_weights_copy(objects,armature,*,weight_tolerance=1e-4):
    meshes=_meshes(objects)
    if armature is None:raise ValueError("Normalization requires an explicit rig")
    bones=_deform_names(armature)
    if not math.isfinite(weight_tolerance) or weight_tolerance<=0:raise ValueError("weight_tolerance must be finite and positive")
    bpy=_bpy();plans=[];unresolved=[]
    for obj in meshes:
        if not obj.is_editable or obj.library or obj.data.library:raise ValueError("Normalization requires a local editable mesh: "+obj.name)
        rigs={m.object for m in obj.modifiers if m.type=="ARMATURE" and m.object}
        if rigs!={armature}:raise ValueError("Target must use exactly the explicit armature: "+obj.name)
        groups={g.index:g for g in obj.vertex_groups if g.name in bones};plan=[]
        for vertex in obj.data.vertices:
            entries=[(e.group,float(e.weight)) for e in vertex.groups if e.group in groups];reason=None
            if any(not math.isfinite(v) or v<0 or v>1 for _,v in entries):reason="invalid_deform_weight"
            elif sum(v for _,v in entries)<=0:reason="unweighted"
            locked=[(i,v) for i,v in entries if groups[i].lock_weight];free=[(i,v) for i,v in entries if not groups[i].lock_weight and v>0];locked_sum=sum(v for _,v in locked);total=sum(v for _,v in free)
            if reason is None and locked_sum>1+1e-7:reason="locked_sum_exceeds_one"
            budget=max(0,1-locked_sum) if math.isfinite(locked_sum) else 0
            if reason is None and total==0 and budget>1e-7:reason="locked_weights_leave_unfillable_budget"
            if reason:unresolved.append({"object":obj.name,"vertex":vertex.index,"reason":reason})
            plan.append([(i,budget*v/total) for i,v in free] if total>0 else [])
        plans.append((obj,plan))
    report={"schema":REPORT_SCHEMA,"command":"normalize-copy","status":"unresolved" if unresolved else "candidate","unresolved":unresolved,"copies":[],"sum_tolerance":weight_tolerance,"notes":["Only unlocked deform weights are normalized; masks and locked entries are retained.","No influence reduction, nearest-surface transfer or fallback assignment.","Source objects and candidates both remain at their original positions/visibility; isolate the named candidate for comparison.","Normalization is structural; motion and appearance need separate review."],"unverified":list(UNVERIFIED)}
    if unresolved:return [],report
    copies=[]
    try:
        for source,plan in plans:
            candidate=source.copy();candidate.data=source.data.copy();candidate.name=source.name+"_NormalizedCandidate";(source.users_collection[0] if source.users_collection else bpy.context.collection).objects.link(candidate);copies.append(candidate)
            for vertex,entries in zip(candidate.data.vertices,plan):
                for index,value in entries:candidate.vertex_groups[index].add([vertex.index],value,"REPLACE")
            checked=_audit_weights(candidate,bones,weight_tolerance,2**31-1)
            if any(checked["counts"][key] for key in ("unweighted","invalid_values","not_normalized")):raise RuntimeError("Normalized candidate failed weight verification")
            report["copies"].append({"source":source.name,"candidate":candidate.name,"weights":checked})
    except Exception:
        for candidate in copies:
            data=candidate.data;bpy.data.objects.remove(candidate,do_unlink=True)
            if data.users==0:bpy.data.meshes.remove(data)
        raise
    return copies,report

def _new_output(path):
    path=Path(path).expanduser()
    if path.exists() or path.is_symlink():raise ValueError("Refusing to overwrite an existing output: "+path.name)
    path=path.resolve()
    if not path.parent.is_dir():raise ValueError("Output parent directory must already exist")
    return path

def _write_report(path,report):
    with Path(path).open("x",encoding="utf-8",newline="\n") as stream:json.dump(_stable(report),stream,indent=2,ensure_ascii=False,allow_nan=False);stream.write("\n")
def _save_candidate(path):
    bpy=_bpy();fd,temp=tempfile.mkstemp(prefix=".atelier-mesh-quality-",suffix=".blend",dir=path.parent);os.close(fd);Path(temp).unlink()
    try:
        result=bpy.ops.wm.save_as_mainfile(filepath=str(temp),check_existing=False,copy=True)
        if result!={"FINISHED"} or not Path(temp).is_file():raise RuntimeError("Blender did not save a candidate")
        with open(temp,"rb") as source,Path(path).open("xb") as target:shutil.copyfileobj(source,target)
    finally:
        if Path(temp).exists():Path(temp).unlink()

def _parser():
    parser=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter);commands=parser.add_subparsers(dest="command",required=True)
    for command in ("audit","snapshot","normalize-copy"):
        sub=commands.add_parser(command);sub.add_argument("--input",required=True,type=Path);sub.add_argument("--objects",nargs="+",required=True);sub.add_argument("--rig",required=command=="normalize-copy");sub.add_argument("--report",required=True,type=Path)
        if command=="normalize-copy":sub.add_argument("--output-blend",required=True,type=Path)
        if command=="audit":sub.add_argument("--max-influences",type=int,default=4)
    sub=commands.add_parser("compare");sub.add_argument("--left",required=True,type=Path);sub.add_argument("--right",required=True,type=Path);sub.add_argument("--report",required=True,type=Path);return parser

def main(argv=None):
    if argv is None:argv=sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else sys.argv[1:]
    args=_parser().parse_args(argv);report_path=None
    try:
        report_path=_new_output(args.report)
        if args.command=="compare":
            if any(report_path==p.resolve() for p in (args.left,args.right)):raise ValueError("Report must differ from input snapshots")
            report=compare_snapshots(json.loads(args.left.read_text(encoding="utf-8")),json.loads(args.right.read_text(encoding="utf-8")));code=0 if report["equal"] else 2
        else:
            source=args.input.expanduser().resolve()
            if not source.is_file() or source.suffix.lower()!=".blend":raise ValueError("Input must be an existing .blend file")
            if source==report_path:raise ValueError("Report must differ from input")
            output=None
            if args.command=="normalize-copy":
                output=_new_output(args.output_blend)
                if output in (source,report_path) or output.suffix.lower()!=".blend":raise ValueError("Candidate must be a distinct new .blend path")
            before=_file_hash(source);bpy=_bpy()
            if not bpy.app.background:raise ValueError("Run the CLI in a separate Blender background process; use API functions in an interactive session")
            bpy.ops.wm.open_mainfile(filepath=str(source),load_ui=False,use_scripts=False);objects=[]
            for name in args.objects:
                obj=bpy.context.scene.objects.get(name)
                if obj is None:raise ValueError("Target mesh not found: "+name)
                objects.append(obj)
            rig=bpy.context.scene.objects.get(args.rig) if args.rig else None
            if args.rig and rig is None:raise ValueError("Explicit rig not found: "+args.rig)
            if args.command=="audit":report=audit_meshes(objects,rig,max_influences=args.max_influences);code=0
            elif args.command=="snapshot":report=snapshot_meshes(objects,rig,source_path=source);code=0
            else:
                _,report=normalize_weights_copy(objects,rig);code=2 if report["unresolved"] else 0
                if code==0:_save_candidate(output);report["output"]={"name":output.name,"sha256":_file_hash(output)}
            after=_file_hash(source)
            if before!=after:raise RuntimeError("Input SHA changed during command")
            report["input"]={"name":source.name,"sha256":before,"unchanged_after_command":True}
        _write_report(report_path,report);print(json.dumps({"command":args.command,"status":report.get("status","captured"),"report":report_path.name,"exit_code":code},ensure_ascii=False));return code
    except Exception as error:
        value={"schema":REPORT_SCHEMA,"command":args.command,"status":"error","error_type":type(error).__name__,"message":str(error)}
        if report_path is not None and not report_path.exists():
            try:_write_report(report_path,value)
            except OSError:pass
        print(json.dumps(value,ensure_ascii=False),file=sys.stderr);return 1
if __name__=="__main__":raise SystemExit(main())

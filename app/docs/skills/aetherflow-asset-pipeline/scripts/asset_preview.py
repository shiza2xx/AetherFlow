"""Build a source-bound, bounded asset preview through the checked importer."""
import bpy, sys, json
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
from asset_safe_import import safe_import
from asset_preview_support import build_preview

cfg=json.loads(Path(sys.argv[sys.argv.index('--')+1]).read_text(encoding='utf8'))
source=Path(cfg['source']).resolve();output=Path(cfg['output']).resolve();report=Path(cfg['report']).resolve()
if report.exists():raise ValueError('Preview report already exists.')
if source.suffix.lower()=='.blend':
    with bpy.data.libraries.load(str(source),link=False) as (meta,_):
        if not hasattr(meta,'libraries') or meta.libraries:raise ValueError('Linked Blender libraries are not supported in an asset preview.')
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
objects,meshes,_=safe_import(source,cfg,report.parent)
result=build_preview(objects,meshes,cfg,source,output,cfg['scratchRoot'])
report.write_text(json.dumps(result,sort_keys=True),encoding='utf8')

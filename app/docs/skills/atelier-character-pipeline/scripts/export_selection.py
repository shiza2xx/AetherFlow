"""Source-object selection policy for the managed Blender exporter."""

STARTUP_OBJECTS = {'Cube', 'Camera', 'Light'}


def exportable_objects(objects, exclude_startup=False):
    return [
        obj for obj in objects
        if obj.type in ('MESH', 'ARMATURE')
        and (not exclude_startup or obj.name not in STARTUP_OBJECTS)
    ]

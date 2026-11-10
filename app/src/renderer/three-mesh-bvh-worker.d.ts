declare module 'three-mesh-bvh/src/workers/GenerateMeshBVHWorker.js' {
  import type {BufferGeometry} from 'three';
  import type {MeshBVH, MeshBVHOptions} from 'three-mesh-bvh';

  export type GenerateMeshBVHWorkerOptions = MeshBVHOptions & {
    indirect?: boolean;
  };

  export class GenerateMeshBVHWorker {
    readonly name: string;
    running: boolean;
    worker: Worker | null;
    runTask(worker: Worker, geometry: BufferGeometry, options?: GenerateMeshBVHWorkerOptions): Promise<MeshBVH>;
    generate(geometry: BufferGeometry, options?: GenerateMeshBVHWorkerOptions): Promise<MeshBVH>;
    dispose(): void;
  }
}

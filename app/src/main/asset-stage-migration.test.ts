import { afterEach, describe, expect, it } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { AtelierStore } from './store';
import { AssetProductionService } from './asset-production';
import { createMcpServer } from './mcp';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe('persisted five-stage asset migration', () => {
  it('keeps the old MCP navigation value as an input alias and sends current geometry to the renderer', async () => {
    const evidence = path.resolve('evidence/assets-five-stage-20261108/test-workspaces');
    fs.mkdirSync(evidence, { recursive: true });
    const root = fs.mkdtempSync(path.join(evidence, 'legacy-mcp-stage-'));
    roots.push(root);
    const store = new AtelierStore(root, path.join(root, 'key'));
    let navigated: any;
    const callbacks = { uiContext: () => ({}), uiNavigate: async (request: any) => { navigated = request; return { ok: true }; } };
    const server = createMcpServer(store, value => value, () => null, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, callbacks as any);
    const client = new Client({ name: 'asset-five-stage-compat-test', version: '1' }), [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const listing = await client.listTools(), navigate = listing.tools.find(tool => tool.name === 'ui_navigate');
      expect(navigate).toBeTruthy();
      expect(JSON.stringify(navigate?.inputSchema)).toContain('materials');
      expect(JSON.stringify(navigate?.inputSchema)).toContain('assembly');
      const surface = listing.tools.find(tool => tool.name === 'asset_job_surface_run'), surfaceSchema = surface?.inputSchema as any;
      expect(surfaceSchema?.properties?.id).toBeTruthy();
      expect(surfaceSchema?.properties?.expectedRevision).toBeTruthy();
      expect(surfaceSchema?.properties?.mode?.enum).toEqual(['inventory', 'partition', 'guide', 'inspect', 'foliage', 'crop', 'normalize', 'sheet', 'assemble']);
      expect(surfaceSchema?.required).toEqual(expect.arrayContaining(['id', 'expectedRevision', 'mode']));
      const response = await client.callTool({ name: 'ui_navigate', arguments: { screen: 'Assets', stage: 'materials' } });
      expect(response.isError).toBeFalsy();
      expect(navigated.stage).toBe('geometry');
      const create = await client.callTool({ name: 'asset_job_create', arguments: { name: 'Legacy caller', mode: 'prop-set', target: 'One model' } });
      expect(create.isError).toBeFalsy();
      const made = JSON.parse((create.content as any)[0].text).data;
      const update = await client.callTool({ name: 'asset_job_update', arguments: { id: made.job.id, expectedRevision: made.job.revision, stage: 'materials' } });
      expect(update.isError).toBeFalsy();
      const read = await client.callTool({ name: 'asset_job_get', arguments: { id: made.job.id } });
      expect(read.isError).toBeFalsy();
      const current = JSON.parse((read.content as any)[0].text).data;
      expect(current.job.data.stage).toBe('geometry');
      expect(current.stages.map((entry: any) => entry.stage)).toEqual(['source', 'composition', 'images', 'geometry', 'assembly']);
    } finally {
      await client.close();
      await server.close();
      store.db.close();
    }
  });

  it('writes five-stage navigation on the next ordinary save without changing material review history', () => {
    const evidence = path.resolve('evidence/assets-five-stage-20261108/test-workspaces');
    fs.mkdirSync(evidence, { recursive: true });
    const root = fs.mkdtempSync(path.join(evidence, 'legacy-stage-save-'));
    roots.push(root);
    const store = new AtelierStore(root, path.join(root, 'key'));
    try {
      const service = new AssetProductionService(store), created = service.create({ name: 'Legacy material job', mode: 'prop-set', target: 'A single textured prop' });
      const itemId = crypto.randomUUID(), artifactId = crypto.randomUUID(), candidateId = crypto.randomUUID(), pendingCandidateId = crypto.randomUUID(), rejectedCandidateId = crypto.randomUUID(), guideCandidateId = crypto.randomUUID();
      const materialSlotDraft = { itemId, role: 'material', candidates: [
        { id: candidateId, artifactId, hash: 'a'.repeat(64), submittedAt: '2026-11-01T00:00:00.000Z', submittedBy: 'mcp', status: 'accepted', reviewedAt: '2026-11-01T00:01:00.000Z', reviewedBy: 'human', warnings: [] },
        { id: pendingCandidateId, artifactId, hash: 'b'.repeat(64), submittedAt: '2026-11-01T00:02:00.000Z', submittedBy: 'mcp', status: 'pending', warnings: [] },
        { id: rejectedCandidateId, artifactId, hash: 'c'.repeat(64), submittedAt: '2026-11-01T00:03:00.000Z', submittedBy: 'ui', status: 'rejected', reviewedAt: '2026-11-01T00:04:00.000Z', reviewedBy: 'human', warnings: ['kept rejection'] },
      ], acceptedCandidateId: candidateId };
      const guideSlot = { itemId, role: 'guide:front', candidates: [{ id: guideCandidateId, artifactId, hash: 'd'.repeat(64), submittedAt: '2026-11-01T00:05:00.000Z', submittedBy: 'mcp', status: 'pending', warnings: [] }] };
      const legacyWorkflow = {
        ...created.workflow.data,
        stages: ['source', 'composition', 'images', 'geometry', 'materials', 'assembly'],
        slots: [materialSlotDraft, guideSlot],
      };
      store.db.prepare('UPDATE entities SET data=?, revision=revision+1 WHERE id=?').run(JSON.stringify(legacyWorkflow), created.workflow.id);
      const legacyJob = { ...created.job.data, stage: 'materials' };
      store.db.prepare('UPDATE entities SET data=?, revision=revision+1 WHERE id=?').run(JSON.stringify(legacyJob), created.job.id);
      const beforeWorkflow = store.get('workflow', created.workflow.id)!, beforeJob = store.get('assetJob', created.job.id)!;
      const savedJob = service.update({ id: created.job.id, expectedRevision: beforeJob.revision, target: 'A single textured prop, refined' });
      const savedWorkflow = store.get('workflow', created.workflow.id)!, savedMaterialSlot = savedWorkflow.data.slots[0];

      expect(savedJob.data.stage).toBe('geometry');
      expect(savedWorkflow.data.stages).toEqual(['source', 'composition', 'images', 'geometry', 'assembly']);
      expect(savedWorkflow.revision).toBe(beforeWorkflow.revision + 1);
      expect(savedWorkflow.data.slots).toEqual(beforeWorkflow.data.slots);
      expect(savedMaterialSlot.candidates.map((candidate: any) => candidate.id)).toEqual([candidateId, pendingCandidateId, rejectedCandidateId]);
      expect(savedMaterialSlot.candidates).toEqual(beforeWorkflow.data.slots[0].candidates);
      expect(savedWorkflow.data.slots[1]).toEqual(guideSlot);
      expect(savedMaterialSlot.candidates).toContainEqual(expect.objectContaining({ id: candidateId, artifactId, status: 'accepted', reviewedBy: 'human' }));
      expect(savedMaterialSlot.candidates).toContainEqual(expect.objectContaining({ id: pendingCandidateId, artifactId, status: 'pending' }));
      expect(savedMaterialSlot.candidates).toContainEqual(expect.objectContaining({ id: rejectedCandidateId, artifactId, status: 'rejected', reviewedBy: 'human' }));
      expect(service.get(created.job.id).current).toEqual([]);
    } finally { store.db.close(); }
  });
});

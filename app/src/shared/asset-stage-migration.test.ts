import { describe, expect, it } from 'vitest';
import { AssetJobDataSchema, AssetStageSchema, AssetWorkflowDataSchema } from './asset-production';

const itemId = '00000000-0000-4000-8000-000000000001';
const jobId = '00000000-0000-4000-8000-000000000002';
const artifactId = '00000000-0000-4000-8000-000000000003';
const candidateId = '00000000-0000-4000-8000-000000000004';
const sourceId = '00000000-0000-4000-8000-000000000005';
const instanceId = '00000000-0000-4000-8000-000000000006';
const pendingCandidateId = '00000000-0000-4000-8000-000000000007';
const rejectedCandidateId = '00000000-0000-4000-8000-000000000008';
const guideCandidateId = '00000000-0000-4000-8000-000000000009';
const hash = 'a'.repeat(64);

describe('five-stage asset workflow compatibility', () => {
  it('normalizes the legacy six-stage workflow while preserving every review record and identity', () => {
    const old = {
      schemaVersion: 1,
      definitionVersion: 'asset-1',
      assetJobId: jobId,
      stages: ['source', 'composition', 'images', 'geometry', 'materials', 'assembly'],
      slots: [{
        itemId,
        role: 'material',
        candidates: [{
          id: candidateId,
          artifactId,
          hash,
          submittedAt: '2026-11-01T00:00:00.000Z',
          submittedBy: 'mcp',
          status: 'accepted',
          reviewedAt: '2026-11-01T00:01:00.000Z',
          reviewedBy: 'human',
          dependsOnGeometryHash: hash,
          warnings: ['kept warning'],
        }, {
          id: pendingCandidateId,
          artifactId,
          hash: 'b'.repeat(64),
          submittedAt: '2026-11-01T00:02:00.000Z',
          submittedBy: 'mcp',
          status: 'pending',
          dependsOnGeometryHash: hash,
          warnings: [],
        }, {
          id: rejectedCandidateId,
          artifactId,
          hash: 'c'.repeat(64),
          submittedAt: '2026-11-01T00:03:00.000Z',
          submittedBy: 'ui',
          status: 'rejected',
          reviewedAt: '2026-11-01T00:04:00.000Z',
          reviewedBy: 'human',
          warnings: ['kept rejection'],
        }],
        acceptedCandidateId: candidateId,
      }, {
        itemId,
        role: 'guide:front',
        candidates: [{
          id: guideCandidateId,
          artifactId,
          hash: 'd'.repeat(64),
          submittedAt: '2026-11-01T00:05:00.000Z',
          submittedBy: 'mcp',
          status: 'pending',
          warnings: [],
        }],
      }],
      sceneCandidates: [],
      sharedSources: [{
        id: sourceId,
        artifactId,
        hash,
        sheetArtifactId: artifactId,
        sheetHash: hash,
        members: [{ itemId, sourceHash: hash, sourceRole: 'image:front', sourceType: 'color', sourceArtifactId: artifactId }],
        status: 'accepted',
        submittedAt: '2026-11-01T00:00:00.000Z',
        reviewedAt: '2026-11-01T00:01:00.000Z',
        reviewedBy: 'human',
      }],
      instances: [{ id: instanceId, masterItemId: itemId, transform: { position: [1, 2, 3], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
      updatedAt: '2026-11-01T00:00:00.000Z',
    };

    const normalized = AssetWorkflowDataSchema.parse(old);

    expect(normalized.stages).toEqual(['source', 'composition', 'images', 'geometry', 'assembly']);
    expect(normalized.slots).toEqual(old.slots);
    expect(normalized.sharedSources).toEqual(old.sharedSources);
    expect(normalized.instances).toEqual(old.instances);
    expect(normalized.updatedAt).toBe(old.updatedAt);
  });

  it('normalizes legacy job navigation on read and exposes only the five current stages', () => {
    const oldJob = {
      schemaVersion: 1,
      workflowId: jobId,
      mode: 'composite',
      target: 'A small cabin',
      stage: 'materials',
    };

    expect(AssetJobDataSchema.parse({ ...oldJob, stage: 'geometry' }).stage).toBe('geometry');
    expect(AssetJobDataSchema.parse(oldJob).stage).toBe('geometry');
    expect(AssetJobDataSchema.parse({ ...oldJob, stage: 'assembly' }).stage).toBe('assembly');
    expect(AssetStageSchema.options).toEqual(['source', 'composition', 'images', 'geometry', 'assembly']);
  });
});

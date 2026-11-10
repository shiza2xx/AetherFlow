import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import AssetAssemblyStage, { effectiveAssemblyPreviewFilter } from './AssetAssemblyStage';
import { resolvePendingAssetSceneCandidate } from './asset-navigation';

const item = { id: 'part-1', name: 'Wooden gate', data: { route: 'module' } };

function renderStage(overrides: Record<string, unknown> = {}) {
  const props = {
    job: { id: 'job-1', name: 'Garden gate', data: { mode: 'composite' } },
    items: [item],
    current: [{ itemId: item.id, geometry: { id: 'model-1' } }],
    workflow: { sceneCandidates: [], sceneAcceptedCandidateId: null },
    instances: [{ id: 'instance-1', masterItemId: item.id }],
    sceneCandidates: [],
    selectedItemId: item.id,
    selectedArtifact: 'model-artifact',
    selectedInstanceId: 'instance-1',
    selectedRole: 'geometry',
    selectedSceneCandidateId: '',
    preview: null,
    locale: 'en' as const,
    theme: 'light' as const,
    validation: { readyForAssembly: true, readyForExport: false, issues: [], warnings: [], scene: null, sceneStale: false },
    validationIsCurrent: true,
    pendingSceneCandidate: null,
    modelReady: false,
    busy: false,
    exported: null,
    exportRecovery: 'missing' as const,
    activities: {},
    filter: 'all' as const,
    onFilterChange: () => {},
    onModelReady: () => {},
    onViewerState: () => {},
    onViewerLoadStatus: () => {},
    onDismissActivity: () => {},
    onRetryPreview: () => {},
    onValidate: () => {},
    onBuildScene: () => {},
    onSelectInstance: () => {},
    onSelectAllInstances: () => {},
    onMakeUnique: () => {},
    onSelectScene: () => {},
    onReviewScene: () => {},
    onWorkOnModel: () => {},
    onExport: () => {},
    onOpenExport: () => {},
    ...overrides,
  };
  return renderToStaticMarkup(<AssetAssemblyStage {...props as any} />);
}

describe('asset assembly stage flow', () => {
  it('validates current files automatically and makes scene build the composite primary action', () => {
    const markup = renderStage();
    expect(markup).toContain('asset-assembly-check-summary');
    expect(markup).toContain('Accepted masters, materials and placements are ready for the scene.');
    expect(markup).toContain('Build and inspect the scene');
    expect(markup).toContain('Build scene from current placements');
    expect(markup).not.toContain('>Validate</button>');
    expect(markup).not.toContain('>Проверить</button>');
  });

  it('explains the direct independent export for prop sets without asking for a scene or another model approval', () => {
    const markup = renderStage({ job: { id: 'job-2', name: 'Prop set', data: { mode: 'prop-set' } } });
    expect(markup).toContain('No scene is needed for a prop set');
    expect(markup).toContain('Export models + textures separately');
    expect(markup).not.toContain('Build scene');
    expect(markup).not.toContain('Accept inspected scene');
    expect(markup).not.toContain('>Validate</button>');
  });

  it('shows current validation blockers and a visible reason when build/export are disabled', () => {
    const markup = renderStage({
      validation: { readyForAssembly: false, readyForExport: false, issues: ['Wooden gate: current geometry is missing or stale.'], warnings: [], scene: null, sceneStale: false },
    });
    expect(markup).toContain('Wooden gate: current geometry is missing or stale.');
    expect(markup).toContain('Resolve the file or dependency issues above before building the scene.');
    expect(markup).toContain('Resolve the file or dependency issues above before exporting.');
  });

  it('keeps the combined scene pending until the selected preview is ready and the person accepts it', () => {
    const scene = { id: 'scene-pending', status: 'pending', artifactId: 'scene-file', hash: 'scene-hash', dependencyFingerprint: 'current' };
    const props = {
      pendingSceneCandidate: scene,
      selectedSceneCandidateId: scene.id,
      selectedArtifact: scene.artifactId,
      modelReady: false,
      sceneCandidates: [{ candidate: scene, current: true }],
    };
    const waiting = renderStage(props);
    expect(waiting).toContain('only this combined scene needs your decision');
    expect(waiting).toMatch(/disabled=""[^>]*>Accept inspected scene<\/button>/);
    expect(waiting).toContain('data-testid="asset-open-assembly-correction"');
    expect(waiting).not.toContain('data-asset-focus="assembly-build"');
    expect(waiting).toContain('Review or correct this scene before building another.');
    expect((waiting.match(/data-testid="asset-accept-scene"/g) || []).length).toBe(1);
    expect(scene.status).toBe('pending');

    const ready = renderStage({ ...props, modelReady: true });
    expect(ready).toMatch(/<button[^>]*>Accept inspected scene<\/button>/);
    expect(ready).not.toMatch(/disabled=""[^>]*>Accept inspected scene<\/button>/);
    expect(ready).toContain('Awaiting review');
  });

  it('keeps scene correction available while preview recovery is shown and disables accept until the viewer is ready', () => {
    const scene = { id: 'scene-error', status: 'pending', artifactId: 'scene-file', hash: 'scene-hash', dependencyFingerprint: 'current' };
    const markup = renderStage({
      pendingSceneCandidate: scene,
      selectedSceneCandidateId: scene.id,
      selectedArtifact: scene.artifactId,
      modelReady: false,
      sceneCandidates: [{ candidate: scene, current: true }],
      activities: { preview: { ownerId: 'job-1', operationId: 'preview-error', action: 'preview', state: 'error', startedAt: 0, message: 'The preview failed.', code: 'APP_ERROR', detail: 'Assembly preview could not be verified.' } },
    });
    expect(markup).toContain('data-testid="asset-open-assembly-correction"');
    expect(markup).toContain('data-testid="asset-assembly-status-preview"');
    expect(markup).toContain('The current assembly preview could not be verified.');
    expect(markup).toMatch(/disabled=""[^>]*>Accept inspected scene<\/button>/);
  });

  it('keeps two pending scenes individually selectable and targets review at the selected current candidate', () => {
    const older = { id: 'scene-old-1111', status: 'pending', artifactId: 'old-scene-file', hash: 'old-hash', dependencyFingerprint: 'current' };
    const latest = { id: 'scene-new-2222', status: 'pending', artifactId: 'new-scene-file', hash: 'new-hash', dependencyFingerprint: 'current' };
    const scenes = [older, latest];
    const validation = { readyForAssembly: true, dependencyFingerprint: 'current', scene: null, sceneStale: false };
    const rows = scenes.map(candidate => ({ candidate, current: true }));

    for (const selected of [older, latest]) {
      const reviewTarget = resolvePendingAssetSceneCandidate(scenes, validation, null, selected.id)!;
      const markup = renderStage({
        sceneCandidates: rows,
        pendingSceneCandidate: reviewTarget,
        selectedSceneCandidateId: selected.id,
        selectedArtifact: selected.artifactId,
        modelReady: true,
      });
      expect(markup).toContain(`data-testid="asset-scene-history-candidate" data-candidate-id="${older.id}"`);
      expect(markup).toContain(`data-testid="asset-scene-history-candidate" data-candidate-id="${latest.id}"`);
      expect(markup).toContain(`data-testid="asset-selected-scene-version">Selected scene version · ${selected.id.slice(0, 8)}`);
      expect(markup).toContain(`data-testid="asset-accept-scene" data-candidate-id="${selected.id}"`);
      expect(markup).toContain(`data-testid="asset-reject-scene" data-candidate-id="${selected.id}"`);
      expect(markup).toContain(`aria-pressed="true" class="subtle-button selected"`);
      expect(scenes.map(candidate => candidate.status)).toEqual(['pending', 'pending']);
    }

    expect(resolvePendingAssetSceneCandidate(scenes, validation, null)?.id).toBe(latest.id);
  });

  it('leaves older pending history inspectable after acceptance without demanding another review', () => {
    const older = { id: 'scene-old-pending', status: 'pending', artifactId: 'old-scene-file', hash: 'old-hash', dependencyFingerprint: 'current' };
    const accepted = { id: 'scene-new-accepted', status: 'accepted', artifactId: 'accepted-scene-file', hash: 'accepted-hash', dependencyFingerprint: 'current' };
    const scenes = [older, accepted];
    const validation = { readyForAssembly: true, readyForExport: true, dependencyFingerprint: 'current', scene: accepted, sceneStale: false };
    const rows = scenes.map(candidate => ({ candidate, current: true }));
    const pending = resolvePendingAssetSceneCandidate(scenes, validation, accepted.id);
    expect(pending).toBeNull();

    const acceptedMarkup = renderStage({
      validation,
      sceneCandidates: rows,
      pendingSceneCandidate: pending,
      selectedSceneCandidateId: accepted.id,
      selectedArtifact: accepted.artifactId,
    });
    expect(acceptedMarkup).toContain('Scene accepted');
    expect(acceptedMarkup).toContain(`data-testid="asset-scene-history-candidate" data-candidate-id="${older.id}"`);
    expect(acceptedMarkup).not.toContain('data-testid="asset-assembly-scene-review"');

    const historyMarkup = renderStage({
      validation,
      sceneCandidates: rows,
      pendingSceneCandidate: pending,
      selectedSceneCandidateId: older.id,
      selectedArtifact: older.artifactId,
    });
    expect(historyMarkup).toContain(`data-testid="asset-scene-history-candidate" data-candidate-id="${older.id}"`);
    expect(historyMarkup).toContain('aria-pressed="true" class="subtle-button selected"');
    expect(historyMarkup).not.toContain('data-testid="asset-assembly-scene-review"');
    expect(historyMarkup).not.toContain('Accept inspected scene');
  });

  it('offers a new pending scene submitted after the accepted scene', () => {
    const oldPending = { id: 'scene-old-pending', status: 'pending', artifactId: 'old-scene-file', hash: 'old-hash', dependencyFingerprint: 'current' };
    const accepted = { id: 'scene-accepted', status: 'accepted', artifactId: 'accepted-scene-file', hash: 'accepted-hash', dependencyFingerprint: 'current' };
    const newPending = { id: 'scene-new-pending', status: 'pending', artifactId: 'new-scene-file', hash: 'new-hash', dependencyFingerprint: 'current' };
    const scenes = [oldPending, accepted, newPending];
    const validation = { readyForAssembly: true, readyForExport: false, dependencyFingerprint: 'current', scene: accepted, sceneStale: false };
    const reviewTarget = resolvePendingAssetSceneCandidate(scenes, validation, accepted.id)!;
    expect(reviewTarget.id).toBe(newPending.id);
    const markup = renderStage({
      validation,
      sceneCandidates: scenes.map(candidate => ({ candidate, current: true })),
      pendingSceneCandidate: reviewTarget,
      selectedSceneCandidateId: newPending.id,
      selectedArtifact: newPending.artifactId,
      modelReady: true,
    });
    expect(markup).toContain(`data-testid="asset-accept-scene" data-candidate-id="${newPending.id}"`);
    expect(markup).not.toContain(`data-testid="asset-accept-scene" data-candidate-id="${oldPending.id}"`);
  });

  it('offers whole-scene correction for a current scene without requiring a selected master', () => {
    const older = { id: 'scene-older', status: 'accepted', artifactId: 'old-file', hash: 'old-hash', dependencyFingerprint: 'current' };
    for (const scene of [
      { id: 'scene-correction', status: 'pending', artifactId: 'scene-file', hash: 'scene-hash', dependencyFingerprint: 'current' },
      { id: 'scene-correction-accepted', status: 'accepted', artifactId: 'accepted-file', hash: 'accepted-hash', dependencyFingerprint: 'current' },
    ]) {
      const markup = renderStage({
        selectedItemId: '',
        selectedArtifact: scene.artifactId,
        selectedSceneCandidateId: scene.id,
        sceneCandidates: [{ candidate: older, current: true }, { candidate: scene, current: true }],
        pendingSceneCandidate: scene.status === 'pending' ? scene : null,
      });
      expect(markup).toContain('data-testid="asset-assembly-correction-form"');
      expect(markup).toContain('data-testid="asset-assembly-issue"');
      expect(markup).toContain(`data-scene-candidate-id="${scene.id}"`);
      expect(markup).toContain('data-testid="asset-open-assembly-correction"');
      expect(markup).toContain('Correct assembly');
      expect((markup.match(/data-testid="asset-correct-assembly"/g) || []).length).toBe(1);
      expect(markup).toContain('Prepare correction request');
      expect(markup).toContain('maxLength="4000"');
      expect(markup).toContain('Up to 4,000 characters');
      expect(markup).not.toContain('Work on selected part');
      expect(markup).not.toContain('Trunk');
      expect(markup).not.toContain('Foliage');
    }
  });

  it('shows tree filters only when the composite catalog includes foliage', () => {
    const treeItem = { id: 'tree', name: 'Tree', data: { route: 'foliage' } };
    const acceptedScene = { id: 'tree-scene', status: 'accepted', artifactId: 'tree-scene-file', hash: 'tree-hash', dependencyFingerprint: 'current' };
    const tree = renderStage({
      items: [item, treeItem],
      sceneCandidates: [{ candidate: acceptedScene, current: true }],
      selectedSceneCandidateId: acceptedScene.id,
      selectedArtifact: acceptedScene.artifactId,
    });
    expect(tree).toContain('Scene preview filter');
    expect(tree).toContain('Foliage');
    expect(tree).toContain('Trunk');
  });

  it('resets a remembered foliage-only filter to all when switching to a building scene', () => {
    const treeItem = { id: 'tree', name: 'Tree', data: { route: 'foliage' } };
    expect(effectiveAssemblyPreviewFilter('foliage', [treeItem] as any)).toBe('foliage');
    expect(effectiveAssemblyPreviewFilter('foliage', [item] as any)).toBe('all');
  });

  it('numbers composite scene and export sections in order', () => {
    const markup = renderStage({
      sceneCandidates: [{ candidate: { id: 'scene-numbering', status: 'accepted', artifactId: 'scene-artifact', hash: 'scene-hash', dependencyFingerprint: 'current' }, current: true }],
      selectedSceneCandidateId: 'scene-numbering',
      selectedArtifact: 'scene-artifact',
    });
    const scene = markup.slice(markup.indexOf('data-testid="asset-assembly-review"'));
    const exportSection = markup.slice(markup.indexOf('data-testid="asset-assembly-export"'));
    expect(scene).toMatch(/asset-assembly-step-number">01/);
    expect(exportSection).toMatch(/asset-assembly-step-number">02/);
  });

  it('groups 91 repeated placements into compact selectors while keeping an individual placement selectable and unique', () => {
    const wall = { id: 'wall-master', name: 'Wall', data: { route: 'module' } };
    const beam = { id: 'beam-master', name: 'Beam', data: { route: 'module' } };
    const instances = [
      ...Array.from({ length: 80 }, (_, index) => ({ id: `wall-instance-${index + 1}`, masterItemId: wall.id, transform: { position: [index, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, placementConfidence: 'inferred', placementEvidence: `Wall tile ${index + 1} from source elevation.` })),
      ...Array.from({ length: 11 }, (_, index) => ({ id: `beam-instance-${index + 1}`, masterItemId: beam.id, transform: { position: [index, 2, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }, placementConfidence: 'uncertain', placementEvidence: `Beam ${index + 1} requires scene review.` })),
    ];
    const markup = renderStage({
      items: [wall, beam],
      current: [{ itemId: beam.id, geometry: { id: 'beam-model' } }],
      instances,
      selectedItemId: beam.id,
      selectedInstanceId: 'beam-instance-11',
    });

    expect(markup).toContain('data-testid="asset-instance-master-select"');
    expect(markup).toContain('data-testid="asset-instance-select"');
    expect(markup).toContain('Wall · 80');
    expect(markup).toContain('Beam · 11');
    expect(markup).toContain('beam-instance-11');
    expect(markup).toContain('Beam 11 requires scene review.');
    expect(markup).toContain('Make instance unique');
    expect(markup).not.toMatch(/disabled=""[^>]*>Make instance unique<\/button>/);
    expect((markup.match(/class="asset-instance-placement"/g) || []).length).toBe(1);
    expect((markup.match(/value="(?:wall-instance|beam-instance)-\d+"/g) || []).length).toBe(11);
    const wallGroup = renderStage({ items: [wall, beam], instances, selectedInstanceId: 'wall-instance-80', selectedItemId: wall.id });
    expect(wallGroup).toContain('Wall · 80');
    expect((wallGroup.match(/value="(?:wall-instance|beam-instance)-\d+"/g) || []).length).toBe(80);
  });
});

import { describe, expect, it } from 'vitest';
import { currentWorkflowStageLabel } from './workflowStageSummary';

describe('current workflow stage label', () => {
  it('reports the first unfinished required and applicable stage', () => {
    expect(currentWorkflowStageLabel([
      { name: 'References', required: true, applicable: true, status: 'accepted' },
      { name: 'Model', required: true, applicable: true, status: 'accepted' },
      { name: 'Texture', required: true, applicable: true, status: 'idle' },
    ])).toBe('Texture');
  });

  it('keeps the earliest invalidated required stage current', () => {
    expect(currentWorkflowStageLabel([
      { name: 'References', required: true, applicable: true, status: 'accepted' },
      { name: 'Model', required: true, applicable: true, status: 'invalidated' },
      { name: 'Texture', required: true, applicable: true, status: 'idle' },
    ])).toBe('Model');
  });

  it('ignores optional and nonapplicable placeholders', () => {
    expect(currentWorkflowStageLabel([
      { name: 'References', required: true, applicable: true, status: 'accepted' },
      { name: 'Optional polish', required: false, applicable: true, status: 'idle' },
      { name: 'Separate parts', required: true, applicable: false, status: 'idle' },
      { name: 'Model', required: true, applicable: true, status: 'running' },
    ])).toBe('Model');
  });

  it('reports Complete when every required applicable stage is accepted', () => {
    expect(currentWorkflowStageLabel([
      { name: 'References', required: true, applicable: true, status: 'accepted' },
      { name: 'Optional polish', required: false, applicable: true, status: 'idle' },
      { name: 'Separate parts', required: true, applicable: false, status: 'idle' },
    ])).toBe('Complete');
  });
});

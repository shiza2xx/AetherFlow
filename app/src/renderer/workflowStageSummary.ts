export type WorkflowStageSummary = {
  name: string;
  required: boolean;
  applicable: boolean;
  status: string;
};

/** Return the next required, applicable stage, or Complete after acceptance. */
export function currentWorkflowStageLabel(stages: readonly WorkflowStageSummary[] | undefined): string | undefined {
  if (!stages) return undefined;
  return stages.find(stage => stage.required && stage.applicable && stage.status !== 'accepted')?.name ?? 'Complete';
}

import {describe,expect,it} from 'vitest';
import {atelierMcpToolNames} from './mcp';

describe('published MCP production registry',()=>{
 it('advertises guided v2 production entry points and no retired v1 workflow commands',()=>{
  const names=new Set(atelierMcpToolNames);
  expect(names.size).toBe(atelierMcpToolNames.length);
  for(const name of ['guided_character_create','guided_workflow_get','guided_next_actions_get','guided_output_submit','guided_validate','guided_export_prepare','plan_start'])expect(names.has(name),`missing ${name}`).toBe(true);
  for(const retired of ['workflow_create','workflow_get_status','workflow_issue_create','workflow_claim_stage','workflow_heartbeat','workflow_cancel','workflow_recover','workflow_run_checks','workflow_report_progress','workflow_submit_stage','workflow_request_review','slot_create','slot_list','slot_bind','part_assign_groups'])expect(names.has(retired),`retired cc82686 tool still advertised: ${retired}`).toBe(false);
 });
});

import { describe, expect, it } from 'vitest';
import {
  ARTIFACT_SCHEMAS,
  checkManualMove,
  effectiveStages,
  needsRebalance,
  rankBetween,
  resolveProjectSettings,
  roleAllows,
  statusForRunOutcome,
  statusForStage,
  WORKFLOWS,
  workflowTasks,
  TASKS,
} from './index.js';
import { z } from 'zod';

describe('ticket lifecycle', () => {
  it('lets people move between manual columns', () => {
    expect(checkManualMove('backlog', 'ready', false)).toEqual({ ok: true });
    expect(checkManualMove('ready', 'cancelled', false)).toEqual({ ok: true });
  });

  it('blocks manual moves into run-driven columns', () => {
    const r = checkManualMove('ready', 'building', false);
    expect(r.ok).toBe(false);
  });

  it('blocks any move while a run is active', () => {
    const r = checkManualMove('building', 'backlog', true);
    expect(r.ok).toBe(false);
  });

  it('reopens finished tickets only to backlog', () => {
    expect(checkManualMove('done', 'ready', false).ok).toBe(false);
    expect(checkManualMove('done', 'backlog', false).ok).toBe(true);
  });

  it('maps stages and outcomes to board columns', () => {
    expect(statusForStage('build')).toBe('building');
    expect(statusForStage('plan')).toBe('analysing');
    expect(statusForRunOutcome('succeeded')).toBe('done');
    expect(statusForRunOutcome('cancelled')).toBe('ready');
    expect(statusForRunOutcome('running')).toBeNull();
  });
});

describe('workflows', () => {
  it('uses only defined tasks whose agent matches the task table', () => {
    for (const wf of Object.values(WORKFLOWS)) {
      for (const stage of wf.stages) {
        for (const group of stage.groups) {
          for (const task of group) expect(TASKS[task]).toBeDefined();
        }
      }
    }
  });

  it('removes gates the project switched off', () => {
    const stages = effectiveStages('full_change', { plan: false, release: true });
    expect(stages.find((s) => s.key === 'build')?.gateBefore).toBeUndefined();
    expect(stages.find((s) => s.key === 'release')?.gateBefore).toBe('release');
  });

  it('includes the QA loop tasks in build workflows only', () => {
    expect(workflowTasks('full_change')).toContain('run_tests');
    expect(workflowTasks('analysis')).not.toContain('run_tests');
  });
});

describe('permissions', () => {
  it('ranks roles', () => {
    expect(roleAllows('viewer', 'ticket.create')).toBe(false);
    expect(roleAllows('requester', 'ticket.create')).toBe(true);
    expect(roleAllows('requester', 'gate.decide')).toBe(false);
    expect(roleAllows('approver', 'gate.decide')).toBe(true);
    expect(roleAllows(null, 'project.view')).toBe(false);
  });
});

describe('settings', () => {
  it('fills defaults for empty or invalid settings', () => {
    const s = resolveProjectSettings({});
    expect(s.gates).toEqual({ plan: true, release: true });
    expect(s.qaMaxAttempts).toBe(3);
    expect(resolveProjectSettings({ qaMaxAttempts: 999 }).qaMaxAttempts).toBe(3);
  });
});

describe('ranking', () => {
  it('computes ranks between neighbours', () => {
    expect(rankBetween(null, null)).toBe(1024);
    expect(rankBetween(1024, null)).toBe(2048);
    expect(rankBetween(null, 1024)).toBe(0);
    expect(rankBetween(1024, 2048)).toBe(1536);
    expect(needsRebalance(1, 1 + 1e-9)).toBe(true);
  });
});

describe('artifact schemas', () => {
  it('convert to JSON Schema with every property required', () => {
    for (const schema of Object.values(ARTIFACT_SCHEMAS)) {
      const json = z.toJSONSchema(schema) as { required?: string[]; properties?: Record<string, unknown> };
      expect(Object.keys(json.properties ?? {}).sort()).toEqual([...(json.required ?? [])].sort());
    }
  });
});

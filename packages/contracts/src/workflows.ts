import type { AgentKey, ArtifactKind, GateKind, StageKey, WorkflowType } from './enums.js';

/** One unit of agent work. The worker runs it as a Temporal activity. */
export const AGENT_TASKS = [
  'structure_requirement',
  'business_context',
  'acceptance_tests',
  'impact_analysis',
  'root_cause_analysis',
  'change_plan',
  'test_plan',
  'reproduce_defect',
  'implement_change',
  'implement_db_change',
  'run_tests',
  'fix_failures',
  'code_review',
  'security_review',
  'package_release',
  'release_notes',
  'analysis_report',
] as const;
export type AgentTask = (typeof AGENT_TASKS)[number];

export interface TaskDefinition {
  task: AgentTask;
  agent: AgentKey;
  title: string;
  /** Artifact the task must produce. */
  produces: ArtifactKind;
  /** Artifacts the task reads as input, if they exist in the run. */
  reads: ArtifactKind[];
  /** Tasks that change the workspace need the run's checked-out repository. */
  needsWorkspace: boolean;
}

export const TASKS: Record<AgentTask, TaskDefinition> = {
  structure_requirement: {
    task: 'structure_requirement',
    agent: 'requirement_analyst',
    title: 'Structure the requirement and acceptance criteria',
    produces: 'requirement_spec',
    reads: [],
    needsWorkspace: false,
  },
  business_context: {
    task: 'business_context',
    agent: 'business_analyst',
    title: 'Place the change in its business process',
    produces: 'business_context',
    reads: ['requirement_spec'],
    needsWorkspace: false,
  },
  acceptance_tests: {
    task: 'acceptance_tests',
    agent: 'qa',
    title: 'Turn acceptance criteria into test cases',
    produces: 'test_plan',
    reads: ['requirement_spec'],
    needsWorkspace: false,
  },
  impact_analysis: {
    task: 'impact_analysis',
    agent: 'legacy_intelligence',
    title: 'Map every component the change touches',
    produces: 'impact_map',
    reads: ['requirement_spec', 'business_context'],
    needsWorkspace: true,
  },
  root_cause_analysis: {
    task: 'root_cause_analysis',
    agent: 'legacy_intelligence',
    title: 'Find the root cause of the defect',
    produces: 'impact_map',
    reads: ['requirement_spec'],
    needsWorkspace: true,
  },
  change_plan: {
    task: 'change_plan',
    agent: 'solution_architect',
    title: 'Plan the changes and how each is proved',
    produces: 'change_plan',
    reads: ['requirement_spec', 'business_context', 'impact_map', 'test_plan'],
    needsWorkspace: false,
  },
  test_plan: {
    task: 'test_plan',
    agent: 'qa',
    title: 'Map each planned change to a test',
    produces: 'test_plan',
    reads: ['requirement_spec', 'change_plan', 'test_plan'],
    needsWorkspace: false,
  },
  reproduce_defect: {
    task: 'reproduce_defect',
    agent: 'qa',
    title: 'Write a test that reproduces the defect',
    produces: 'test_plan',
    reads: ['requirement_spec', 'impact_map'],
    needsWorkspace: true,
  },
  implement_change: {
    task: 'implement_change',
    agent: 'developer',
    title: 'Implement the application changes',
    produces: 'code_change',
    reads: ['requirement_spec', 'impact_map', 'change_plan'],
    needsWorkspace: true,
  },
  implement_db_change: {
    task: 'implement_db_change',
    agent: 'database',
    title: 'Implement schema and PL/SQL changes with rollback',
    produces: 'db_change',
    reads: ['requirement_spec', 'impact_map', 'change_plan'],
    needsWorkspace: true,
  },
  run_tests: {
    task: 'run_tests',
    agent: 'qa',
    title: 'Run the test plan against the sandbox build',
    produces: 'test_results',
    reads: ['test_plan', 'code_change', 'db_change'],
    needsWorkspace: true,
  },
  fix_failures: {
    task: 'fix_failures',
    agent: 'developer',
    title: 'Fix the failing tests',
    produces: 'code_change',
    reads: ['change_plan', 'test_results', 'code_change', 'db_change'],
    needsWorkspace: true,
  },
  code_review: {
    task: 'code_review',
    agent: 'code_review',
    title: 'Review every change',
    produces: 'review_report',
    reads: ['change_plan', 'code_change', 'db_change', 'test_results'],
    needsWorkspace: true,
  },
  security_review: {
    task: 'security_review',
    agent: 'security',
    title: 'Check the change set against security policy',
    produces: 'security_report',
    reads: ['change_plan', 'code_change', 'db_change'],
    needsWorkspace: true,
  },
  package_release: {
    task: 'package_release',
    agent: 'release',
    title: 'Package the change set for your CI/CD',
    produces: 'release_package',
    reads: ['change_plan', 'code_change', 'db_change', 'test_results', 'review_report', 'security_report'],
    needsWorkspace: true,
  },
  release_notes: {
    task: 'release_notes',
    agent: 'documentation',
    title: 'Write release notes from the evidence',
    produces: 'release_notes',
    reads: ['requirement_spec', 'change_plan', 'test_results', 'release_package'],
    needsWorkspace: false,
  },
  analysis_report: {
    task: 'analysis_report',
    agent: 'documentation',
    title: 'Write the analysis report',
    produces: 'analysis_report',
    reads: ['requirement_spec', 'impact_map', 'change_plan'],
    needsWorkspace: false,
  },
};

export interface StageDefinition {
  key: StageKey;
  name: string;
  /** Groups run in order; tasks inside one group run in parallel. */
  groups: AgentTask[][];
  /** When set, the build-and-test loop runs after the groups: test, fix, re-test. */
  qaLoop?: boolean;
  /** Approval gate that must pass before this stage starts. */
  gateBefore?: Exclude<GateKind, 'escalation'>;
}

export interface WorkflowDefinition {
  type: WorkflowType;
  name: string;
  description: string;
  stages: StageDefinition[];
}

export const WORKFLOWS: Record<WorkflowType, WorkflowDefinition> = {
  full_change: {
    type: 'full_change',
    name: 'Full change',
    description:
      'Understand, analyse, plan, build with continuous testing, verify and release. Two approval gates.',
    stages: [
      {
        key: 'understand',
        name: 'Understand',
        groups: [['structure_requirement'], ['business_context', 'acceptance_tests']],
      },
      { key: 'analyse', name: 'Analyse', groups: [['impact_analysis']] },
      { key: 'plan', name: 'Plan', groups: [['change_plan'], ['test_plan']] },
      {
        key: 'build',
        name: 'Build',
        gateBefore: 'plan',
        groups: [['implement_change', 'implement_db_change']],
        qaLoop: true,
      },
      { key: 'verify', name: 'Verify', groups: [['code_review', 'security_review']] },
      {
        key: 'release',
        name: 'Release',
        gateBefore: 'release',
        groups: [['package_release'], ['release_notes']],
      },
    ],
  },
  hotfix: {
    type: 'hotfix',
    name: 'Hotfix',
    description: 'Find the root cause, prove the defect with a failing test, fix, re-test and release.',
    stages: [
      { key: 'understand', name: 'Understand', groups: [['structure_requirement']] },
      { key: 'analyse', name: 'Analyse', groups: [['root_cause_analysis'], ['reproduce_defect']] },
      { key: 'plan', name: 'Plan', groups: [['change_plan']] },
      {
        key: 'build',
        name: 'Build',
        gateBefore: 'plan',
        groups: [['implement_change', 'implement_db_change']],
        qaLoop: true,
      },
      { key: 'verify', name: 'Verify', groups: [['code_review', 'security_review']] },
      {
        key: 'release',
        name: 'Release',
        gateBefore: 'release',
        groups: [['package_release'], ['release_notes']],
      },
    ],
  },
  analysis: {
    type: 'analysis',
    name: 'Analysis only',
    description: 'Understand and analyse the system, plan the change and report. Nothing is built.',
    stages: [
      { key: 'understand', name: 'Understand', groups: [['structure_requirement']] },
      { key: 'analyse', name: 'Analyse', groups: [['impact_analysis']] },
      { key: 'plan', name: 'Plan', groups: [['change_plan']] },
      { key: 'release', name: 'Report', groups: [['analysis_report']] },
    ],
  },
};

/** Stages of a workflow with the gates the project has switched off removed. */
export function effectiveStages(
  type: WorkflowType,
  gates: { plan: boolean; release: boolean },
): StageDefinition[] {
  return WORKFLOWS[type].stages.map((s) => {
    if (s.gateBefore && !gates[s.gateBefore]) {
      const { gateBefore: _drop, ...rest } = s;
      return rest;
    }
    return s;
  });
}

/** Every task a workflow can run, in order, deduplicated. Used to draw the pipeline. */
export function workflowTasks(type: WorkflowType): AgentTask[] {
  const seen = new Set<AgentTask>();
  for (const stage of WORKFLOWS[type].stages) {
    for (const group of stage.groups) for (const t of group) seen.add(t);
    if (stage.qaLoop) {
      seen.add('run_tests');
      seen.add('fix_failures');
    }
  }
  return [...seen];
}

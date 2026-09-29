import type { AgentKey, StageKey } from './enums.js';

export interface AgentCatalogEntry {
  key: AgentKey;
  name: string;
  shortName: string;
  description: string;
  /** Home stage on the pipeline. `null` for agents that work in every stage (QA). */
  stage: StageKey | null;
  /** Skill packages the agent can load (see packages/agents/skills). */
  skills: string[];
  /** Tool groups the agent is allowed to use. */
  toolGroups: ToolGroup[];
}

export const TOOL_GROUPS = ['knowledge', 'workspace_read', 'workspace_write', 'commands', 'oracle', 'git'] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];

export const TOOL_GROUP_LABELS: Record<ToolGroup, string> = {
  knowledge: 'Knowledge graph and search',
  workspace_read: 'Read the sandbox repository',
  workspace_write: 'Edit files in the sandbox',
  commands: 'Run allowed commands in the sandbox',
  oracle: 'Oracle adapter (Forms, Reports, PL/SQL)',
  git: 'Git diff and commit',
};

export const AGENTS: Record<AgentKey, AgentCatalogEntry> = {
  requirement_analyst: {
    key: 'requirement_analyst',
    name: 'Requirement Analyst',
    shortName: 'Requirements',
    description: 'Turns a request into clear requirements and testable acceptance criteria, and flags anything ambiguous.',
    stage: 'understand',
    skills: ['requirements-engineering', 'banking-domain'],
    toolGroups: ['knowledge'],
  },
  business_analyst: {
    key: 'business_analyst',
    name: 'Business Analyst',
    shortName: 'Business',
    description: 'Places the change in the business process it affects and records the rules that apply.',
    stage: 'understand',
    skills: ['banking-domain', 'requirements-engineering'],
    toolGroups: ['knowledge'],
  },
  legacy_intelligence: {
    key: 'legacy_intelligence',
    name: 'Legacy Intelligence',
    shortName: 'Legacy Intel',
    description: 'Reads the legacy system and maps every component a change touches before anything is edited.',
    stage: 'analyse',
    skills: ['impact-analysis', 'oracle-forms', 'oracle-reports', 'plsql-engineering'],
    toolGroups: ['knowledge', 'workspace_read', 'oracle'],
  },
  solution_architect: {
    key: 'solution_architect',
    name: 'Solution Architect',
    shortName: 'Architect',
    description: 'Decides which components change, how, in what order, and which tests prove each change.',
    stage: 'plan',
    skills: ['impact-analysis', 'oracle-schema-change', 'plsql-engineering', 'oracle-forms', 'oracle-reports', 'test-design'],
    toolGroups: ['knowledge', 'workspace_read'],
  },
  developer: {
    key: 'developer',
    name: 'Developer',
    shortName: 'Developer',
    description: 'Makes the code change in any stack through technology adapters and keeps it compiling.',
    stage: 'build',
    skills: ['oracle-forms', 'oracle-reports', 'plsql-engineering'],
    toolGroups: ['knowledge', 'workspace_read', 'workspace_write', 'commands', 'oracle', 'git'],
  },
  database: {
    key: 'database',
    name: 'Database',
    shortName: 'Database',
    description: 'Owns schema and PL/SQL changes. Every change ships with a tested rollback script.',
    stage: 'build',
    skills: ['oracle-schema-change', 'plsql-engineering'],
    toolGroups: ['knowledge', 'workspace_read', 'workspace_write', 'commands', 'oracle', 'git'],
  },
  qa: {
    key: 'qa',
    name: 'QA / Test Engineer',
    shortName: 'QA',
    description: 'Works in every stage: writes tests from the acceptance criteria, runs them on each build and sends failures back to be fixed.',
    stage: null,
    skills: ['test-design', 'plsql-unit-testing', 'failure-triage'],
    toolGroups: ['knowledge', 'workspace_read', 'workspace_write', 'commands', 'oracle'],
  },
  code_review: {
    key: 'code_review',
    name: 'Code Review',
    shortName: 'Code Review',
    description: 'Reviews every change for correctness, standards and risk before it moves on.',
    stage: 'verify',
    skills: ['code-review', 'plsql-engineering', 'oracle-forms'],
    toolGroups: ['knowledge', 'workspace_read', 'git'],
  },
  security: {
    key: 'security',
    name: 'Security',
    shortName: 'Security',
    description: 'Checks the change set for injection, privilege, secret and personal-data risks.',
    stage: 'verify',
    skills: ['secure-plsql'],
    toolGroups: ['knowledge', 'workspace_read', 'git'],
  },
  release: {
    key: 'release',
    name: 'Release / DevOps',
    shortName: 'Release',
    description: 'Packages the change set with deployment order and rollback plan, and hands it to your CI/CD.',
    stage: 'release',
    skills: ['release-packaging', 'evidence-pack'],
    toolGroups: ['workspace_read', 'git'],
  },
  documentation: {
    key: 'documentation',
    name: 'Documentation',
    shortName: 'Docs',
    description: 'Writes release notes, analysis reports and system documentation from the evidence trail.',
    stage: 'release',
    skills: ['technical-writing', 'evidence-pack'],
    toolGroups: ['knowledge', 'workspace_read'],
  },
};

export const AGENT_ORDER: AgentKey[] = [
  'requirement_analyst',
  'business_analyst',
  'legacy_intelligence',
  'solution_architect',
  'developer',
  'database',
  'qa',
  'code_review',
  'security',
  'release',
  'documentation',
];

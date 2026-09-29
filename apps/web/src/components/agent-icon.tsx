import {
  BookOpen,
  Bot,
  Briefcase,
  CodeXml,
  Compass,
  Database,
  Eye,
  FileText,
  FlaskConical,
  Layers,
  Rocket,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react';
import type { AgentKey } from '@lsa/contracts';
import { cx } from './ui';

const ICONS: Record<AgentKey, LucideIcon> = {
  requirement_analyst: FileText,
  business_analyst: Briefcase,
  legacy_intelligence: Layers,
  solution_architect: Compass,
  developer: CodeXml,
  database: Database,
  qa: FlaskConical,
  code_review: Eye,
  security: ShieldCheck,
  release: Rocket,
  documentation: BookOpen,
};

export type AgentTone = 'done' | 'run' | 'wait' | 'bad' | 'idle' | 'accent';

const TONE: Record<AgentTone, string> = {
  done: 'text-ok bg-ok/8 border-ok/20',
  run: 'text-run bg-run/10 border-run/25',
  wait: 'text-wait bg-wait/10 border-wait/30',
  bad: 'text-bad bg-bad/10 border-bad/30',
  idle: 'text-muted bg-white/4 border-line',
  accent: 'text-accent bg-accent/10 border-accent/25',
};

export function AgentIcon({
  agent,
  tone = 'idle',
  size = 32,
  className,
}: {
  agent: AgentKey | null;
  tone?: AgentTone;
  size?: number;
  className?: string;
}) {
  const Icon = agent ? ICONS[agent] : Bot;
  return (
    <span
      style={{ width: size, height: size }}
      className={cx(
        'grid shrink-0 place-items-center rounded-[9px] border transition-colors',
        TONE[tone],
        className,
      )}
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={1.7} />
    </span>
  );
}

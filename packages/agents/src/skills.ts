import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Skill {
  name: string;
  description: string;
  body: string;
}

/**
 * Skills are folders with a SKILL.md (front matter: name, description).
 * Agents see each skill's one-line description and load the full text with
 * `load_skill` when it applies, keeping prompts small (progressive disclosure).
 */
export class SkillRegistry {
  private readonly skills = new Map<string, Skill>();

  constructor(dirs: string[] = [defaultSkillsDir()]) {
    for (const dir of dirs) {
      if (!existsSync(dir)) continue;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const file = path.join(dir, entry.name, 'SKILL.md');
        if (!existsSync(file)) continue;
        const skill = parseSkill(readFileSync(file, 'utf8'), entry.name);
        this.skills.set(skill.name, skill);
      }
    }
  }

  get(name: string): Skill | undefined {
    return this.skills.get(name);
  }

  list(names?: string[]): Skill[] {
    const all = [...this.skills.values()];
    return names ? all.filter((s) => names.includes(s.name)) : all;
  }

  index(names: string[]): string {
    return this.list(names)
      .map((s) => `- ${s.name}: ${s.description}`)
      .join('\n');
  }
}

export function defaultSkillsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills');
}

export function parseSkill(text: string, fallbackName: string): Skill {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { name: fallbackName, description: '', body: text.trim() };
  const meta: Record<string, string> = {};
  for (const line of m[1]!.split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { name: meta.name ?? fallbackName, description: meta.description ?? '', body: m[2]!.trim() };
}

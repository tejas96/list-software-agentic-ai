'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo } from 'react';
import { roleAllows, type Permission, type ProjectDto } from '@lsa/contracts';
import { useMe, useProjects } from './queries';

const STORAGE_KEY = 'lsa.project';

function stored(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/**
 * The project the user is working in: `?project=KEY` in the URL, else the
 * last one they used, else their first project. Kept in the URL so links share it.
 */
export function useCurrentProject(): {
  project: ProjectDto | null;
  projects: ProjectDto[];
  isLoading: boolean;
  setProject: (key: string) => void;
} {
  const { data: projects = [], isLoading } = useProjects();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const fromUrl = params.get('project');

  const project = useMemo(() => {
    const byKey = (k: string | null) =>
      k ? (projects.find((p) => p.key === k.toUpperCase()) ?? null) : null;
    return byKey(fromUrl) ?? (typeof window !== 'undefined' ? byKey(stored()) : null) ?? projects[0] ?? null;
  }, [projects, fromUrl]);

  useEffect(() => {
    if (project) {
      try {
        window.localStorage.setItem(STORAGE_KEY, project.key);
      } catch {
        /* storage unavailable */
      }
    }
  }, [project]);

  const setProject = useCallback(
    (key: string) => {
      const next = new URLSearchParams(params.toString());
      next.set('project', key);
      router.replace(`${pathname}?${next.toString()}`);
    },
    [params, pathname, router],
  );

  return { project, projects, isLoading, setProject };
}

/** Whether the signed-in user may do `permission` in `project`. Workspace admins may do everything. */
export function useCan(project: ProjectDto | null | undefined, permission: Permission): boolean {
  const me = useMe().data;
  return !!me?.isAdmin || roleAllows(project?.myRole, permission);
}

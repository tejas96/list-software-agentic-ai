import type { ActorType, AgentKey } from '@lsa/contracts';

/** Who performed an action. Recorded on every activity. */
export type Actor =
  | { type: 'user'; userId: string; name?: string }
  | { type: 'agent'; agentKey: AgentKey }
  | { type: 'system' };

export function actorFields(actor: Actor): { actorType: ActorType; actorId: string | null; agentKey: AgentKey | null } {
  switch (actor.type) {
    case 'user':
      return { actorType: 'user', actorId: actor.userId, agentKey: null };
    case 'agent':
      return { actorType: 'agent', actorId: null, agentKey: actor.agentKey };
    case 'system':
      return { actorType: 'system', actorId: null, agentKey: null };
  }
}

export class DomainError extends Error {
  constructor(
    public readonly code: 'not_found' | 'conflict' | 'invalid' | 'forbidden' | 'unavailable',
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}

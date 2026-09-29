import Anthropic from '@anthropic-ai/sdk';

export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export interface LlmUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number;
}

export interface LlmCall {
  /** Stable instructions. Cached, so keep volatile data out of it. */
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: Anthropic.Beta.BetaTool[];
  effort?: Effort;
  maxTokens?: number;
  /** JSON Schema for a structured final answer (no tools). */
  outputSchema?: Record<string, unknown>;
  /** Prune old tool results in long tool loops. */
  pruneToolResults?: boolean;
  signal?: AbortSignal;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly code:
      | 'not_configured'
      | 'auth'
      | 'rate_limited'
      | 'overloaded'
      | 'bad_request'
      | 'refused'
      | 'network'
      | 'unknown',
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** USD per million tokens: input, output, cache read, cache write. */
const PRICES: Record<string, [number, number, number, number]> = {
  'claude-opus-5-5': [4, 20, 0.2, 5],
  'claude-opus-5': [5, 25, 0.5, 6.25],
  'claude-sonnet-5-5': [2, 10, 0.2, 2.5],
  'claude-sonnet-5': [2, 10, 0.2, 2.5],
  'claude-haiku-4-5': [1, 5, 0.1, 1.25],
  'claude-fable-5-1': [10, 50, 0.25, 12.5],
};

export function costOf(
  model: string,
  u: { input: number; output: number; cacheRead: number; cacheWrite: number },
): number {
  const p = PRICES[model] ?? PRICES['claude-opus-5-5']!;
  return (u.input * p[0] + u.output * p[1] + u.cacheRead * p[2] + u.cacheWrite * p[3]) / 1_000_000;
}

export interface LlmGatewayOptions {
  apiKey?: string | null;
  model: string;
  /** Re-run a refused request on a fallback model chosen by the API (server-side fallback). */
  refusalFallback: boolean;
  timeoutMs?: number;
}

/**
 * The one place the platform talks to a model. Adds caching, adaptive
 * thinking, refusal fallback, usage accounting and typed errors, so agents
 * and other callers stay provider-agnostic.
 */
export class LlmGateway {
  private readonly client: Anthropic | null;

  constructor(private readonly options: LlmGatewayOptions) {
    this.client = options.apiKey
      ? new Anthropic({ apiKey: options.apiKey, maxRetries: 3, timeout: options.timeoutMs ?? 20 * 60_000 })
      : null;
  }

  get available(): boolean {
    return this.client !== null;
  }

  get model(): string {
    return this.options.model;
  }

  async call(req: LlmCall): Promise<{ message: Anthropic.Beta.BetaMessage; usage: LlmUsage }> {
    if (!this.client) {
      throw new LlmError(
        'No LLM provider is configured. Set ANTHROPIC_API_KEY for the worker and API.',
        false,
        'not_configured',
      );
    }
    const betas: Anthropic.Beta.AnthropicBeta[] = [];
    if (this.options.refusalFallback) betas.push('server-side-fallback-2026-07-01');
    if (req.pruneToolResults) betas.push('context-management-2025-06-27');

    const params: Anthropic.Beta.MessageCreateParamsStreaming = {
      model: this.options.model,
      max_tokens: req.maxTokens ?? 64_000,
      stream: true,
      system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
      messages: req.messages,
      thinking: { type: 'adaptive' },
      output_config: {
        effort: req.effort ?? 'high',
        ...(req.outputSchema && { format: { type: 'json_schema', schema: req.outputSchema } }),
      },
      ...(req.tools?.length && { tools: req.tools }),
      ...(this.options.refusalFallback && { fallbacks: 'default' as const }),
      ...(req.pruneToolResults && {
        context_management: {
          edits: [
            {
              type: 'clear_tool_uses_20250919' as const,
              keep: { type: 'tool_uses' as const, value: 8 },
              exclude_tools: ['load_skill', 'submit_result'],
            },
          ],
        },
      }),
      ...(betas.length && { betas }),
    };
    // Cache the growing conversation tail as well as the system prompt.
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user');
    if (lastUser && Array.isArray(lastUser.content) && lastUser.content.length > 0) {
      const last = lastUser.content[lastUser.content.length - 1] as { cache_control?: unknown };
      last.cache_control = { type: 'ephemeral' };
    }

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await this.client.beta.messages.stream(params, { signal: req.signal }).finalMessage();
    } catch (err) {
      throw classify(err);
    } finally {
      if (lastUser && Array.isArray(lastUser.content) && lastUser.content.length > 0) {
        delete (lastUser.content[lastUser.content.length - 1] as { cache_control?: unknown }).cache_control;
      }
    }
    if (message.stop_reason === 'refusal') {
      throw new LlmError(
        'The model declined this request. Rephrase the ticket or ask an administrator to review it.',
        false,
        'refused',
      );
    }
    const u = message.usage;
    const usage: LlmUsage = {
      model: message.model,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      costUsd: costOf(message.model, {
        input: u.input_tokens,
        output: u.output_tokens,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
      }),
    };
    return { message, usage };
  }
}

function classify(err: unknown): LlmError {
  if (err instanceof LlmError) return err;
  if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
    return new LlmError('The LLM provider rejected the API key. Check ANTHROPIC_API_KEY.', false, 'auth');
  }
  if (err instanceof Anthropic.RateLimitError)
    return new LlmError('The LLM provider is rate limiting requests.', true, 'rate_limited');
  if (err instanceof Anthropic.BadRequestError)
    return new LlmError(`The LLM request was rejected: ${err.message}`, false, 'bad_request');
  if (err instanceof Anthropic.InternalServerError)
    return new LlmError('The LLM provider is overloaded or failing.', true, 'overloaded');
  if (err instanceof Anthropic.APIConnectionError)
    return new LlmError('Could not reach the LLM provider.', true, 'network');
  if (err instanceof Anthropic.APIError)
    return new LlmError(`LLM error ${err.status}: ${err.message}`, (err.status ?? 500) >= 500, 'unknown');
  return new LlmError((err as Error)?.message ?? 'Unknown LLM error', true, 'unknown');
}

/** Text of all text blocks in a message. */
export function textOf(message: Anthropic.Beta.BetaMessage): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/**
 * JSON Schema for the model: drop validation keywords structured outputs may
 * not support and close every object. The full zod schema still validates the result.
 */
export function modelSchema(schema: Record<string, unknown>): Record<string, unknown> {
  const DROP = new Set([
    '$schema',
    'minLength',
    'maxLength',
    'minimum',
    'maximum',
    'exclusiveMinimum',
    'exclusiveMaximum',
    'pattern',
    'format',
    'minItems',
    'maxItems',
    'default',
  ]);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (!node || typeof node !== 'object') return node;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) {
      if (DROP.has(k)) continue;
      out[k] =
        k === 'properties' && v && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([pk, pv]) => [pk, walk(pv)]))
          : walk(v);
    }
    if (out.type === 'object' && out.properties) {
      out.additionalProperties = false;
      out.required = Object.keys(out.properties as object);
    }
    return out;
  };
  return walk(schema) as Record<string, unknown>;
}

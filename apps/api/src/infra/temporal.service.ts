import { Inject, Injectable, Logger, type OnApplicationShutdown } from '@nestjs/common';
import { Client, Connection, WorkflowNotFoundError } from '@temporalio/client';
import {
  QUERIES,
  SIGNALS,
  WORKFLOW_NAMES,
  workflowIds,
  type GateDecisionSignal,
  type RunControlSignal,
  type RunWorkflowState,
} from '@lsa/contracts';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { unavailable } from '../common/errors.js';

/**
 * Temporal client. Connects lazily so the API starts (and serves the board)
 * even while the workflow engine is down; run actions then fail with a clear 503.
 */
@Injectable()
export class TemporalService implements OnApplicationShutdown {
  private readonly logger = new Logger('Temporal');
  private connection: Connection | null = null;
  private client: Client | null = null;
  private connecting: Promise<Client> | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private async getClient(): Promise<Client> {
    if (this.client) return this.client;
    if (!this.connecting) {
      this.connecting = (async () => {
        try {
          this.connection = await Connection.connect({
            address: this.config.TEMPORAL_ADDRESS,
            connectTimeout: '5s',
          });
          this.client = new Client({
            connection: this.connection,
            namespace: this.config.TEMPORAL_NAMESPACE,
          });
          this.logger.log(`Connected to ${this.config.TEMPORAL_ADDRESS}`);
          return this.client;
        } catch (err) {
          this.connecting = null;
          this.logger.warn(
            `Cannot reach Temporal at ${this.config.TEMPORAL_ADDRESS}: ${(err as Error).message}`,
          );
          throw unavailable('The workflow engine is not reachable right now. Try again in a moment.');
        }
      })();
    }
    return this.connecting;
  }

  async isConnected(): Promise<boolean> {
    try {
      const c = await this.getClient();
      await c.connection.workflowService.getSystemInfo({});
      return true;
    } catch {
      return false;
    }
  }

  private get taskQueue(): string {
    return this.config.TEMPORAL_TASK_QUEUE;
  }

  async startRun(runId: string): Promise<void> {
    const c = await this.getClient();
    await c.workflow.start(WORKFLOW_NAMES.run, {
      taskQueue: this.taskQueue,
      workflowId: workflowIds.run(runId),
      args: [{ runId }],
    });
  }

  async startTriage(ticketId: string): Promise<void> {
    const c = await this.getClient();
    await c.workflow.start(WORKFLOW_NAMES.triage, {
      taskQueue: this.taskQueue,
      workflowId: workflowIds.triage(ticketId),
      args: [{ ticketId }],
      workflowIdConflictPolicy: 'USE_EXISTING',
    });
  }

  async startSourceSync(sourceId: string): Promise<'started' | 'already_running'> {
    const c = await this.getClient();
    try {
      await c.workflow.start(WORKFLOW_NAMES.syncSource, {
        taskQueue: this.taskQueue,
        workflowId: workflowIds.syncSource(sourceId),
        args: [{ sourceId }],
        workflowIdConflictPolicy: 'FAIL',
      });
      return 'started';
    } catch (err) {
      if ((err as Error).name === 'WorkflowExecutionAlreadyStartedError') return 'already_running';
      throw err;
    }
  }

  async startAgentReply(commentId: string, agentKey: import('@lsa/contracts').AgentKey): Promise<void> {
    const c = await this.getClient();
    await c.workflow.start(WORKFLOW_NAMES.agentReply, {
      taskQueue: this.taskQueue,
      workflowId: workflowIds.agentReply(`${commentId}-${agentKey}`),
      args: [{ commentId, agentKey }],
    });
  }

  /** Returns false when the workflow no longer exists (finished or never started). */
  async signalGate(runId: string, signal: GateDecisionSignal): Promise<boolean> {
    return this.signal(runId, SIGNALS.gateDecision, signal);
  }

  async signalControl(runId: string, signal: RunControlSignal): Promise<boolean> {
    return this.signal(runId, SIGNALS.control, signal);
  }

  private async signal(runId: string, name: string, payload: unknown): Promise<boolean> {
    const c = await this.getClient();
    try {
      await c.workflow.getHandle(workflowIds.run(runId)).signal(name, payload);
      return true;
    } catch (err) {
      if (err instanceof WorkflowNotFoundError) return false;
      throw err;
    }
  }

  async queryRun(runId: string): Promise<RunWorkflowState | null> {
    try {
      const c = await this.getClient();
      return await c.workflow.getHandle(workflowIds.run(runId)).query<RunWorkflowState>(QUERIES.state);
    } catch {
      return null;
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.connection?.close();
  }
}

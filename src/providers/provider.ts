import type {PreparedRun, ProviderRunResult} from '../core/types';

export interface AgentProvider {
  run(
    prepared: PreparedRun,
    options: {agentId: string; color?: boolean; verbose?: boolean},
  ): Promise<ProviderRunResult>;
}

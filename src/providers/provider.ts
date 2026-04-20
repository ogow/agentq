import type {
  AgentQEvent,
  LogLevel,
  PreparedRun,
  ProcessMetadata,
  ProviderRunResult,
  RunParentLink,
} from '../core/types';
import type {ProcessRegistry} from '../core/processes';

export interface AgentProvider {
  run(
    prepared: PreparedRun,
    options: {
      agentId: string;
      color?: boolean;
      logLevel?: LogLevel;
      onEvent?: (event: AgentQEvent) => void;
      onSpawn?: (process: ProcessMetadata) => void | Promise<void>;
      processRegistry?: ProcessRegistry;
      progress?: boolean;
      runtimeParent?: RunParentLink;
      verbose?: boolean;
    },
  ): Promise<ProviderRunResult>;
}

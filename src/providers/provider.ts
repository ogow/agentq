import type {
  AgentQEvent,
  OutputFormat,
  LogLevel,
  PreparedRun,
  ProcessMetadata,
  ProviderRunResult,
  RunParentLink,
  Verbosity,
} from '../core/types';
import type {ProcessRegistry} from '../core/processes';

export interface AgentProvider {
  run(
    prepared: PreparedRun,
    options: {
      agentId: string;
      color?: boolean;
      format?: OutputFormat;
      logLevel?: LogLevel;
      onEvent?: (event: AgentQEvent) => void;
      onSpawn?: (process: ProcessMetadata) => void | Promise<void>;
      processRegistry?: ProcessRegistry;
      progress?: boolean;
      runtimeParent?: RunParentLink;
      verbosity?: Verbosity;
      verbose?: boolean;
    },
  ): Promise<ProviderRunResult>;
}

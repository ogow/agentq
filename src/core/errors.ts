export class AgentQError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentQError';
  }
}

export function assertAgentQ(
  condition: unknown,
  message: string,
): asserts condition {
  if (!condition) {
    throw new AgentQError(message);
  }
}

export interface NodeRedCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  rawText: string;
}

export interface NodeRedCallOptions {
  /** Overrides the default timeout (NODE_RED_TIMEOUT_MS). */
  timeoutMs?: number;
}

export interface INodeRedClient {
  post(
    stepPath: string,
    payload: Record<string, unknown>,
    options?: NodeRedCallOptions,
  ): Promise<NodeRedCallResult>;
}

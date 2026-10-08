export interface GraphSendResult {
  ok: boolean;
  status: number;
  data: unknown;
}

export interface IGraphClient {
  send(phoneNumberId: string, payload: Record<string, unknown>): Promise<GraphSendResult>;
}

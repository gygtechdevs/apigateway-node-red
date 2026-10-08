export interface IDedupeStore {
  /** Atomically claims an id. Resolves true if it was not claimed before (first delivery). */
  claim(id: string): Promise<boolean>;
  /** Releases a claim so a later retry of the same id is processed again. */
  release(id: string): Promise<void>;
}

import type { IIntentsCatalog } from '../ports/IIntentsServiceClient';

export interface ValidateNodeDeletionInput {
  nodeId: string;
  nodeType: string;
}

export interface AssociatedIntentRef {
  intent: string;
  initialStep: string;
}

export type ValidateNodeDeletionResult =
  | { ok: true }
  | { ok: false; code: 'ASSOCIATED'; intents: AssociatedIntentRef[] }
  | { ok: false; code: 'INTERNAL'; message: string };

export class ValidateNodeDeletionUseCase {
  constructor(private catalog: IIntentsCatalog) {}

  async execute(input: ValidateNodeDeletionInput): Promise<ValidateNodeDeletionResult> {
    if (input.nodeType !== 'step-trigger') {
      return { ok: true };
    }

    try {
      const all = await this.catalog.list();
      const associated = all
        .filter(
          (i) =>
            i.initialStep === input.nodeId ||
            i.initialStep.endsWith('/' + input.nodeId),
        )
        .map((i) => ({ intent: i.intent, initialStep: i.initialStep }));

      if (associated.length > 0) {
        return { ok: false, code: 'ASSOCIATED', intents: associated };
      }

      return { ok: true };
    } catch {
      return { ok: false, code: 'INTERNAL', message: 'Failed to query intents' };
    }
  }
}

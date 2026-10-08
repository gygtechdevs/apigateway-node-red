/** Result of classifying a message (owned by intents-service, POST /intents/detect). */
export interface DetectedIntent {
  intent: string;
  initialStep: string;
  confidence: number;
  matchedKeywords: string[];
}

/** Catalog entry as exposed by the gateway admin API (`intent` = intents-service `name`). */
export interface CatalogIntent {
  intent: string;
  initialStep: string;
  keywords: string[];
  description?: string;
}

export interface CreateIntentInput {
  intent: string;
  initialStep: string;
  keywords: string[];
  description?: string;
}

export interface UpdateIntentInput {
  initialStep: string;
  keywords?: string[];
  description?: string;
}

export type IntentsAdminResult =
  | { ok: true; status: number; intent?: CatalogIntent }
  | { ok: false; status: number; error: string };

/** Classification is delegated: the gateway only orchestrates. */
export interface IIntentClassifier {
  /** Returns null when no intent matches. Throws when intents-service is unreachable. */
  detect(text: string): Promise<DetectedIntent | null>;
}

/** Read access to the active catalog (service-to-service, X-Internal-Secret). */
export interface IIntentsCatalog {
  list(): Promise<CatalogIntent[]>;
}

/** Catalog writes, executed by intents-service with the CALLER's JWT forwarded. */
export interface IIntentsAdmin {
  create(accessToken: string, input: CreateIntentInput): Promise<IntentsAdminResult>;
  update(accessToken: string, name: string, input: UpdateIntentInput): Promise<IntentsAdminResult>;
  remove(accessToken: string, name: string): Promise<IntentsAdminResult>;
}

export interface IIntentsServiceClient extends IIntentClassifier, IIntentsCatalog, IIntentsAdmin {}

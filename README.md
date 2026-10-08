# Node-RED API Gateway

HTTP gateway (Express 4 + TypeScript, hexagonal) that detects the intent of a message, routes it to the initial step in Node-RED and bridges the WhatsApp Cloud API (Meta).

One deployment serves one company: there is no multi-tenancy, no `:slug` in URLs and no tenant header.

The gateway holds no session state and no user store. Identity comes from `auth-service` as an HS256 JWT that the gateway verifies locally.

## Architecture

```
WhatsApp Cloud API ──POST /webhooks/whatsapp──┐
SPA / ChatSim ──POST /api/gateway/message─────┤   (JWT)
                                              ▼
                                  ┌─────────────────────┐
                                  │  API Gateway :8080  │
                                  │  1. verify JWT / Meta signature
                                  │  2. de-duplicate (webhook)
                                  │  3. detect intent
                                  │  4. POST /<initialStep> to Node-RED
                                  │  5. send graphApiPayload via Graph API (webhook)
                                  └──────────┬──────────┘
                                             ▼
                                  Node-RED :1878 / Graph API
```

## Configuration

Copy `.env.example` to `.env`.

| Variable | Description | Default |
|---|---|---|
| `PORT` | Gateway port | `8080` |
| `AUTH_JWT_SECRET` | HS256 secret shared with auth-service. **Required.** | - |
| `INTENTS_SERVICE_URL` | Base URL of intents-service (e.g. `http://localhost:4002`). **Required.** | - |
| `INTENTS_INTERNAL_SECRET` | Sent as `X-Internal-Secret` to `POST /intents/detect` and `GET /internal/intents`; must match intents-service `INTERNAL_SECRET`. **Required.** | - |
| `INTENTS_TIMEOUT_MS` | Timeout of calls to intents-service | `5000` |
| `META_APP_SECRET` | Verifies `X-Hub-Signature-256` on the webhook | - |
| `META_VERIFY_TOKEN` | Token for Meta's `GET /webhooks/whatsapp` challenge | - |
| `META_ACCESS_TOKEN` | Bearer token for the Graph API. **Required.** | - |
| `META_PHONE_NUMBER_ID` | Fallback sender number when the inbound payload has none | - |
| `META_API_VERSION` | Graph API version | `v21.0` |
| `REDIS_URL` | Redis for webhook de-duplication; in-memory fallback when empty | - |
| `NODE_RED_BASE_URL` | Node-RED base URL | - |
| `NODE_RED_TIMEOUT_MS` | Node-RED timeout for `/api/gateway/message` (the webhook always uses 8 s) | `10000` |
| `STEPS_SERVICE_BASE_URL` | Source of the `/api/steps` catalog | `http://localhost:3000` |
| `GATEWAY_FALLBACK_STEP` | Step used when no intent matches | - |
| `CORS_ALLOWED_ORIGINS` | Comma-separated browser origins allowed (with credentials). Empty = none. `*` is served without credentials | empty |
| `TRUST_PROXY` | Proxy hops in front of the gateway (`1`, `2`, `false` or an Express keyword such as `loopback`); needed so rate limiting sees the real client IP | `1` |
| `RATE_LIMIT_ENABLED` | `false` disables all rate limiting (it is also off when `NODE_ENV=test`) | `true` |
| `RATE_LIMIT_GENERAL_MAX` / `RATE_LIMIT_GENERAL_WINDOW_MS` | General limiter per IP (everything except `/health` and the webhook) | `300` / `60000` |
| `RATE_LIMIT_WEBHOOK_MAX` / `RATE_LIMIT_WEBHOOK_WINDOW_MS` | Separate limiter for `/webhooks/whatsapp` per IP | `120` / `60000` |

## Hardening

- `helmet` default headers on every response; `X-Powered-By` is removed.
- CORS is an explicit allow-list (`CORS_ALLOWED_ORIGINS`); credentials only for listed origins and never together with a wildcard.
- Rate limiting (`express-rate-limit`): a general per-IP limiter and a separate bucket for `/webhooks/whatsapp`. Over the limit the gateway answers `429` with `Retry-After` and `{ "ok": false, "error": "Too many requests" }`; Meta treats it as a failed delivery and retries later with backoff, and the webhook stays idempotent thanks to de-duplication. Raise `RATE_LIMIT_WEBHOOK_MAX` if your WhatsApp volume per source IP is higher. Set `TRUST_PROXY` to the number of proxies in front of the gateway (e.g. `1` behind one ALB).
- The webhook raw-body + `X-Hub-Signature-256` verification is unchanged.

## Scripts

```bash
npm run dev         # tsx watch
npm run typecheck   # tsc --noEmit (src + tests)
npm test            # vitest + supertest
npm run build       # tsc -p tsconfig.build.json -> dist/
npm start
```

## Authentication and authorization

Protected routes accept the access token as `Authorization: Bearer <jwt>` or as the `access_token` cookie. The token is an HS256 JWT with `{ sub, email, permissions[] }`. The gateway injects `req.auth` and never calls auth-service.

- Missing, invalid or expired token: `401`.
- Valid token without the required permission: `403`.
- Permission changes take up to the token lifetime (15 min) to apply.

| Route | Protection |
|---|---|
| `/api/admin/intents/*` | JWT + `WRITE` or `ADMIN` |
| `GET /api/gateway/intents` | JWT |
| `POST /api/gateway/message` | JWT |
| `GET /api/steps` | JWT |
| `POST /api/node-events` | JWT + `WRITE` or `ADMIN` |
| `GET /webhooks/whatsapp` | `META_VERIFY_TOKEN` |
| `POST /webhooks/whatsapp` | `X-Hub-Signature-256` (no JWT) |
| `GET /health`, `/api/docs` | open |

## Endpoints

Interactive docs: `GET /api/docs`.

### `POST /api/gateway/message` (JWT)

Detects the intent, calls Node-RED and returns JSON. Consumers: ChatSim and internal clients.

```json
{
  "ok": true,
  "intent": "plazo_fijo",
  "routedStep": "/stepin/ebe1ec2b11d8dd6e",
  "graphApiPayload": { "messaging_product": "whatsapp", "type": "text", "text": { "body": "..." } },
  "replyText": "..."
}
```

`graphApiPayload` is what Node-RED built (`text`, `interactive`, `template`, ...); `replyText` is a plain-text rendering. The response is never XML.

| Status | Reason |
|---|---|
| `400` | No text found in the body |
| `401` / `403` | Missing/invalid token / missing permission |
| `422` | No intent detected and no `GATEWAY_FALLBACK_STEP` |
| `500` | Unexpected error |

Text is read from `requirementsText`, `text`, `message.text`, `payload.text` or `payload.intentText` (in that order).

### `GET /webhooks/whatsapp`

Meta verification: with `hub.mode=subscribe` and `hub.verify_token === META_VERIFY_TOKEN` it answers `200` with `hub.challenge` as `text/plain`; otherwise `403`.

### `POST /webhooks/whatsapp`

1. Verify `X-Hub-Signature-256 = sha256=HMAC_SHA256(rawBody, META_APP_SECRET)` (constant-time). The raw body is captured only on this route. Missing or bad signature: `403`.
2. De-duplicate by `messages[0].id` (Redis `SET NX`, key `meta:msg:{id}`, TTL 10 min; in-memory fallback). A duplicate is acknowledged with `200` and not processed again.
3. Extract the text (`text.body`, `interactive.button_reply.id`, `interactive.list_reply.id`, or media captions) and route it to Node-RED with an 8 s timeout.
4. POST the returned `graphApiPayload` to `https://graph.facebook.com/v{META_API_VERSION}/{phone_number_id}/messages` (Bearer `META_ACCESS_TOKEN`; `429`/`5xx` are retried with exponential backoff).
5. Answer `200` only if the send succeeded. Node-RED or Graph failures answer `502` and release the de-duplication key so Meta's retry is processed.

Payloads without messages (status updates), messages without text, and messages with no matching intent and no fallback are acknowledged with `200`.

### Intents

- `GET /api/gateway/intents` (JWT)
- `GET | POST /api/admin/intents`, `PUT | DELETE /api/admin/intents/:intent` (JWT + `WRITE`/`ADMIN`)

The catalog lives in intents-service (`INTENTS_SERVICE_URL`). The gateway reads it from `GET /internal/intents` (`X-Internal-Secret`). Writes under `/api/admin/intents` are forwarded to `POST /intents`, `PUT /intents/:name` and `DELETE /intents/:name` with the **caller's JWT forwarded**, so intents-service enforces `WRITE` (create/update) and `ADMIN` (delete, soft). `DELETE` also requires `ADMIN` at the gateway. The gateway's public contract (`intent` field, `{ ok, ... }` envelope) is unchanged; the service status and message are relayed on failure.

### Other

- `GET /api/steps` (JWT): steps catalog proxied from `STEPS_SERVICE_BASE_URL`.
- `POST /api/node-events` (JWT + `WRITE`/`ADMIN`): `node_deleted` events from Node-RED.
- `GET /health`: `{ "ok": true }`.

## Intent detection

Classification is **delegated** to intents-service (`POST /intents/detect`, `X-Internal-Secret`), which returns `{ intent, confidence, matchedKeywords, initialStep }` (see its README for the algorithm). The gateway keeps the orchestration only: receive -> detect -> invoke Node-RED on `initialStep` -> send via Graph.

- No match: use `GATEWAY_FALLBACK_STEP` if configured, otherwise `422` (webhook: acknowledged with `200`).
- intents-service unreachable: `500` on `/api/gateway/message`, `502` on the webhook (the de-duplication key is released so Meta retries). There is no local fallback classifier.

## Tests

`npm test` runs vitest with supertest against the app built through `createApp(overrides)`, with Node-RED, Graph API and intents-service mocked. `test/e2e.pipeline.test.ts` runs the real HTTP adapters against a mocked network (Meta webhook -> gateway -> intents-service -> Node-RED -> Graph) and asserts the payload sent to Graph equals the `graphApiPayload` returned by Node-RED. Covered: 401/403 on admin routes, webhook challenge, signature verification, Graph send, de-duplication, JSON contract of `/api/gateway/message`, `/health` without token.

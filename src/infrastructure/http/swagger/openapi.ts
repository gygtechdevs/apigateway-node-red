import type { OpenAPIV3 } from 'openapi-types';

export const openApiSpec: OpenAPIV3.Document = {
  openapi: '3.0.3',
  info: {
    title: 'Node-RED API Gateway',
    version: '1.0.0',
    description: 'Gateway that detects intents, routes to the initial Node-RED step and bridges the WhatsApp Cloud API.',
  },
  tags: [
    { name: 'Admin', description: 'Intent management (JWT + WRITE or ADMIN)' },
    { name: 'Gateway', description: 'Message routing to Node-RED' },
    { name: 'Webhooks', description: 'WhatsApp Cloud API (Meta) webhook' },
    { name: 'Node Events', description: 'Events emitted by Node-RED (JWT + WRITE)' },
    { name: 'Steps', description: 'Catalog of steps registered in Node-RED (JWT)' },
    { name: 'Health', description: 'Service status' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'HS256 access token issued by auth-service (claims: sub, email, permissions[]).',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'access_token',
        description: 'Same JWT, read from the access_token cookie when no Authorization header is sent.',
      },
      metaSignature: {
        type: 'apiKey',
        in: 'header',
        name: 'X-Hub-Signature-256',
        description: 'sha256=HMAC_SHA256(raw body, META_APP_SECRET).',
      },
    },
    schemas: {
      Intent: {
        type: 'object',
        required: ['intent', 'initialStep', 'keywords'],
        properties: {
          intent: { type: 'string', description: 'Unique intent identifier.' },
          initialStep: { type: 'string', description: 'Path of the initial step in Node-RED.' },
          keywords: { type: 'array', items: { type: 'string' }, description: 'Keywords used to detect the intent.' },
          description: { type: 'string', nullable: true, description: 'Optional intent description.' },
        },
      },
      NodeDeletedEvent: {
        type: 'object',
        required: ['event', 'node_id', 'node_type', 'flow_id', 'timestamp'],
        properties: {
          event: { type: 'string', enum: ['node_deleted'], description: 'Event type. Must be `node_deleted`.' },
          node_id: { type: 'string', description: 'Unique identifier of the deleted node.' },
          node_type: { type: 'string', description: 'Node type (e.g. `step-trigger`).' },
          node_name: { type: 'string', description: 'Human-readable node name (optional).' },
          flow_id: { type: 'string', description: 'Identifier of the flow the node belonged to.' },
          timestamp: { type: 'string', pattern: '^\\d+$', description: 'Unix timestamp in milliseconds as a numeric string.' },
        },
      },
      IntentRef: {
        type: 'object',
        properties: {
          intent: { type: 'string' },
          initialStep: { type: 'string' },
        },
      },
      ErrorResponse: {
        type: 'object',
        properties: {
          ok: { type: 'boolean', example: false },
          error: { type: 'string' },
        },
      },
    },
  },
  paths: {
    '/health': {
      get: {
        summary: 'Health check',
        operationId: 'getHealth',
        tags: ['Health'],
        responses: {
          '200': {
            description: 'Service available.',
            content: {
              'application/json': {
                schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } },
              },
            },
          },
        },
      },
    },
    '/api/admin/intents': {
      get: {
        summary: 'List intents',
        operationId: 'getIntents',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Admin'],
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Missing permission (WRITE or ADMIN).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '200': {
            description: 'List of all intents.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    intents: { type: 'array', items: { $ref: '#/components/schemas/Intent' } },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      post: {
        summary: 'Create intent',
        operationId: 'createIntent',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Admin'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['intent', 'initialStep', 'keywords'],
                properties: {
                  intent: { type: 'string' },
                  initialStep: { type: 'string' },
                  keywords: { type: 'array', items: { type: 'string' }, minItems: 1 },
                  description: { type: 'string' },
                },
              },
              example: { intent: 'plazo_fijo', initialStep: '/stepin/abc123', keywords: ['plazo fijo', 'inversión'], description: 'Fixed-term deposit inquiry' },
            },
          },
        },
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Missing permission (WRITE or ADMIN).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '201': {
            description: 'Intent created.',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true }, intent: { $ref: '#/components/schemas/Intent' } } } } },
          },
          '400': { description: 'Invalid body.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '409': { description: 'An intent with that name already exists.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Internal error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/admin/intents/{intent}': {
      put: {
        summary: 'Update intent',
        operationId: 'updateIntent',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Admin'],
        parameters: [
          { name: 'intent', in: 'path', required: true, schema: { type: 'string' }, description: 'Name of the intent to update.' },
        ],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['initialStep'],
                properties: {
                  initialStep: { type: 'string' },
                  keywords: { type: 'array', items: { type: 'string' } },
                  description: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Missing permission (WRITE or ADMIN).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '200': {
            description: 'Intent updated.',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true }, intent: { $ref: '#/components/schemas/Intent' } } } } },
          },
          '400': { description: 'Invalid body.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Intent not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Internal error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      delete: {
        summary: 'Delete intent',
        operationId: 'deleteIntent',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Admin'],
        parameters: [
          { name: 'intent', in: 'path', required: true, schema: { type: 'string' }, description: 'Name of the intent to delete.' },
        ],
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Missing permission (WRITE or ADMIN).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '200': {
            description: 'Intent deleted.',
            content: { 'application/json': { schema: { type: 'object', properties: { ok: { type: 'boolean', example: true } } } } },
          },
          '404': { description: 'Intent not found.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Internal error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/gateway/intents': {
      get: {
        summary: 'List intents available in the gateway',
        operationId: 'getGatewayIntents',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Gateway'],
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '200': {
            description: 'List of intents.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    intents: { type: 'array', items: { $ref: '#/components/schemas/Intent' } },
                  },
                },
              },
            },
          },
          '500': { description: 'Internal error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/gateway/message': {
      post: {
        summary: 'Route a message to the initial Node-RED step',
        description: 'Detects the intent in the message text and forwards the request to the matching initial step in Node-RED. The text may be sent in `text`, `message.text`, `requirementsText`, `payload.text` or `payload.intentText`. Returns JSON: the Graph API payload built by Node-RED plus a plain-text rendering.',
        operationId: 'routeGatewayMessage',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Gateway'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  text: { type: 'string' },
                  requirementsText: { type: 'string' },
                  message: { type: 'object', properties: { text: { type: 'string' } } },
                  payload: { type: 'object', properties: { text: { type: 'string' }, intentText: { type: 'string' } } },
                },
              },
              example: { text: 'quiero hacer un plazo fijo' },
            },
          },
        },
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '200': {
            description: 'Message routed.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    intent: { type: 'string', nullable: true, example: 'plazo_fijo' },
                    routedStep: { type: 'string', example: '/stepin/abc123' },
                    graphApiPayload: { type: 'object', nullable: true, description: 'WhatsApp Graph API message payload built by Node-RED.' },
                    replyText: { type: 'string', nullable: true, description: 'Plain-text rendering of the reply.' },
                  },
                },
              },
            },
          },
          '400': { description: 'No text was provided to detect the intent.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '422': { description: 'No intent detected and no fallback configured.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '500': { description: 'Unexpected gateway error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/webhooks/whatsapp': {
      get: {
        summary: 'Meta webhook verification (challenge)',
        description: 'Returns hub.challenge as text/plain when hub.mode=subscribe and hub.verify_token matches META_VERIFY_TOKEN.',
        operationId: 'verifyWhatsappWebhook',
        tags: ['Webhooks'],
        parameters: [
          { name: 'hub.mode', in: 'query', required: true, schema: { type: 'string', enum: ['subscribe'] } },
          { name: 'hub.verify_token', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'hub.challenge', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: 'Challenge echoed back.', content: { 'text/plain': { schema: { type: 'string' }, example: 'abc' } } },
          '403': { description: 'Verification failed.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
      post: {
        summary: 'Receive WhatsApp Cloud API events',
        description: 'Verifies X-Hub-Signature-256 over the raw body, de-duplicates by messages[0].id, routes the text to Node-RED (8 s timeout), sends the returned graphApiPayload through the Graph API and answers 200 only if the send succeeded; otherwise a 5xx so Meta retries.',
        operationId: 'receiveWhatsappWebhook',
        tags: ['Webhooks'],
        security: [{ metaSignature: [] }],
        requestBody: { required: true, content: { 'application/json': { schema: { type: 'object' } } } },
        responses: {
          '200': { description: 'Event processed, duplicate or nothing to answer.' },
          '400': { description: 'Body is not valid JSON.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Missing or invalid signature.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '502': { description: 'Node-RED or Graph API failure; Meta will retry.' },
        },
      },
    },
    '/api/steps': {
      get: {
        summary: 'Get the Node-RED steps catalog',
        operationId: 'getSteps',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Steps'],
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '200': {
            description: 'List of registered steps.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    steps: { type: 'array', items: { type: 'object' } },
                  },
                },
              },
            },
          },
          '502': { description: 'The upstream steps service could not be queried.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/node-events': {
      post: {
        summary: 'Receive a node-deleted event from Node-RED',
        description:
          'Accepts the `node_deleted` event emitted by Node-RED. If the node is a `step-trigger`, checks that it is not associated with any intent before accepting the deletion.',
        operationId: 'postNodeEvent',
        security: [{ bearerAuth: [] }, { cookieAuth: [] }],
        tags: ['Node Events'],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                $ref: '#/components/schemas/NodeDeletedEvent',
              },
              example: {
                event: 'node_deleted',
                node_id: 'ebe1ec2b11d8dd6e',
                node_type: 'step-trigger',
                node_name: 'Plazo Fijo Trigger',
                flow_id: 'z',
                timestamp: '1775074885833',
              },
            },
          },
        },
        responses: {
          '401': { description: 'Missing or invalid access token.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '403': { description: 'Missing permission (WRITE or ADMIN).', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '202': {
            description: 'Event received.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: true },
                    received: { $ref: '#/components/schemas/NodeDeletedEvent' },
                  },
                },
              },
            },
          },
          '400': {
            description:
              'Invalid body: a required field is missing, `event` is not `node_deleted` or `timestamp` is not numeric.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
                example: {
                  ok: false,
                  error:
                    'Invalid body. Se espera event=node_deleted y los campos node_id, node_type, node_name, flow_id, timestamp como strings.',
                },
              },
            },
          },
          '409': {
            description:
              'The node is a `step-trigger` associated with one or more intents. Unlink it before deleting it.',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    ok: { type: 'boolean', example: false },
                    error: { type: 'string' },
                    intents: {
                      type: 'array',
                      items: { $ref: '#/components/schemas/IntentRef' },
                    },
                  },
                },
                example: {
                  ok: false,
                  error:
                    "Node 'ebe1ec2b11d8dd6e' is associated with the following intents: plazo_fijo. Unlink it before deleting it.",
                  intents: [
                    { intent: 'plazo_fijo', initialStep: '/stepin/ebe1ec2b11d8dd6e' },
                  ],
                },
              },
            },
          },
          '500': {
            description: 'Internal error while querying intents.',
            content: {
              'application/json': {
                schema: { $ref: '#/components/schemas/ErrorResponse' },
              },
            },
          },
        },
      },
    },
  },
};

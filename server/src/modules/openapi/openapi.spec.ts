import { WEBHOOK_EVENTS } from '../webhook/webhook.service.js';

// Hand-authored OpenAPI 3.1 description of the PUBLIC REST API. Deliberately curated: the public
// surface is a documented subset authenticated by an API key (Bearer pk_live_...), not a dump of
// every internal SPA endpoint. Keep this in sync with the routes it documents; a test asserts the
// documented paths are real. The webhook event payloads live under the 3.1 `webhooks` section.

const errorResponse = {
  description: 'Error',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};
const jsonObject = { type: 'object', additionalProperties: true } as const;

export function buildOpenApiSpec() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'Prismatix Public API',
      version: '1.0.0',
      description:
        'Programmatic, read-only access to your Prismatix workspace. Authenticate with an API key ' +
        '(created in Settings → API keys) sent as `Authorization: Bearer pk_live_...`. All responses ' +
        'are scoped to the key’s workspace.',
    },
    servers: [{ url: '/api/v1', description: 'This deployment' }],
    security: [{ apiKey: [] }],
    tags: [
      { name: 'Portfolio', description: 'Cross-project roll-ups.' },
      { name: 'Projects', description: 'Project records.' },
    ],
    paths: {
      '/portfolio/summary': {
        get: {
          tags: ['Portfolio'],
          summary: 'Portfolio EVM summary',
          description: 'Cross-project earned-value roll-up scoped to the key’s workspace.',
          parameters: [{ name: 'statusDate', in: 'query', required: false, schema: { type: 'string', format: 'date' }, description: 'As-of date (defaults to today).' }],
          responses: {
            200: { description: 'Portfolio summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/PortfolioSummary' } } } },
            401: errorResponse,
          },
        },
      },
      '/portfolio/raid': {
        get: {
          tags: ['Portfolio'],
          summary: 'Portfolio RAID roll-up',
          description: 'Risks, Assumptions, Issues and Dependencies across the workspace’s projects.',
          responses: { 200: { description: 'RAID roll-up', content: { 'application/json': { schema: jsonObject } } }, 401: errorResponse },
        },
      },
      '/portfolio/evm/trend': {
        get: {
          tags: ['Portfolio'],
          summary: 'Portfolio EVM trend',
          description: 'Rolled-up EVM trend series from captured per-project snapshots.',
          responses: { 200: { description: 'Trend series', content: { 'application/json': { schema: jsonObject } } }, 401: errorResponse },
        },
      },
      '/projects': {
        get: {
          tags: ['Projects'],
          summary: 'List projects',
          description: 'Lists the workspace’s projects. Requires a key with an ADMIN or PMO role.',
          responses: {
            200: { description: 'Projects', content: { 'application/json': { schema: { type: 'array', items: { $ref: '#/components/schemas/Project' } } } } },
            401: errorResponse,
            403: errorResponse,
          },
        },
      },
    },
    // OpenAPI 3.1 `webhooks`: events Prismatix POSTs to a subscribed endpoint. Each is signed with
    // the subscription secret (see the security note in the schema). Return any 2xx to acknowledge.
    webhooks: {
      'project.created': {
        post: {
          summary: 'A project was created',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEnvelope' } } } },
          responses: { '2XX': { description: 'Acknowledged' } },
        },
      },
      'baseline.locked': {
        post: {
          summary: 'A project baseline was locked',
          requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/WebhookEnvelope' } } } },
          responses: { '2XX': { description: 'Acknowledged' } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKey: {
          type: 'http',
          scheme: 'bearer',
          description: 'A Prismatix API key, e.g. `pk_live_...`. Read-only; scoped to one workspace.',
        },
      },
      schemas: {
        Error: {
          type: 'object',
          properties: { error: { type: 'object', properties: { code: { type: 'string' }, message: { type: 'string' } } } },
        },
        Project: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            code: { type: 'string' },
            name: { type: 'string' },
            status: { type: 'string' },
            deliveryApproach: { type: 'string', enum: ['PREDICTIVE', 'AGILE'] },
          },
        },
        PortfolioSummary: {
          type: 'object',
          description: 'EVM roll-up. Shape mirrors the app’s portfolio summary.',
          additionalProperties: true,
        },
        WebhookEnvelope: {
          type: 'object',
          description: 'The body Prismatix POSTs for every webhook. Verify the `X-Prismatix-Signature` ' +
            'header: `t=<unix>,v1=<hex>` where v1 = HMAC-SHA256(secret, `${t}.${rawBody}`).',
          properties: {
            id: { type: 'string', description: 'Delivery id (also in X-Prismatix-Delivery).' },
            event: { type: 'string', enum: [...WEBHOOK_EVENTS] },
            createdAt: { type: 'string', format: 'date-time' },
            data: { type: 'object', additionalProperties: true, description: 'Event-specific payload.' },
          },
        },
      },
    },
  };
}

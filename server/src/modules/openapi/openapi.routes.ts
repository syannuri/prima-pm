import { Router } from 'express';
import { buildOpenApiSpec } from './openapi.spec.js';

// Public API documentation (T3.4): the machine-readable spec + a rendered reference page. Both are
// PUBLIC (no auth) — an API's docs are meant to be read before you have a key. Mounted on /api/v1.
const router = Router();

// The OpenAPI 3.1 document.
router.get('/openapi.json', (_req, res) => {
  res.json(buildOpenApiSpec());
});

// A rendered reference, via Redoc from its CDN (whitelisted in the app CSP). It fetches the spec
// above from the same origin.
const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Prismatix API reference</title>
    <meta name="robots" content="noindex" />
  </head>
  <body>
    <redoc spec-url="/api/v1/openapi.json"></redoc>
    <script src="https://cdn.redocly.com/redoc/latest/bundles/redoc.standalone.js"></script>
  </body>
</html>`;

router.get('/docs', (_req, res) => {
  res.type('html').send(DOCS_HTML);
});

export default router;

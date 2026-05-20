// /openapi.json — OpenAPI 3.1 discovery surface for /guard/*.
// Spec content lives in src/openapi/spec.ts (hand-curated, see SPEC §9.1 Variante III).

import { Hono } from 'hono';
import { spec } from '../openapi/spec.js';

const app = new Hono();

app.get('/openapi.json', (c) => c.json(spec));

export default app;

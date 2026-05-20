// Public events feed — exposes anomaly + multi_outcome events from the
// MoltGuard Polymarket events scanner (Python agent at ~/moltstack/agents/moltguard.py).
// File is refreshed every 6h by cron (30 */6 * * *).

import { Hono } from 'hono';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const EVENTS_FILE = join(process.cwd(), '..', 'moltstack', 'data', 'moltguard_events.json');

const app = new Hono();

app.get('/events/feed', (c) => {
  if (!existsSync(EVENTS_FILE)) {
    return c.json({ error: 'no_data', message: 'Events scan has not run yet' }, 404);
  }
  try {
    const data = JSON.parse(readFileSync(EVENTS_FILE, 'utf-8'));
    return c.json({
      last_scan: data.last_scan,
      total_events_scanned: data.total_events_scanned,
      anomaly_count: data.anomaly_count,
      multi_outcome_count: data.multi_outcome_count,
      events: data.events || [],
    });
  } catch (e: any) {
    return c.json({ error: 'parse_error', message: String(e?.message ?? e) }, 500);
  }
});

export default app;

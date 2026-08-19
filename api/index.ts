/**
 * Vercel serverless entry point.
 *
 * Vercel treats every file under /api as a function. This one wraps the whole
 * Express app, so a single function serves the entire API and all the routing,
 * middleware and abuse protection behave exactly as they do when the app runs
 * as a normal long-lived server.
 *
 * The app is built once per container and reused across warm invocations —
 * rebuilding it per request would re-create the Prisma client and the rate
 * limiters every time.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from '../server/src/index';
import { loadBlocks } from '../server/src/lib/abuse';

type Handler = (req: IncomingMessage, res: ServerResponse) => void;

let app: Handler | null = null;
let warming: Promise<void> | null = null;

function getApp(): Handler {
  if (!app) app = createApp() as unknown as Handler;
  return app;
}

/**
 * Pull the active block list into this container's memory once, so blocked
 * sources are rejected from a map lookup rather than a query per request.
 * Failure is non-fatal: `blockedForShared` still consults the database.
 */
function warmUp(): Promise<void> {
  if (!warming) warming = loadBlocks().then(() => undefined).catch(() => undefined);
  return warming;
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  await warmUp();
  return getApp()(req, res);
}

import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import os from 'node:os';
import express from 'express';
import helmet from 'helmet';
import compression from 'compression';
import cookieParser from 'cookie-parser';

import { config } from './config';
import { closeDatabase, initDatabase } from './lib/db';
import { ah, errorHandler, notFoundHandler } from './lib/errors';
import { loadSession, originGuard } from './middleware/auth';
import { apiLimiter } from './middleware/rateLimit';
import { blockGuard, botHint, offenceWatcher, scannerTrap } from './middleware/abuse';
import { loadBlocks } from './lib/abuse';
import { safeEqual } from './lib/crypto';
import { audit } from './lib/audit';
import { runHousekeeping, startScheduler, stopScheduler } from './scheduler';

import { authRouter } from './routes/auth';
import { tasksRouter } from './routes/tasks';
import { organizationRouter } from './routes/organization';
import { goalsRouter } from './routes/goals';
import { habitsRouter } from './routes/habits';
import { focusRouter } from './routes/focus';
import { notesRouter } from './routes/notes';
import { reviewsRouter } from './routes/reviews';
import { dashboardRouter } from './routes/dashboard';
import { analyticsRouter } from './routes/analytics';
import { settingsRouter } from './routes/settings';
import { backupRouter } from './routes/backup';

export function createApp() {
  const app = express();

  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', 1);

  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: false,
        directives: {
          defaultSrc: ["'self'"],
          baseUri: ["'self'"],
          scriptSrc: ["'self'"],
          // Tailwind and the chart library set inline style attributes.
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:', 'blob:'],
          fontSrc: ["'self'", 'data:'],
          connectSrc: ["'self'", ...config.extraOrigins],
          manifestSrc: ["'self'"],
          workerSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: config.cookie.secure ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-origin' },
      referrerPolicy: { policy: 'no-referrer' },
      hsts: config.cookie.secure ? { maxAge: 31_536_000, includeSubDomains: true } : false,
    }),
  );

  app.use((_req, res, next) => {
    // A private productivity log should never be indexed or cached by a proxy.
    res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=(), interest-cohort=()');
    next();
  });

  // --- abuse protection, before anything expensive runs -------------------
  // A blocked source is rejected on a map lookup; scanners never reach routing.
  app.use(blockGuard);
  app.use(scannerTrap);
  app.use(botHint);
  app.use(offenceWatcher);

  app.use(compression());
  // Bodies are capped well below the import ceiling everywhere except the two
  // bulk-data routes, which raise it themselves.
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());

  // Nothing here should ever be indexed or crawled.
  app.get('/robots.txt', (_req, res) => {
    res.type('text/plain').send('User-agent: *\nDisallow: /\n');
  });

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, app: 'TarangOS', time: new Date().toISOString() });
  });

  app.use('/api', apiLimiter, originGuard(config.extraOrigins), loadSession);

  app.use('/api/auth', authRouter);
  app.use('/api/tasks', tasksRouter);
  app.use('/api/org', organizationRouter);
  app.use('/api/goals', goalsRouter);
  app.use('/api/habits', habitsRouter);
  app.use('/api/focus', focusRouter);
  app.use('/api/notes', notesRouter);
  app.use('/api/reviews', reviewsRouter);
  app.use('/api/dashboard', dashboardRouter);
  app.use('/api/analytics', analyticsRouter);
  app.use('/api/settings', settingsRouter);
  app.use('/api/backup', backupRouter);

  /**
   * Scheduled housekeeping.
   *
   * A long-running server runs this on a timer. Serverless functions do not
   * exist between requests, so there is no timer to run — the platform's cron
   * calls this endpoint instead. Guarded by a shared secret because it is
   * reachable from the internet.
   */
  app.all(
    '/api/cron/housekeeping',
    ah(async (req: express.Request, res: express.Response) => {
      const provided =
        (req.get('authorization') || '').replace(/^Bearer\s+/i, '') ||
        String(req.query.secret || '');

      if (!config.cronSecret || !provided || !safeEqual(provided, config.cronSecret)) {
        audit(req, 'cron.denied', { ok: false });
        res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Invalid cron secret' } });
        return;
      }

      const result = await runHousekeeping();
      res.json({ ok: true, ...result });
    }),
  );

  app.use('/api', notFoundHandler);

  // ---- static SPA ---------------------------------------------------------
  if (fs.existsSync(config.webDist)) {
    app.use(
      express.static(config.webDist, {
        index: false,
        maxAge: '30d',
        setHeaders(res, filePath) {
          if (filePath.endsWith('index.html') || filePath.endsWith('sw.js')) {
            res.setHeader('Cache-Control', 'no-cache');
          }
        },
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(config.webDist, 'index.html'));
    });
  } else {
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next();
      res.status(503).type('text/plain').send(
        'TarangOS web build not found.\nRun "npm run build" first, or use "npm run dev" for development.',
      );
    });
  }

  app.use(errorHandler);
  return app;
}

function localAddresses(port: number, scheme: string): string[] {
  const nets = os.networkInterfaces();
  const out: string[] = [`${scheme}://localhost:${port}`];
  for (const list of Object.values(nets)) {
    for (const net of list ?? []) {
      if (net.family === 'IPv4' && !net.internal) out.push(`${scheme}://${net.address}:${port}`);
    }
  }
  return out;
}

async function main() {
  await initDatabase();
  const restored = await loadBlocks();
  if (restored > 0) {
    // eslint-disable-next-line no-console
    console.log(`[tarangos] ${restored} active block(s) restored — a restart does not clear them`);
  }
  const app = createApp();

  const useTls = Boolean(config.tls.keyFile && config.tls.certFile);
  const server = useTls
    ? https.createServer(
        { key: fs.readFileSync(config.tls.keyFile), cert: fs.readFileSync(config.tls.certFile) },
        app,
      )
    : http.createServer(app);

  server.listen(config.port, config.host, () => {
    const scheme = useTls ? 'https' : 'http';
    // eslint-disable-next-line no-console
    console.log('\n  TarangOS is running\n');
    for (const url of localAddresses(config.port, scheme)) {
      // eslint-disable-next-line no-console
      console.log(`   ${url}`);
    }
    // eslint-disable-next-line no-console
    console.log(`\n   data:    ${config.dataDir}`);
    // eslint-disable-next-line no-console
    console.log(`   backups: ${config.backupDir}`);
    if (!useTls && config.cookie.secure) {
      // eslint-disable-next-line no-console
      console.log(
        '\n   Note: cookies are marked Secure but TLS is off. For plain-HTTP LAN access\n' +
          '   set ALLOW_INSECURE_COOKIE=true, or configure TLS_KEY_FILE / TLS_CERT_FILE.',
      );
    }
    // eslint-disable-next-line no-console
    console.log('');
    startScheduler();
  });

  const close = async (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`\n[tarangos] ${signal} received, shutting down…`);
    stopScheduler();
    server.close();
    await closeDatabase();
    process.exit(0);
  };

  process.on('SIGINT', () => void close('SIGINT'));
  process.on('SIGTERM', () => void close('SIGTERM'));
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[tarangos] failed to start:', err);
    process.exit(1);
  });
}

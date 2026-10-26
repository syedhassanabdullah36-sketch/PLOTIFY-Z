/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import path from 'path';
import express from 'express';
import { createApp } from './server/app';

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';

async function startServer(): Promise<void> {
  const app = createApp();

  if (process.env.NODE_ENV === 'production') {
    const distPath = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  } else {
    // Development mode: Dynamically mount Vite middleware if vite is available
    try {
      const { createServer: createViteServer } = await import('vite');
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: 'spa',
      });
      app.use(vite.middlewares);
    } catch (err) {
      console.warn('[Server] Running Express API only (Vite dev middleware not loaded):', err);
    }
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`[Plotify Gateway] Server running at http://${HOST}:${PORT}`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error('[Plotify Gateway] Server listen error:', err);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[Plotify Gateway] Shutting down gracefully...');
    server.close(() => {
      process.exit(0);
    });
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
  process.on('uncaughtException', (err) => {
    console.error('[Plotify Gateway] Uncaught exception:', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[Plotify Gateway] Unhandled rejection:', reason);
  });
}

import { fileURLToPath } from 'url';

// Only start when invoked directly as main module
const isMainModule = Boolean(
  process.argv[1] &&
    (import.meta.url === `file://${process.argv[1]}` ||
      fileURLToPath(import.meta.url) === path.resolve(process.argv[1]))
);

if (isMainModule) {
  startServer().catch((err) => {
    console.error('[Plotify Gateway] Fatal startup error:', err);
    process.exit(1);
  });
}

export { startServer };

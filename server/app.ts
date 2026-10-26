/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import express, { Express, Request, Response, NextFunction } from 'express';
import { authenticateUser, authorizeTenantMembership } from './middleware/auth';
import { projectsRouter } from './routes/projects';
import { snapshotsRouter } from './routes/snapshots';
import { archivesRouter } from './routes/archives';

export function createApp(): Express {
  const app = express();

  // Middleware: Request Body Parsing & Limits
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Security Headers
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    next();
  });

  // Public Health Endpoint
  app.get('/api/health', (req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      package: 'P53-STAGE1',
      service: 'Plotify Architecture Intelligence OS API Gateway',
      timestamp: new Date().toISOString(),
    });
  });

  // Protected API Routes: Require Authentication AND Tenant Authorization
  const protectedApi = express.Router();
  protectedApi.use(authenticateUser);
  protectedApi.use(authorizeTenantMembership);

  // Mount API Sub-routers
  protectedApi.use('/projects/:id/snapshots', snapshotsRouter);
  protectedApi.use('/projects', projectsRouter);
  protectedApi.use('/archives', archivesRouter);

  app.use('/api', protectedApi);

  // Global 404 Handler for API routes
  app.all('/api/*', (req: Request, res: Response) => {
    res.status(404).json({
      error: `API route not found: ${req.method} ${req.path}`,
      code: 'ERR_ROUTE_NOT_FOUND',
    });
  });

  // Centralized Error Handler (Zero Sensitive Info Leakage)
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    console.error('[API Gateway Error]:', err?.message || err);

    if (res.headersSent) {
      return next(err);
    }

    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;
    res.status(statusCode).json({
      error: 'An internal server error occurred.',
      code: 'ERR_INTERNAL_SERVER_ERROR',
    });
  });

  return app;
}

export const app = createApp();

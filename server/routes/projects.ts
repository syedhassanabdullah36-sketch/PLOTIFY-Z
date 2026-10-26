/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { getAppPool } from '../db/pool';
import { withTenantContext } from '../db/tenantContext';
import { Project } from '../../src/types/project';

export const projectsRouter = Router();

// Regular expression for validating RFC 4122 UUIDs
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  // Project identifiers in PostgreSQL are typed as UUID. Reject legacy strings like "proj-001".
  return UUID_REGEX.test(id.trim());
}

/**
 * GET /api/projects
 * Lists projects for the authenticated tenant with safe pagination.
 */
projectsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant!.id;

  // Validate pagination parameters
  let limit = 50; // default limit
  let offset = 0; // default offset

  if (req.query.limit !== undefined) {
    const parsedLimit = Number(req.query.limit);
    if (!Number.isInteger(parsedLimit) || parsedLimit < 1 || parsedLimit > 100) {
      res.status(400).json({
        error: 'Invalid "limit" parameter. Must be an integer between 1 and 100.',
        code: 'ERR_INVALID_PAGINATION',
      });
      return;
    }
    limit = parsedLimit;
  }

  if (req.query.offset !== undefined) {
    const parsedOffset = Number(req.query.offset);
    if (!Number.isInteger(parsedOffset) || parsedOffset < 0) {
      res.status(400).json({
        error: 'Invalid "offset" parameter. Must be a non-negative integer.',
        code: 'ERR_INVALID_PAGINATION',
      });
      return;
    }
    offset = parsedOffset;
  }

  const pool = getAppPool();

  try {
    const { projects, total } = await withTenantContext(pool, tenantId, async (client) => {
      const countRes = await client.query<{ count: string }>(
        `SELECT COUNT(*) AS count FROM projects WHERE organization_id = $1`,
        [tenantId]
      );
      const totalCount = parseInt(countRes.rows[0]?.count || '0', 10);

      const dbRes = await client.query<{
        id: string;
        organization_id: string;
        name: string;
        project_type: string;
        status: string;
        unit: string;
        budget: string | number;
        currency: string;
        data: Partial<Project>;
        created_at: Date;
        updated_at: Date;
      }>(
        `SELECT id, organization_id, name, project_type, status, unit, budget, currency, data, created_at, updated_at
         FROM projects
         WHERE organization_id = $1
         ORDER BY updated_at DESC
         LIMIT $2 OFFSET $3`,
        [tenantId, limit, offset]
      );

      const mapped = dbRes.rows.map((row) => ({
        ...row.data,
        id: row.id,
        name: row.name,
        projectType: row.project_type as any,
        status: row.status as any,
        unit: row.unit as any,
        budget: Number(row.budget),
        currency: row.currency as any,
      }));

      return { projects: mapped, total: totalCount };
    });

    res.json({ projects, total, limit, offset });
  } catch (err: any) {
    console.error('[Projects API] GET /api/projects error:', err.message);
    res.status(500).json({
      error: 'Failed to retrieve projects from database.',
      code: 'ERR_DATABASE_QUERY',
    });
  }
});

/**
 * GET /api/projects/:id
 * Fetches a single project by ID for the authenticated tenant.
 */
projectsRouter.get('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.tenant!.id;

  if (!isValidId(id)) {
    res.status(400).json({
      error: `Invalid project identifier: "${id}".`,
      code: 'ERR_INVALID_ID',
    });
    return;
  }

  const pool = getAppPool();

  try {
    const project = await withTenantContext(pool, tenantId, async (client) => {
      const dbRes = await client.query<{
        id: string;
        name: string;
        project_type: string;
        status: string;
        unit: string;
        budget: string | number;
        currency: string;
        data: Partial<Project>;
      }>(
        `SELECT id, name, project_type, status, unit, budget, currency, data
         FROM projects
         WHERE id = $1 AND organization_id = $2`,
        [id, tenantId]
      );

      if (dbRes.rows.length === 0) return null;

      const row = dbRes.rows[0];
      return {
        ...row.data,
        id: row.id,
        name: row.name,
        projectType: row.project_type as any,
        status: row.status as any,
        unit: row.unit as any,
        budget: Number(row.budget),
        currency: row.currency as any,
      };
    });

    if (!project) {
      res.status(404).json({
        error: `Project with ID "${id}" was not found in this organization.`,
        code: 'ERR_PROJECT_NOT_FOUND',
      });
      return;
    }

    res.json({ project });
  } catch (err: any) {
    console.error(`[Projects API] GET /api/projects/${id} error:`, err.message);
    res.status(500).json({
      error: 'Failed to retrieve project details.',
      code: 'ERR_DATABASE_QUERY',
    });
  }
});

/**
 * POST /api/projects
 * Creates a new project in the authenticated tenant.
 */
projectsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const tenantId = req.tenant!.id;
  const body = req.body as Partial<Project>;

  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Invalid request body. Expected project JSON object.',
      code: 'ERR_INVALID_BODY',
    });
    return;
  }

  if (!body.name || typeof body.name !== 'string' || body.name.trim().length === 0) {
    res.status(400).json({
      error: 'Project "name" is required and must be a non-empty string.',
      code: 'ERR_VALIDATION_NAME',
    });
    return;
  }

  if (body.name.trim().length > 255) {
    res.status(400).json({
      error: 'Project "name" must not exceed 255 characters.',
      code: 'ERR_VALIDATION_NAME',
    });
    return;
  }

  if (body.budget !== undefined && body.budget !== null) {
    if (typeof body.budget !== 'number' || !Number.isFinite(body.budget) || body.budget < 0) {
      res.status(400).json({
        error: 'Project "budget" must be a non-negative finite number.',
        code: 'ERR_VALIDATION_BUDGET',
      });
      return;
    }
  }

  if (body.id !== undefined && body.id !== null) {
    if (typeof body.id !== 'string' || !isValidId(body.id)) {
      res.status(400).json({
        error: `Invalid project identifier: "${body.id}". If supplied, project "id" must be a valid RFC 4122 UUID. Legacy IDs (e.g. "proj-001") must be mapped via idMapping before direct API submission.`,
        code: 'ERR_INVALID_PROJECT_ID',
      });
      return;
    }
  }

  const pool = getAppPool();

  try {
    const createdProject = await withTenantContext(pool, tenantId, async (client) => {
      const projectId = body.id ? body.id.trim().toLowerCase() : crypto.randomUUID();
      const name = body.name!.trim();
      const projectType = body.projectType || 'house';
      const status = body.status || 'Drafting';
      const unit = body.unit || 'feet';
      const budget = typeof body.budget === 'number' ? body.budget : 0;
      const currency = body.currency || 'USD';

      // Enforce tenant identity inside serialized metadata and prevent client tenant injection
      const sanitizedBody: Partial<Project> & Record<string, unknown> = {
        ...body,
        id: projectId,
        organizationId: tenantId,
      };
      delete sanitizedBody.organization_id;

      const serializedData = JSON.stringify(sanitizedBody);

      const insertRes = await client.query<{ id: string; created_at: Date; updated_at: Date }>(
        `INSERT INTO projects (
           id, organization_id, name, project_type, status, unit, budget, currency, data, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp(), clock_timestamp())
         RETURNING id, created_at, updated_at`,
        [projectId, tenantId, name, projectType, status, unit, budget, currency, serializedData]
      );

      return {
        ...sanitizedBody,
        id: insertRes.rows[0].id,
        name,
        projectType,
        status,
        unit,
        budget,
        currency,
      };
    });

    res.status(201).json({ project: createdProject });
  } catch (err: any) {
    console.error('[Projects API] POST /api/projects error:', err.message);
    res.status(500).json({
      error: 'Failed to create project in database.',
      code: 'ERR_DATABASE_INSERT',
    });
  }
});

/**
 * PUT /api/projects/:id
 * Updates an existing project in the authenticated tenant.
 */
projectsRouter.put('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.tenant!.id;
  const updates = req.body as Partial<Project>;

  if (!isValidId(id)) {
    res.status(400).json({
      error: `Invalid project identifier: "${id}".`,
      code: 'ERR_INVALID_ID',
    });
    return;
  }

  if (!updates || typeof updates !== 'object') {
    res.status(400).json({
      error: 'Invalid request body. Expected project JSON object.',
      code: 'ERR_INVALID_BODY',
    });
    return;
  }

  if (updates.name !== undefined) {
    if (typeof updates.name !== 'string' || updates.name.trim().length === 0) {
      res.status(400).json({
        error: 'Project "name" must be a non-empty string.',
        code: 'ERR_VALIDATION_NAME',
      });
      return;
    }
    if (updates.name.trim().length > 255) {
      res.status(400).json({
        error: 'Project "name" must not exceed 255 characters.',
        code: 'ERR_VALIDATION_NAME',
      });
      return;
    }
  }

  if (updates.budget !== undefined && updates.budget !== null) {
    if (typeof updates.budget !== 'number' || !Number.isFinite(updates.budget) || updates.budget < 0) {
      res.status(400).json({
        error: 'Project "budget" must be a non-negative finite number.',
        code: 'ERR_VALIDATION_BUDGET',
      });
      return;
    }
  }

  const pool = getAppPool();

  try {
    const updated = await withTenantContext(pool, tenantId, async (client) => {
      // Check existing row
      const existingRes = await client.query<{ data: Partial<Project> }>(
        `SELECT data FROM projects WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
        [id, tenantId]
      );

      if (existingRes.rows.length === 0) return null;

      // Enforce organizationId in mergedData cannot be changed
      const mergedData: Partial<Project> & Record<string, unknown> = {
        ...existingRes.rows[0].data,
        ...updates,
        id,
        organizationId: tenantId,
      };
      delete mergedData.organization_id;

      const name = updates.name ? updates.name.trim() : (mergedData.name || 'Untitled Project');
      const projectType = updates.projectType || mergedData.projectType || 'house';
      const status = updates.status || mergedData.status || 'Drafting';
      const budget = typeof updates.budget === 'number' ? updates.budget : (mergedData.budget || 0);

      await client.query(
        `UPDATE projects 
         SET name = $1, project_type = $2, status = $3, budget = $4, data = $5, updated_at = clock_timestamp()
         WHERE id = $6 AND organization_id = $7`,
        [name, projectType, status, budget, JSON.stringify(mergedData), id, tenantId]
      );

      return mergedData;
    });

    if (!updated) {
      res.status(404).json({
        error: `Project "${id}" not found or unauthorized.`,
        code: 'ERR_PROJECT_NOT_FOUND',
      });
      return;
    }

    res.json({ project: updated });
  } catch (err: any) {
    console.error(`[Projects API] PUT /api/projects/${id} error:`, err.message);
    res.status(500).json({
      error: 'Failed to update project in database.',
      code: 'ERR_DATABASE_UPDATE',
    });
  }
});

/**
 * DELETE /api/projects/:id
 * Removes a project and all associated cascading snapshots from the tenant.
 */
projectsRouter.delete('/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const tenantId = req.tenant!.id;

  if (!isValidId(id)) {
    res.status(400).json({
      error: `Invalid project identifier: "${id}".`,
      code: 'ERR_INVALID_ID',
    });
    return;
  }

  const pool = getAppPool();

  try {
    const deleted = await withTenantContext(pool, tenantId, async (client) => {
      const delRes = await client.query(
        `DELETE FROM projects WHERE id = $1 AND organization_id = $2`,
        [id, tenantId]
      );
      return delRes.rowCount && delRes.rowCount > 0;
    });

    if (!deleted) {
      res.status(404).json({
        error: `Project "${id}" not found or unauthorized.`,
        code: 'ERR_PROJECT_NOT_FOUND',
      });
      return;
    }

    res.json({ success: true, id });
  } catch (err: any) {
    console.error(`[Projects API] DELETE /api/projects/${id} error:`, err.message);
    res.status(500).json({
      error: 'Failed to delete project from database.',
      code: 'ERR_DATABASE_DELETE',
    });
  }
});

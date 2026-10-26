/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Router, Request, Response } from 'express';
import { getAppPool } from '../db/pool';
import {
  createProjectSnapshot,
  listProjectSnapshots,
  CreateSnapshotInput,
} from '../services/snapshotService';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isValidProjectId(id: string): boolean {
  if (!id || typeof id !== 'string') return false;
  return UUID_REGEX.test(id.trim());
}

export const snapshotsRouter = Router({ mergeParams: true });

/**
 * GET /api/projects/:id/snapshots
 * Lists all revisions for a project in descending order.
 */
snapshotsRouter.get('/', async (req: Request, res: Response): Promise<void> => {
  const { id: projectId } = req.params;
  const tenantId = req.tenant!.id;

  if (!isValidProjectId(projectId)) {
    res.status(400).json({
      error: `Invalid project identifier: "${projectId}". Must be a valid RFC 4122 UUID.`,
      code: 'ERR_INVALID_PROJECT_ID',
    });
    return;
  }

  const pool = getAppPool();

  try {
    const snapshots = await listProjectSnapshots(pool, tenantId, projectId);
    res.json({ snapshots });
  } catch (err: any) {
    console.error(`[Snapshots API] GET /snapshots error:`, err.message);
    res.status(500).json({
      error: 'Failed to retrieve project snapshots.',
      code: 'ERR_DATABASE_QUERY',
    });
  }
});

/**
 * POST /api/projects/:id/snapshots
 * Atomically generates a serialized snapshot with parent-project row lock.
 */
snapshotsRouter.post('/', async (req: Request, res: Response): Promise<void> => {
  const { id: projectId } = req.params;
  const tenantId = req.tenant!.id;

  if (!isValidProjectId(projectId)) {
    res.status(400).json({
      error: `Invalid project identifier: "${projectId}". Must be a valid RFC 4122 UUID.`,
      code: 'ERR_INVALID_PROJECT_ID',
    });
    return;
  }
  const body = req.body;

  if (!body || typeof body !== 'object') {
    res.status(400).json({
      error: 'Invalid request body. Expected snapshot payload.',
      code: 'ERR_INVALID_BODY',
    });
    return;
  }

  if (!body.label || typeof body.label !== 'string') {
    res.status(400).json({
      error: 'Snapshot "label" is required.',
      code: 'ERR_VALIDATION_LABEL',
    });
    return;
  }

  if (!body.projectData || typeof body.projectData !== 'object') {
    res.status(400).json({
      error: 'Snapshot "projectData" is required and must contain project state.',
      code: 'ERR_VALIDATION_PROJECT_DATA',
    });
    return;
  }

  const pool = getAppPool();

  const snapshotInput: CreateSnapshotInput = {
    projectId,
    organizationId: tenantId,
    versionTag: body.versionTag || 'v1.0',
    label: body.label.trim(),
    description: body.description || '',
    trigger: body.trigger || 'manual',
    authorId: req.user?.id || undefined,
    metrics: body.metrics || {},
    projectData: body.projectData,
  };

  try {
    const createdSnapshot = await createProjectSnapshot(pool, snapshotInput);
    res.status(201).json({ snapshot: createdSnapshot });
  } catch (err: any) {
    console.error(`[Snapshots API] POST /snapshots error:`, err.message);
    if (err.message && err.message.includes('not found')) {
      res.status(404).json({
        error: err.message,
        code: 'ERR_PROJECT_NOT_FOUND',
      });
      return;
    }
    res.status(500).json({
      error: 'Failed to create project snapshot.',
      code: 'ERR_SNAPSHOT_CREATION_FAILED',
    });
  }
});

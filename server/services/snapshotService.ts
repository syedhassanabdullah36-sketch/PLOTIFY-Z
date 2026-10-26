/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { Project } from '../../src/types/project';
import { ProjectSnapshot, SnapshotTrigger } from '../../src/types/versioning';
import { withTenantContext } from '../db/tenantContext';

export interface CreateSnapshotInput {
  projectId: string;
  organizationId: string;
  versionTag: string;
  label: string;
  description?: string;
  trigger: SnapshotTrigger;
  authorId?: string;
  metrics?: Record<string, unknown>;
  projectData: Project;
}

export interface DbSnapshotRecord {
  id: string;
  project_id: string;
  organization_id: string;
  revision: number;
  version_tag: string;
  label: string;
  description: string | null;
  trigger: string;
  author_id: string | null;
  metrics: Record<string, unknown>;
  project_data: Project;
  checksum: string;
  created_at: Date;
}

/**
 * Computes deterministic SHA-256 fingerprint of a project state.
 */
export function computeProjectDataChecksum(projectData: Project): string {
  const serialized = JSON.stringify(projectData);
  return crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');
}

/**
 * Atomically creates a project snapshot with sequential revision numbering
 * guaranteed via an exclusive row-level lock on the parent project row.
 */
export async function createSnapshotWithClient(
  client: PoolClient,
  input: CreateSnapshotInput
): Promise<DbSnapshotRecord> {
  const {
    projectId,
    organizationId,
    versionTag,
    label,
    description = '',
    trigger,
    authorId = null,
    metrics = {},
    projectData,
  } = input;

  // 1. Acquire exclusive row-level lock on parent project
  const projectLockRes = await client.query<{ id: string }>(
    `SELECT id FROM projects WHERE id = $1 AND organization_id = $2 FOR UPDATE`,
    [projectId, organizationId]
  );

  if (projectLockRes.rows.length === 0) {
    throw new Error(
      `Project "${projectId}" not found in tenant "${organizationId}" or access denied.`
    );
  }

  // 2. Compute the next sequential revision number
  const revRes = await client.query<{ next_rev: number }>(
    `SELECT COALESCE(MAX(revision), 0) + 1 AS next_rev 
     FROM project_snapshots 
     WHERE project_id = $1 AND organization_id = $2`,
    [projectId, organizationId]
  );

  const nextRevision = revRes.rows[0].next_rev;
  const checksum = computeProjectDataChecksum(projectData);

  // 3. Insert snapshot row
  const insertRes = await client.query<DbSnapshotRecord>(
    `INSERT INTO project_snapshots (
       id, project_id, organization_id, revision, version_tag, label,
       description, trigger, author_id, metrics, project_data, checksum, created_at
     )
     VALUES (
       gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, clock_timestamp()
     )
     RETURNING *`,
    [
      projectId,
      organizationId,
      nextRevision,
      versionTag,
      label,
      description,
      trigger,
      authorId,
      JSON.stringify(metrics),
      JSON.stringify(projectData),
      checksum,
    ]
  );

  return insertRes.rows[0];
}

/**
 * Top-level convenience wrapper setting tenant context and creating snapshot.
 */
export async function createProjectSnapshot(
  pool: Pool,
  input: CreateSnapshotInput
): Promise<DbSnapshotRecord> {
  return withTenantContext(pool, input.organizationId, async (client) => {
    return createSnapshotWithClient(client, input);
  });
}

/**
 * Lists all snapshots for a project in descending revision order.
 */
export async function listProjectSnapshots(
  pool: Pool,
  tenantId: string,
  projectId: string
): Promise<DbSnapshotRecord[]> {
  return withTenantContext(pool, tenantId, async (client) => {
    const res = await client.query<DbSnapshotRecord>(
      `SELECT * FROM project_snapshots 
       WHERE project_id = $1 AND organization_id = $2 
       ORDER BY revision DESC`,
      [projectId, tenantId]
    );
    return res.rows;
  });
}

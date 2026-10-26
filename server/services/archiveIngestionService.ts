/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { Pool, PoolClient } from 'pg';
import { Project } from '../../src/types/project';
import { withTenantContext } from '../db/tenantContext';
import { computeProjectDataChecksum } from './snapshotService';

export const MAX_PROJECTS_PER_ARCHIVE = 100;
export const MAX_PAYLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

export interface ProjectArchiveItem {
  project: Project;
  snapshots?: Array<{
    revision: number;
    versionTag: string;
    label: string;
    description?: string;
    trigger: string;
    metrics?: Record<string, unknown>;
    projectData: Project;
  }>;
}

export interface ProjectArchivePayload {
  archiveVersion: string;
  archiveName: string;
  exportedAt: string;
  tenantId?: string;
  items: ProjectArchiveItem[];
}

export interface ArchiveValidationResult {
  valid: boolean;
  errors: string[];
  projectCount: number;
  sizeBytes: number;
}

export interface IngestionResult {
  jobId: string;
  archiveName: string;
  projectsIngested: number;
  snapshotsIngested: number;
  durationMs: number;
}

/**
 * Validates the raw uncompressed archive payload against strict size,
 * project-count, and schema integrity constraints.
 */
export function validateArchivePayload(rawPayload: unknown): ArchiveValidationResult {
  const errors: string[] = [];

  if (!rawPayload || typeof rawPayload !== 'object') {
    return { valid: false, errors: ['Archive payload must be a non-null object.'], projectCount: 0, sizeBytes: 0 };
  }

  const serialized = JSON.stringify(rawPayload);
  const sizeBytes = Buffer.byteLength(serialized, 'utf8');

  if (sizeBytes > MAX_PAYLOAD_SIZE_BYTES) {
    errors.push(
      `Archive payload exceeds maximum size limit of 50 MB (Actual: ${(sizeBytes / (1024 * 1024)).toFixed(2)} MB).`
    );
  }

  const payload = rawPayload as Partial<ProjectArchivePayload>;

  if (!payload.archiveName || typeof payload.archiveName !== 'string') {
    errors.push('Archive payload missing required string property "archiveName".');
  }

  if (!Array.isArray(payload.items)) {
    errors.push('Archive payload missing required array property "items".');
    return { valid: false, errors, projectCount: 0, sizeBytes };
  }

  const projectCount = payload.items.length;

  if (projectCount === 0) {
    errors.push('Archive contains 0 projects. Must contain between 1 and 100 projects.');
  }

  if (projectCount > MAX_PROJECTS_PER_ARCHIVE) {
    errors.push(
      `Archive contains ${projectCount} projects, exceeding the maximum limit of ${MAX_PROJECTS_PER_ARCHIVE} projects.`
    );
  }

  payload.items.forEach((item, idx) => {
    if (!item.project || typeof item.project !== 'object') {
      errors.push(`Item #${idx + 1} is missing a valid "project" object.`);
      return;
    }
    if (!item.project.id || typeof item.project.id !== 'string') {
      errors.push(`Item #${idx + 1} project is missing a valid string "id".`);
    }
    if (!item.project.name || typeof item.project.name !== 'string') {
      errors.push(`Item #${idx + 1} project is missing a valid string "name".`);
    }
    if (typeof item.project.plotWidth !== 'number' || typeof item.project.plotLength !== 'number') {
      errors.push(`Item #${idx + 1} project has invalid plot dimensions.`);
    }
  });

  return {
    valid: errors.length === 0,
    errors,
    projectCount,
    sizeBytes,
  };
}

/**
 * Ingests a validated project archive inside a single atomic transaction.
 * If any project or snapshot insert fails, the entire transaction rolls back.
 */
export async function ingestProjectArchive(
  pool: Pool,
  organizationId: string,
  payload: ProjectArchivePayload
): Promise<IngestionResult> {
  const validation = validateArchivePayload(payload);
  if (!validation.valid) {
    throw new Error(`Archive validation failed: ${validation.errors.join('; ')}`);
  }

  const startTime = Date.now();
  const serialized = JSON.stringify(payload);
  const checksum = crypto.createHash('sha256').update(serialized, 'utf8').digest('hex');

  return withTenantContext(pool, organizationId, async (client: PoolClient) => {
    // 1. Create audit job record
    const jobRes = await client.query<{ id: string }>(
      `INSERT INTO archive_ingestion_jobs (
         id, organization_id, archive_name, project_count, payload_size_bytes, status, checksum, created_at
       )
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'in_progress', $5, clock_timestamp())
       RETURNING id`,
      [organizationId, payload.archiveName, validation.projectCount, validation.sizeBytes, checksum]
    );

    const jobId = jobRes.rows[0].id;
    let totalProjects = 0;
    let totalSnapshots = 0;

    // 2. Insert projects and snapshots atomically
    for (const item of payload.items) {
      const p = item.project;

      await client.query(
        `INSERT INTO projects (
           id, organization_id, name, project_type, status, unit, budget, currency, data, created_at, updated_at
         )
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, clock_timestamp(), clock_timestamp())
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           status = EXCLUDED.status,
           budget = EXCLUDED.budget,
           data = EXCLUDED.data,
           updated_at = clock_timestamp()`,
        [
          p.id,
          organizationId,
          p.name,
          p.projectType || 'house',
          p.status || 'Drafting',
          p.unit || 'feet',
          p.budget || 0,
          p.currency || 'USD',
          JSON.stringify(p),
        ]
      );
      totalProjects++;

      if (Array.isArray(item.snapshots) && item.snapshots.length > 0) {
        for (const snap of item.snapshots) {
          const snapChecksum = computeProjectDataChecksum(snap.projectData || p);
          await client.query(
            `INSERT INTO project_snapshots (
               id, project_id, organization_id, revision, version_tag, label,
               description, trigger, metrics, project_data, checksum, created_at
             )
             VALUES (
               gen_random_uuid(), $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, clock_timestamp()
             )
             ON CONFLICT (project_id, revision) DO NOTHING`,
            [
              p.id,
              organizationId,
              snap.revision,
              snap.versionTag || `v${snap.revision}.0`,
              snap.label || `Snapshot Rev ${snap.revision}`,
              snap.description || '',
              snap.trigger || 'import',
              JSON.stringify(snap.metrics || {}),
              JSON.stringify(snap.projectData || p),
              snapChecksum,
            ]
          );
          totalSnapshots++;
        }
      }
    }

    // 3. Mark job complete
    await client.query(
      `UPDATE archive_ingestion_jobs 
       SET status = 'completed', completed_at = clock_timestamp() 
       WHERE id = $1`,
      [jobId]
    );

    return {
      jobId,
      archiveName: payload.archiveName,
      projectsIngested: totalProjects,
      snapshotsIngested: totalSnapshots,
      durationMs: Date.now() - startTime,
    };
  });
}

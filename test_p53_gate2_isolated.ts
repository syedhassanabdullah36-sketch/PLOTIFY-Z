/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import fs from 'fs';
import path from 'path';
import {
  computeSqlChecksum,
  loadMigrationFiles,
  ChecksumDriftError,
} from './server/db/migrator';
import {
  isValidTenantId,
  withTenantContext,
  TenantContextError,
} from './server/db/tenantContext';
import {
  validateArchivePayload,
  MAX_PROJECTS_PER_ARCHIVE,
  ProjectArchivePayload,
} from './server/services/archiveIngestionService';
import {
  computeProjectDataChecksum,
} from './server/services/snapshotService';
import { getDatabaseConfig } from './server/db/pool';
import { INITIAL_SAMPLE_PROJECTS } from './src/services/storage';

console.log('================================================================');
console.log('PLOTIFY — P53 GATE 2 ISOLATED & OFFLINE VERIFICATION RUNNER');
console.log('Mode: Static Audit, Structural Pattern Checks & In-Memory Unit Tests');
console.log('Notice: Live PostgreSQL integration tests are deferred to Gate 3.');
console.log('================================================================\n');

interface AssertionResult {
  group: string;
  name: string;
  passed: boolean;
  details?: string;
}

const results: AssertionResult[] = [];

function assert(group: string, name: string, condition: boolean, details?: string) {
  results.push({ group, name, passed: condition, details });
  if (condition) {
    console.log(`  ✓ [${group}] ${name}`);
  } else {
    console.error(`  ✗ [${group}] ${name}${details ? ` — ${details}` : ''}`);
  }
}

// -----------------------------------------------------------------------------
// Discipline 1: Migration Files Discovery & SHA-256 Checksum Integrity
// -----------------------------------------------------------------------------
console.log('• Discipline 1: Migration Inventory & Cryptographic Checksums...');

const migrationsDir = path.resolve(process.cwd(), 'migrations');
const migrations = loadMigrationFiles(migrationsDir);

assert(
  'Migrations',
  'Discovers exactly 4 up-and-down migration pairs',
  migrations.length === 4,
  `Found ${migrations.length} migrations`
);

const expectedVersions = ['0001', '0002', '0003', '0004'];
const actualVersions = migrations.map((m) => m.version);
assert(
  'Migrations',
  'Migration versions match expected sequence [0001, 0002, 0003, 0004]',
  JSON.stringify(actualVersions) === JSON.stringify(expectedVersions)
);

migrations.forEach((m) => {
  const isSha256 = /^[0-9a-f]{64}$/.test(m.checksum);
  assert(
    'Checksums',
    `Migration ${m.version}_${m.name} generates valid SHA-256 hash`,
    isSha256 && m.upSql.length > 50 && m.downSql.length > 20,
    `Hash: ${m.checksum}`
  );
});

// -----------------------------------------------------------------------------
// Discipline 2: Structural SQL Pattern & Security Auditing
// -----------------------------------------------------------------------------
console.log('\n• Discipline 2: Structural SQL Patterns & Tenant Isolation Audit...');

const m1 = migrations.find((m) => m.version === '0001')!;
const m2 = migrations.find((m) => m.version === '0002')!;
const m3 = migrations.find((m) => m.version === '0003')!;
const m4 = migrations.find((m) => m.version === '0004')!;

// 0001 checks
assert(
  'SQL Pattern (0001)',
  'Enables pgcrypto extension',
  m1.upSql.includes('CREATE EXTENSION IF NOT EXISTS pgcrypto')
);
assert(
  'SQL Pattern (0001)',
  'Creates schema_migrations ledger table with checksum',
  m1.upSql.includes('CREATE TABLE IF NOT EXISTS schema_migrations') &&
    m1.upSql.includes('checksum CHAR(64)')
);
assert(
  'SQL Pattern (0001)',
  'Creates organizations, users, and organization_memberships tables',
  m1.upSql.includes('CREATE TABLE IF NOT EXISTS organizations') &&
    m1.upSql.includes('CREATE TABLE IF NOT EXISTS users') &&
    m1.upSql.includes('CREATE TABLE IF NOT EXISTS organization_memberships')
);

// 0002 checks
assert(
  'SQL Pattern (0002)',
  'Creates projects table and user_settings table',
  m2.upSql.includes('CREATE TABLE IF NOT EXISTS projects') &&
    m2.upSql.includes('CREATE TABLE IF NOT EXISTS user_settings')
);
assert(
  'SQL Pattern (0002)',
  'Enforces ROW LEVEL SECURITY and FORCE ROW LEVEL SECURITY on tenant tables',
  m2.upSql.includes('ALTER TABLE projects ENABLE ROW LEVEL SECURITY') &&
    m2.upSql.includes('ALTER TABLE projects FORCE ROW LEVEL SECURITY') &&
    m2.upSql.includes('ALTER TABLE user_settings ENABLE ROW LEVEL SECURITY') &&
    m2.upSql.includes('ALTER TABLE user_settings FORCE ROW LEVEL SECURITY')
);
assert(
  'SQL Pattern (0002)',
  'Enforces app.current_tenant_id setting in RLS policies with NULLIF fail-closed',
  m2.upSql.includes("current_setting('app.current_tenant_id', true)") &&
    m2.upSql.includes("NULLIF(current_setting('app.current_tenant_id', true), '')::uuid")
);

// 0003 checks
assert(
  'SQL Pattern (0003)',
  'Creates project_snapshots with unique constraint on (project_id, revision)',
  m3.upSql.includes('CREATE TABLE IF NOT EXISTS project_snapshots') &&
    m3.upSql.includes('CONSTRAINT uq_project_snapshots_revision UNIQUE (project_id, revision)')
);
assert(
  'SQL Pattern (0003)',
  'Enforces RLS and FORCE RLS on project_snapshots table',
  m3.upSql.includes('ALTER TABLE project_snapshots ENABLE ROW LEVEL SECURITY') &&
    m3.upSql.includes('ALTER TABLE project_snapshots FORCE ROW LEVEL SECURITY')
);

// 0004 checks
assert(
  'SQL Pattern (0004)',
  'Creates archive_ingestion_jobs table with 100 project and 50MB constraints',
  m4.upSql.includes('CREATE TABLE IF NOT EXISTS archive_ingestion_jobs') &&
    m4.upSql.includes('project_count <= 100') &&
    m4.upSql.includes('payload_size_bytes <= 52428800')
);

// Role script checks
const rolesPath = path.resolve(process.cwd(), 'scripts/init_roles.sql');
const rolesSql = fs.readFileSync(rolesPath, 'utf8');
assert(
  'Role Security',
  'init_roles.sql defines plotify_migrator and plotify_app roles with NOBYPASSRLS',
  rolesSql.includes('CREATE ROLE plotify_migrator') &&
    rolesSql.includes('CREATE ROLE plotify_app') &&
    rolesSql.includes('NOBYPASSRLS')
);
assert(
  'Role Security',
  'init_roles.sql explicitly revokes DDL & schema_migrations from plotify_app',
  rolesSql.includes('REVOKE CREATE ON SCHEMA public FROM plotify_app') &&
    rolesSql.includes('REVOKE ALL ON TABLE schema_migrations FROM plotify_app')
);

// -----------------------------------------------------------------------------
// Discipline 3: Tenant Context Validation & Fail-Closed Logic (Unit)
// -----------------------------------------------------------------------------
console.log('\n• Discipline 3: Tenant Context & Fail-Closed Logic...');

const validUuid = '123e4567-e89b-12d3-a456-426614174000';
assert('Tenant Context', 'Valid UUIDv4 is accepted', isValidTenantId(validUuid));
assert('Tenant Context', 'Empty tenant ID is rejected', !isValidTenantId(''));
assert('Tenant Context', 'Whitespace tenant ID is rejected', !isValidTenantId('   '));
assert('Tenant Context', 'SQL injection payload is rejected', !isValidTenantId("1' OR '1'='1"));
assert('Tenant Context', 'Truncated UUID is rejected', !isValidTenantId('123e4567-e89b'));

// Test that withTenantContext fails closed before connecting when tenant ID is invalid
let caughtContextError = false;
try {
  const dummyPool = {} as any;
  await withTenantContext(dummyPool, 'invalid-uuid', async () => {});
} catch (err: any) {
  if (err instanceof TenantContextError) {
    caughtContextError = true;
  }
}
assert(
  'Tenant Context',
  'withTenantContext immediately throws TenantContextError on invalid tenant ID',
  caughtContextError
);

// -----------------------------------------------------------------------------
// Discipline 4: Checksum Drift Error Construction (Unit)
// -----------------------------------------------------------------------------
console.log('\n• Discipline 4: Checksum Drift Error Diagnostics...');

const testChecksumA = 'a'.repeat(64);
const testChecksumB = 'b'.repeat(64);
const driftErr = new ChecksumDriftError('0002', testChecksumA, testChecksumB);

assert('Checksum Drift', 'ChecksumDriftError has code ERR_MIGRATION_CHECKSUM_MISMATCH', driftErr.code === 'ERR_MIGRATION_CHECKSUM_MISMATCH');
assert('Checksum Drift', 'Error message includes both recorded and computed checksums', driftErr.message.includes(testChecksumA) && driftErr.message.includes(testChecksumB));

// -----------------------------------------------------------------------------
// Discipline 5: Archive Ingestion Validation Engine (Unit)
// -----------------------------------------------------------------------------
console.log('\n• Discipline 5: Archive Ingestion Validation Limits...');

const sampleProject = INITIAL_SAMPLE_PROJECTS[0];

const validArchive: ProjectArchivePayload = {
  archiveVersion: '1.0.0',
  archiveName: 'Export 2026-01',
  exportedAt: new Date().toISOString(),
  items: [
    {
      project: sampleProject,
      snapshots: [
        {
          revision: 1,
          versionTag: 'v1.0',
          label: 'Baseline Concept',
          trigger: 'manual',
          projectData: sampleProject,
        },
      ],
    },
  ],
};

const validResult = validateArchivePayload(validArchive);
assert('Archive Validator', 'Valid archive payload passes validation', validResult.valid && validResult.projectCount === 1);

// Test empty archive rejection
const emptyArchive: ProjectArchivePayload = {
  ...validArchive,
  items: [],
};
const emptyResult = validateArchivePayload(emptyArchive);
assert('Archive Validator', 'Rejects archive with 0 projects', !emptyResult.valid && emptyResult.errors.some((e) => e.includes('0 projects')));

// Test archive exceeding 100 projects limit
const oversizedArchive: ProjectArchivePayload = {
  ...validArchive,
  items: Array.from({ length: 101 }, (_, i) => ({
    project: { ...sampleProject, id: `proj-${i}`, name: `Project ${i}` },
  })),
};
const oversizedResult = validateArchivePayload(oversizedArchive);
assert(
  'Archive Validator',
  `Rejects archive with 101 projects (> ${MAX_PROJECTS_PER_ARCHIVE} limit)`,
  !oversizedResult.valid && oversizedResult.errors.some((e) => e.includes('exceeding the maximum limit'))
);

// Test archive missing essential fields
const invalidItemArchive = {
  archiveName: 'Broken',
  items: [{ project: { name: 'No ID' } }],
};
const invalidItemResult = validateArchivePayload(invalidItemArchive);
assert('Archive Validator', 'Rejects archive with malformed project records', !invalidItemResult.valid && invalidItemResult.errors.length > 0);

// -----------------------------------------------------------------------------
// Discipline 6: Snapshot Fingerprinting & Revision Determinism (Unit)
// -----------------------------------------------------------------------------
console.log('\n• Discipline 6: Snapshot Fingerprinting & Cryptographic Hashing...');

const hash1 = computeProjectDataChecksum(sampleProject);
const hash2 = computeProjectDataChecksum(sampleProject);
assert('Snapshot Checksum', 'Generates 64-char hex SHA-256 fingerprint', /^[0-9a-f]{64}$/.test(hash1));
assert('Snapshot Checksum', 'Checksum is perfectly deterministic across multiple calls', hash1 === hash2);

const modifiedProject = { ...sampleProject, name: 'Renamed Project' };
const hashModified = computeProjectDataChecksum(modifiedProject);
assert('Snapshot Checksum', 'Mutated project data changes checksum', hash1 !== hashModified);

// -----------------------------------------------------------------------------
// Discipline 7: Role Connection Configuration (Unit)
// -----------------------------------------------------------------------------
console.log('\n• Discipline 7: Database Connection Configuration & Least Privilege Pools...');

const appConfig = getDatabaseConfig('app');
const migratorConfig = getDatabaseConfig('migrator');

assert(
  'Pool Config',
  'Application pool defaults to plotify_app user and 20 max connections',
  appConfig.user === 'plotify_app' && appConfig.max === 20
);
assert(
  'Pool Config',
  'Migrator pool defaults to plotify_migrator user and 2 max connections',
  migratorConfig.user === 'plotify_migrator' && migratorConfig.max === 2
);

// -----------------------------------------------------------------------------
// Summary Matrix & Output
// -----------------------------------------------------------------------------
console.log('\n================================================================');
console.log('P53 GATE 2 ISOLATED VERIFICATION SUMMARY');
console.log('================================================================');

const passedCount = results.filter((r) => r.passed).length;
const totalCount = results.length;
const allPassed = passedCount === totalCount;

console.log(`Total Assertions Evaluated : ${totalCount}`);
console.log(`Assertions Passed          : ${passedCount}`);
console.log(`Assertions Failed          : ${totalCount - passedCount}`);
console.log(`Discipline Groups Tested   : Migrations, Checksums, SQL Patterns, Tenant Context, Archive Validation, Snapshot Hashing, Pool Config`);
console.log(`Gate 2 Offline Verdict     : ${allPassed ? 'PASSED (100%)' : 'FAILED'}`);
console.log('================================================================');

if (!allPassed) {
  process.exit(1);
}

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'http';
import {
  isUuid,
  legacyToCloudUuid,
  cloudUuidToLegacy,
  normalizeProjectForCloud,
  normalizeProjectFromCloud,
} from './src/utils/idMapping';
import {
  configureApiClient,
  setAuthSession,
  getAuthSession,
  listProjects,
  getProject,
  createProject,
  updateProject,
  deleteProject,
  checkApiHealth,
  AuthRequiredError,
  TenantRequiredError,
  ApiError,
} from './src/services/apiClient';
import {
  isCloudPersistenceEnabled,
  getCloudPersistenceStatus,
  loadProjects,
  saveProjects,
  INITIAL_SAMPLE_PROJECTS,
  pushProjectToCloud,
  fetchProjectsFromCloud,
  loadProjectsAsync,
  getProjectPersistenceAdapter,
  cloudStorageAdapter,
} from './src/services/storage';
import {
  exportSystemArchiveForBackend,
  ingestSystemArchiveToBackend,
} from './src/services/backupService';
import {
  listProjectSnapshotsAsync,
} from './src/services/versioningService';

console.log('================================================================');
console.log('PLOTIFY — P53 STAGE 2: CLIENT API ADAPTER & STORAGE TESTS');
console.log('Mode: Typed Client Audit, UUID Normalization & Storage Isolation');
console.log('================================================================\n');

interface TestAssertion {
  num: number;
  name: string;
  passed: boolean;
  details?: string;
}

const results: TestAssertion[] = [];

function assert(num: number, name: string, condition: boolean, details?: string) {
  results.push({ num, name, passed: condition, details });
  if (condition) {
    console.log(`  ✓ Test ${num}: ${name}`);
  } else {
    console.error(`  ✗ Test ${num}: ${name}${details ? ` — ${details}` : ''}`);
  }
}

async function runStage2Tests(): Promise<void> {
  // ---------------------------------------------------------------------------
  // 1. UUID vs Legacy ID Validation & Conversion
  // ---------------------------------------------------------------------------
  const legacyId1 = 'proj-001';
  const legacyId2 = 'proj-002';
  const existingUuid = '123e4567-e89b-12d3-a456-426614174000';

  assert(1, 'isUuid accurately identifies valid RFC 4122 UUID', isUuid(existingUuid));
  assert(2, 'isUuid rejects legacy identifiers (proj-001)', !isUuid(legacyId1));

  const cloudUuid1 = legacyToCloudUuid(legacyId1);
  const cloudUuid2 = legacyToCloudUuid(legacyId2);

  assert(3, 'legacyToCloudUuid generates a valid RFC 4122 UUID', isUuid(cloudUuid1));
  assert(4, 'legacyToCloudUuid is 100% deterministic', cloudUuid1 === legacyToCloudUuid(legacyId1));
  assert(5, 'legacyToCloudUuid preserves existing UUIDs unchanged', legacyToCloudUuid(existingUuid) === existingUuid);
  assert(6, 'Distinct legacy IDs produce distinct cloud UUIDs (no sample collision)', cloudUuid1 !== cloudUuid2);

  // ---------------------------------------------------------------------------
  // 2. Bidirectional Mapping & Normalization
  // ---------------------------------------------------------------------------
  const restoredId = cloudUuidToLegacy(cloudUuid1);
  assert(7, 'cloudUuidToLegacy accurately restores the original legacy ID', restoredId === legacyId1);

  const sample = INITIAL_SAMPLE_PROJECTS[0];
  const normalizedForCloud = normalizeProjectForCloud(sample);
  assert(8, 'normalizeProjectForCloud sets project.id to valid UUID', isUuid(normalizedForCloud.id));
  assert(9, 'normalizeProjectForCloud preserves original local ID in metadata', (normalizedForCloud as any).legacyId === sample.id);

  const restoredFromCloud = normalizeProjectFromCloud(normalizedForCloud);
  assert(10, 'normalizeProjectFromCloud restores exact local project ID without data loss', restoredFromCloud.id === sample.id);

  // ---------------------------------------------------------------------------
  // 3. API Client Authentication Guards (Pre-Network Checks)
  // ---------------------------------------------------------------------------
  setAuthSession(null);

  let caughtAuthErr = false;
  try {
    await listProjects();
  } catch (err: any) {
    if (err instanceof AuthRequiredError && err.status === 401) {
      caughtAuthErr = true;
    }
  }
  assert(11, 'listProjects() fails closed with AuthRequiredError when unauthenticated', caughtAuthErr);

  setAuthSession({ token: 'test.jwt.token', tenantId: '' });
  let caughtTenantErr = false;
  try {
    await listProjects();
  } catch (err: any) {
    if (err instanceof TenantRequiredError && err.status === 400) {
      caughtTenantErr = true;
    }
  }
  assert(12, 'listProjects() fails closed with TenantRequiredError when tenantId is empty', caughtTenantErr);

  // ---------------------------------------------------------------------------
  // 4. HTTP Error Handling against In-Memory Test Server
  // ---------------------------------------------------------------------------
  let simulatedStatus = 200;
  let simulatedBody: any = { status: 'healthy', package: 'P53' };

  const testServer = http.createServer((req, res) => {
    res.writeHead(simulatedStatus, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(simulatedBody));
  });

  await new Promise<void>((resolve) => testServer.listen(0, '127.0.0.1', resolve));
  const testPort = (testServer.address() as any).port;
  const testBaseUrl = `http://127.0.0.1:${testPort}`;

  configureApiClient({ baseUrl: testBaseUrl, timeoutMs: 3000 });
  setAuthSession({
    token: 'valid.test.token',
    tenantId: '00000000-0000-4000-8000-000000000001',
  });

  try {
    // Test 200 OK
    simulatedStatus = 200;
    simulatedBody = { status: 'healthy', package: 'P53-STAGE2' };
    const health = await checkApiHealth();
    assert(13, 'Public checkApiHealth() parses 200 OK successfully', health.status === 'healthy');

    // Test 403 Forbidden
    simulatedStatus = 403;
    simulatedBody = { error: 'Forbidden: Access denied to organization', code: 'ERR_TENANT_FORBIDDEN' };
    let caught403 = false;
    try {
      await listProjects();
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 403 && err.code === 'ERR_TENANT_FORBIDDEN') {
        caught403 = true;
      }
    }
    assert(14, 'API client correctly parses HTTP 403 Forbidden with custom error code', caught403);

    // Test 404 Not Found
    simulatedStatus = 404;
    simulatedBody = { error: 'Project not found', code: 'ERR_NOT_FOUND' };
    let caught404 = false;
    try {
      await getProject('proj-999');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        caught404 = true;
      }
    }
    assert(15, 'API client correctly parses HTTP 404 Not Found', caught404);

    // Test 500 Internal Server Error
    simulatedStatus = 500;
    simulatedBody = { error: 'An internal server error occurred.', code: 'ERR_INTERNAL' };
    let caught500 = false;
    try {
      await deleteProject('proj-001');
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 500) {
        caught500 = true;
      }
    }
    assert(16, 'API client safely surfaces sanitized HTTP 500 server errors', caught500);
  } finally {
    testServer.close();
  }

  // ---------------------------------------------------------------------------
  // 5. Storage Integration & Feature-Flag Safety
  // ---------------------------------------------------------------------------
  assert(
    17,
    'isCloudPersistenceEnabled() is false by default in this environment',
    isCloudPersistenceEnabled() === false
  );

  const status = getCloudPersistenceStatus();
  assert(
    18,
    'getCloudPersistenceStatus() confirms localStorage active and cloud disabled',
    status.isCloudActive === false &&
      status.provider === 'local_storage' &&
      status.status === 'disabled'
  );

  // Local data safety check
  const localProjectsBefore = loadProjects();
  assert(19, 'loadProjects() continues reading from localStorage safely', localProjectsBefore.length > 0);

  // Cloud sync attempt when disabled fails safely without corrupting local data
  const pushRes = await pushProjectToCloud(localProjectsBefore[0]);
  assert(
    20,
    'pushProjectToCloud() safely rejects when cloud mode is disabled',
    pushRes.success === false && Boolean(pushRes.error)
  );

  const fetchRes = await fetchProjectsFromCloud();
  assert(
    21,
    'fetchProjectsFromCloud() safely rejects when cloud mode is disabled',
    fetchRes.success === false && Boolean(fetchRes.error)
  );

  const localProjectsAfter = loadProjects();
  assert(
    22,
    'Local projects in localStorage remain 100% intact after cloud push/fetch rejections',
    localProjectsAfter.length === localProjectsBefore.length &&
      localProjectsAfter[0].id === localProjectsBefore[0].id
  );

  // ---------------------------------------------------------------------------
  // Persistence Adapter & Frontend–Backend Integration Tests
  // ---------------------------------------------------------------------------
  const asyncProjects = await loadProjectsAsync();
  assert(
    23,
    'loadProjectsAsync() resolves local projects safely when cloud mode is disabled',
    asyncProjects.length === localProjectsBefore.length && asyncProjects[0].name === localProjectsBefore[0].name
  );

  const activeAdapter = getProjectPersistenceAdapter();
  assert(
    24,
    'getProjectPersistenceAdapter() returns localStorageAdapter by default',
    activeAdapter.provider === 'local_storage'
  );

  setAuthSession(null);
  let cloudAdapterRejectedWithoutSession = false;
  try {
    await cloudStorageAdapter.createProject(localProjectsBefore[0]);
  } catch (err) {
    if (err instanceof AuthRequiredError) {
      cloudAdapterRejectedWithoutSession = true;
    }
  }
  assert(
    25,
    'cloudStorageAdapter.createProject fails closed with AuthRequiredError without silent fallback to local storage',
    cloudAdapterRejectedWithoutSession
  );

  const backendArchive = exportSystemArchiveForBackend('Integration Test Export');
  assert(
    26,
    'exportSystemArchiveForBackend() formats items with cloud UUIDs within 100 project limit',
    backendArchive.items.length <= 100 &&
      backendArchive.items.length > 0 &&
      isUuid(backendArchive.items[0].project.id)
  );

  const ingestRes = await ingestSystemArchiveToBackend();
  assert(
    27,
    'ingestSystemArchiveToBackend() safely rejects when cloud mode is disabled',
    ingestRes.success === false && Boolean(ingestRes.error)
  );

  const snapshots = await listProjectSnapshotsAsync(localProjectsBefore[0]);
  assert(
    28,
    'listProjectSnapshotsAsync() returns local snapshot records when cloud mode is disabled',
    Array.isArray(snapshots)
  );

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('P53 STAGE 2 CLIENT INTEGRATION TEST SUMMARY');
  console.log('================================================================');

  const passedCount = results.filter((r) => r.passed).length;
  const totalCount = results.length;
  const allPassed = passedCount === totalCount;

  console.log(`Total Stage 2 Tests        : ${totalCount}`);
  console.log(`Tests Passed               : ${passedCount}`);
  console.log(`Tests Failed               : ${totalCount - passedCount}`);
  console.log(`Stage 2 Verification Status: ${allPassed ? 'PASSED (100%)' : 'FAILED'}`);
  console.log('================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runStage2Tests().catch((err) => {
  console.error('[Stage 2 Test Runner] Fatal error:', err);
  process.exit(1);
});

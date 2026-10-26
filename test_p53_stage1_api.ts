/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import http from 'http';
import crypto from 'crypto';
import { createApp } from './server/app';
import {
  createJwtToken,
  setMembershipChecker,
  resetMembershipChecker,
} from './server/middleware/auth';
import { getCloudPersistenceStatus } from './src/services/storage';

console.log('================================================================');
console.log('PLOTIFY — P53 STAGE 1: HTTP API GATEWAY & AUTHENTICATION TESTS');
console.log('Mode: Isolated In-Memory HTTP Server & Offline Middleware Audit');
console.log('================================================================\n');

const TEST_SECRET = 'stage1_test_secret_for_verification_only_12345';
process.env.JWT_SECRET = TEST_SECRET;

const ALICE_ID = '11111111-1111-4111-8111-111111111111';
const BOB_ID = '22222222-2222-4222-8222-222222222222';
const TENANT_ALPHA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const TENANT_BETA = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TENANT_GAMMA = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

// Setup mock membership validator for offline testing
setMembershipChecker(async (userId: string, orgId: string) => {
  if (userId === ALICE_ID && orgId === TENANT_ALPHA) return 'owner';
  if (userId === BOB_ID && orgId === TENANT_BETA) return 'member';
  return null; // Denied for any other pair
});

interface ApiAssertion {
  testNumber: number;
  description: string;
  passed: boolean;
  details?: string;
}

const assertions: ApiAssertion[] = [];

function assert(num: number, desc: string, condition: boolean, details?: string) {
  assertions.push({ testNumber: num, description: desc, passed: condition, details });
  if (condition) {
    console.log(`  ✓ Test ${num}: ${desc}`);
  } else {
    console.error(`  ✗ Test ${num}: ${desc}${details ? ` — ${details}` : ''}`);
  }
}

async function runApiTestSuite(): Promise<void> {
  const app = createApp();
  const server = http.createServer(app);

  // Start server on an ephemeral random port
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address() as any;
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const aliceToken = createJwtToken({ sub: ALICE_ID, email: 'alice@example.com' }, TEST_SECRET);
  const bobToken = createJwtToken({ sub: BOB_ID, email: 'bob@example.com' }, TEST_SECRET);
  const expiredToken = createJwtToken(
    { sub: ALICE_ID, email: 'alice@example.com', exp: Math.floor(Date.now() / 1000) - 60 },
    TEST_SECRET
  );
  const invalidSignatureToken = aliceToken.slice(0, -6) + 'xxxxxx';

  try {
    // -------------------------------------------------------------------------
    // 1. Unauthenticated Requests
    // -------------------------------------------------------------------------
    const res1 = await fetch(`${baseUrl}/api/projects`, {
      headers: { 'X-Tenant-ID': TENANT_ALPHA },
    });
    const body1 = await res1.json();
    assert(
      1,
      'Unauthenticated requests are rejected with HTTP 401',
      res1.status === 401 && body1.code === 'ERR_UNAUTHENTICATED',
      `Got ${res1.status} - ${JSON.stringify(body1)}`
    );

    // -------------------------------------------------------------------------
    // 2. Invalid & Expired Tokens
    // -------------------------------------------------------------------------
    const res2a = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${invalidSignatureToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body2a = await res2a.json();

    const res2b = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${expiredToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body2b = await res2b.json();

    assert(
      2,
      'Forged and expired JWT tokens are rejected with HTTP 401',
      res2a.status === 401 &&
        body2a.code === 'ERR_INVALID_TOKEN' &&
        res2b.status === 401 &&
        body2b.code === 'ERR_INVALID_TOKEN'
    );

    // -------------------------------------------------------------------------
    // 3. Authenticated User Without Tenant Membership (HTTP 403)
    // -------------------------------------------------------------------------
    // Alice is member of Alpha, but tries to access Beta
    const res3 = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_BETA,
      },
    });
    const body3 = await res3.json();
    assert(
      3,
      'Authenticated user without tenant membership receives HTTP 403 Forbidden',
      res3.status === 403 && body3.code === 'ERR_TENANT_MEMBERSHIP_DENIED',
      `Got ${res3.status} - ${JSON.stringify(body3)}`
    );

    // -------------------------------------------------------------------------
    // 4. Missing Tenant Selector (HTTP 400)
    // -------------------------------------------------------------------------
    const res4 = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
      },
    });
    const body4 = await res4.json();
    assert(
      4,
      'Missing X-Tenant-ID selector is rejected with HTTP 400 Bad Request',
      res4.status === 400 && body4.code === 'ERR_MISSING_TENANT_ID'
    );

    // -------------------------------------------------------------------------
    // 5. Malformed Tenant UUID (HTTP 400)
    // -------------------------------------------------------------------------
    const res5 = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': "not-a-uuid-1' OR 1=1",
      },
    });
    const body5 = await res5.json();
    assert(
      5,
      'Malformed tenant identifier is rejected with HTTP 400 Bad Request',
      res5.status === 400 && body5.code === 'ERR_INVALID_TENANT_UUID'
    );

    // -------------------------------------------------------------------------
    // 6. Anti-Spoofing: Client Cannot Inject Arbitrary User ID
    // -------------------------------------------------------------------------
    // Bob sends a body claiming to be Alice, but his Bearer token is Bob's
    const res6 = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${bobToken}`,
        'X-Tenant-ID': TENANT_ALPHA, // Bob attempts to access Alpha pretending to be Alice
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Spoofed Project',
        claimedUserId: ALICE_ID,
      }),
    });
    const body6 = await res6.json();
    assert(
      6,
      'Client cannot spoof tenant membership by injecting forged IDs in request payload',
      res6.status === 403 && body6.code === 'ERR_TENANT_MEMBERSHIP_DENIED'
    );

    // -------------------------------------------------------------------------
    // 7. Request Body Validation (HTTP 400)
    // -------------------------------------------------------------------------
    const res7 = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: '', // Empty name should be rejected by route validator
      }),
    });
    const body7 = await res7.json();
    assert(
      7,
      'Invalid project body (empty name) is rejected with HTTP 400',
      res7.status === 400 && body7.code === 'ERR_VALIDATION_NAME'
    );

    // -------------------------------------------------------------------------
    // 8. Legacy Project ID Direct Submission Rejection (HTTP 400)
    // -------------------------------------------------------------------------
    const res8a = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        id: 'proj-001',
        name: 'Attempted Legacy ID Project',
      }),
    });
    const body8a = await res8a.json();

    const res8b = await fetch(`${baseUrl}/api/projects/proj-001`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body8b = await res8b.json();

    assert(
      8,
      'Legacy non-UUID project IDs (e.g. "proj-001") are rejected with HTTP 400 Bad Request',
      res8a.status === 400 &&
        body8a.code === 'ERR_INVALID_PROJECT_ID' &&
        res8b.status === 400 &&
        body8b.code === 'ERR_INVALID_ID'
    );

    // -------------------------------------------------------------------------
    // 9. Archive Boundary Limits Validation (HTTP 400)
    // -------------------------------------------------------------------------
    const res9 = await fetch(`${baseUrl}/api/archives/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        archiveName: 'Oversized Archive',
        items: Array.from({ length: 105 }, (_, i) => ({
          project: { id: `proj-${i}`, name: `P${i}`, plotWidth: 50, plotLength: 100 },
        })),
      }),
    });
    const body9 = await res9.json();
    assert(
      9,
      'Archive payload exceeding 100 projects is rejected with HTTP 400',
      res9.status === 400 && body9.code === 'ERR_ARCHIVE_VALIDATION'
    );

    // -------------------------------------------------------------------------
    // 10. Public Health Check & Security Headers
    // -------------------------------------------------------------------------
    const res10 = await fetch(`${baseUrl}/api/health`);
    const body10 = await res10.json();
    const nosniff = res10.headers.get('x-content-type-options');
    const frameOptions = res10.headers.get('x-frame-options');

    assert(
      10,
      'Public /api/health endpoint is accessible with security headers without authentication',
      res10.status === 200 &&
        body10.status === 'healthy' &&
        nosniff === 'nosniff' &&
        frameOptions === 'SAMEORIGIN'
    );

    // -------------------------------------------------------------------------
    // 11. LocalStorage Continuity: Cloud Mode Remains Disabled
    // -------------------------------------------------------------------------
    const cloudStatus = getCloudPersistenceStatus();
    assert(
      11,
      'Existing localStorage persistence remains unchanged; cloud persistence is explicitly NOT IMPLEMENTED',
      cloudStatus.isCloudActive === false &&
        cloudStatus.provider === 'local_storage' &&
        cloudStatus.status === 'disabled'
    );
    // -------------------------------------------------------------------------
    // 12. Security Hardening: Mandatory JWT Expiration (exp)
    // -------------------------------------------------------------------------
    function createRawToken(payload: Record<string, unknown>, secret: string): string {
      const header = { alg: 'HS256', typ: 'JWT' };
      const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
      const signatureB64 = crypto
        .createHmac('sha256', secret)
        .update(`${headerB64}.${payloadB64}`)
        .digest('base64url');
      return `${headerB64}.${payloadB64}.${signatureB64}`;
    }

    const tokenWithoutExp = createRawToken({ sub: ALICE_ID, email: 'alice@example.com' }, TEST_SECRET);
    const res12 = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${tokenWithoutExp}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body12 = await res12.json();
    assert(
      12,
      'Tokens missing mandatory "exp" claim are rejected with HTTP 401',
      res12.status === 401 && body12.code === 'ERR_INVALID_TOKEN'
    );

    // -------------------------------------------------------------------------
    // 13. Security Hardening: Maximum JWT Lifetime Enforced (<= 24h)
    // -------------------------------------------------------------------------
    const nowSec = Math.floor(Date.now() / 1000);
    const tokenExcessiveLifetime = createRawToken(
      { sub: ALICE_ID, exp: nowSec + 86400 * 30, iat: nowSec },
      TEST_SECRET
    );
    const res13 = await fetch(`${baseUrl}/api/projects`, {
      headers: {
        Authorization: `Bearer ${tokenExcessiveLifetime}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body13 = await res13.json();
    assert(
      13,
      'Tokens with lifetime exceeding maximum threshold (24h) are rejected with HTTP 401',
      res13.status === 401 && body13.code === 'ERR_INVALID_TOKEN'
    );

    // -------------------------------------------------------------------------
    // 14. Snapshots Endpoint Rejects Non-UUID Project Identifiers
    // -------------------------------------------------------------------------
    const res14a = await fetch(`${baseUrl}/api/projects/legacy-proj-123/snapshots`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body14a = await res14a.json();

    const res14b = await fetch(`${baseUrl}/api/projects/legacy-proj-123/snapshots`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        label: 'Test Snapshot',
        projectData: { id: 'dummy', name: 'Dummy' },
      }),
    });
    const body14b = await res14b.json();

    assert(
      14,
      'Snapshots GET and POST reject non-UUID project IDs with HTTP 400 Bad Request',
      res14a.status === 400 &&
        body14a.code === 'ERR_INVALID_PROJECT_ID' &&
        res14b.status === 400 &&
        body14b.code === 'ERR_INVALID_PROJECT_ID'
    );

    // -------------------------------------------------------------------------
    // 15. Project List Pagination Input Validation
    // -------------------------------------------------------------------------
    const res15a = await fetch(`${baseUrl}/api/projects?limit=-5`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body15a = await res15a.json();

    const res15b = await fetch(`${baseUrl}/api/projects?limit=999`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body15b = await res15b.json();

    const res15c = await fetch(`${baseUrl}/api/projects?offset=invalid`, {
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
      },
    });
    const body15c = await res15c.json();

    assert(
      15,
      'Invalid pagination parameters (negative limit, excessive limit >100, malformed offset) reject with HTTP 400',
      res15a.status === 400 &&
        body15a.code === 'ERR_INVALID_PAGINATION' &&
        res15b.status === 400 &&
        body15b.code === 'ERR_INVALID_PAGINATION' &&
        res15c.status === 400 &&
        body15c.code === 'ERR_INVALID_PAGINATION'
    );

    // -------------------------------------------------------------------------
    // 16. Project Creation Input Boundary & Non-Negative Budget Validation
    // -------------------------------------------------------------------------
    const res16a = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Valid Project',
        budget: -50000,
      }),
    });
    const body16a = await res16a.json();

    const res16b = await fetch(`${baseUrl}/api/projects`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${aliceToken}`,
        'X-Tenant-ID': TENANT_ALPHA,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'A'.repeat(256),
      }),
    });
    const body16b = await res16b.json();

    assert(
      16,
      'Project creation rejects negative budgets and oversized names (>255 chars) with HTTP 400',
      res16a.status === 400 &&
        body16a.code === 'ERR_VALIDATION_BUDGET' &&
        res16b.status === 400 &&
        body16b.code === 'ERR_VALIDATION_NAME'
    );
  } finally {
    // Teardown
    resetMembershipChecker();
    await new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log('P53 STAGE 1 API GATEWAY & AUTHENTICATION SUMMARY');
  console.log('================================================================');

  const passedCount = assertions.filter((a) => a.passed).length;
  const totalCount = assertions.length;
  const allPassed = passedCount === totalCount;

  console.log(`Total API Contract Tests   : ${totalCount}`);
  console.log(`Tests Passed               : ${passedCount}`);
  console.log(`Tests Failed               : ${totalCount - passedCount}`);
  console.log(`Stage 1 Verification Status: ${allPassed ? 'PASSED (100%)' : 'FAILED'}`);
  console.log('================================================================');

  if (!allPassed) {
    process.exit(1);
  }
}

runApiTestSuite().catch((err) => {
  console.error('[API Test Runner] Fatal error:', err);
  process.exit(1);
});

/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { getAppPool } from '../db/pool';
import { isValidTenantId } from '../db/tenantContext';

export interface AuthenticatedUser {
  id: string;
  email?: string;
  roles?: string[];
}

export interface TenantContext {
  id: string;
  role: string;
}

// Extend Express Request interface
declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
      tenant?: TenantContext;
    }
  }
}

export type MembershipChecker = (
  userId: string,
  organizationId: string
) => Promise<string | null>;

/**
 * Default database membership checker querying organization_memberships table.
 */
export async function defaultDbMembershipChecker(
  userId: string,
  organizationId: string,
  pool: Pool = getAppPool()
): Promise<string | null> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ role: string }>(
      `SELECT role FROM organization_memberships 
       WHERE user_id = $1 AND organization_id = $2`,
      [userId, organizationId]
    );
    if (res.rows.length === 0) return null;
    return res.rows[0].role;
  } catch (err) {
    console.error('[Auth] Database membership check error:', err);
    return null;
  } finally {
    client.release();
  }
}

// Configurable membership checker (injectable for testing and custom providers)
let activeMembershipChecker: MembershipChecker = defaultDbMembershipChecker;

export function setMembershipChecker(checker: MembershipChecker): void {
  activeMembershipChecker = checker;
}

export function resetMembershipChecker(): void {
  activeMembershipChecker = defaultDbMembershipChecker;
}

export const MAX_JWT_LIFETIME_SEC = 24 * 60 * 60; // 24 hours maximum token lifetime
export const CLOCK_SKEW_SEC = 300; // 5 minutes permissible clock skew

/**
 * Verifies HMAC-SHA256 signed JWT tokens using standard crypto.
 * Enforces mandatory expiration (exp) and maximum lifetime bounds.
 */
export function verifyJwtToken(
  token: string,
  secret: string = process.env.JWT_SECRET || ''
): AuthenticatedUser | null {
  if (!secret) return null; // Fail closed if no secret configured
  if (!token || typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signatureB64] = parts;

  // Verify signature
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  if (signatureB64 !== expectedSignature) return null;

  try {
    const payloadJson = Buffer.from(payloadB64, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    // 1. Mandatory expiration check (exp claim is strictly required)
    if (typeof payload.exp !== 'number' || !Number.isFinite(payload.exp) || payload.exp <= 0) {
      return null; // Missing, non-numeric, or non-positive expiration
    }

    // 2. Reject expired token
    const nowMs = Date.now();
    if (nowMs >= payload.exp * 1000) {
      return null; // Expired
    }

    // 3. Enforce maximum token lifetime
    if (typeof payload.iat === 'number' && Number.isFinite(payload.iat)) {
      // Reject if issued in the future beyond acceptable clock skew
      if (payload.iat * 1000 > nowMs + CLOCK_SKEW_SEC * 1000) {
        return null;
      }
      // Reject if stated validity duration exceeds max lifetime
      if (payload.exp - payload.iat > MAX_JWT_LIFETIME_SEC) {
        return null;
      }
    }

    // Reject if expiration extends beyond now + max lifetime + clock skew
    if (payload.exp * 1000 > nowMs + (MAX_JWT_LIFETIME_SEC + CLOCK_SKEW_SEC) * 1000) {
      return null;
    }

    if (!payload.sub || typeof payload.sub !== 'string') return null;

    return {
      id: payload.sub,
      email: payload.email,
      roles: payload.roles || [],
    };
  } catch {
    return null;
  }
}

/**
 * Helper to generate a valid test or session JWT token.
 * Defaults to 1-hour expiration if exp is omitted.
 */
export function createJwtToken(
  payload: { sub: string; email?: string; roles?: string[]; exp?: number; iat?: number },
  secret: string = process.env.JWT_SECRET || ''
): string {
  if (!secret) throw new Error('JWT_SECRET must be configured to generate tokens.');
  const nowSec = Math.floor(Date.now() / 1000);
  const iat = typeof payload.iat === 'number' ? payload.iat : nowSec;
  const exp = typeof payload.exp === 'number' ? payload.exp : iat + 3600; // Default 1 hour lifetime

  const fullPayload = {
    ...payload,
    iat,
    exp,
  };

  const header = { alg: 'HS256', typ: 'JWT' };
  const headerB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
  const payloadB64 = Buffer.from(JSON.stringify(fullPayload)).toString('base64url');

  const signatureB64 = crypto
    .createHmac('sha256', secret)
    .update(`${headerB64}.${payloadB64}`)
    .digest('base64url');

  return `${headerB64}.${payloadB64}.${signatureB64}`;
}

/**
 * Authentication Middleware:
 * Extracts Bearer token, validates cryptographic signature, and attaches req.user.
 * Rejects unauthenticated requests with HTTP 401.
 */
export function authenticateUser(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Unauthorized: Missing or malformed Authorization header.',
      code: 'ERR_UNAUTHENTICATED',
    });
    return;
  }

  const token = authHeader.slice(7).trim();
  const secret = process.env.JWT_SECRET;

  if (!secret) {
    // If no JWT_SECRET is configured, fail closed
    res.status(401).json({
      error: 'Unauthorized: Authentication service is unconfigured or unavailable.',
      code: 'ERR_AUTH_UNCONFIGURED',
    });
    return;
  }

  const verifiedUser = verifyJwtToken(token, secret);
  if (!verifiedUser) {
    res.status(401).json({
      error: 'Unauthorized: Invalid or expired token.',
      code: 'ERR_INVALID_TOKEN',
    });
    return;
  }

  req.user = verifiedUser;
  next();
}

/**
 * Tenant Authorization Middleware:
 * Resolves requested tenant ID, verifies that it is a valid UUID, and verifies
 * that the authenticated user has an active membership in that tenant.
 * Rejects unauthorized tenant access with HTTP 403.
 */
export async function authorizeTenantMembership(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user || !req.user.id) {
    res.status(401).json({
      error: 'Unauthorized: Authentication required before tenant authorization.',
      code: 'ERR_UNAUTHENTICATED',
    });
    return;
  }

  // Tenant ID selector from header, query param, or route param
  const requestedTenantId =
    (req.headers['x-tenant-id'] as string) ||
    (req.query.tenantId as string) ||
    (req.params.tenantId as string);

  if (!requestedTenantId) {
    res.status(400).json({
      error: 'Bad Request: Missing required tenant selector (header X-Tenant-ID or query tenantId).',
      code: 'ERR_MISSING_TENANT_ID',
    });
    return;
  }

  if (!isValidTenantId(requestedTenantId)) {
    res.status(400).json({
      error: `Bad Request: Tenant ID "${requestedTenantId}" is not a valid UUID.`,
      code: 'ERR_INVALID_TENANT_UUID',
    });
    return;
  }

  try {
    const role = await activeMembershipChecker(req.user.id, requestedTenantId);

    if (!role) {
      res.status(403).json({
        error: `Forbidden: User "${req.user.id}" is not an authorized member of organization "${requestedTenantId}".`,
        code: 'ERR_TENANT_MEMBERSHIP_DENIED',
      });
      return;
    }

    req.tenant = {
      id: requestedTenantId,
      role,
    };
    next();
  } catch (err) {
    console.error('[Auth] Error verifying tenant membership:', err);
    res.status(500).json({
      error: 'Internal Server Error: Failed to verify tenant authorization.',
      code: 'ERR_INTERNAL_AUTH_ERROR',
    });
  }
}

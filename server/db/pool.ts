/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Pool, PoolConfig } from 'pg';

let appPool: Pool | null = null;
let migratorPool: Pool | null = null;

export function getDatabaseConfig(role: 'app' | 'migrator' = 'app'): PoolConfig {
  const connectionString =
    role === 'migrator'
      ? (process.env.MIGRATOR_DATABASE_URL || process.env.DATABASE_MIGRATOR_URL || process.env.DATABASE_URL)
      : (process.env.APP_DATABASE_URL || process.env.DATABASE_APP_URL || process.env.DATABASE_URL);

  if (connectionString) {
    return {
      connectionString,
      max: role === 'migrator' ? 2 : 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };
  }

  const host = process.env.PGHOST || '127.0.0.1';
  const port = parseInt(process.env.PGPORT || '5432', 10);
  const database = process.env.PGDATABASE || 'plotify_db';
  const user = role === 'migrator'
    ? (process.env.PGMIGRATOR_USER || 'plotify_migrator')
    : (process.env.PGUSER || 'plotify_app');
  const password = role === 'migrator'
    ? (process.env.PGMIGRATOR_PASSWORD || 'plotify_migrator_secure_pass')
    : (process.env.PGPASSWORD || 'plotify_app_secure_pass');

  return {
    host,
    port,
    database,
    user,
    password,
    max: role === 'migrator' ? 2 : 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
}

export function getAppPool(customConfig?: PoolConfig): Pool {
  if (!appPool) {
    appPool = new Pool(customConfig || getDatabaseConfig('app'));
    appPool.on('error', (err) => {
      console.warn('[Database Pool: app] Client warning/error:', err.message);
    });
  }
  return appPool;
}

export function getMigratorPool(customConfig?: PoolConfig): Pool {
  if (!migratorPool) {
    migratorPool = new Pool(customConfig || getDatabaseConfig('migrator'));
    migratorPool.on('error', (err) => {
      console.warn('[Database Pool: migrator] Client warning/error:', err.message);
    });
  }
  return migratorPool;
}

export async function closePools(): Promise<void> {
  if (appPool) {
    await appPool.end();
    appPool = null;
  }
  if (migratorPool) {
    await migratorPool.end();
    migratorPool = null;
  }
}

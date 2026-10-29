// Centralised SQL Server connection pool + small helpers that force parameterised queries.
import sql from 'mssql';
import { config } from '../config/env.js';

let poolPromise = null;

export function getPool() {
  if (!poolPromise) {
    const pool = new sql.ConnectionPool(config.db);
    poolPromise = pool.connect().catch((err) => {
      poolPromise = null; // allow retry on next call
      throw err;
    });
  }
  return poolPromise;
}

export async function closePool() {
  if (poolPromise) {
    const pool = await poolPromise;
    poolPromise = null;
    await pool.close();
  }
}

/** Typed parameter helpers for cases where inference is not enough. */
export const t = {
  int: (v) => ({ type: sql.Int, value: v }),
  bigint: (v) => ({ type: sql.BigInt, value: v }),
  money: (v) => ({ type: sql.Decimal(12, 2), value: v }),
  date: (v) => ({ type: sql.Date, value: v }),
  time: (v) => ({ type: sql.VarChar(8), value: v }), // 'HH:MM:SS', cast in SQL
  datetime: (v) => ({ type: sql.DateTime2(3), value: v }),
  uuid: (v) => ({ type: sql.UniqueIdentifier, value: v }),
  bit: (v) => ({ type: sql.Bit, value: v }),
  nvarchar: (v, len = sql.MAX) => ({ type: sql.NVarChar(len), value: v }),
};

function bindParams(request, params = {}) {
  for (const [name, raw] of Object.entries(params)) {
    if (raw && typeof raw === 'object' && 'type' in raw && 'value' in raw) {
      request.input(name, raw.type, raw.value);
    } else if (raw === null || raw === undefined) {
      request.input(name, sql.NVarChar, null);
    } else if (typeof raw === 'number') {
      if (Number.isInteger(raw)) request.input(name, Math.abs(raw) < 2 ** 31 ? sql.Int : sql.BigInt, raw);
      else request.input(name, sql.Decimal(18, 4), raw);
    } else if (typeof raw === 'boolean') {
      request.input(name, sql.Bit, raw);
    } else if (raw instanceof Date) {
      request.input(name, sql.DateTime2(3), raw);
    } else {
      const str = String(raw);
      request.input(name, sql.NVarChar(str.length <= 4000 ? 4000 : sql.MAX), str);
    }
  }
  return request;
}

function makeRunner(requestFactory) {
  const run = async (text, params) => bindParams(requestFactory(), params).query(text);
  return {
    /** Returns all rows of the first recordset. */
    query: async (text, params) => (await run(text, params)).recordset ?? [],
    /** Returns the first row or null. */
    one: async (text, params) => (await run(text, params)).recordset?.[0] ?? null,
    /** Returns every recordset (for multi-statement batches). */
    many: async (text, params) => (await run(text, params)).recordsets ?? [],
    /** Executes and returns rowsAffected total. */
    exec: async (text, params) => (await run(text, params)).rowsAffected.reduce((a, b) => a + b, 0),
  };
}

export const db = {
  async query(text, params) { const pool = await getPool(); return makeRunner(() => pool.request()).query(text, params); },
  async one(text, params) { const pool = await getPool(); return makeRunner(() => pool.request()).one(text, params); },
  async many(text, params) { const pool = await getPool(); return makeRunner(() => pool.request()).many(text, params); },
  async exec(text, params) { const pool = await getPool(); return makeRunner(() => pool.request()).exec(text, params); },
};

/**
 * Runs `fn(tx)` inside a SQL transaction. Commits on success, rolls back on any error.
 * `tx` exposes the same query/one/many/exec helpers bound to the transaction.
 */
export async function withTransaction(fn, isolationLevel = sql.ISOLATION_LEVEL.READ_COMMITTED) {
  const pool = await getPool();
  const transaction = new sql.Transaction(pool);
  await transaction.begin(isolationLevel);
  const tx = makeRunner(() => new sql.Request(transaction));
  try {
    const result = await fn(tx);
    await transaction.commit();
    return result;
  } catch (err) {
    try { await transaction.rollback(); } catch { /* already rolled back by SQL Server (XACT_ABORT) */ }
    throw err;
  }
}

export { sql };

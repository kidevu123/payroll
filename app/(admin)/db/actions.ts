"use server";

import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { requireOwner } from "@/lib/auth-guards";

/**
 * Owner-only read-only DB browser. Use sparingly — this exposes raw
 * row data including audit/login records. Every code path here goes
 * through requireOwner() and the table name is validated against the
 * server-resolved table list before any SQL composition.
 */

export type ColumnInfo = {
  name: string;
  dataType: string;
  isNullable: boolean;
};

export type TableInfo = {
  name: string;
  rowCount: number;
};

/** All public-schema tables in the live DB, with row counts. */
export async function listTablesAction(): Promise<
  { ok: true; tables: TableInfo[] } | { error: string }
> {
  await requireOwner();
  try {
    const rows = await db.execute<{ table_name: string; n_live_tup: number }>(
      sql`
        SELECT c.relname AS table_name,
               COALESCE(s.n_live_tup, 0)::int AS n_live_tup
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
        WHERE c.relkind = 'r'
          AND n.nspname = 'public'
        ORDER BY c.relname
      `,
    );
    return {
      ok: true,
      tables: rows.map((r) => ({ name: r.table_name, rowCount: r.n_live_tup })),
    };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Failed to list tables." };
  }
}

/**
 * First N rows of a single table. The table name is validated against
 * pg_class before being substituted into the query, so an attacker who
 * controlled the parameter could only ever target a real public-schema
 * table — and this action requires owner authz anyway.
 */
export async function selectTableAction(
  tableName: string,
  options: { limit?: number; offset?: number; orderBy?: string } = {},
): Promise<
  | { ok: true; columns: ColumnInfo[]; rows: Record<string, unknown>[]; total: number }
  | { error: string }
> {
  await requireOwner();
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 500);
  const offset = Math.max(options.offset ?? 0, 0);

  // Whitelist by name lookup against the live schema. If the request
  // names a non-existent table, the join returns nothing and we bail.
  const known = await db.execute<{ table_name: string }>(
    sql`SELECT relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r' AND n.nspname = 'public' AND c.relname = ${tableName}`,
  );
  if (known.length === 0) return { error: "Unknown table." };

  // Resolve column metadata for the chosen table.
  const cols = await db.execute<{
    column_name: string;
    data_type: string;
    is_nullable: "YES" | "NO";
    ordinal_position: number;
  }>(
    sql`SELECT column_name, data_type, is_nullable, ordinal_position
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = ${tableName}
        ORDER BY ordinal_position`,
  );
  const columns: ColumnInfo[] = cols.map((c) => ({
    name: c.column_name,
    dataType: c.data_type,
    isNullable: c.is_nullable === "YES",
  }));

  // Validate orderBy against the resolved column set so we can safely
  // splice it into the query without parameter binding (Postgres can't
  // bind identifiers).
  const orderColumn =
    options.orderBy && columns.some((c) => c.name === options.orderBy)
      ? options.orderBy
      : columns.find((c) => c.name === "created_at")?.name ??
        columns.find((c) => c.name === "id")?.name ??
        columns[0]?.name;

  const totalRow = await db.execute<{ count: number }>(
    sql.raw(`SELECT COUNT(*)::int AS count FROM "${tableName}"`),
  );
  const total = totalRow[0]?.count ?? 0;

  const orderClause = orderColumn ? `ORDER BY "${orderColumn}" DESC` : "";
  const selectQuery = `SELECT * FROM "${tableName}" ${orderClause} LIMIT ${limit} OFFSET ${offset}`;
  const rows = await db.execute<Record<string, unknown>>(sql.raw(selectQuery));
  return {
    ok: true,
    columns,
    rows: rows.map((r) => ({ ...r })),
    total,
  };
}

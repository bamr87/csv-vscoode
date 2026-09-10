import type { Database, SqlJsStatic } from "sql.js";
import { inferColumnTypes, isNumeric, toNumber } from "./core/infer";
import type { SqlResult } from "./core/messages";
import type { CsvTable } from "./core/types";
import { columnCount, columnNames } from "./core/types";

export const SQL_TABLE_NAME = "csv";

function quoteIdentifier(name: string): string {
  return `"${name.replace(/"/g, "\"\"")}"`;
}

/**
 * In-memory SQLite (via sql.js) loaded with one CSV table. The database is
 * rebuilt when the table version changes; queries are otherwise cheap.
 */
export class SqlEngine {
  private db: Database | undefined;
  private loadedVersion: unknown;

  constructor(private readonly SQL: SqlJsStatic) {}

  /** Column names as they should be referenced in SQL. */
  static columnsFor(table: CsvTable): string[] {
    return columnNames(table);
  }

  load(table: CsvTable, version: unknown): void {
    if (this.db && this.loadedVersion === version) {
      return;
    }
    this.db?.close();
    const db = new this.SQL.Database();
    const names = columnNames(table);
    const width = columnCount(table);
    const types = inferColumnTypes(table);
    const defs = names.map((n, i) => {
      const t = types[i];
      const sqlType = t === "integer" ? "INTEGER" : t === "number" ? "REAL" : "TEXT";
      return `${quoteIdentifier(n)} ${sqlType}`;
    });
    db.run(`CREATE TABLE ${quoteIdentifier(SQL_TABLE_NAME)} (${defs.join(", ")})`);

    if (width > 0 && table.rows.length > 0) {
      const placeholders = names.map(() => "?").join(", ");
      const stmt = db.prepare(`INSERT INTO ${quoteIdentifier(SQL_TABLE_NAME)} VALUES (${placeholders})`);
      db.run("BEGIN");
      try {
        for (const row of table.rows) {
          const values: (string | number | null)[] = [];
          for (let c = 0; c < width; c += 1) {
            const raw = row[c] ?? "";
            const numericColumn = types[c] === "number" || types[c] === "integer";
            if (raw === "") {
              values.push(null);
            } else if (numericColumn && isNumeric(raw)) {
              values.push(toNumber(raw));
            } else {
              values.push(raw);
            }
          }
          stmt.run(values);
        }
        db.run("COMMIT");
      } finally {
        stmt.free();
      }
    }

    this.db = db;
    this.loadedVersion = version;
  }

  /** Execute a query and return up to `limit` rows. */
  query(sql: string, limit: number): SqlResult {
    if (!this.db) {
      throw new Error("No table loaded.");
    }
    const started = Date.now();
    const stmt = this.db.prepare(sql);
    const rows: (string | number | null)[][] = [];
    let total = 0;
    let columns: string[] = [];
    try {
      while (stmt.step()) {
        if (columns.length === 0) {
          columns = stmt.getColumnNames();
        }
        total += 1;
        if (rows.length < limit) {
          rows.push(
            stmt.get().map((v) => (v === null || v === undefined ? null : typeof v === "number" ? v : String(v)))
          );
        }
      }
      if (columns.length === 0) {
        columns = stmt.getColumnNames();
      }
    } finally {
      stmt.free();
    }
    return {
      columns,
      rows,
      truncated: total > rows.length,
      totalRows: total,
      durationMs: Date.now() - started
    };
  }

  dispose(): void {
    this.db?.close();
    this.db = undefined;
  }
}

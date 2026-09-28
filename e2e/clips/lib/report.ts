/**
 * PASS / FAIL / SKIPPED / INFO rows for the clips E2E specs (plan 15.3).
 *
 * The rows have the same shape as the analyzer rows
 * (scripts/clips/lib/sync.mjs), so the lab steps and the analyzer checks
 * print as one table. A SKIPPED row is for a missing tool: it never fails
 * a run.
 */

export type RowStatus = "PASS" | "FAIL" | "SKIPPED" | "INFO";

export interface Row {
  status: RowStatus;
  check: string;
  value: string;
  limit: string;
  detail?: unknown;
}

export class RowReport {
  readonly rows: Row[] = [];

  constructor(readonly title: string) {}

  /** A PASS row when ok, else a FAIL row. Returns ok. */
  check(check: string, ok: boolean, value: string, limit = "-", detail?: unknown): boolean {
    this.rows.push({ status: ok ? "PASS" : "FAIL", check, value, limit, ...(detail === undefined ? {} : { detail }) });
    return ok;
  }

  /** A missing tool. The detail is the reason, printed in the table. */
  skipped(check: string, reason: string): void {
    this.rows.push({ status: "SKIPPED", check, value: "-", limit: "-", detail: reason });
  }

  info(check: string, value: string, detail?: unknown): void {
    this.rows.push({ status: "INFO", check, value, limit: "-", ...(detail === undefined ? {} : { detail }) });
  }

  /** Adds rows from the analyzer, with a prefix that names the file. */
  add(rows: readonly Row[], prefix = ""): void {
    for (const row of rows) this.rows.push({ ...row, check: prefix ? `${prefix}: ${row.check}` : row.check });
  }

  failures(): Row[] {
    return this.rows.filter((row) => row.status === "FAIL");
  }

  /** The table: one line per row. A SKIPPED row shows its reason; any other row shows its text detail. */
  text(): string {
    const width = Math.max(20, ...this.rows.map((r) => r.check.length));
    const valueWidth = Math.max(10, ...this.rows.map((r) => r.value.length));
    const lines = this.rows.map((r) => {
      const text = typeof r.detail === "string" ? r.detail : null;
      const tail = r.status === "SKIPPED" && text ? `skipped: ${text}` : r.status === "INFO" && text ? text : text ? `${r.limit} (${text})` : r.limit;
      return `${r.status.padEnd(7)} | ${r.check.padEnd(width)} | ${r.value.padEnd(valueWidth)} | ${tail}`;
    });
    return [`== ${this.title}`, ...lines].join("\n");
  }
}

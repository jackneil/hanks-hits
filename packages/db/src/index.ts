import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Create a singleton pool.
//
// The timeouts make a database that does not answer (a network drop, where
// TCP waits minutes) fail fast with an error, so each route answers, logs
// and recovers instead of hanging. They fail loudly and drop no data. The
// tables are small; the slowest query takes well under a second.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // A new connection to a healthy database takes milliseconds.
  connectionTimeoutMillis: 5_000,
  // Client side: give up on a query whose answer never comes back.
  query_timeout: 30_000,
  // Server side: Postgres stops a statement that runs longer.
  statement_timeout: 30_000,
});

// Create the drizzle instance with schema
export const db = drizzle(pool, { schema });

// Export schema for use in other packages
export * from "./schema";

// Export common drizzle operators for use in other packages
// This ensures version consistency across the monorepo
export { eq, and, or, ne, gt, gte, lt, lte, like, ilike, sql, asc, desc } from "drizzle-orm";

// Export types
export type Database = typeof db;

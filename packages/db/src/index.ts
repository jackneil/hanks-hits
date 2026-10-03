import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

// Create a singleton pool
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Create the drizzle instance with schema
export const db = drizzle(pool, { schema });

// Export schema for use in other packages
export * from "./schema";

// Export common drizzle operators for use in other packages
// This ensures version consistency across the monorepo
export { eq, and, or, ne, gt, gte, lt, lte, like, ilike, inArray, isNull, sql, asc, desc } from "drizzle-orm";

// Export types
export type Database = typeof db;

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  boolean,
  primaryKey,
  integer,
  index,
  uniqueIndex,
  check,
} from "drizzle-orm/pg-core";

/**
 * NextAuth v5 compatible schema
 * Based on @auth/drizzle-adapter requirements
 *
 * COPPA (16 CFR 312.5(c)(7), issue #26i): an account keeps only the Google
 * subject id (accounts.provider_account_id) and our own random user id. The
 * adapter needs the name, email, email_verified and image columns to exist,
 * but they must always be NULL, and the token columns of accounts too. The
 * CHECK constraints make that a database rule, so a future code path that
 * tries to store a child's email, name, photo or an OAuth token fails loudly
 * instead of storing it. See design/ACCOUNTS_COPPA.md.
 */

export const users = pgTable(
  "users",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    // Always NULL (users_no_personal_info). The adapter's User shape needs the columns.
    name: text("name"),
    email: text("email").unique(),
    emailVerified: timestamp("email_verified", { mode: "date" }),
    image: text("image"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    check(
      "users_no_personal_info",
      sql`${table.name} IS NULL AND ${table.email} IS NULL AND ${table.emailVerified} IS NULL AND ${table.image} IS NULL`
    ),
  ]
);

export const accounts = pgTable(
  "accounts",
  {
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text("type").notNull(), // "oidc" for Google
    provider: text("provider").notNull(),
    providerAccountId: text("provider_account_id").notNull(),
    // Always NULL (accounts_no_tokens): sign-in needs only provider +
    // providerAccountId. The id_token is a JWT that carries the email claim.
    refresh_token: text("refresh_token"),
    access_token: text("access_token"),
    expires_at: integer("expires_at"),
    token_type: text("token_type"),
    scope: text("scope"),
    id_token: text("id_token"),
    session_state: text("session_state"),
  },
  (table) => [
    primaryKey({ columns: [table.provider, table.providerAccountId] }),
    // One sign-in account per player. Without it, Auth.js links a NEW
    // Google account to whoever is signed in on that browser, and that
    // Google account then opens the first player's account on any device
    // (@auth/core handle-login.js). With it, the link fails and the
    // session stays on the first player.
    uniqueIndex("accounts_user_id_unique").on(table.userId),
    check(
      "accounts_no_tokens",
      sql`${table.refresh_token} IS NULL AND ${table.access_token} IS NULL AND ${table.expires_at} IS NULL AND ${table.token_type} IS NULL AND ${table.scope} IS NULL AND ${table.id_token} IS NULL AND ${table.session_state} IS NULL`
    ),
  ]
);

export const sessions = pgTable(
  "sessions",
  {
    sessionToken: text("session_token").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [
    // Index for fast session lookups by user
    index("sessions_user_idx").on(table.userId),
  ]
);

export const verificationTokens = pgTable(
  "verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.identifier, table.token] }),
  ]
);

// Authenticators table for WebAuthn (future-proofing)
export const authenticators = pgTable(
  "authenticators",
  {
    credentialID: text("credential_id").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    providerAccountId: text("provider_account_id").notNull(),
    credentialPublicKey: text("credential_public_key").notNull(),
    counter: integer("counter").notNull(),
    credentialDeviceType: text("credential_device_type").notNull(),
    credentialBackedUp: boolean("credential_backed_up").notNull(),
    transports: text("transports"),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.credentialID] }),
  ]
);

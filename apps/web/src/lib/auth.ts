import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { db, eq } from "@hank-neil/db";
import * as schema from "@hank-neil/db/schema";
import bcrypt from "bcryptjs";
import { checkLoginRateLimit } from "@/lib/rate-limit";

export const { handlers, signIn, signOut, auth } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: schema.users,
    accountsTable: schema.accounts,
    sessionsTable: schema.sessions,
    verificationTokensTable: schema.verificationTokens,
    authenticatorsTable: schema.authenticators,
  }),

  providers: [
    // Google OAuth
    Google({
      clientId: process.env.AUTH_GOOGLE_ID,
      clientSecret: process.env.AUTH_GOOGLE_SECRET,
    }),

    // Email/Password credentials
    Credentials({
      name: "Email",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) {
          return null;
        }

        // Normalize email (lowercase + trim)
        const email = (credentials.email as string).toLowerCase().trim();
        const password = credentials.password as string;

        // Rate limiting - 10 attempts per 15 minutes per email
        const rateLimit = checkLoginRateLimit(email);
        if (!rateLimit.success) {
          // Return null to indicate auth failure
          // NextAuth will show generic "Invalid credentials" error
          // which is better than revealing "too many attempts" for security
          return null;
        }

        // Find user by email
        const user = await db.query.users.findFirst({
          where: eq(schema.users.email, email),
        });

        if (!user || !user.password) {
          return null;
        }

        // Verify password
        const isValid = await bcrypt.compare(password, user.password);

        if (!isValid) {
          return null;
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          image: user.image,
        };
      },
    }),
  ],

  session: {
    strategy: "jwt",
    // Fixed 30-day sessions
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },

  pages: {
    signIn: "/login",
    // signUp: "/signup", // Custom signup page
    error: "/login", // Redirect errors to login
  },

  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token?.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },

  // Trust Railway and localhost
  trustHost: true,
});

// Export auth config for use in API routes
export type { Session } from "next-auth";

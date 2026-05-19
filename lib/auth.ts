// Auth.js v5 setup.
//   • Email + password (Credentials provider)
//   • Authentik OIDC (SSO)
//   • Argon2id for hashes (64MB, 3 iters, 4 parallelism)
//   • Postgres-backed login attempts → §13 rate limit
//   • Sessions in Postgres via the Drizzle adapter (see /lib/auth-adapter.ts)
//
// Server-side authz check at the action layer is required (§13). This file
// only handles authn — knowing *who* — not authz. Use `requireRole()` from
// /lib/auth-guards in your action.ts files.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import Authentik from "@auth/core/providers/authentik";
import { z } from "zod";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { findUserByEmail, findUserById, recordSuccessfulLogin } from "@/lib/db/queries/users";
import { recordLoginAttempt, isRateLimited } from "@/lib/auth-rate-limit";
import { writeAudit } from "@/lib/db/audit";

const ARGON = {
  memoryCost: 64 * 1024, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;

export type Role =
  | "OWNER"
  | "ADMIN"
  | "PAYROLL_STAFF"
  | "ACCOUNTANT"
  | "EMPLOYEE";

export async function hashPassword(plain: string): Promise<string> {
  return argonHash(plain, ARGON);
}

export async function verifyPassword(
  plain: string,
  hash: string,
): Promise<boolean> {
  try {
    return await argonVerify(hash, plain, ARGON);
  } catch {
    return false;
  }
}

const credentialsSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  trustHost: true,
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 30 }, // 30-day rolling
  pages: { signIn: "/login" },
  providers: [
    ...(process.env.AUTHENTIK_CLIENT_ID
      ? [
          Authentik({
            clientId: process.env.AUTHENTIK_CLIENT_ID,
            clientSecret: process.env.AUTHENTIK_CLIENT_SECRET!,
            issuer: process.env.AUTHENTIK_ISSUER!,
          }),
        ]
      : []),
    Credentials({
      credentials: {
        email: { type: "email" },
        password: { type: "password" },
      },
      async authorize(raw) {
        const parsed = credentialsSchema.safeParse(raw);
        if (!parsed.success) return null;
        const { email, password } = parsed.data;

        if (await isRateLimited(email)) {
          await recordLoginAttempt({ email, ip: "rate-limited", succeeded: false });
          throw new Error("RATE_LIMITED");
        }

        const user = await findUserByEmail(email);
        if (!user || user.disabledAt) {
          await recordLoginAttempt({ email, ip: "n/a", succeeded: false });
          return null;
        }
        if (user.lockedUntil && user.lockedUntil > new Date()) {
          throw new Error("LOCKED");
        }
        const ok = await verifyPassword(password, user.passwordHash);
        await recordLoginAttempt({ email, ip: "n/a", succeeded: ok });
        if (!ok) return null;

        await recordSuccessfulLogin(user.id);
        await writeAudit({
          actorId: user.id,
          actorRole: user.role,
          action: "auth.login",
          targetType: "User",
          targetId: user.id,
        });
        // Usage metric — Grafana derives DAU/WAU + role-mix from this.
        try {
          const { authSignins } = await import("@/lib/telemetry");
          authSignins.add(1, { role: user.role });
        } catch {
          /* metric SDK may not be initialized in tests */
        }

        return {
          id: user.id,
          email: user.email,
          name: user.email,
          role: user.role,
          employeeId: user.employeeId ?? undefined,
          mustChangePassword: user.mustChangePassword,
        };
      },
    }),
  ],
  callbacks: {
    async signIn({ user, account }) {
      if (account?.provider === "authentik") {
        if (!user.email) return false;
        const dbUser = await findUserByEmail(user.email);
        return !!(dbUser && !dbUser.disabledAt);
      }
      return true;
    },
    async jwt({ token, user, account, trigger }) {
      if (user) {
        if (account?.provider === "authentik") {
          const dbUser = await findUserByEmail(user.email!);
          if (dbUser) {
            token.id = dbUser.id;
            token.role = dbUser.role;
            token.employeeId = dbUser.employeeId ?? undefined;
            token.mustChangePassword = dbUser.mustChangePassword;
          }
        } else {
          if (user.id !== undefined) token.id = user.id;
          token.role = (user as { role: Role }).role;
          token.employeeId = (user as { employeeId?: string }).employeeId;
          token.mustChangePassword = (user as { mustChangePassword?: boolean }).mustChangePassword ?? false;
        }
      }
      // Refresh stable bits from the DB on every JWT call. Cheap (one
      // indexed lookup) and ensures employeeId / role / mustChangePassword
      // pick up admin-side changes without the user re-signing-in. Catches
      // the bug where an employee was invited AFTER they signed in: their
      // old JWT had employeeId=undefined and /me/time stayed empty until
      // they logged out and back in.
      if (token.id) {
        const fresh = await findUserById(token.id as string);
        if (fresh) {
          token.employeeId = fresh.employeeId ?? undefined;
          token.role = fresh.role;
          token.mustChangePassword = fresh.mustChangePassword;
        }
      }
      void trigger;
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as Role;
        session.user.employeeId = token.employeeId as string | undefined;
        session.user.mustChangePassword = token.mustChangePassword as boolean | undefined;
      }
      return session;
    },
  },
});

// Auth.js v5 setup.
//   • Email + password (Credentials provider)
//   • Argon2id for hashes (64MB, 3 iters, 4 parallelism)
//   • Postgres-backed login attempts → §13 rate limit
//   • Sessions in Postgres via the Drizzle adapter (see /lib/auth-adapter.ts)
//
// Server-side authz check at the action layer is required (§13). This file
// only handles authn — knowing *who* — not authz. Use `requireRole()` from
// /lib/auth-guards in your action.ts files.

import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { findUserByEmail, recordSuccessfulLogin } from "@/lib/db/queries/users";
import { recordLoginAttempt, isRateLimited } from "@/lib/auth-rate-limit";
import { writeAudit } from "@/lib/db/audit";

const ARGON = {
  memoryCost: 64 * 1024, // 64 MB
  timeCost: 3,
  parallelism: 4,
} as const;

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

        return {
          id: user.id,
          email: user.email,
          name: user.email,
          role: user.role,
          employeeId: user.employeeId ?? undefined,
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        if (user.id !== undefined) token.id = user.id;
        token.role = (user as { role: "OWNER" | "ADMIN" | "EMPLOYEE" }).role;
        token.employeeId = (user as { employeeId?: string }).employeeId;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.id as string;
        session.user.role = token.role as "OWNER" | "ADMIN" | "EMPLOYEE";
        session.user.employeeId = token.employeeId as string | undefined;
      }
      return session;
    },
  },
});

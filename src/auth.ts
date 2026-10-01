import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import { db, schema } from "@/db";

export const devLoginEnabled =
  process.env.DEV_LOGIN === "true" && process.env.VERCEL_ENV !== "production";

function adminEmails() {
  return (process.env.ADMIN_EMAILS || "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    ...authConfig.providers,
    ...(devLoginEnabled
      ? [
          Credentials({
            id: "dev",
            name: "Dev login (test copy only)",
            credentials: { email: { label: "Email" } },
            authorize: async (c) => {
              const email = String(c?.email || "").trim().toLowerCase();
              return email ? { email, name: email } : null;
            },
          }),
        ]
      : []),
  ],
  callbacks: {
    ...authConfig.callbacks,
    /** Only people listed in Users (and active) may sign in. ADMIN_EMAILS bootstraps the first admin. */
    async signIn({ user, account }) {
      const email = user.email?.toLowerCase();
      if (!email) return false;
      if (account?.provider === "google" && (account as { email_verified?: boolean }).email_verified === false) return false;
      const [u] = await db.select().from(schema.users).where(eq(schema.users.email, email));
      if (!u) {
        if (!adminEmails().includes(email)) return "/login?error=NotInvited";
        await db.insert(schema.users).values({ email, name: user.name, role: "ADMIN", allLocations: true, allStylePOs: true });
      } else if (!u.active) {
        return "/login?error=Inactive";
      }
      await db.update(schema.users).set({ lastLoginAt: new Date(), ...(u?.name ? {} : { name: user.name }) }).where(eq(schema.users.email, email));
      return true;
    },
    async jwt({ token, user }) {
      if (user?.email) token.email = user.email.toLowerCase();
      return token;
    },
    async session({ session, token }) {
      if (session.user && token.email) session.user.email = token.email as string;
      return session;
    },
  },
});

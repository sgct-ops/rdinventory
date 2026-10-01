import type { NextAuthConfig } from "next-auth";
import Google from "next-auth/providers/google";

/** Edge-safe part of the auth config (used by middleware). */
export const authConfig = {
  providers: [Google],
  pages: { signIn: "/login", error: "/login" },
  session: { strategy: "jwt", maxAge: 60 * 60 * 12 },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user?.email;
    },
  },
  trustHost: true,
} satisfies NextAuthConfig;

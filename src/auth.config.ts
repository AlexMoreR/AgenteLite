import type { NextAuthConfig } from "next-auth";
import type { Role } from "@prisma/client";

const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: { strategy: "jwt" },
  callbacks: {
    authorized({ auth, request }) {
      const pathname = request.nextUrl.pathname;
      const role = auth?.user?.role;

      if (pathname === "/login" || pathname === "/register") {
        return true;
      }

      if (pathname.startsWith("/profile")) {
        return !!auth?.user;
      }

      if (pathname.startsWith("/admin")) {
        return role === "ADMIN";
      }

      if (pathname.startsWith("/empleado")) {
        return !!role && ["ADMIN", "EMPLEADO"].includes(role);
      }

      if (pathname.startsWith("/cliente")) {
        return !!role && ["ADMIN", "CLIENTE"].includes(role);
      }

      return true;
    },
    jwt({ token, user, trigger, session }) {
      if (user) {
        token.role = user.role;
        token.name = user.name;
        token.email = user.email;
        token.picture = user.image;
      }

      if (trigger === "update" && session) {
        if (typeof session.name === "string") token.name = session.name;
        if (typeof session.email === "string") token.email = session.email;
        if (typeof session.image === "string" || session.image === null) {
          token.picture = session.image;
        }
      }

      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.sub ?? "";
        session.user.role = token.role as Role | undefined;
        session.user.name = typeof token.name === "string" ? token.name : null;
        session.user.email = typeof token.email === "string" ? token.email : "";
        session.user.image = typeof token.picture === "string" ? token.picture : null;
      }
      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;

export default authConfig;

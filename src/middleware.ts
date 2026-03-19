import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";

const { auth } = NextAuth(authConfig);

const roleHome = {
  ADMIN: "/admin",
  EMPLEADO: "/empleado",
  CLIENTE: "/cliente",
} as const;

const authPages = ["/login", "/register"];
const canonicalHost = "magilus.com";
const legacyHosts = new Set(["www.magilus.com", "magilus.com.co", "www.magilus.com.co"]);

export default auth((req) => {
  const { nextUrl } = req;
  const session = req.auth;
  const pathname = nextUrl.pathname;
  const role = session?.user?.role;
  const requestHost = req.headers.get("host")?.toLowerCase();

  if (requestHost && legacyHosts.has(requestHost)) {
    const redirectUrl = new URL(nextUrl.toString());
    redirectUrl.protocol = "https:";
    redirectUrl.host = canonicalHost;
    return NextResponse.redirect(redirectUrl, 301);
  }

  if (authPages.includes(pathname) && role) {
    return NextResponse.redirect(new URL(roleHome[role], nextUrl));
  }

  if (pathname.startsWith("/profile") && !session?.user) {
    return NextResponse.redirect(new URL("/login", nextUrl));
  }

  if (pathname.startsWith("/admin")) {
    if (role !== "ADMIN") {
      return NextResponse.redirect(new URL("/unauthorized", nextUrl));
    }
  }

  if (pathname.startsWith("/empleado")) {
    if (!role || !["ADMIN", "EMPLEADO"].includes(role)) {
      return NextResponse.redirect(new URL("/unauthorized", nextUrl));
    }
  }

  if (pathname.startsWith("/cliente")) {
    if (!role || !["ADMIN", "CLIENTE"].includes(role)) {
      return NextResponse.redirect(new URL("/unauthorized", nextUrl));
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

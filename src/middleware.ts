import { NextResponse } from "next/server";
import NextAuth from "next-auth";
import authConfig from "@/auth.config";
import { COOKIE_INICIO, OPCIONES_COOKIE_INICIO, debeMandarAlInicio } from "@/lib/abrir-en-chats";

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
  const primaryWorkspaceId = session?.user?.primaryWorkspaceId;
  const requestHost = req.headers.get("host")?.toLowerCase();

  if (requestHost && legacyHosts.has(requestHost)) {
    const redirectUrl = new URL(nextUrl.toString());
    redirectUrl.protocol = "https:";
    redirectUrl.host = canonicalHost;
    return NextResponse.redirect(redirectUrl, 301);
  }

  // La landing de marketing es solo para visitantes SIN sesión. Si el usuario ya está logueado
  // y cae en "/", lo mandamos directo a su panel. Pasa sobre todo con la PWA instalada: Android
  // congela el start_url del manifest al instalar, así que las apps ya instaladas siguen
  // abriendo en "/" (la landing) aunque el manifest actual apunte a /cliente.
  // Todos entran por "/cliente", que decide el destino según los módulos de cada persona:
  // Chats si la puede ver (las asesoras tienen que contestar rápido), si no Mi día, y si no la
  // bienvenida. No se manda directo a /cliente/chats porque esa pantalla manda a "No autorizado"
  // a quien no tiene el módulo.
  if (pathname === "/" && role) {
    const appHome =
      role === "ADMIN"
        ? "/admin"
        : role === "EMPLEADO" && !primaryWorkspaceId
          ? "/empleado"
          : "/cliente";
    return NextResponse.redirect(new URL(appHome, nextUrl));
  }

  if (authPages.includes(pathname) && role) {
    // Recien logueado: mismo destino que al entrar por "/", para que la experiencia sea una sola.
    const home =
      role === "ADMIN"
        ? roleHome[role]
        : role === "EMPLEADO" && !primaryWorkspaceId
          ? "/empleado"
          : "/cliente";
    return NextResponse.redirect(new URL(home, nextUrl));
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
    if (!role || !["ADMIN", "CLIENTE", "EMPLEADO"].includes(role)) {
      return NextResponse.redirect(new URL("/unauthorized", nextUrl));
    }

    // App instalada, favorito o pestaña vieja que abre Mi día: se manda a /cliente, que abre Chats a quien la
    // puede ver. La cookie corta (aizen_inicio) evita el rebote: a quien no ve Chats, /cliente lo devuelve a
    // Mi día y esa segunda vez pasa normal. La regla está en src/lib/abrir-en-chats.ts.
    if (
      debeMandarAlInicio({
        pathname,
        search: nextUrl.search,
        header: (nombre) => req.headers.get(nombre),
        cookie: (nombre) => req.cookies?.get(nombre)?.value,
      })
    ) {
      const respuesta = NextResponse.redirect(new URL("/cliente", nextUrl));
      respuesta.cookies.set(COOKIE_INICIO, "1", OPCIONES_COOKIE_INICIO);
      return respuesta;
    }
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};

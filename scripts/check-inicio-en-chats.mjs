// Pruebas de "al entrar al CRM, abrir Chats en vez de Mi día": el middleware manda la raíz y /login (con sesión) a
// /cliente, /cliente decide el destino según los módulos de la persona (Chats, si no Mi día, si no la bienvenida) y
// la app instalada abre en /cliente. Con datos de prueba, sin red ni base. Correr: npm run test:inicio-en-chats
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const leer = (archivo) => fs.readFileSync(path.join(RAIZ, archivo), "utf8");

// ---------- Middleware: "/" y "/login" con sesión van a /cliente ----------
const middlewareTexto = leer("src/middleware.ts");
assert.ok(!middlewareTexto.includes("/cliente/crm/mi-dia"), "el middleware ya no debe mandar a /cliente/crm/mi-dia");

const middleware = cargar("src/middleware.ts", {
  "next-auth": { __esModule: true, default: () => ({ auth: (manejador) => manejador }) },
  "@/auth.config": { __esModule: true, default: {} },
  "next/server": {
    NextResponse: {
      redirect: (url) => ({ destino: new URL(url).pathname }),
      next: () => ({ destino: null }),
    },
  },
}).default;

function entrar(ruta, user) {
  const nextUrl = new URL(`https://magilus.com${ruta}`);
  return middleware({
    nextUrl,
    auth: user ? { user } : null,
    headers: { get: (nombre) => (nombre === "host" ? "magilus.com" : null) },
  }).destino;
}

for (const ruta of ["/", "/login", "/register"]) {
  assert.equal(entrar(ruta, { role: "CLIENTE", primaryWorkspaceId: "ws-1" }), "/cliente", `dueño en ${ruta}`);
  assert.equal(entrar(ruta, { role: "EMPLEADO", primaryWorkspaceId: "ws-1" }), "/cliente", `asesora en ${ruta}`);
  assert.equal(entrar(ruta, { role: "EMPLEADO", primaryWorkspaceId: null }), "/empleado", `empleado sin negocio en ${ruta}`);
  assert.equal(entrar(ruta, { role: "ADMIN", primaryWorkspaceId: "ws-1" }), "/admin", `ADMIN en ${ruta}`);
}
assert.equal(entrar("/", null), null, "sin sesión la raíz sigue mostrando la landing");
assert.equal(entrar("/login", null), null, "sin sesión /login sigue mostrando el login");

// ---------- /cliente decide el destino ----------
const estado = { session: null, access: null, membership: null };
class Redireccion extends Error {
  constructor(destino) {
    super(`redirect ${destino}`);
    this.destino = destino;
  }
}
const accesoReal = cargar("src/lib/client-workspace-access.ts", {
  "@/lib/prisma": { prisma: {} },
  "@/auth": { auth: async () => estado.session },
  "next/navigation": { redirect: (destino) => { throw new Redireccion(destino); } },
});
const pagina = cargar("src/app/cliente/page.tsx", {
  "@/auth": { auth: async () => estado.session },
  "next/navigation": { redirect: (destino) => { throw new Redireccion(destino); } },
  "@/components/ui/query-feedback-toast": { QueryFeedbackToast: () => null },
  "@/lib/client-workspace-access": {
    canAccessClientModule: accesoReal.canAccessClientModule,
    getClientWorkspaceAccessForUser: async () => estado.access,
    requireClientWorkspaceAccess: async () => {
      if (!estado.access) throw new Redireccion("/unauthorized");
      return estado.access;
    },
  },
  "@/lib/workspace": { getPrimaryWorkspaceForUser: async () => estado.membership },
}).default;

async function abrirCliente({ role, access, params = {} }) {
  estado.session = { user: { id: "u-1", role, name: "Ana Pérez" } };
  estado.access = access;
  estado.membership = access ? { workspace: { id: "ws-1" } } : null;
  try {
    await pagina({ searchParams: Promise.resolve(params) });
    return "bienvenida";
  } catch (error) {
    if (error instanceof Redireccion) return error.destino;
    throw error;
  }
}

const acceso = (extra) => ({ userId: "u-1", workspaceId: "ws-1", isOwner: false, role: "MEMBER", moduleAccess: [], ...extra });

// Dueño (CLIENTE con negocio): ve todo, va a Chats.
assert.equal(await abrirCliente({ role: "CLIENTE", access: acceso({ isOwner: true, role: "OWNER" }) }), "/cliente/chats");
// Asesora con Chats y CRM: Chats va primero.
assert.equal(await abrirCliente({ role: "EMPLEADO", access: acceso({ moduleAccess: ["crm", "chats"] }) }), "/cliente/chats");
// Asesora solo con Chats.
assert.equal(await abrirCliente({ role: "EMPLEADO", access: acceso({ moduleAccess: ["chats"] }) }), "/cliente/chats");
// Sin Chats y con CRM: se queda en Mi día (y no en "No autorizado").
assert.equal(await abrirCliente({ role: "EMPLEADO", access: acceso({ moduleAccess: ["crm"] }) }), "/cliente/crm/mi-dia");
assert.equal(await abrirCliente({ role: "CLIENTE", access: acceso({ moduleAccess: ["crm"] }) }), "/cliente/crm/mi-dia");
// Sin ninguno de los dos: bienvenida.
assert.equal(await abrirCliente({ role: "EMPLEADO", access: acceso({ moduleAccess: ["contacts"] }) }), "bienvenida");
// Dueño que todavía no creó su negocio: bienvenida, con el botón "Comenzar".
assert.equal(await abrirCliente({ role: "CLIENTE", access: null }), "bienvenida");
// ADMIN que abre /cliente a mano: no cambia, ve la bienvenida.
assert.equal(await abrirCliente({ role: "ADMIN", access: acceso({ role: "ADMIN" }) }), "bienvenida");

// Recién creado el negocio llega con ?ok=: se queda en la bienvenida para que se vea el aviso.
assert.equal(
  await abrirCliente({ role: "CLIENTE", access: acceso({ isOwner: true, role: "OWNER" }), params: { ok: "Negocio configurado" } }),
  "bienvenida",
);

// ---------- La app instalada abre en /cliente ----------
const manifestTexto = leer("src/app/manifest.ts");
assert.match(manifestTexto, /start_url:\s*"\/cliente",/, "la app instalada debe abrir en /cliente");

// ---------- El menú sigue llevando a Mi día ----------
const navCrm = leer("src/components/nav-crm.tsx");
assert.match(navCrm, /\{ title: "Mi día", view: "mi-dia"/, "el menú del CRM debe seguir teniendo Mi día");
assert.ok(navCrm.includes("href={`/cliente/crm/${item.view}`}"), "Mi día del menú debe seguir abriendo /cliente/crm/mi-dia");

// ---------- Regla "abrir en Chats" para la app instalada con el start_url viejo (/cliente/crm/mi-dia) ----------
const abrirEnChats = cargar("src/lib/abrir-en-chats.ts");
const abrirEnChatsTexto = leer("src/lib/abrir-en-chats.ts");
assert.ok(!/from\s+["']next/.test(abrirEnChatsTexto), "abrir-en-chats.ts no debe importar next ni next-auth");
assert.equal(abrirEnChats.RUTA_MI_DIA, "/cliente/crm/mi-dia");
assert.equal(abrirEnChats.COOKIE_INICIO, "aizen_inicio");
assert.deepEqual(
  { ...abrirEnChats.OPCIONES_COOKIE_INICIO },
  { maxAge: 60, httpOnly: true, sameSite: "lax", path: "/" },
  "opciones de la cookie aizen_inicio",
);

const MARCAS_APERTURA = { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" };
function decide({ pathname = "/cliente/crm/mi-dia", search = "", headers = MARCAS_APERTURA, cookies = {} } = {}) {
  return abrirEnChats.debeMandarAlInicio({
    pathname,
    search,
    header: (nombre) => headers[nombre] ?? null,
    cookie: (nombre) => cookies[nombre],
  });
}

assert.equal(decide(), true, "apertura nueva de Mi día (navigate, document, none, sin RSC ni cookie) va al inicio");
assert.equal(decide({ headers: { ...MARCAS_APERTURA, rsc: "1" } }), false, "con RSC: 1 no redirige");
assert.equal(decide({ headers: { ...MARCAS_APERTURA, "sec-fetch-site": "same-origin" } }), false, "con Sec-Fetch-Site: same-origin no redirige");
assert.equal(decide({ cookies: { aizen_inicio: "1" } }), false, "con la cookie aizen_inicio no redirige");
assert.equal(decide({ search: "?x=1" }), false, "con ?x=1 no redirige");
assert.equal(decide({ headers: {} }), false, "sin marcas Sec-Fetch-* (navegador viejo) no redirige");
for (const ruta of ["/cliente/crm/registro", "/cliente/chats", "/cliente/crm/mi-dia/"]) {
  assert.equal(decide({ pathname: ruta }), false, `${ruta} no redirige`);
}

console.log("OK inicio-en-chats: raíz y /login a /cliente; /cliente abre Chats, si no Mi día, si no la bienvenida; app instalada en /cliente.");
console.log("OK abrir-en-chats: solo la apertura nueva de /cliente/crm/mi-dia (sin RSC, sin cookie, sin parámetros) va al inicio.");

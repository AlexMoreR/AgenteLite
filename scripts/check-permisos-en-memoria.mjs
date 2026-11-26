// Pruebas de «Rutas con permisos en memoria» (pasar las rutas a getClientWorkspaceAccessForUserCached).
//
// (a) Lee el codigo de cada ruta de ARCHIVOS: usa la version con memoria de 45 s, ya no la de sin
//     memoria ni getPrimaryWorkspaceForUser, y sigue pidiendo el MISMO modulo en canAccessClientModule
//     (el modulo sale del codigo de antes del cambio). Las partes 2, 3 y 4 agregan sus archivos aca.
// (b) Con el Prisma REAL y un pool de pg falso (como check-velocidad-bandeja.mjs): dos pedidos seguidos
//     del mismo usuario no vuelven a leer los permisos, y tras escribir un WorkspaceMember si.
// (c) Imprime cuantas consultas de permisos hacian dos pedidos antes y cuantas hacen ahora.
// Sin red ni base. Correr: npm run test:permisos-en-memoria   (requiere `prisma generate` hecho)
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const require = createRequire(import.meta.url);
const raiz = path.resolve("src");
process.env.DATABASE_URL = process.env.DATABASE_URL_FALSA ?? "postgres://x:y@127.0.0.1:1/z";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const leer = (relativo) => fs.readFileSync(path.resolve(relativo), "utf8").replace(/\r\n/g, "\n");
const sinComentarios = (texto) => texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/* ------------------------------------------------------------------------------------------------
   (a) Las rutas. archivo -> modulos que pide canAccessClientModule (en el orden del codigo).
   Lista vacia = la ruta no llama canAccessClientModule (y no tiene que empezar a llamarlo).
------------------------------------------------------------------------------------------------ */
const ARCHIVOS = {
  // Parte 1: chats, flujos, seguimientos y buscar.
  "src/app/api/cliente/chats/enviar/route.ts": ["chats"],
  "src/app/api/cliente/chats/enviar/fallo/route.ts": ["chats"],
  "src/app/api/cliente/chats/upload-audio/route.ts": ["chats"],
  "src/app/api/cliente/flujos/route.ts": ["flows"],
  "src/app/api/cliente/flujos/upload-media/route.ts": ["flows"],
  "src/app/api/cliente/seguimientos/upload-media/route.ts": ["seguimientos"],
  "src/app/api/cliente/buscar/route.ts": ["chats", "contacts", "products_v2"],
  // Permiso de supervisora (puedeSupervisar), sin canAccessClientModule.
  "src/app/api/cliente/carta-de-colores/foto/route.ts": [],
  // Solo pide estar en un negocio, sin canAccessClientModule.
  "src/app/api/cliente/crm/conteo-etapas/route.ts": [],
};

for (const [archivo, modulos] of Object.entries(ARCHIVOS)) {
  await prueba(`${archivo}: permisos con memoria y el mismo modulo (${modulos.join(", ") || "ninguno"})`, () => {
    const codigo = sinComentarios(leer(archivo));
    assert.match(codigo, /getClientWorkspaceAccessForUserCached\(/, "no usa la version con memoria");
    assert.doesNotMatch(codigo, /getClientWorkspaceAccessForUser\(/, "sigue usando la version sin memoria");
    assert.doesNotMatch(codigo, /getPrimaryWorkspaceForUser\(/, "sigue leyendo la membresia aparte");
    assert.doesNotMatch(codigo, /membership\./, "quedo un uso de membership");
    const pedidos = [...codigo.matchAll(/canAccessClientModule\(\s*access\s*,\s*"([^"]+)"\s*\)/g)].map((m) => m[1]);
    const llamadas = codigo.match(/canAccessClientModule\(/g)?.length ?? 0;
    assert.equal(llamadas, pedidos.length, "hay una llamada a canAccessClientModule que la prueba no reconoce");
    assert.deepEqual(pedidos, modulos, "cambio el modulo de canAccessClientModule");
  });
}

/* ------------------------------------------------------------------------------------------------
   (b) Pool de pg falso y cargador de src: copiados de check-velocidad-bandeja.mjs.
------------------------------------------------------------------------------------------------ */
const pg = require("pg");
const escenario = { userRole: "CLIENTE", memberRole: "OWNER" };
const sqls = [];

function columnas(sql) {
  const m = /^SELECT (.*?) FROM "public"\."(\w+)"/s.exec(sql);
  if (!m) return null;
  const partes = [];
  let prof = 0;
  let actual = "";
  for (const ch of m[1]) {
    if (ch === "(") prof++;
    if (ch === ")") prof--;
    if (ch === "," && prof === 0) {
      partes.push(actual.trim());
      actual = "";
      continue;
    }
    actual += ch;
  }
  if (actual.trim()) partes.push(actual.trim());
  return {
    tabla: m[2],
    cols: partes.map((p) => / AS "([^"]+)"$/.exec(p)?.[1] ?? /"([^"]+)"(::[\w[\]]+)?$/.exec(p)?.[1] ?? p),
  };
}

function valor(tabla, col) {
  if (/^_aggr_count/.test(col)) return [23, 0];
  // El groupBy de conteo-etapas (por ejemplo "_count$_all").
  if (/^_count/.test(col)) return [23, 0];
  if (col === "role") return [25, tabla === "User" ? escenario.userRole : escenario.memberRole];
  if (col === "provider") return [25, "EVOLUTION"];
  if (col === "status") return [25, tabla === "Conversation" ? "OPEN" : "CONNECTED"];
  if (col === "moduleAccess") return [3802, JSON.stringify(["chats"])];
  if (col === "metadata" || col === "activeProductContext") return [3802, "{}"];
  if (col === "crmStage" || col === "planTier") return [25, null];
  if (col === "value") return [25, "[]"];
  if (/At$/.test(col)) return [1114, "2026-10-08 10:00:00.000"];
  if (col === "isActive") return [16, true];
  if (/^is[A-Z]/.test(col) || col === "automationPaused") return [16, false];
  if (col === "name" || col === "email" || col === "phoneNumber" || col === "key") return [25, "n"];
  return [25, "x1"];
}

class PoolFalso extends pg.Pool {
  async query(q) {
    const text = typeof q === "string" ? q : q.text;
    sqls.push(text);
    const info = columnas(text);
    if (!info) return { fields: [], rows: [], rowCount: 1 };
    return {
      fields: info.cols.map((c) => ({ name: c, dataTypeID: valor(info.tabla, c)[0] })),
      rows: [info.cols.map((c) => valor(info.tabla, c)[1])],
      rowCount: 1,
    };
  }
  // Las escrituras de Prisma van en una transaccion interna: piden una conexion propia.
  async connect() {
    return {
      query: (q) => this.query(q),
      release() {},
      on() {},
      removeListener() {},
    };
  }
}

/* ------------------------------------------------------------------------------------------------
   Cargador de los .ts de src (con el alias @/), igual que las otras pruebas pero recursivo.
------------------------------------------------------------------------------------------------ */
function cargadorDeSrc(sesion) {
  const modulos = new Map();
  const reemplazos = {
    pg: { ...pg, Pool: PoolFalso, default: { ...pg, Pool: PoolFalso } },
    react: { cache: (f) => f },
    "@/auth": { auth: async () => sesion.actual },
    "next/navigation": {
      redirect() {
        throw new Error("redirect");
      },
      notFound() {
        throw new Error("404");
      },
    },
    "server-only": {},
    // Corre en segundo plano (after): no es parte de la respuesta y aca no hay contexto de Next.
    "@/lib/contact-avatar-refresh": { scheduleContactAvatarRefresh() {}, scheduleSingleContactAvatarRefresh() {} },
  };
  const resolver = (base) => {
    for (const ext of ["", ".ts", ".tsx", "/index.ts", "/index.tsx"]) {
      const f = base + ext;
      if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
    }
    return null;
  };
  function requerir(spec, desde) {
    if (reemplazos[spec]) return reemplazos[spec];
    const archivo = spec.startsWith("@/")
      ? resolver(path.join(raiz, spec.slice(2)))
      : spec.startsWith(".")
        ? resolver(path.resolve(path.dirname(desde), spec))
        : null;
    if (!archivo || !/\.tsx?$/.test(archivo)) return require(archivo ?? spec);
    if (modulos.has(archivo)) return modulos.get(archivo).exports;
    const mod = { exports: {} };
    modulos.set(archivo, mod);
    const salida = ts.transpileModule(fs.readFileSync(archivo, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
        jsx: ts.JsxEmit.ReactJSX,
      },
      fileName: archivo,
    });
    new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
      mod.exports,
      (s) => requerir(s, archivo),
      mod,
      archivo,
      path.dirname(archivo),
    );
    return mod.exports;
  }
  return (spec) => requerir(spec, path.join(raiz, "index.ts"));
}

const sesion = { actual: { user: { id: "x1", role: "CLIENTE" } } };
const cargar = cargadorDeSrc(sesion);
const permisos = cargar("@/lib/cache-de-permisos");
const { prisma } = cargar("@/lib/prisma");
const acceso = cargar("@/lib/client-workspace-access");
const { getPrimaryWorkspaceForUser } = cargar("@/lib/workspace");
const { GET: conteoDeEtapas } = cargar("@/app/api/cliente/crm/conteo-etapas/route");

// Las tablas de "quien es y que puede ver": usuario, membresia y negocio.
const esDePermisos = (sql) => /FROM "public"\."(User|WorkspaceMember|Workspace)"/.test(sql);
const consultasDePermisos = () => sqls.filter(esDePermisos).length;

async function pedirConteo() {
  sqls.length = 0;
  const res = await conteoDeEtapas();
  const cuerpo = await res.json();
  assert.equal(res.status, 200, JSON.stringify(cuerpo));
  assert.equal(cuerpo.ok, true, JSON.stringify(cuerpo));
  return consultasDePermisos();
}

let antes = 0;
let despues = 0;

await prueba("antes: cada pedido leia el acceso sin memoria y la membresia aparte", async () => {
  for (let i = 0; i < 2; i++) {
    sqls.length = 0;
    assert.ok(await acceso.getClientWorkspaceAccessForUser("x1"));
    assert.ok(await getPrimaryWorkspaceForUser("x1"));
    antes += consultasDePermisos();
  }
  assert.ok(antes >= 4, `antes: ${antes}`);
});

await prueba("ahora: el segundo pedido del mismo usuario hace 0 consultas de permisos", async () => {
  permisos.vaciarCachesDePermisos();
  const primero = await pedirConteo();
  const segundo = await pedirConteo();
  despues = primero + segundo;
  assert.ok(primero > 0, "el primer pedido tiene que leer de la base");
  assert.equal(segundo, 0, `el segundo pedido hizo ${segundo} consultas de permisos`);
});

await prueba("tras escribir un WorkspaceMember vuelve a leer el acceso de la base", async () => {
  await pedirConteo();
  assert.equal(await pedirConteo(), 0);
  await prisma.workspaceMember.updateMany({ where: { userId: "x1" }, data: { moduleAccess: [] } });
  assert.ok((await pedirConteo()) > 0, "no volvio a leer el acceso tras la escritura");
  assert.equal(await pedirConteo(), 0, "y despues vuelve a la memoria");
  permisos.vaciarCachesDePermisos();
});

console.log(`\nantes: ${antes} consultas / después: ${despues}  (consultas de permisos en dos pedidos seguidos)`);
console.log(`\n${pruebas} pruebas ok`);
process.exit(0);

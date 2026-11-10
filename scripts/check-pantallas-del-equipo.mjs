// Pruebas de las pantallas que ve cada persona del equipo (Mi empresa -> Equipo -> editar persona):
// la casilla "Automatizaciones" existe, arranca desmarcada, da acceso solo a quien la tiene (y
// siempre al dueño), el menú la muestra con la casilla y solo el dueño o un administrador guardan
// casillas. No necesita base ni red.
// Correr: npm run test:pantallas-del-equipo
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);

// Módulos que necesitan base, sesión o Next: no hacen falta para estas reglas.
const falsos = {
  "next/navigation": { redirect: (a) => { throw new Error(`redirect ${a}`); } },
  "@/auth": { auth: async () => null },
  "@/lib/prisma": { prisma: {} },
  "@/lib/cache-de-permisos": { cacheDeAcceso: { obtener: (_id, fn) => fn() } },
};

/** Carga un .ts transpilado, resolviendo los imports relativos y los alias `@/` a src/. */
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido in falsos) return falsos[pedido];
    let base = null;
    if (pedido.startsWith("@/")) base = path.resolve("src", pedido.slice(2));
    else if (pedido.startsWith(".")) base = path.resolve(path.dirname(absoluto), pedido);
    if (base) {
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
      throw new Error(`no se encontró ${pedido}`);
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    requerir,
    mod,
    absoluto,
    path.dirname(absoluto),
  );
  return mod.exports;
}

const modulos = cargar("src/lib/client-workspace-modules.ts");
const { adminModuleDefinitions } = cargar("src/lib/admin-modules.ts");
const { canAccessClientModule } = cargar("src/lib/client-workspace-access.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

prueba("automatizaciones y coach están en la lista oficial de pantallas", () => {
  const auto = adminModuleDefinitions.find((m) => m.key === "automatizaciones");
  assert.ok(auto, "falta automatizaciones");
  assert.equal(auto.label, "Automatizaciones");
  assert.equal(auto.path, "/cliente/automatizaciones");
  const coach = adminModuleDefinitions.find((m) => m.key === "coach");
  assert.ok(coach, "falta coach");
  assert.equal(coach.label, "Coach");
  assert.equal(coach.path, "/cliente/equipo/coach");
});

prueba("automatizaciones es casilla del equipo; coach todavía no", () => {
  assert.ok(modulos.clientAssignableModuleKeys.includes("automatizaciones"));
  assert.ok(!modulos.clientAssignableModuleKeys.includes("coach"));
  assert.ok(modulos.clientAssignableModuleDefinitions.some((m) => m.key === "automatizaciones" && m.label === "Automatizaciones"));
  // Se guarda y se lee de vuelta (no la descarta el limpiador).
  assert.deepEqual(modulos.sanitizeClientModuleAccess(["automatizaciones", "coach", "x"]), ["automatizaciones"]);
});

prueba("lo nuevo arranca desmarcado: por defecto solo chats, contacts y crm", () => {
  assert.deepEqual([...modulos.defaultClientEmployeeModuleKeys], ["chats", "contacts", "crm"]);
});

prueba("canAccessClientModule: la asesora solo con la casilla; el dueño y el admin siempre", () => {
  const asesora = (moduleAccess) => ({ isOwner: false, role: "EMPLEADO", moduleAccess });
  assert.equal(canAccessClientModule(asesora(["chats", "crm"]), "automatizaciones"), false);
  assert.equal(canAccessClientModule(asesora(["chats", "automatizaciones"]), "automatizaciones"), true);
  assert.equal(canAccessClientModule(asesora([]), "automatizaciones"), false);
  assert.equal(canAccessClientModule({ isOwner: true, role: "CLIENTE", moduleAccess: [] }, "automatizaciones"), true);
  assert.equal(canAccessClientModule({ isOwner: false, role: "ADMIN", moduleAccess: [] }, "automatizaciones"), true);
});

const leer = (archivo) => fs.readFileSync(path.resolve(archivo), "utf8");

prueba("el menú muestra Automatizaciones al jefe o a quien tiene la casilla, sin repetirla", () => {
  const menu = leer("src/components/app-sidebar.tsx");
  assert.ok(menu.includes("esJefeDelNegocio || adminModuleAccess.automatizaciones"));
  assert.ok(menu.includes('module.key !== "automatizaciones"'), "automatizaciones saldría dos veces");
  assert.ok(menu.includes('module.key !== "coach"'), "coach saldría dos veces");
  // Agente V3 sigue solo para jefes.
  const v3 = menu.indexOf('href="/cliente/agente-v3"');
  const antes = menu.lastIndexOf("{esJefeDelNegocio ? (", v3);
  assert.ok(v3 > 0 && antes > 0 && antes > menu.indexOf("esJefeDelNegocio || adminModuleAccess.automatizaciones"));
});

prueba("la página y las acciones dejan entrar al jefe o a quien tiene la casilla", () => {
  const pagina = leer("src/app/cliente/automatizaciones/page.tsx");
  assert.ok(pagina.includes('canAccessClientModule(access, "automatizaciones")'));
  assert.ok(pagina.includes("puedeSupervisar(access)"));
  const acciones = leer("src/app/actions/automatizaciones-actions.ts");
  assert.ok(acciones.includes('canAccessClientModule(access, "automatizaciones")'));
  assert.ok(acciones.includes("puedeSupervisar(access)"));
});

prueba("solo el dueño o un administrador guardan las casillas del equipo", () => {
  const equipo = leer("src/app/actions/equipo-actions.ts");
  assert.ok(equipo.includes('requireClientWorkspaceAccess("client_team", { ownerOnly: true })'));
});

console.log(`\n${pruebas} pruebas ok`);

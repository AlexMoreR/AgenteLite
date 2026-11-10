// Pruebas de P1, abrir /cliente/chats mas rapido (10-11-2026): ajustes del sistema en memoria, el
// layout raiz con menos idas en fila y la pagina de Chats con lo independiente junto.
// No necesita base: los ajustes corren con el Prisma REAL y un pool de pg falso que anota cada SQL
// y guarda AppSetting en un Map. El layout y la pagina se revisan por su codigo.
// Correr: node scripts/check-apertura-chats.mjs   (requiere `prisma generate` hecho)
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

/* ------------------------------------------------------------------------------------------------
   Pool de pg falso: anota cada SQL; AppSetting vive en un Map (INSERT ... ON CONFLICT y SELECT
   "value" ... WHERE "key" = $1). Todo lo demas devuelve vacio.
------------------------------------------------------------------------------------------------ */
const pg = require("pg");
const sqls = [];
const ajustes = new Map();

class PoolFalso extends pg.Pool {
  async query(q) {
    const text = typeof q === "string" ? q : q.text;
    const values = typeof q === "string" ? [] : (q.values ?? []);
    sqls.push(text);
    if (/INSERT INTO "AppSetting"/.test(text)) {
      ajustes.set(values[0], values[1]);
      return { fields: [], rows: [], rowCount: 1 };
    }
    if (/SELECT "value"\s+FROM "AppSetting"/.test(text)) {
      const valor = ajustes.get(values[0]);
      return {
        fields: [{ name: "value", dataTypeID: 25 }],
        rows: valor === undefined ? [] : [[valor]],
        rowCount: valor === undefined ? 0 : 1,
      };
    }
    return { fields: [], rows: [], rowCount: 0 };
  }
  async connect() {
    return { query: (q) => this.query(q), release() {}, on() {}, removeListener() {} };
  }
}

/* ------------------------------------------------------------------------------------------------
   Cargador de los .ts de src (con el alias @/), igual que check-velocidad-bandeja.
------------------------------------------------------------------------------------------------ */
function cargadorDeSrc() {
  const modulos = new Map();
  const reemplazos = {
    pg: { ...pg, Pool: PoolFalso, default: { ...pg, Pool: PoolFalso } },
    react: { cache: (f) => f },
    "@/auth": { auth: async () => null },
    "next/navigation": {
      redirect() {
        throw new Error("redirect");
      },
    },
    "server-only": {},
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

// Reloj propio SOLO mientras se carga: la cache de ajustes guarda la funcion Date.now al crearse y
// sigue usando este reloj; el resto (Prisma) vuelve al de verdad.
let reloj = 1_000_000;
const dateNowOriginal = Date.now;
Date.now = () => reloj;
const cargar = cargadorDeSrc();
const ajustesMod = cargar("@/lib/system-settings");
Date.now = dateNowOriginal;

const cuantos = (regex) => sqls.filter((s) => regex.test(s)).length;
const CREATE = /CREATE TABLE IF NOT EXISTS "AppSetting"/;
const SELECT_AJUSTE = /SELECT "value"\s+FROM "AppSetting"/;

/* ------------------------------------------------------------------------------------------------
   1. Ajustes del sistema en memoria (system-settings.ts)
------------------------------------------------------------------------------------------------ */
await prueba("ajustes: dos lecturas de marca, color y Evolution = 1 CREATE TABLE y 1 SELECT por clave", async () => {
  sqls.length = 0;
  ajustes.set("brandName", "Magilus");
  ajustes.set("primaryColor", "#112233");
  for (let vuelta = 0; vuelta < 2; vuelta += 1) {
    assert.equal(await ajustesMod.getSystemBrandName(), "Magilus");
    assert.equal(await ajustesMod.getSystemPrimaryColor(), "#112233");
    await ajustesMod.getSystemPrimaryStrongColor();
    await ajustesMod.getEvolutionSettings();
  }
  assert.equal(cuantos(CREATE), 1, "el CREATE TABLE va una vez por proceso");
  // marca + color + 5 de Evolution, una vez cada una.
  assert.equal(cuantos(SELECT_AJUSTE), 7);
});

await prueba("ajustes: despues de setSystemBrandName la lectura siguiente trae el valor nuevo", async () => {
  await ajustesMod.setSystemBrandName("  Marca Nueva ");
  assert.equal(await ajustesMod.getSystemBrandName(), "Marca Nueva");
  await ajustesMod.setSystemPrimaryColor("#ABC");
  assert.equal(await ajustesMod.getSystemPrimaryColor(), "#aabbcc");
  await ajustesMod.setEvolutionSettings({
    apiBaseUrl: "https://evo.example/",
    apiToken: "tok",
    instancePrefix: "Pre",
    webhookBaseUrl: "",
    webhookSecret: "",
  });
  const evo = await ajustesMod.getEvolutionSettings();
  assert.equal(evo.apiBaseUrl, "https://evo.example");
  assert.equal(evo.instancePrefix, "pre");
  assert.equal(cuantos(CREATE), 1, "escribir tampoco repite el CREATE TABLE");
});

await prueba("ajustes: pasados 60 s se vuelve a leer de la base (cambio hecho desde afuera)", async () => {
  ajustes.set("brandName", "Desde Afuera");
  assert.equal(await ajustesMod.getSystemBrandName(), "Marca Nueva", "dentro de los 60 s sigue lo guardado");
  reloj += 60_001;
  const antes = cuantos(SELECT_AJUSTE);
  assert.equal(await ajustesMod.getSystemBrandName(), "Desde Afuera");
  assert.equal(cuantos(SELECT_AJUSTE), antes + 1);
});

await prueba("ajustes: sin valor guardado sale el de siempre y una falla no se guarda", async () => {
  ajustes.delete("currency");
  reloj += 60_001;
  assert.equal(await ajustesMod.getSystemCurrency(), "COP");
  const fuente = fs.readFileSync(path.join(raiz, "lib/system-settings.ts"), "utf8");
  // La lectura con error sigue devolviendo null (catch) y la escritura borra su clave aunque falle.
  assert.match(fuente, /return await cacheDeAjustes\.obtener\(key, \(\) => readSettingValueFromDb\(key\)\);\s*\} catch \{\s*return null;/);
  assert.match(fuente, /\} finally \{[\s\S]*?cacheDeAjustes\.invalidar\(key\);/);
});

/* ------------------------------------------------------------------------------------------------
   2. Layout raiz (app/layout.tsx)
------------------------------------------------------------------------------------------------ */
const layout = fs.readFileSync(path.join(raiz, "app/layout.tsx"), "utf8");
const cuerpoDelLayout = layout.slice(layout.indexOf("export default async function RootLayout"));

await prueba("layout: la membresia sale en el mismo Promise.all que los ajustes y el acceso", async () => {
  const inicio = cuerpoDelLayout.indexOf("await Promise.all([");
  assert.ok(inicio >= 0);
  const todo = cuerpoDelLayout.slice(inicio, cuerpoDelLayout.indexOf("]);", inicio));
  assert.match(todo, /getPrimaryWorkspaceForUser\(session\.user\.id\)/);
  assert.match(todo, /getSystemPrimaryColor\(\)/);
  assert.match(todo, /getSystemBrandName\(\)/);
  assert.match(todo, /getClientWorkspaceAccessForRequest\(session\.user\.id\)/);
  assert.equal((cuerpoDelLayout.match(/getPrimaryWorkspaceForUser\(/g) ?? []).length, 1, "nada en fila antes");
  assert.doesNotMatch(cuerpoDelLayout, /getClientWorkspaceAccessForUser\(/);
});

await prueba("layout: enforceWorkspacePlanAccess solo con el plan vencido; la fecha sale de la membresia", async () => {
  assert.equal((cuerpoDelLayout.match(/enforceWorkspacePlanAccess\(/g) ?? []).length, 1);
  assert.match(
    cuerpoDelLayout,
    /if \(clientWorkspace\?\.workspace\.id && planState\.blockClientArea\) \{\s*await enforceWorkspacePlanAccess\(clientWorkspace\.workspace\.id\);\s*\}/,
  );
  assert.match(cuerpoDelLayout, /const planExpiresAt = clientWorkspace\?\.workspace\.planExpiresAt \?\? null;/);
});

/* ------------------------------------------------------------------------------------------------
   3. Una lectura del acceso por pedido (client-workspace-access.ts)
------------------------------------------------------------------------------------------------ */
await prueba("acceso: requireClientWorkspaceAccess usa la lectura del pedido (cache de React)", async () => {
  const acceso = fs.readFileSync(path.join(raiz, "lib/client-workspace-access.ts"), "utf8");
  assert.match(acceso, /import \{ cache \} from "react";/);
  assert.match(acceso, /export const getClientWorkspaceAccessForRequest = cache\(getClientWorkspaceAccessForUser\);/);
  const requerir = acceso.slice(acceso.indexOf("export async function requireClientWorkspaceAccess"));
  assert.match(requerir, /await getClientWorkspaceAccessForRequest\(session\.user\.id\)/);
  // La cache de 45 s de las rutas no cambia.
  assert.match(acceso, /cacheDeAcceso\.obtener\(userId, \(\) => getClientWorkspaceAccessForUser\(userId\)\)/);
});

/* ------------------------------------------------------------------------------------------------
   4 y 5. La pagina de Chats (app/cliente/chats/page.tsx)
------------------------------------------------------------------------------------------------ */
const pagina = fs.readFileSync(path.join(raiz, "app/cliente/chats/page.tsx"), "utf8");
const cuerpoDeLaPagina = pagina.slice(pagina.indexOf("export default async function ClienteChatsPage"));

function bloqueDelAfter(fuente) {
  const inicio = fuente.indexOf("after(async () => {");
  assert.ok(inicio >= 0);
  return fuente.slice(inicio, fuente.indexOf("syncLeadLifecycleForContacts(", inicio));
}

await prueba("pagina: los chats fijados ya no se leen dentro del JSX", async () => {
  assert.doesNotMatch(pagina, /await leerChatsFijados/);
  assert.match(pagina, /chatsFijados=\{chatsFijados\}/);
});

await prueba("pagina: businessConfig solo se lee dentro del after() del etiquetado", async () => {
  const antesDelAfter = cuerpoDeLaPagina.slice(0, cuerpoDeLaPagina.indexOf("after(async () => {"));
  assert.doesNotMatch(antesDelAfter, /businessConfig/);
  assert.match(bloqueDelAfter(cuerpoDeLaPagina), /select: \{ businessConfig: true \}/);
});

await prueba("pagina: supervisora, firma, monitoreo, canales visibles y fijados en un mismo Promise.all", async () => {
  const inicio = cuerpoDeLaPagina.indexOf("await Promise.all([");
  const todo = cuerpoDeLaPagina.slice(inicio, cuerpoDeLaPagina.indexOf("const chatKeySolicitada", inicio));
  for (const llamada of [
    /esSupervisora\(membership\.workspace\.id, access\.userId\)/,
    /select: \{ chatSignature: true \}/,
    /canalesQueMonitorea\(\{/,
    /getVisibleChannelIds\(\{/,
    /leerChatsFijados\(access\.userId\)/,
    /chatKeyPorConversacion\(\{/,
  ]) {
    assert.match(todo, llamada);
  }
  // Ninguna se vuelve a pedir en fila.
  for (const nombre of ["esSupervisora(", "canalesQueMonitorea(", "getVisibleChannelIds(", "chatKeyPorConversacion("]) {
    assert.equal(cuerpoDeLaPagina.split(nombre).length - 1, 1, nombre);
  }
  // La supervisora solo se pregunta si no es dueño ni administrador (como antes).
  assert.match(todo, /membership\.role === "OWNER" \|\| membership\.role === "ADMIN"\s*\? Promise\.resolve\(false\)\s*: esSupervisora/);
  // Los canales visibles usan isOwner/ADMIN, no isManager.
  assert.match(todo, /esJefe: access\.isOwner \|\| access\.role === "ADMIN"/);
});

await prueba("pagina: el permiso del enlace y la conexion elegida salen juntos", async () => {
  const inicio = cuerpoDeLaPagina.indexOf("const [puedeAbrirSolicitado, conexionElegida] = await Promise.all([");
  assert.ok(inicio >= 0);
  const todo = cuerpoDeLaPagina.slice(inicio, cuerpoDeLaPagina.indexOf("]);", inicio));
  assert.match(todo, /puedeAbrirChatPorClave\(\{/);
  assert.match(todo, /resolverConexionElegida\(\{/);
  assert.match(todo, /: Promise\.resolve\(false\)/);
});

await prueba("pagina: con un chat abierto, el detalle y la etapa del contacto salen juntos", async () => {
  const promesa = cuerpoDeLaPagina.indexOf("const selectedContactRowPromise");
  const detalle = cuerpoDeLaPagina.indexOf("await loadAgentConversationDetail(");
  const espera = cuerpoDeLaPagina.indexOf("const selectedContactRow = await selectedContactRowPromise;");
  assert.ok(promesa >= 0 && detalle >= 0 && espera >= 0);
  assert.ok(promesa < detalle && detalle < espera, "la etapa se pide antes del detalle y se espera despues");
  assert.match(cuerpoDeLaPagina, /const selectedContactId = selectedUnified \? selectedUnified\.contactId \?\? null : null;/);
});

await prueba("pagina: el etiquetado usa EXISTS y no COUNT(*)", async () => {
  const bloque = bloqueDelAfter(cuerpoDeLaPagina);
  assert.match(bloque, /WHERE EXISTS \(/);
  assert.match(bloque, /unnest\(ARRAY\[\$\{Prisma\.join\(contactIds\)\}\]::text\[\]\)/);
  assert.match(bloque, /m\."direction" = 'OUTBOUND'/);
  // El conteo de salientes (outboundCount) ya no existe; el COUNT(*) de entrantes es otra consulta y no cambia.
  assert.doesNotMatch(bloque, /outboundCount/);
});

await prueba("pagina: el bloque de la apertura de la asesora no cambia", async () => {
  const apertura = pagina.slice(pagina.indexOf("const veTodasLaBandeja"), pagina.indexOf("let paginaDeEsperando"));
  assert.match(apertura, /const veTodasLaBandeja = isManager \|\| modoMonitoreo;/);
  assert.match(apertura, /try \{\s*esperandoMios = \(await leerListaDeEspera\("mine"\)\)\.length;\s*\} catch/);
});

/* ------------------------------------------------------------------------------------------------
   6. La membresia sin _count (lib/workspace.ts)
------------------------------------------------------------------------------------------------ */
await prueba("membresia: getPrimaryWorkspaceForUser sigue entregando la fecha del plan (el layout la usa)", async () => {
  // El _count NO se quita: agent-actions.ts lo lee (tsc lo detecto el 10-nov-2026).
  const fuente = fs.readFileSync(path.join(raiz, "lib/workspace.ts"), "utf8");
  assert.match(fuente, /planExpiresAt: true,/);
});

console.log(`\n${pruebas} pruebas ok`);
process.exit(0);

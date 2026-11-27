// Pruebas de «nunca construir en el repo equivocado» (27-nov-2026, parte 2): antes de construir, y desde la primera vez que Claude
// no cambió ningún archivo, el Coordinador mira con git si los archivos del plan están en el repo de la tarjeta. Si están en el
// otro repo, /cambiar-repo le cambia el repo y la vuelve a planear; sin construir, sin reparar y sin gastar intento.
//   node trabajador-tablero/pruebas/probar-repo-equivocado.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Dos repos git temporales («aizencrm» y «gestion», cada uno con su "origin" en una carpeta), un CRM falso que guarda las llamadas
// y el claude falso de siempre (anota en CLAUDE_FALSO_LOG cada vez que lo abren). Sin red de verdad.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { manejarFalla, procesar } from "../lib/bucle.mjs";
import { COMO_SE_RESOLVIO, QUE_FALLO, reglaPara } from "../lib/bitacora.mjs";
import { archivosExistentesDelPlan } from "../lib/choques.mjs";
import { completarConfig } from "../lib/config.mjs";
import { CATEGORIAS } from "../lib/diagnostico.mjs";
import { repoDelNecesito } from "../lib/agentes.mjs";
import { ErrorDeEtapa, otroRepoDelPlan, promptDeConstruir, revisarArchivosDelRepo } from "../lib/etapas.mjs";
import { repoDeLaRecomendada, seguirConLaRecomendada } from "../lib/preguntas-abiertas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "repo-equivocado-"));
const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

/** Un repo con su "origin" (una carpeta bare) y estos archivos en main. */
function repoDePrueba(nombre, archivos) {
  const remoto = path.join(T, `${nombre}.git`);
  const ruta = path.join(T, nombre);
  fs.mkdirSync(ruta);
  execFileSync("git", ["init", "--bare", "-b", "main", remoto], { stdio: "ignore" });
  g(ruta, "init", "-b", "main");
  for (const [archivo, contenido] of Object.entries(archivos)) {
    fs.mkdirSync(path.dirname(path.join(ruta, archivo)), { recursive: true });
    fs.writeFileSync(path.join(ruta, archivo), contenido);
  }
  g(ruta, "add", "-A");
  g(ruta, "commit", "-m", "base");
  g(ruta, "remote", "add", "origin", remoto);
  g(ruta, "push", "-q", "-u", "origin", "main");
  return ruta;
}

const ARCHIVO_DE_GESTION = "src/modules/marketplace/presentation/marketplace-accounts.tsx";
const REPO_CRM = repoDePrueba("aizencrm", {
  "package.json": '{ "name": "aizencrm-de-prueba", "private": true }\n',
  "src/app/cliente/chats/page.tsx": "export default function Pagina() { return null; }\n",
});
const REPO_GESTION = repoDePrueba("gestion", {
  "package.json": '{ "name": "gestion-de-prueba", "private": true }\n',
  [ARCHIVO_DE_GESTION]: "export function MarketplaceAccounts() { return null; }\n",
});

const LOG_CLAUDE = path.join(T, "claude.log");
process.env.CLAUDE_FALSO_LOG = LOG_CLAUDE;
const vecesQueAbrieronClaude = () => (fs.existsSync(LOG_CLAUDE) ? fs.readFileSync(LOG_CLAUDE, "utf8").split("\n").filter(Boolean).length : 0);

const baseDelRepo = { subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [[process.execPath, "-e", "console.log('verificar ok')"]], pruebas: [[process.execPath, "-e", "console.log('pruebas ok')"]] };
const configDe = (carpeta) =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: carpeta,
    nube: { activa: false },
    limites: { esperaMaximaMinutos: 0 },
    git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
    comandoClaude: [process.execPath, path.join(AQUI, "claude-falso.mjs")],
    repos: { aizencrm: { ...baseDelRepo, ruta: REPO_CRM }, gestion: { ...baseDelRepo, ruta: REPO_GESTION } },
  });
const registroFalso = () => ({ info: () => {}, aviso: () => {}, error: () => {}, carpeta: null, guardarIntento: () => null });

/** El CRM falso: guarda cada llamada; /cambiar-repo contesta `respuestaDeCambiarRepo` (por defecto, ok y APROBADO). */
function crmFalso(respuestaDeCambiarRepo = { ok: true, estado: "APROBADO" }) {
  const llamadas = [];
  const anota = (que, respuesta = { ok: true }) => async (...args) => (llamadas.push([que, ...args]), respuesta);
  const crm = {
    latido: async () => ({ ok: true }),
    depender: anota("depender", { ok: true, soltada: false }),
    cambiarRepo: anota("cambiar-repo", respuestaDeCambiarRepo),
    plan: anota("plan", { ok: true, estado: "PLAN_LISTO" }),
    reparar: anota("reparar", { ok: true, estado: "APROBADO", reparaciones: 1 }),
    resultado: anota("resultado", { ok: true, estado: "POR_REVISAR" }),
    error: anota("error"),
    soltar: anota("soltar"),
    partir: anota("partir"),
    causaExterna: anota("causaExterna"),
    yaHecha: anota("ya-hecha", { ok: true, estado: "HECHO" }),
    limpieza: anota("limpieza"),
    aviso: anota("aviso"),
  };
  return { crm, llamadas, que: () => llamadas.map(([que]) => que) };
}

const planCon = (...lineas) =>
  ["## 1. Qué se cambia", "La lista de cuentas.", "", "## 5. Archivos que se tocan", ...lineas.map((linea) => `- ${linea}`), "", "## 6. Cómo se va a probar", "Con las pruebas del repo."].join("\n");
const tarjetaCon = (id, plan, extra = {}) => ({ id, titulo: "Lista de cuentas del marketplace", repo: "aizencrm", estado: "EN_CURSO", plan, topeReparaciones: 3, reparaciones: 0, intentos: 1, ultimosIntentos: [], ...extra });

try {
  await prueba("archivosExistentesDelPlan quita los que el plan crea: (nuevo), crear, se crea", async () => {
    const plan = planCon("src/app/a.ts", "src/app/b.ts (nuevo)", "Crear src/app/c.ts", "src/app/d.ts: se crea con la lista", "src/app/e.ts (nueva)");
    assert.deepEqual(archivosExistentesDelPlan(plan), ["src/app/a.ts"]);
    assert.deepEqual(archivosExistentesDelPlan(planCon("src/app/solo-nuevo.ts (nuevo)")), []);
  });

  await prueba("las claves nuevas: repo_equivocado, cambio_de_repo, la clase repo y la categoría", async () => {
    assert.ok(QUE_FALLO.repo_equivocado);
    assert.ok(COMO_SE_RESOLVIO.cambio_de_repo);
    assert.equal(reglaPara("el plan nombra archivos de otro repo", "repo"), "Si el plan nombra archivos de otro repo, se cambia la tarjeta de repo y se vuelve a planear; nunca se construye en el repo equivocado.");
    assert.ok(CATEGORIAS.includes("repo_equivocado"));
  });

  await prueba("caso a: el plan nombra un archivo que solo está en gestion -> cambiar-repo a gestion, sin construir ni reparar", async () => {
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-a-"));
    const config = configDe(carpeta);
    const tarjeta = tarjetaCon("cmyjn7ul5ga111111111111", planCon(ARCHIVO_DE_GESTION));
    const revision = await revisarArchivosDelRepo({ tarjeta, plan: tarjeta.plan, config });
    assert.deepEqual(revision, { faltan: [ARCHIVO_DE_GESTION], repoCorrecto: "gestion", accion: "cambiar_repo" });

    const { crm, llamadas, que } = crmFalso();
    const antes = vecesQueAbrieronClaude();
    const salida = await procesar({ crm, config, registro: registroFalso() }, tarjeta, "construir");
    assert.equal(salida.ok, true, JSON.stringify(salida));
    assert.equal(salida.estado, "APROBADO");
    assert.equal(salida.accion, "cambiar_repo");
    assert.deepEqual(que().filter((cual) => cual !== "depender"), ["cambiar-repo"], "ni reparar, ni resultado, ni ERROR");
    const [, id, datos] = llamadas.find(([cual]) => cual === "cambiar-repo");
    assert.equal(id, tarjeta.id);
    assert.equal(datos.repo, "gestion");
    assert.equal(datos.origen, "antes_de_construir");
    assert.match(datos.causa, /marketplace-accounts\.tsx/);
    assert.equal(vecesQueAbrieronClaude(), antes, "no se abrió ninguna sesión de construir");
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.ok(texto.includes(`- Qué falló: ${QUE_FALLO.repo_equivocado}`), texto);
    assert.ok(texto.includes(`- Cómo se resolvió: ${COMO_SE_RESOLVIO.cambio_de_repo}`), texto);
    assert.match(texto, /^- Regla: Si el plan nombra archivos de otro repo/m);
  });

  await prueba("caso a, sin repo: no está en ningún repo -> se vuelve a planear sin repo; con 404 o 409 sigue como hoy", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "trabajo-b-")));
    const tarjeta = tarjetaCon("cmyjn7ul5gb222222222222", planCon("src/lib/no-existe-en-ninguno.ts"));
    assert.equal((await revisarArchivosDelRepo({ tarjeta, plan: tarjeta.plan, config })).accion, "replanear");
    const { crm, llamadas } = crmFalso();
    const salida = await procesar({ crm, config, registro: registroFalso() }, tarjeta, "construir");
    assert.equal(salida.accion, "replanear");
    const [, , datos] = llamadas.find(([cual]) => cual === "cambiar-repo");
    assert.equal("repo" in datos, false, "sin repo: solo se vuelve a planear");

    // El CRM viejo (404) o el tope (409): se avisa y se construye como siempre.
    const viejo = crmFalso({ ok: false, status: 404, error: "no existe" });
    const antes = vecesQueAbrieronClaude();
    await procesar({ crm: viejo.crm, config, registro: registroFalso() }, { ...tarjeta, id: "cmyjn7ul5gb333333333333" }, "construir");
    assert.ok(viejo.que().includes("cambiar-repo"));
    assert.ok(vecesQueAbrieronClaude() > antes, "con 404 se construye como hoy");
  });

  await prueba("caso c: los archivos existen, o el plan solo crea archivos (nuevo) -> construye normal", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "trabajo-c-")));
    for (const [id, plan] of [
      ["cmyjn7ul5gc444444444444", planCon("src/app/cliente/chats/page.tsx", "src/app/cliente/chats/lista.tsx (nuevo)")],
      ["cmyjn7ul5gc555555555555", planCon("src/app/cliente/chats/otra.tsx (nuevo)")],
    ]) {
      const tarjeta = tarjetaCon(id, plan);
      assert.equal((await revisarArchivosDelRepo({ tarjeta, plan, config })).accion, "ninguna");
      const { crm, que } = crmFalso();
      const antes = vecesQueAbrieronClaude();
      const salida = await procesar({ crm, config, registro: registroFalso() }, tarjeta, "construir");
      assert.ok(!que().includes("cambiar-repo"), JSON.stringify(que()));
      assert.ok(vecesQueAbrieronClaude() > antes, "se abrió la sesión de construir");
      // Construyó entero: mandó el resultado, o (con subirSolo: false en esta configuración) quedó lista con build y pruebas en OK.
      assert.ok(que().includes("resultado") || /build y pruebas en OK/.test(salida.motivo ?? ""), `construyó: ${JSON.stringify(salida)} ${JSON.stringify(que())}`);
    }
  });

  await prueba("caso d: «no cambió ningún archivo» con archivos del otro repo -> cambiar-repo, sin reparar", async () => {
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-d-"));
    const config = configDe(carpeta);
    const tarjeta = tarjetaCon("cmyjn7ul5gd666666666666", planCon(ARCHIVO_DE_GESTION));
    const { crm, llamadas, que } = crmFalso();
    const registro = registroFalso();
    const error = new ErrorDeEtapa("Claude no cambió ningún archivo.", { categoria: "no_cambio_nada" });
    const salida = await manejarFalla({ crm, config, registro, contexto: { config, registro }, bitacora: [] }, tarjeta, "construir", error);
    assert.equal(salida.accion, "cambiar_repo", JSON.stringify(salida));
    assert.deepEqual(que(), ["cambiar-repo"], "ni reparar (plan_nuevo u opus) ni ERROR");
    const [, , datos] = llamadas[0];
    assert.equal(datos.repo, "gestion");
    assert.equal(datos.origen, "no_cambio_nada");
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.ok(texto.includes(`- Qué falló: ${QUE_FALLO.repo_equivocado}`), texto);
    assert.ok(!texto.includes(`- Qué falló: ${QUE_FALLO.no_cambio_nada}`), "se anota una sola vez, como repo equivocado");

    // Tras TOPE (2) intentos "repo_equivocado", sigue la reparación de siempre (sin dar vueltas entre repos).
    const otra = tarjetaCon("cmyjn7ul5gd777777777777", planCon(ARCHIVO_DE_GESTION), { ultimosIntentos: [{ categoria: "repo_equivocado" }, { categoria: "repo_equivocado" }] });
    const conTope = crmFalso();
    await manejarFalla({ crm: conTope.crm, config, registro, contexto: { config, registro }, bitacora: [] }, otra, "construir", error);
    assert.deepEqual(conTope.que(), ["reparar"]);
  });

  // Parte 3 (27-nov-2026): el aviso del plan sobre el otro repo cambia la tarjeta de verdad.
  /** El CRM falso que además guarda el repo de cada tarjeta, como el de verdad (cambiar-repo lo cambia). */
  function crmConRepos() {
    const base = crmFalso();
    const repos = new Map();
    const cambiar = base.crm.cambiarRepo;
    base.crm.cambiarRepo = async (id, datos) => {
      if (datos?.repo) repos.set(id, datos.repo);
      return cambiar(id, datos);
    };
    return { ...base, repoDe: (id) => repos.get(id) ?? "aizencrm" };
  }
  const tarjetaParaPlanear = (id, marca) => ({ ...tarjetaCon(id, null), titulo: `Lista de cuentas ${marca}`, detalle: "Mostrar la lista de cuentas.", estado: "PLANEANDO" });

  await prueba("repoDelNecesito, repoDeLaRecomendada y otroRepoDelPlan reconocen el cambio de repo (sin mayúsculas ni tildes)", async () => {
    assert.equal(repoDelNecesito("RIESGO: BAJO\nNECESITO: decisión pasar la tarjeta a Gestion"), "gestion");
    assert.equal(repoDelNecesito("NECESITO: decision mover la tarjeta al repo AIZENCRM"), "aizencrm");
    assert.equal(repoDelNecesito("NECESITO: clave de la API de pagos"), null);
    assert.equal(repoDeLaRecomendada("¿Aquí o allá? Recomendada: pasar a Gestión"), "gestion");
    assert.equal(repoDeLaRecomendada("¿pasar a Gestion o dejarla aquí?"), null, "la primera opción escrita no cambia el repo");
    assert.equal(repoDeLaRecomendada("¿Botón azul o rojo? Recomendada: azul"), null);
    assert.deepEqual(otroRepoDelPlan("OTRO_REPO: gestion — la pantalla está allá", "aizencrm"), { repo: "gestion", motivo: "la pantalla está allá" });
    assert.equal(otroRepoDelPlan("La tabla solo existe en el repo Gestión.", "aizencrm").repo, "gestion");
    assert.equal(otroRepoDelPlan("OTRO_REPO: aizencrm — es de aquí", "aizencrm"), null, "el mismo repo no cuenta");
    assert.equal(otroRepoDelPlan("PREGUNTAS ABIERTAS: ninguna", "aizencrm"), null);
  });

  await prueba("caso b: el plan dice «NECESITO: decisión pasar la tarjeta a Gestion» -> cambiar-repo a gestion, sin plan ni aviso «necesita»", async () => {
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-pb-"));
    const config = configDe(carpeta);
    const tarjeta = tarjetaParaPlanear("cmyjn7ul5gb888888888888", "[otro-repo-necesito]");
    const { crm, llamadas, que, repoDe } = crmConRepos();
    const salida = await procesar({ crm, config, registro: registroFalso() }, tarjeta, "planear");
    assert.equal(salida.ok, true, JSON.stringify(salida));
    assert.equal(salida.accion, "cambiar_repo");
    assert.ok(que().includes("cambiar-repo"), JSON.stringify(que()));
    assert.ok(!que().includes("plan"), "no se manda el plan");
    assert.ok(!que().includes("aviso"), "no se manda el aviso «necesita» (ni ningún WhatsApp)");
    const [, id, datos] = llamadas.find(([cual]) => cual === "cambiar-repo");
    assert.equal(id, tarjeta.id);
    assert.equal(datos.repo, "gestion");
    assert.equal(datos.origen, "plan");
    assert.match(datos.causa, /pasar la tarjeta a Gestion/);
    assert.equal(repoDe(tarjeta.id), "gestion", "la tarjeta quedó en gestion en el CRM falso");
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.ok(texto.includes(`- Qué falló: ${QUE_FALLO.repo_equivocado}`), texto);
    assert.ok(texto.includes(`- Cómo se resolvió: ${COMO_SE_RESOLVIO.cambio_de_repo}`), texto);

    // Con 404 (CRM viejo) sigue el camino de hoy: se manda el plan y el aviso «necesita».
    const viejo = crmFalso({ ok: false, status: 404, error: "no existe" });
    await procesar({ crm: viejo.crm, config, registro: registroFalso() }, { ...tarjeta, id: "cmyjn7ul5gb999999999999" }, "planear");
    assert.ok(viejo.que().includes("cambiar-repo"));
    assert.ok(viejo.que().includes("plan"), JSON.stringify(viejo.que()));
    assert.ok(viejo.que().includes("aviso"), JSON.stringify(viejo.que()));
  });

  await prueba("caso e: el plan trae la pregunta abierta «Recomendada: pasar a Gestion» -> cambiar-repo a gestion", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "trabajo-pe-")));
    const tarjeta = tarjetaParaPlanear("cmyjn7ul5ge111111111111", "[otro-repo-recomendada]");
    const { crm, llamadas, que, repoDe } = crmConRepos();
    const salida = await procesar({ crm, config, registro: registroFalso() }, tarjeta, "planear");
    assert.equal(salida.accion, "cambiar_repo", JSON.stringify(salida));
    assert.ok(!que().includes("plan") && !que().includes("aviso"), JSON.stringify(que()));
    assert.equal(llamadas.find(([cual]) => cual === "cambiar-repo")[2].repo, "gestion");
    assert.equal(repoDe(tarjeta.id), "gestion");

    // La línea OTRO_REPO hace lo mismo.
    const conLinea = crmConRepos();
    await procesar({ crm: conLinea.crm, config, registro: registroFalso() }, tarjetaParaPlanear("cmyjn7ul5ge222222222222", "[otro-repo-linea]"), "planear");
    assert.equal(conLinea.repoDe("cmyjn7ul5ge222222222222"), "gestion");
    assert.ok(!conLinea.que().includes("plan"), JSON.stringify(conLinea.que()));

    // Al construir, un plan ya aprobado cuya recomendada es pasar a Gestion: cambiar-repo en vez de construir.
    const plan = [planCon("src/app/cliente/chats/page.tsx"), "", "PREGUNTAS ABIERTAS:", "- ¿Se hace aquí o en Gestión? Recomendada: pasar a Gestion"].join("\n");
    const alConstruir = crmConRepos();
    const antes = vecesQueAbrieronClaude();
    const deConstruir = await procesar({ crm: alConstruir.crm, config, registro: registroFalso() }, tarjetaCon("cmyjn7ul5ge333333333333", plan), "construir");
    assert.equal(deConstruir.accion, "cambiar_repo", JSON.stringify(deConstruir));
    assert.deepEqual(alConstruir.que().filter((cual) => cual !== "depender"), ["cambiar-repo"]);
    assert.equal(alConstruir.repoDe("cmyjn7ul5ge333333333333"), "gestion");
    assert.equal(vecesQueAbrieronClaude(), antes, "no se abrió la sesión de construir");
  });

  await prueba("promptDeConstruir trae el bloque «Decisiones ya tomadas» sin las de cambio de repo", async () => {
    const plan = ["## 1. Qué se cambia", "El botón.", "", "PREGUNTAS ABIERTAS:", "- ¿Botón azul o rojo? Recomendada: azul", "- ¿Aquí o en Gestión? Recomendada: pasar a Gestion"].join("\n");
    const resueltas = seguirConLaRecomendada(plan, "El botón");
    assert.equal(resueltas.decisiones.length, 2);
    // Con la nota que planear deja arriba del plan, las preguntas no se cuentan dos veces.
    const conNota = `${resueltas.nota}\n\n${plan}`;
    const prompt = promptDeConstruir({ ...tarjetaCon("cmyjn7ul5gf111111111111", conNota), detalle: "El botón" }, { clave: "aizencrm" }, "tablero/x");
    assert.match(prompt, /Decisiones ya tomadas \(aplícalas, no las vuelvas a preguntar\):\n- ¿Botón azul o rojo\? -> azul/);
    const bloque = prompt.split("Decisiones ya tomadas")[1].split("\n\n")[0];
    assert.ok(!/Gestion/.test(bloque), bloque);
    assert.equal((bloque.match(/^- /gm) ?? []).length, 1, bloque);
    assert.ok(!promptDeConstruir(tarjetaCon("cmyjn7ul5gf222222222222", planCon("a.ts")), { clave: "aizencrm" }, "tablero/y").includes("Decisiones ya tomadas"));
  });

  console.log(`\n${pruebas} pruebas del repo equivocado: todo OK`);
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

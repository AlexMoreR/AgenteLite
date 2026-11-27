// Pruebas de «repo correcto antes de planear» (27-nov-2026, caso T-940): el Coordinador busca los archivos que nombra la tarjeta en
// cada repo y, si están solo en el otro, le cambia el repo y planea allá.
//   node trabajador-tablero/pruebas/probar-repo-correcto.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Dos repos git temporales (cada uno con su "origin"), un CRM falso y el claude falso de siempre. Sin red de verdad.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { COMO_SE_RESOLVIO, INCIDENTES_CONOCIDOS, QUE_FALLO, reglaPara } from "../lib/bitacora.mjs";
import { completarConfig } from "../lib/config.mjs";
import { planear } from "../lib/etapas.mjs";
import { repoCorrecto, rutasDeLaTarjeta } from "../lib/repo-correcto.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "repo-correcto-"));
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

const SOLO_EN_GESTION = "src/modules/marketplace/presentation/marketplace-accounts.tsx";
const EN_LOS_DOS = "src/lib/compartido.ts";
const REPO_CRM = repoDePrueba("aizencrm", {
  "package.json": "{}\n",
  "src/app/cliente/chats/page.tsx": "export default function Pagina() { return null; }\n",
  "src/app/api/ruta/route.ts": "export {};\n",
  [EN_LOS_DOS]: "export {};\n",
});
const REPO_GESTION = repoDePrueba("gestion", {
  "package.json": "{}\n",
  [SOLO_EN_GESTION]: "export function MarketplaceAccounts() { return null; }\n",
  "src/solo/etapas-de-gestion.mjs": "export {};\n",
  "src/api/otra/route.ts": "export {};\n",
  [EN_LOS_DOS]: "export {};\n",
});

const baseDelRepo = { subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [[process.execPath, "-e", "0"]], pruebas: [[process.execPath, "-e", "0"]] };
const configDe = (carpeta, repos = { aizencrm: { ...baseDelRepo, ruta: REPO_CRM }, gestion: { ...baseDelRepo, ruta: REPO_GESTION } }) =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: carpeta,
    nube: { activa: false },
    limites: { esperaMaximaMinutos: 0 },
    git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
    comandoClaude: [process.execPath, path.join(AQUI, "claude-falso.mjs")],
    repos,
  });
const registroFalso = () => ({ info: () => {}, aviso: () => {}, error: () => {}, carpeta: null, guardarIntento: () => null });
const tarjetaCon = (detalle, extra = {}) => ({ id: "cmyjn7ul5gr111111111111", titulo: "Lista de cuentas", detalle, repo: "aizencrm", estado: "PLANEANDO", ultimosIntentos: [], ...extra });

/** El CRM falso: guarda las llamadas a /repo; `respuesta` es lo que contesta. */
function crmFalso(respuesta = { ok: true, estado: "PLANEANDO", repo: "gestion" }) {
  const llamadas = [];
  return { llamadas, crm: { cambiarRepoAlPlanear: async (id, datos) => (llamadas.push([id, datos]), respuesta), depender: async () => ({ ok: true, soltada: false }) } };
}

try {
  await prueba("rutasDeLaTarjeta: saca las rutas del título y del detalle, sin comodines, manual ni notas", () => {
    const tarjeta = { titulo: "Arreglar src/lib/a.ts", detalle: "Tocar `src/app/b.tsx`, src/lib/**, docs/que-es-esta-aplicacion.md y docs/cambios-pendientes/x.md; también etapas.mjs y src/lib/a.ts." };
    assert.deepEqual(rutasDeLaTarjeta(tarjeta).sort(), ["etapas.mjs", "src/app/b.tsx", "src/lib/a.ts"]);
    assert.deepEqual(rutasDeLaTarjeta({ titulo: "Sin rutas", detalle: "Mejorar el texto." }), []);
    assert.deepEqual(rutasDeLaTarjeta(null), []);
  });

  await prueba("las claves de la bitácora: la clase repo_equivocado y el caso T-940", () => {
    assert.equal(reglaPara("x", "repo_equivocado"), "Buscar los archivos de la tarjeta en cada repo antes de planear; si están en el otro, cambiar el repo.");
    const t940 = INCIDENTES_CONOCIDOS.find((incidente) => incidente.tarjeta.id === "T-940");
    assert.ok(t940, "T-940 está en INCIDENTES_CONOCIDOS");
    assert.ok(QUE_FALLO[t940.queFallo] && COMO_SE_RESOLVIO[t940.comoSeResolvio]);
  });

  await prueba("solo en el otro repo: cambia (con el motivo)", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "t-")));
    const cambio = await repoCorrecto({ config }, tarjetaCon(`Tocar ${SOLO_EN_GESTION}`));
    assert.equal(cambio.repo, "gestion");
    assert.match(cambio.motivo, /marketplace-accounts\.tsx/);
  });

  await prueba("nombre suelto sin carpeta: se encuentra por el final de la ruta", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "t-")));
    assert.equal((await repoCorrecto({ config }, tarjetaCon("Arreglar etapas-de-gestion.mjs")))?.repo, "gestion");
  });

  await prueba("en los dos repos: no cambia (también un nombre suelto repetido como route.ts)", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "t-")));
    assert.equal(await repoCorrecto({ config }, tarjetaCon(`Tocar ${EN_LOS_DOS}`)), null);
    assert.equal(await repoCorrecto({ config }, tarjetaCon(`Tocar route.ts`)), null);
    // Una ruta en el propio repo y otra solo en el otro: la tarjeta es de este repo.
    assert.equal(await repoCorrecto({ config }, tarjetaCon(`Tocar src/app/cliente/chats/page.tsx y ${SOLO_EN_GESTION}`)), null);
  });

  await prueba("en ninguno de los dos: no cambia (ni sin rutas)", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "t-")));
    assert.equal(await repoCorrecto({ config }, tarjetaCon("Tocar src/lib/no-existe-en-ninguno.ts")), null);
    assert.equal(await repoCorrecto({ config }, tarjetaCon("Mejorar el texto de la pantalla.")), null);
  });

  await prueba("git falla: null y no lanza", async () => {
    const inexistente = path.join(T, "no-existe");
    const rota = configDe(fs.mkdtempSync(path.join(T, "t-")), { aizencrm: { ...baseDelRepo, ruta: inexistente }, gestion: { ...baseDelRepo, ruta: REPO_GESTION } });
    assert.equal(await repoCorrecto({ config: rota }, tarjetaCon(`Tocar ${SOLO_EN_GESTION}`)), null, "falla el repo de la tarjeta");
    const otraRota = configDe(fs.mkdtempSync(path.join(T, "t-")), { aizencrm: { ...baseDelRepo, ruta: REPO_CRM }, gestion: { ...baseDelRepo, ruta: inexistente } });
    assert.equal(await repoCorrecto({ config: otraRota }, tarjetaCon(`Tocar ${SOLO_EN_GESTION}`)), null, "falla el otro repo");
    assert.equal(await repoCorrecto({ config: rota }, { id: "x", repo: "no-configurado", titulo: "a src/a.ts" }), null);
    assert.equal(await repoCorrecto(undefined, undefined), null);
  });

  await prueba("planear(): sigue en el repo nuevo, llama una vez a /repo y deja el incidente", async () => {
    const carpeta = fs.mkdtempSync(path.join(T, "trabajo-a-"));
    const config = configDe(carpeta);
    const { crm, llamadas } = crmFalso();
    const salida = await planear({ config, registro: registroFalso(), crm, motorDe: () => "claude" }, tarjetaCon(`Tocar ${SOLO_EN_GESTION}`));
    assert.equal(salida.repoCambiado, "gestion", JSON.stringify(salida));
    assert.ok(salida.plan, "salió un plan");
    assert.equal(llamadas.length, 1);
    assert.equal(llamadas[0][0], "cmyjn7ul5gr111111111111");
    assert.equal(llamadas[0][1].repo, "gestion");
    assert.match(llamadas[0][1].motivo, /marketplace-accounts\.tsx/);
    const texto = fs.readFileSync(path.join(carpeta, "incidentes", "aizencrm.md"), "utf8");
    assert.ok(texto.includes(`- Qué falló: ${QUE_FALLO.repo_equivocado}`), texto);
    assert.ok(texto.includes(`- Cómo se resolvió: ${COMO_SE_RESOLVIO.cambio_de_repo}`), texto);
    assert.match(texto, /^- Regla: Buscar los archivos de la tarjeta en cada repo antes de planear/m);
  });

  await prueba("planear(): con 404 o 409 del CRM, o el tope de cambios, planea en el repo de antes", async () => {
    const config = configDe(fs.mkdtempSync(path.join(T, "trabajo-b-")));
    for (const status of [404, 409]) {
      const { crm, llamadas } = crmFalso({ ok: false, status, error: "no" });
      const salida = await planear({ config, registro: registroFalso(), crm, motorDe: () => "claude" }, tarjetaCon(`Tocar ${SOLO_EN_GESTION}`));
      assert.equal(salida.repoCambiado, undefined, `status ${status}`);
      assert.ok(salida.plan);
      assert.equal(llamadas.length, 1);
    }
    const tope = crmFalso();
    const intentos = [{ categoria: "repo_equivocado" }, { categoria: "repo_equivocado" }];
    const salida = await planear({ config, registro: registroFalso(), crm: tope.crm, motorDe: () => "claude" }, tarjetaCon(`Tocar ${SOLO_EN_GESTION}`, { ultimosIntentos: intentos }));
    assert.equal(salida.repoCambiado, undefined);
    assert.equal(tope.llamadas.length, 0, "pasado el tope no se revisa nada");
  });

  console.log(`\n${pruebas} pruebas ok`);
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}

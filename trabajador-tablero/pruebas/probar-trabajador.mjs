// Pruebas del TRABAJADOR del Tablero IA, de punta a punta y sin tocar nada real:
//   npm run test:trabajador-tablero
//
// - un CRM FALSO (servidor HTTP local en esta prueba) con la misma máquina de estados que la API real
//   (usa TRANSICIONES_DEL_TRABAJADOR y AL_TOMAR de services/reglas-trabajador.ts);
// - un repo git TEMPORAL de ensayo con su "GitHub" (un repo bare local: los push van ahí);
// - `claude`, `ssh` y `gh` FALSOS (pruebas/*-falso.mjs) en vez de los de verdad.
// Recorre PLANEANDO -> PLAN_LISTO -> EN_CURSO -> POR_REVISAR -> SUBIENDO -> HECHO, la zona protegida
// (queda POR_REVISAR con la zona marcada aunque suba solo) y los casos de ERROR: tiempo máximo,
// verificación (tsc) que falla, lint nuevo, conflicto al subir, Claude que no cambia nada, y el
// vencimiento por latido.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { cargar } from "../../scripts/supervisor-cargar.mjs";
import { crearVigilante, sumarDescendientes } from "../lib/atasco.mjs";
import { crearPlanificador, crearSemaforo, procesar, unaVuelta } from "../lib/bucle.mjs";
import { PRIORIDAD, crearColaPesada } from "../lib/cola.mjs";
import { archivosDelPlan, candidatasQueChocan, huellaDeTarjeta, moduloDe, motivoDeChoque } from "../lib/choques.mjs";
import { completarConfig } from "../lib/config.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { CARPETA_DE_NOTAS, MANUAL, crearManualNocturno, horaEnBogota, leerEstadoDelManual } from "../lib/manual-nocturno.mjs";
import { guionDeEnsayo, sqlParaEnsayo } from "../lib/ensayo.mjs";
import { esRamaDelTrabajador, nombreDeRama, pushDeRama, webDeGithub } from "../lib/git.mjs";
import { decidir, diagnosticar, resumenDeEscalada } from "../lib/diagnostico.mjs";
import { esLimiteDeUso, promptDeConstruir, promptDeNube, promptDelPlan } from "../lib/etapas.mjs";
import { MAX_DESCRIPCION, descripcionParaLaNube, esTareaGrande, estaDentroDe, lanzarEnNube, linkDeSesion, preguntaDeConfianza, resultadoDelCommit, seccionDelPlan, trabajaConMigracion } from "../lib/nube.mjs";
import { detalleDeFalla, lineasQueFallaron } from "../lib/procesos.mjs";
import { destructivoDelSql, migracionDestructiva } from "../lib/riesgo.mjs";
import {
  crearEstadoDeMotores,
  decidirUso,
  esLimiteDeCodex,
  horaDelReinicio,
  leerUsoDeClaude,
  motorDeLaEtapa,
  textoDelAvisoDeLimite,
} from "../lib/motores.mjs";
import { armarLatido, crearLatido } from "../lib/latido.mjs";
import { faltanRecursos, leerCarga } from "../lib/recursos.mjs";
import { crearRegistro } from "../lib/registro.mjs";
import { enviosDeLog, globARegex, minutosDeLaVentana, zonasTocadas } from "../lib/zonas.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");

const sinMedirAqui = { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined };

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ─────────────────────────────────────────────────────────── piezas puras ── */

await prueba("zonas: enviosDeLog cuenta enviados y fallidos por minuto, acepta otro patrón y no confunde errores sin envío", async () => {
  const log = [
    "10:00 INFO sendMessage ok",
    "10:00 INFO sendText ok",
    "10:00 INFO message sent a 573001",
    "10:00 INFO POST /message/send 200",
    "10:00 ERROR sendMessage falló con status 500",
    "10:00 ERROR TypeError: no se pudo leer saludo",
    "10:00 INFO servidor listo",
  ].join("\n");
  assert.deepEqual(enviosDeLog(log, undefined, 1), { enviados: 4, fallidos: 1 });
  assert.deepEqual(enviosDeLog(log, undefined, 2), { enviados: 2, fallidos: 0.5 });
  assert.deepEqual(enviosDeLog(log), { enviados: 4 / 3, fallidos: 1 / 3 });
  assert.deepEqual(enviosDeLog("10:00 INFO enviado por la bandeja\n10:01 ERROR enviado falló", /enviado/i, 1), { enviados: 1, fallidos: 1 });
  assert.deepEqual(enviosDeLog("", undefined, 3), { enviados: 0, fallidos: 0 });
  assert.deepEqual(enviosDeLog(undefined), { enviados: 0, fallidos: 0 });
});

await prueba("zonas: minutosDeLaVentana saca los minutos del --since del comando (3 si no lo dice)", async () => {
  assert.equal(minutosDeLaVentana("docker logs --since 3m crm"), 3);
  assert.equal(minutosDeLaVentana("docker logs --since 10m crm"), 10);
  assert.equal(minutosDeLaVentana("docker logs --since=1h crm"), 60);
  assert.equal(minutosDeLaVentana("docker logs crm"), 3);
  assert.equal(minutosDeLaVentana(undefined), 3);
});

await prueba("zonas: globs simples y qué zonas toca un cambio", async () => {
  assert.ok(globARegex("src/bot/**").test("src/bot/a/b.ts"));
  assert.ok(globARegex("src/**/agente*.ts").test("src/agente-v3.ts"));
  assert.ok(globARegex("src/**/agente*.ts").test("src/lib/x/agente-v3.ts"));
  assert.ok(!globARegex("src/*.ts").test("src/lib/a.ts"));
  assert.deepEqual(zonasTocadas(["src/bot/x.ts", "README.md", "src\\v3\\libro.ts"], { BOT_VENTAS: ["src/bot/**"], LIBRO_V3: ["src/v3/**"], META_ADS: ["ads/**"] }), {
    BOT_VENTAS: ["src/bot/x.ts"],
    LIBRO_V3: ["src\\v3\\libro.ts"],
  });
});

await prueba("ensayo: se quitan BEGIN/COMMIT del archivo, va dentro de BEGIN…ROLLBACK con ON_ERROR_STOP y lock_timeout", async () => {
  const guion = guionDeEnsayo('BEGIN;\nDO $$ BEGIN\n  CREATE TYPE "X" AS ENUM (\'A\');\nEXCEPTION WHEN duplicate_object THEN NULL;\nEND $$;\nCOMMIT;\n');
  assert.match(guion, /^\\set ON_ERROR_STOP on\nSET lock_timeout = '5s';\nBEGIN;\n/);
  assert.match(guion, /ROLLBACK;\n$/);
  assert.ok(!/^COMMIT;$/m.test(guion));
  assert.equal((guion.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.throws(() => sqlParaEnsayo("BEGIN;\nSELECT 1; COMMIT; SELECT 2;\nCOMMIT;"), /COMMIT/);
  assert.throws(() => sqlParaEnsayo("CREATE INDEX CONCURRENTLY x ON y (z);"), /CONCURRENTLY/);
});

await prueba("latido: la carga del PC (GB) se lee sin lanzar y el cuerpo lleva tareas, carga, uso y esperas", async () => {
  const carga = leerCarga(os.tmpdir());
  assert.ok(carga.memoriaTotalGb > 0 && carga.memoriaUsadaGb >= 0 && carga.memoriaUsadaGb <= carga.memoriaTotalGb);
  assert.ok(carga.discoLibreGb === null || carga.discoLibreGb >= 0);
  const sinDisco = leerCarga("/no/existe", { statfs: () => { throw new Error("sin disco"); } });
  assert.equal(sinDisco.discoLibreGb, null);
  assert.equal(sinDisco.discoTotalGb, null);
  const estado = { tareas: [{ tarjetaId: "t1", titulo: "Algo", etapa: "probando", lugar: "aizen1" }], esperandoPc: true, motivoEspera: "CPU 92 % (límite 85 %)", esperas: [{ tarjetaId: "t2", motivo: "misma zona" }], uso: { limiteAlcanzado: false, motor: null, reiniciaEn: null } };
  const cuerpo = armarLatido({ estado, medidor: { medir: () => ({ cpu: 40, memoria: 55 }) }, carga: { memoriaUsadaGb: 22, memoriaTotalGb: 40, discoLibreGb: 120.5, discoTotalGb: 500 } });
  assert.equal(cuerpo.nombre, "aizen1");
  assert.equal(cuerpo.tareas[0].etapa, "probando");
  assert.deepEqual(cuerpo.carga, { cpu: 40, memoriaPorciento: 55, memoriaUsadaGb: 22, memoriaTotalGb: 40, discoLibreGb: 120.5, discoTotalGb: 500, esperandoPc: true, motivoEspera: "CPU 92 % (límite 85 %)" });
  assert.equal(cuerpo.esperas[0].tarjetaId, "t2");
  // Un medidor que falla no tumba el latido: la carga va en null.
  const sinMedidor = armarLatido({ estado, medidor: { medir: () => { throw new Error("x"); } }, carga: null });
  assert.equal(sinMedidor.carga.cpu, null);
  assert.equal(sinMedidor.carga.discoLibreGb, null);
});

await prueba("latido: se manda al CRM; si el CRM falla, no lanza, avisa una sola vez y nunca hay dos en vuelo", async () => {
  const enviados = [];
  const avisos = [];
  let falla = false;
  let suelta = null;
  const crmFalso = {
    latidoDelCoordinador: async (cuerpo) => {
      if (falla) throw new Error("No se pudo hablar con el CRM (caído).");
      if (suelta) await suelta;
      enviados.push(cuerpo);
      return { ok: true };
    },
  };
  const planificadorFalso = { estado: () => ({ tareas: [], esperandoPc: false, motivoEspera: null, esperas: [], uso: { limiteAlcanzado: false, motor: null, reiniciaEn: null } }) };
  const registroFalso = { info: () => undefined, aviso: (mensaje) => avisos.push(mensaje), error: () => undefined };
  const latido = crearLatido({ crm: crmFalso, config: { carpetaTrabajo: os.tmpdir() }, registro: registroFalso, planificador: planificadorFalso, medidor: sinMedirAqui, cadaSegundos: 3600 });
  await latido.latirYa();
  assert.ok(enviados.length >= 1, "el latido salió");
  falla = true;
  assert.equal(await latido.latirYa(), false);
  assert.equal(await latido.latirYa(), false);
  assert.equal(avisos.length, 1, "el mismo fallo se avisa una vez");
  assert.match(avisos[0], /sigue trabajando/);
  falla = false;
  let soltar;
  suelta = new Promise((resolver) => { soltar = resolver; });
  const primero = latido.latirYa();
  assert.equal(await latido.latirYa(), false, "con uno en vuelo se salta el turno");
  soltar();
  assert.equal(await primero, true);
  latido.parar();
});

await prueba("latido: el uso de los motores dice cuándo se reinicia la pausa por límite de uso", async () => {
  let ahora = Date.parse("2026-10-24T15:00:00Z");
  const config = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } });
  const motores = crearEstadoDeMotores(config, { ahora: () => ahora });
  assert.deepEqual(motores.resumenDeUso(), { limiteAlcanzado: false, motor: null, reiniciaEn: null });
  const hasta = motores.pausar("claude");
  const uso = motores.resumenDeUso();
  assert.equal(uso.limiteAlcanzado, true);
  assert.equal(uso.motor, "claude");
  assert.equal(uso.reiniciaEn, new Date(hasta).toISOString());
  ahora = hasta + 1;
  assert.equal(motores.resumenDeUso().limiteAlcanzado, false);
});

await prueba("riesgo: el prompt del plan pide la línea RIESGO con sus criterios y dice el riesgo que ya trae la tarjeta", async () => {
  const repo = { clave: "aizencrm", subirSolo: true, zonasProtegidas: { CHATS: ["src/chats/**"] } };
  const prompt = promptDelPlan({ titulo: "Algo", tablero: "T", detalle: "d", intentos: 1 }, repo);
  assert.match(prompt, /RIESGO: BAJO — <motivo en una frase>/);
  assert.match(prompt, /RIESGO: ALTO — <motivo en una frase>/);
  assert.match(prompt, /PRIMERAS líneas/);
  // Regla del dueño 24-oct: pide también la línea APROBAR PLAN.
  assert.match(prompt, /^APROBAR PLAN: SOLO$/m);
  assert.match(prompt, /^APROBAR PLAN: ESPERA TU SÍ — <motivo en una línea>$/m);
  assert.match(prompt, /subir presupuesto, activar campañas o crear gasto en Meta Ads/);
  for (const criterio of ["CHATS, BOT_VENTAS, LIBRO_V3, META_ADS", "DROP, ALTER destructivo, RENAME, DELETE, UPDATE ni TRUNCATE", "abonos, saldos, nómina, comisiones, facturación, pagos", "permisos, usuarios, contraseñas o credenciales", "trabajador-tablero/", "tienes duda, es ALTO"]) {
    assert.ok(prompt.includes(criterio), criterio);
  }
  assert.match(prompt, /NO escribas las palabras DROP, DELETE, UPDATE, RENAME ni TRUNCATE/);
  assert.match(prompt, /Al terminar: sube solo a producción/, "sigue la frase Al terminar");
  assert.match(prompt, /^Eres el Coordinador[\s\S]*Contesta SOLO con el plan\.$/);
  assert.ok(!prompt.includes("Riesgo que ya tiene la tarjeta"), "sin riesgo en la tarjeta, no lo menciona");
  const conRiesgo = promptDelPlan({ titulo: "Algo", tablero: "T", detalle: "d", intentos: 1, riesgo: "ALTO", riesgoMotivo: "habla de pagos" }, repo, "codex");
  assert.match(conRiesgo, /Riesgo que ya tiene la tarjeta en el CRM: ALTO \(habla de pagos\)/);
});

await prueba("riesgo: destructivoDelSql ignora comentarios y textos entre comillas y detecta cada palabra sin repetir", async () => {
  assert.deepEqual(destructivoDelSql(null), []);
  assert.deepEqual(destructivoDelSql('BEGIN;\nCREATE TABLE IF NOT EXISTS "A" ("id" TEXT);\nALTER TABLE "B" ADD COLUMN IF NOT EXISTS "x" TEXT;\nCREATE INDEX IF NOT EXISTS "i" ON "A" ("id");\nCOMMIT;'), []);
  assert.deepEqual(destructivoDelSql("-- DROP TABLE x;\n/* DELETE FROM y;\n UPDATE z */\nSELECT 'DROP y, UPDATE z';"), [], "comentarios y textos");
  assert.deepEqual(destructivoDelSql("INSERT INTO a VALUES ('it''s a DELETE');"), [], "comilla doble escapada dentro del texto");
  assert.deepEqual(destructivoDelSql('DROP TABLE "A";'), ["DROP"]);
  assert.deepEqual(destructivoDelSql('TRUNCATE "A";'), ["TRUNCATE"]);
  assert.deepEqual(destructivoDelSql('DELETE FROM "A";'), ["DELETE"]);
  assert.deepEqual(destructivoDelSql('update "A" set x = 1;'), ["UPDATE"]);
  assert.deepEqual(destructivoDelSql('ALTER TABLE "A" RENAME TO "B";'), ["RENAME"]);
  assert.ok(destructivoDelSql('ALTER TABLE "A" ALTER COLUMN "x" SET NOT NULL;').includes("ALTER destructivo"));
  assert.deepEqual(destructivoDelSql("ALTER TYPE \"E\" ADD VALUE 'X';"), [], "agregar un valor a un enum es aditivo");
  assert.deepEqual(
    destructivoDelSql('CREATE TABLE "A" ("id" TEXT, "tipo" TEXT);\nALTER TABLE "A" ADD COLUMN "type" TEXT;\nALTER TABLE "A" ADD CONSTRAINT "f" FOREIGN KEY ("id") REFERENCES "B"("id") ON DELETE CASCADE ON UPDATE CASCADE;'),
    [],
    "las llaves foráneas de Prisma (ON DELETE/UPDATE) y una columna llamada type no cuentan",
  );
  assert.deepEqual(destructivoDelSql('DROP TABLE a; DROP TABLE b; DELETE FROM c;'), ["DROP", "DELETE"], "sin repetir");
});

await prueba("riesgo: migracionDestructiva lee cada migración nueva ([] si es aditiva, si no hay migración o si no se puede leer)", async () => {
  const archivos = {
    "prisma/migrations/1_a/migration.sql": 'CREATE TABLE IF NOT EXISTS "A" ("id" TEXT);',
    "prisma/migrations/2_b/migration.sql": 'DROP TABLE "A";',
    "prisma/migrations/3_c/migration.sql": 'UPDATE "A" SET x = 1; DROP INDEX i;',
  };
  const leer = (ruta) => archivos[ruta];
  assert.deepEqual(migracionDestructiva([], leer), []);
  assert.deepEqual(migracionDestructiva(undefined, leer), []);
  assert.deepEqual(migracionDestructiva(["prisma/migrations/1_a/migration.sql"], leer), []);
  assert.deepEqual(migracionDestructiva(["prisma/migrations/1_a/migration.sql", "prisma/migrations/3_c/migration.sql", "prisma/migrations/2_b/migration.sql"], leer).sort(), ["DROP", "UPDATE"]);
  assert.deepEqual(migracionDestructiva(["no/existe/migration.sql"], () => { throw new Error("ENOENT"); }), []);
});

await prueba("ramas y links: tablero/<id>-<slug>, solo esas se empujan, link de GitHub", async () => {
  assert.equal(nombreDeRama({ id: "cm9abc12345678", titulo: "Envío gratis 50/50 ¡ya!" }), "tablero/12345678-envio-gratis-50-50-ya");
  assert.ok(esRamaDelTrabajador("tablero/123-x"));
  assert.ok(!esRamaDelTrabajador("main"));
  assert.ok(!esRamaDelTrabajador("tablero/../main"));
  assert.equal(webDeGithub("https://github.com/AlexMoreR/AgenteLite.git"), "https://github.com/AlexMoreR/AgenteLite");
  assert.equal(webDeGithub("git@github.com:AlexMoreR/Gestion.git"), "https://github.com/AlexMoreR/Gestion");
  assert.equal(webDeGithub("C:/tmp/remoto.git"), null);
});

await prueba("configuración: exige https, la clave y un repo; agrega las herramientas prohibidas siempre", async () => {
  assert.throws(() => completarConfig({ urlCrm: "http://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } } }), /https/);
  assert.throws(() => completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "otra", repos: { a: { ruta: "." } } }), /claveTrabajador/);
  assert.throws(() => completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x" }), /repos/);
  const config = completarConfig({
    urlCrm: "https://app.aizenbot.com/",
    claveTrabajador: "aizen_trab_x",
    repos: { aizencrm: { ruta: "." } },
    herramientasProhibidas: ["Bash(rm:*)"],
  });
  assert.equal(config.urlCrm, "https://app.aizenbot.com");
  assert.ok(config.herramientasProhibidas.includes("Bash(git push:*)"));
  assert.ok(config.herramientasProhibidas.includes("Bash(rm:*)"));
  assert.ok(!config.herramientasPermitidas.some((h) => /push|migrate|db push/.test(h)));
});

await prueba("configuración: maxParalelo 2 si no viene (de 1 a 5), límites de CPU y memoria, subagentes permitidos", async () => {
  const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } };
  const config = completarConfig(base);
  assert.equal(config.maxParalelo, 2);
  assert.deepEqual(config.limites, { cpuPorciento: 85, memoriaPorciento: 85, esperaMaximaMinutos: 10, cpuPromedioMinutos: 3 });
  assert.equal(config.tiempos.pausaLimiteMinutos, 30);
  // Construir NO lanza subagentes ni tareas en segundo plano (24-oct-2026): están prohibidos, no permitidos.
  assert.ok(!config.herramientasPermitidas.includes("Agent") && !config.herramientasPermitidas.includes("Task"));
  assert.ok(config.herramientasProhibidas.includes("Agent") && config.herramientasProhibidas.includes("Task"));
  assert.deepEqual(config.atasco, { minutos: 15, revisarCadaSegundos: 60, cpuMinimaSegundos: 0.3 });
  assert.equal(completarConfig({ ...base, atasco: { minutos: 0 } }).atasco.minutos, 0, "0 apaga el vigilante");
  assert.throws(() => completarConfig({ ...base, atasco: { minutos: -1 } }), /atasco\.minutos/);
  assert.equal(completarConfig({ ...base, maxParalelo: 3, limites: { cpuPorciento: 70 } }).maxParalelo, 3);
  assert.equal(completarConfig({ ...base, limites: { cpuPorciento: 70 } }).limites.cpuPorciento, 70);
  assert.throws(() => completarConfig({ ...base, maxParalelo: 9 }), /maxParalelo/);
  assert.throws(() => completarConfig({ ...base, maxParalelo: 0 }), /maxParalelo/);
  assert.throws(() => completarConfig({ ...base, limites: { memoriaPorciento: 500 } }), /memoriaPorciento/);
});

await prueba("nube: la configuración de ejemplo trae aizen1 con 2, la nube prendida (tope 8, 180 min) y los tres repos con su nombre en GitHub", async () => {
  const ejemplo = JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8"));
  const config = completarConfig(ejemplo);
  assert.equal(config.maxParalelo, 2, "aizen1: como máximo 2 a la vez");
  assert.equal(config.nube.activa, true);
  assert.equal(config.nube.maxTareas, 8);
  assert.equal(config.nube.maxArchivosChica, 8);
  assert.equal(config.nube.terminal, "auto");
  assert.equal(config.tiempos.construirNubeMinutos, 178);
  assert.deepEqual(Object.keys(config.repos).sort(), ["aizencrm", "gestion", "messenger-basic"]);
  assert.equal(config.repos.aizencrm.github, "AlexMoreR/AgenteLite");
  assert.equal(config.repos.gestion.github, "AlexMoreR/Gestion");
  assert.equal(config.repos["messenger-basic"].github, "AlexMoreR/messenger-basic");
  // El entorno de la nube lleva SOLO direcciones falsas: ninguna clave.
  assert.deepEqual(Object.keys(config.nube.entorno).sort(), ["DATABASE_URL", "DIRECT_URL"]);
  for (const valor of Object.values(config.nube.entorno)) assert.match(valor, /no-usar@127\.0\.0\.1:1/);
  // Sin `nube` ni `maxParalelo` en la configuración: aizen1 2 y la nube prendida por defecto.
  const sinNada = completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } });
  assert.equal(sinNada.maxParalelo, 2);
  assert.equal(sinNada.nube.activa, true);
  assert.equal(sinNada.tiempos.construirNubeMinutos, 178);
  assert.throws(() => completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } }, nube: { terminal: "otra" } }), /nube\.terminal/);
  assert.throws(() => completarConfig({ urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { a: { ruta: "." } }, nube: { entorno: { clave: "x" } } }), /nube\.entorno/);
});

await prueba("nube: la configuración no deja pasar de 12 entre aizen1 y la nube; la verificación de lo que vuelve hace fila con un semáforo", async () => {
  const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } };
  assert.throws(() => completarConfig({ ...base, maxParalelo: 5, nube: { maxTareas: 8 } }), /no pueden pasar de 12/);
  assert.equal(completarConfig({ ...base, maxParalelo: 5, nube: { maxTareas: 7 } }).nube.maxTareas, 7);
  assert.equal(completarConfig({ ...base, maxParalelo: 5, nube: { activa: false, maxTareas: 8 } }).nube.activa, false, "apagada no se mide");
  assert.equal(completarConfig(base).nube.esperaMinutos + completarConfig(base).nube.verificarMinutos < 180, true, "espera + verificación caben en los 180 min del CRM");
  const semaforo = crearSemaforo(2);
  const a = await semaforo.tomar();
  const b = await semaforo.tomar();
  let tercera = false;
  const pendiente = semaforo.tomar().then((liberar) => {
    tercera = true;
    return liberar;
  });
  await new Promise((resolver) => setTimeout(resolver, 20));
  assert.equal(tercera, false, "con los 2 puestos ocupados la tercera espera");
  a();
  a(); // liberar dos veces no libera dos puestos
  const liberarTercera = await pendiente;
  assert.equal(tercera, true);
  let cuarta = false;
  const siguiente = semaforo.tomar().then(() => {
    cuarta = true;
  });
  await new Promise((resolver) => setTimeout(resolver, 20));
  assert.equal(cuarta, false, "b y la tercera siguen ocupando los 2 puestos");
  b();
  await siguiente;
  assert.equal(cuarta, true);
  liberarTercera();
  // Una espera cancelada por la señal rechaza y no se queda con el puesto.
  const lleno = crearSemaforo(1);
  const unico = await lleno.tomar();
  const control = new AbortController();
  const cancelada = lleno.tomar(control.signal);
  control.abort();
  await assert.rejects(cancelada, /Se canceló la espera/);
  unico();
  const otra = await lleno.tomar();
  otra();
});

await prueba("nube: la regla de reparto (GRANDE = más de 8 archivos, migración, agente nuevo o ya falló por tamaño o recursos)", async () => {
  const archivos = (n) => Array.from({ length: n }, (_, i) => `- src/features/algo/archivo-${i + 1}.ts`).join("\n");
  const plan = (n, migracion = "No.") => `# Plan\n## 1. Qué se cambia\nUna mejora.\n## 4. Migración de base de datos\n${migracion}\n## 5. Archivos que se tocan\n${archivos(n)}\n## 6. Cómo se va a probar\nCorrer pruebas.`;
  const repo = { carpetaMigraciones: "prisma/migrations" };
  const grande = (tarjeta) => esTareaGrande(tarjeta, { repo, maxArchivosChica: 8 });
  // Archivos: 8 es chica, 9 es grande.
  assert.deepEqual(grande({ titulo: "Algo", plan: plan(3) }), { grande: false, motivos: [] });
  assert.equal(grande({ titulo: "Algo", plan: plan(8) }).grande, false, "8 archivos todavía es chica");
  assert.match(grande({ titulo: "Algo", plan: plan(9) }).motivos[0], /9 archivos/);
  // Migración: lo dice la parte 4, o la parte 5 nombra la carpeta de migraciones.
  assert.equal(trabajaConMigracion(plan(2, "**No.** Lo nuevo se guarda en un campo que ya existe."), repo), false);
  assert.equal(trabajaConMigracion(plan(2, "Sí. Una tabla nueva, aditiva."), repo), true);
  assert.equal(trabajaConMigracion(plan(2, "Sí o no: no."), repo), false, "la plantilla 'sí o no' no cuenta");
  assert.equal(trabajaConMigracion("4. Migración (sí/no): no.\n5. Archivos\n- src/a.ts", repo), false, "ni 'sí/no'");
  assert.equal(trabajaConMigracion("5. Archivos\n- prisma/migrations/20261025_x/migration.sql\n- src/a.ts", repo), true);
  assert.deepEqual(grande({ titulo: "Algo", plan: plan(2, "Sí. Una tabla nueva.") }).motivos, ["trae migración"]);
  // Agente nuevo: en el título o en la parte 1.
  assert.deepEqual(grande({ titulo: "Crear un agente nuevo de postventa", plan: plan(2) }).motivos, ["crea un agente nuevo"]);
  assert.equal(grande({ titulo: "Corregir el agente de ventas", plan: plan(2) }).grande, false);
  // Falló antes por tamaño o recursos.
  for (const categoria of ["tiempo_agotado", "pc_sobrecargado", "tarea_muy_grande"]) {
    assert.match(grande({ titulo: "Algo", plan: plan(2), ultimosIntentos: [{ categoria: "no_compila" }, { categoria }] }).motivos[0], /ya falló por tamaño o recursos/);
  }
  assert.equal(grande({ titulo: "Algo", plan: plan(2), ultimosIntentos: [{ categoria: "fallan_pruebas" }] }).grande, false, "una prueba que falla no es de tamaño");
  assert.equal(grande({ titulo: "Algo", plan: null }).grande, false, "sin plan no se sabe: chica");
  assert.match(seccionDelPlan(plan(2, "Sí."), 4), /^## 4\. Migración[\s\S]*Sí\.$/);
});

await prueba("nube: se lee el link de la sesión y la línea 'resultado:' del commit (con las líneas del error en el cuerpo)", async () => {
  assert.equal(linkDeSesion('{"session_url":"https://claude.ai/code/session_01AbC-9_x"}'), "https://claude.ai/code/session_01AbC-9_x");
  assert.equal(linkDeSesion("mira https://claude.ai/code/session_ABC\u001b[0m ya"), "https://claude.ai/code/session_ABC");
  assert.equal(linkDeSesion("https://malo.example/code/session_ABC"), null);
  assert.equal(linkDeSesion("https://claude.ai/otra/cosa"), null);
  assert.deepEqual(resultadoDelCommit("resultado: build=OK tests=OK segundos=361"), { build: "OK", tests: "OK", segundos: 361, paso: true, detalle: "" });
  const fallo = resultadoDelCommit("resultado: build=FALLO tests=OK segundos=7\n\nerror uno\nerror dos");
  assert.equal(fallo.paso, false);
  assert.equal(fallo.build, "FALLO");
  assert.equal(fallo.detalle, "error uno\nerror dos");
  assert.equal(resultadoDelCommit("resultado: build=OK tests=FALLO").paso, false);
  assert.equal(resultadoDelCommit("resultado: build=OK tests=OK").segundos, null);
  assert.equal(resultadoDelCommit("arreglar el build=OK"), null);
  assert.equal(resultadoDelCommit("tablero: algo\n\nresultado: build=OK tests=OK segundos=1"), null, "solo cuenta la primera línea");
});

await prueba("nube: la descripción para `claude --cloud` cabe en la línea de comandos de Windows sin perder rama, plan (recortado) ni reglas", async () => {
  const corta = "Eres el Coordinador… rama tablero/x\n\nTarea: t\n\nPLAN APROBADO:\n1. algo";
  assert.equal(descripcionParaLaNube(corta), corta, "si cabe, va entera");
  const larga = ["Eres el Coordinador… sobre la rama tablero/abc-larga", "Tarea: Larga", `PLAN APROBADO:\n1. Qué se cambia\n${"x".repeat(60_000)}\n6. Pruebas: FIN_DEL_PLAN`, "LECCIONES OBLIGATORIAS:\n1. …", "PROHIBIDO:\n- git push --force"].join("\n\n");
  const recortada = descripcionParaLaNube(larga);
  assert.ok(recortada.length <= MAX_DESCRIPCION && MAX_DESCRIPCION < 32_000);
  for (const pedazo of ["rama tablero/abc-larga", "Tarea: Larga", "PLAN APROBADO:\n1. Qué se cambia", "FIN_DEL_PLAN", "LECCIONES OBLIGATORIAS:", "PROHIBIDO:\n- git push --force", "recortado para que quepa"]) {
    assert.ok(recortada.includes(pedazo), pedazo);
  }
});

await prueba("nube: la instrucción lleva el plan completo, CLAUDE.md, las 4 lecciones, las prohibiciones y la rama; nunca claves", async () => {
  const repo = { clave: "aizencrm", instalar: ["npm", "ci"], verificar: [["npx", "prisma", "generate"], ["npm", "run", "build"]], pruebas: [["npm", "run", "test:tableros"]] };
  const tarjeta = { id: "tarjeta0001", titulo: "Una tarea grande", tablero: "Empresa", detalle: "Hacer lo grande", intentos: 1, plan: "PLAN COMPLETO\n5. Archivos: src/a.ts" };
  const texto = promptDeNube(tarjeta, repo, "tablero/abcd1234-una-tarea", { entorno: { DATABASE_URL: "postgresql://trabajador:no-usar@127.0.0.1:1/no_usar" } });
  assert.match(texto, /PLAN APROBADO:\nPLAN COMPLETO\n5\. Archivos: src\/a\.ts/);
  assert.match(texto, /lee el archivo CLAUDE\.md/);
  assert.match(texto, /1\. PREPARACIÓN[^\n]*`npm ci` → `npx prisma generate` → `npm run build` → `npm run test:tableros`/);
  assert.match(texto, /Sin `npx prisma generate` el build falla con errores de tipos falsos/);
  assert.match(texto, /export DATABASE_URL="postgresql:\/\/trabajador:no-usar@127\.0\.0\.1:1\/no_usar"/);
  assert.match(texto, /2\. TODO EN PRIMER PLANO: nada en segundo plano ni subagentes esperando/);
  assert.match(texto, /3\. DEJA TODO EN LA RAMA tablero\/abcd1234-una-tarea/);
  assert.match(texto, /git push origin tablero\/abcd1234-una-tarea` \(sin --force\)|git push origin tablero\/abcd1234-una-tarea \(sin --force\)/);
  assert.match(texto, /resultado: build=OK tests=OK segundos=<N>/);
  assert.match(texto, /4\. SI FALLA[^\n]*últimas 30 líneas del error/);
  assert.match(texto, /PROHIBIDO:\n- Tocar bases de datos[^\n]*claves, tokens, archivos \.env/);
  assert.match(texto, /git push --force/);
  assert.match(texto, /No toques Meta Ads \(anuncios, campañas, píxel\), el bot de ventas \(el agente que atiende WhatsApp\) ni el libro del agente V3/);
  assert.ok(!/aizen_trab_|Bearer|password/i.test(texto), "ninguna clave");
});

await prueba("recursos: no abre otra sesión si la CPU o la memoria pasan del límite", async () => {
  const limites = { cpuPorciento: 85, memoriaPorciento: 80 };
  assert.equal(faltanRecursos({ cpu: 50, memoria: 60 }, limites), null);
  assert.match(faltanRecursos({ cpu: 92, memoria: 60 }, limites), /CPU 92 %/);
  assert.match(faltanRecursos({ cpu: 10, memoria: 81 }, limites), /memoria 81 %/);
});

await prueba("límite de uso de Claude: se reconoce el aviso (y no cualquier texto)", async () => {
  assert.ok(esLimiteDeUso("Claude AI usage limit reached|1761210000"));
  assert.ok(esLimiteDeUso("You've hit your limit · resets 9pm"));
  assert.ok(esLimiteDeUso("You've hit your session limit · resets 1:20am (America/Bogota)"));
  assert.ok(esLimiteDeUso("You've hit your weekly limit · resets Mon 9am"));
  assert.ok(!esLimiteDeUso("PLAN: agregar el botón de cobrar"));
});

await prueba("log de comandos: guarda las líneas que fallaron (not ok, error), el final y no solo el principio", async () => {
  const salida = [
    ...Array.from({ length: 299 }, (_, i) => `ok ${i + 1} - prueba ${i + 1}`),
    "not ok 300 - la prueba que falló",
    "  AssertionError: se esperaba 1 y llegó 2",
    ...Array.from({ length: 100 }, (_, i) => `ok ${i + 301} - prueba ${i + 301}`),
  ].join("\n");
  const fallas = lineasQueFallaron(salida);
  assert.match(fallas, /not ok 300 - la prueba que falló/);
  assert.match(fallas, /AssertionError/);
  assert.ok(!/^ok 1 /m.test(fallas), "no mete las líneas ok del principio");
  assert.ok(fallas.split("\n").length < 10);
  const detalle = detalleDeFalla({ salida, errores: "", archivoSalida: "C:/x/salida.log" });
  assert.ok(detalle.indexOf("Líneas que fallaron") < detalle.indexOf("Últimas 60 líneas"), "las que fallaron van primero");
  assert.match(detalle, /not ok 300/);
  assert.match(detalle, /ok 400 - prueba 400/, "y el final de la salida");
  assert.match(detalle, /Salida completa: C:\/x\/salida\.log/);
  // Aunque la falla caiga en las últimas 60 líneas o fuera de ellas, "not ok" se conserva.
  assert.equal(lineasQueFallaron("todo bien\nsin problemas"), "");
});

await prueba("diagnóstico: el aviso de 'carpeta sin confianza' no es la causa; las tareas en segundo plano son sesión atascada", async () => {
  const aviso = "Warning: this folder is not trusted: 4 permission rules in .claude/settings.json were ignored.";
  const d = diagnosticar({ error: new Error(`Fallaron las pruebas que ya existen. No se subió nada.\n${aviso}\nnot ok 3 - algo`), etapa: "construir" });
  assert.equal(d.categoria, "fallan_pruebas");
  assert.ok(!/trusted|settings\.json/.test(d.error), "el aviso no queda en el error");
  const solo = diagnosticar({ error: new Error(`Claude falló al construir (código 1):\n${aviso}`), etapa: "construir" });
  assert.equal(solo.categoria, "otra", "con solo el aviso no se inventa una causa");
  const atascada = diagnosticar({ error: new Error("Claude falló al construir (código 1):\nse cortaron tareas en segundo plano"), etapa: "construir" });
  assert.equal(atascada.categoria, "sesion_atascada");
  assert.match(atascada.causa, /atascada|segundo plano/i);
  const cortada = diagnosticar({ error: Object.assign(new Error("La sesión de Claude se quedó quieta 15 min"), { categoria: "sesion_atascada" }), etapa: "construir" });
  assert.equal(cortada.categoria, "sesion_atascada");
  // Primera vez: se repara; si se vuelve a atascar, se parte la tarea (sin gastar reparación).
  assert.equal(decidir({ diagnostico: d.categoria ? cortada : cortada, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "construir" }).accion, "reparar");
  const otraVez = decidir({ diagnostico: cortada, tarjeta: { reparaciones: 1, ultimosIntentos: [{ accion: "reparar", categoria: "sesion_atascada" }] }, etapa: "construir" });
  assert.deepEqual([otraVez.accion, otraVez.cuenta], ["partir", false]);
});

await prueba("decisiones: el límite de Claude espera sin contar; 3 reparaciones y escala con resumen de 3 líneas; tarea grande se parte", async () => {
  const limite = diagnosticar({ error: Object.assign(new Error("Claude llegó a su límite de uso al construir: usage limit reached"), { limiteDeUso: true }), etapa: "construir" });
  assert.equal(limite.categoria, "limite_claude");
  assert.deepEqual(decidir({ diagnostico: limite, tarjeta: { reparaciones: 3 }, etapa: "construir" }), { accion: "esperar", cuenta: false, motivo: "límite de uso de Claude: se espera su reinicio" });
  const compila = diagnosticar({ error: new Error("No compiló: el código tiene errores de tipos (TypeScript)\nerror TS2322: el tipo no calza"), etapa: "construir" });
  assert.equal(compila.categoria, "no_compila");
  assert.equal(decidir({ diagnostico: compila, tarjeta: { reparaciones: 2, topeReparaciones: 3 }, etapa: "construir" }).accion, "reparar");
  assert.equal(decidir({ diagnostico: compila, tarjeta: { reparaciones: 3, topeReparaciones: 3 }, etapa: "construir" }).accion, "escalar");
  const resumen = resumenDeEscalada({ tarjeta: { reparaciones: 3 }, intentos: [{ accion: "reparar", categoria: "no_compila" }, { accion: "reparar", categoria: "no_compila" }, { accion: "reparar", categoria: "no_compila" }], diagnostico: compila });
  const lineas = resumen.split("\n");
  assert.equal(lineas.length, 3);
  assert.match(lineas[0], /^Qué falló:/);
  assert.match(lineas[1], /^Qué se probó:.*3 reparaciones/);
  assert.match(lineas[2], /^Qué necesita de ti:/);
  const lento = diagnosticar({ error: Object.assign(new Error("Claude tardó más de 88 min en construir: se cortó."), { categoria: "tiempo_agotado" }), etapa: "construir" });
  assert.equal(decidir({ diagnostico: lento, tarjeta: {}, etapa: "construir", archivosCambiados: 12 }).accion, "partir", "muchos archivos: se parte");
  assert.equal(decidir({ diagnostico: lento, tarjeta: {}, etapa: "construir", archivosCambiados: 2 }).accion, "reparar", "pocos archivos y primera vez: se repara");
  assert.equal(decidir({ diagnostico: lento, tarjeta: { esParte: true }, etapa: "construir", archivosCambiados: 12 }).accion, "reparar", "una parte no se parte más");
});

await prueba("sesión atascada: solo se corta si pasan 15 min sin archivos nuevos NI procesador (reloj acelerado)", async () => {
  let reloj = 0;
  let huella = "a";
  let cpu = 10;
  const v = crearVigilante({ limiteMs: 15 * 60_000, leerHuella: async () => huella, leerCpu: async () => cpu, ahora: () => reloj });
  assert.equal(await v.revisar(1), false, "la primera lectura es la línea de base");
  reloj += 10 * 60_000;
  assert.equal(await v.revisar(1), false, "10 min quieta: todavía no");
  reloj += 6 * 60_000;
  cpu += 3; // usó el procesador (pensando o corriendo pruebas)
  assert.equal(await v.revisar(1), false, "16 min pero usó CPU: no está atascada");
  reloj += 14 * 60_000;
  huella = "b"; // tocó un archivo
  assert.equal(await v.revisar(1), false, "tocó archivos: no está atascada");
  reloj += 14 * 60_000;
  assert.equal(await v.revisar(1), false, "14 min quieta");
  reloj += 2 * 60_000;
  assert.equal(await v.revisar(1), true, "16 min sin archivos ni CPU: sesión atascada");
  const sinMedir = crearVigilante({ limiteMs: 60_000, leerHuella: async () => "x", leerCpu: async () => Number.NaN, ahora: () => reloj });
  await sinMedir.revisar(1);
  reloj += 10 * 60_000;
  assert.equal(await sinMedir.revisar(1), false, "si no se puede medir la CPU no se corta (podría estar pensando)");
  assert.equal(
    sumarDescendientes(
      [{ pid: 1, ppid: 0, segundos: 2 }, { pid: 2, ppid: 1, segundos: 3 }, { pid: 3, ppid: 2, segundos: 4 }, { pid: 4, ppid: 99, segundos: 100 }],
      1,
    ),
    9,
    "suma el proceso y todos sus hijos, no los ajenos",
  );
});

await prueba("construir: el prompt prohíbe subagentes y esperar, y los argumentos de Claude los bloquean", async () => {
  const repo = { clave: "aizencrm", subirSolo: true, zonasProtegidas: {} };
  const prompt = promptDeConstruir({ titulo: "Algo", tablero: "T", detalle: "d", intentos: 1, plan: "El plan", zonasAprobadas: [] }, repo, "tablero/x");
  assert.match(prompt, /PROHIBIDO lanzar subagentes/);
  assert.match(prompt, /PRIMER PLANO/);
  assert.match(prompt, /nada de "reviso de nuevo en unos minutos"/);
  assert.ok(!/Usa subagentes \(herramienta Agent\), con las mismas reglas/.test(prompt), "ya no manda usar subagentes");
  assert.match(promptDelPlan({ titulo: "Algo", tablero: "T", detalle: "d", intentos: 1 }, repo), /subagentes/, "al planear sí puede usarlos");
});

const USO_REAL = [
  "Current session: 36% used · resets Oct 23, 3:20pm (America/Bogota)",
  "Current week (all models): 6% used · resets Oct 30, 7am (America/Bogota)",
].join("\n");

await prueba("uso de Claude: se lee el texto real de `claude -p /usage` (sesión y semana, porcentaje y reinicio)", async () => {
  assert.deepEqual(leerUsoDeClaude(USO_REAL), {
    sesion: { porcentaje: 36, reinicio: "Oct 23, 3:20pm (America/Bogota)" },
    semana: { porcentaje: 6, reinicio: "Oct 30, 7am (America/Bogota)" },
  });
  assert.deepEqual(leerUsoDeClaude("Current session: 83% used · resets 3:20pm (America/Bogota)").sesion, { porcentaje: 83, reinicio: "3:20pm (America/Bogota)" });
  assert.equal(leerUsoDeClaude("Unknown command"), null, "no se inventan números");
  assert.equal(leerUsoDeClaude(""), null);
  assert.equal(horaDelReinicio("Oct 23, 3:20pm (America/Bogota)"), "3:20pm");
  assert.equal(horaDelReinicio("Oct 30, 7am (America/Bogota)"), "7am");
});

await prueba("uso de Claude: el cruce del umbral se detecta una vez (se repite solo si bajó o cambió el periodo); ilegible = bajo; el aviso de límite lleva la hora de vuelta", async () => {
  const uso = (sesion, reinicio = "Oct 23, 3:20pm") => ({ sesion: { porcentaje: sesion, reinicio }, semana: { porcentaje: 6, reinicio: "Oct 30, 7am" } });
  const primera = decidirUso(uso(83), {}, 80, "2026-10-23");
  assert.deepEqual(primera.alto.map((a) => a.periodo), ["sesion"]);
  assert.equal(primera.avisos.length, 1);
  const segunda = decidirUso(uso(90), primera.estado, 80, "2026-10-23");
  assert.equal(segunda.alto.length, 1, "sigue alto");
  assert.equal(segunda.avisos.length, 0, "no se repite el aviso del mismo cruce");
  assert.equal(decidirUso(uso(80, "Oct 23, 8:20pm"), segunda.estado, 80, "2026-10-23").avisos.length, 1, "otro periodo: avisa de nuevo");
  const bajo = decidirUso(uso(40), segunda.estado, 80, "2026-10-23");
  assert.equal(bajo.alto.length, 0);
  assert.equal(decidirUso(uso(85), bajo.estado, 80, "2026-10-23").avisos.length, 1, "bajó y volvió a subir: avisa de nuevo");
  const semana = decidirUso({ sesion: { porcentaje: 10, reinicio: "x" }, semana: { porcentaje: 81, reinicio: "Oct 30, 7am" } }, {}, 80, "2026-10-23");
  assert.deepEqual(semana.avisos.map((a) => a.periodo), ["semana"]);
  const ilegible = decidirUso(null, {}, 80, "2026-10-23");
  assert.deepEqual([ilegible.alto, ilegible.alertaLectura], [[], true]);
  assert.equal(decidirUso(null, ilegible.estado, 80, "2026-10-23").alertaLectura, false, "una sola vez por día");
  assert.equal(decidirUso(null, ilegible.estado, 80, "2026-10-24").alertaLectura, true, "al otro día otra vez");
  const hasta = Date.parse("2026-10-23T20:20:00Z"); // 3:20 p. m. en Bogotá
  const limite = textoDelAvisoDeLimite(hasta, { urlCrm: "https://crm.ejemplo.com/" });
  assert.equal(limite, "⛔ Claude llegó a su límite de uso: Sistemas quedó en pausa.\nVuelve a trabajar solo a las 3:20 p. m.\nVer: https://crm.ejemplo.com/cliente/tablero-ia?vista=coordinador");
  assert.ok(limite.split("\n").length <= 3, "el aviso tiene 3 líneas o menos");
  assert.match(textoDelAvisoDeLimite(hasta, {}), /Ver: https:\/\/app\.aizenbot\.com\/cliente\/tablero-ia\?vista=coordinador$/);
});

await prueba("límite de Codex: se reconoce el aviso de ChatGPT (y no cualquier texto)", async () => {
  assert.ok(esLimiteDeCodex("ERROR: You've hit your usage limit. Upgrade to Pro, or try again in 2 hours."));
  assert.ok(esLimiteDeCodex("stream error: 429 Too Many Requests"));
  assert.ok(esLimiteDeCodex("Rate limit reached for the Plus plan"));
  assert.ok(esLimiteDeCodex("You exceeded your current quota"));
  assert.ok(!esLimiteDeCodex("RESUMEN: Codex hizo el cambio del botón"));
});

await prueba("motores: por defecto todo Claude (Opus planea, Sonnet construye y revisa); con Codex: Claude alto -> Codex solo con respaldoCodex; Codex agotado -> espera (o Claude con respaldo)", async () => {
  const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } };
  const porDefecto = completarConfig(base);
  assert.deepEqual(porDefecto.motores, { planear: "claude", construir: "claude", revisar: "claude", respaldoClaude: false, respaldoCodex: false });
  assert.deepEqual(porDefecto.modelos, { planear: "opus", planearSencillo: "sonnet", construir: "sonnet", revisar: "sonnet", subagentes: "sonnet", leer: "haiku" });
  assert.throws(() => completarConfig({ ...base, modelos: { planear: "opus 5" } }), /modelos\.planear/);
  const sinRespaldo = crearEstadoDeMotores(porDefecto);
  sinRespaldo.ponerClaudeAlto({ periodo: "sesion", porcentaje: 83, reinicio: "3:20pm" });
  assert.deepEqual(["planear", "construir", "revisar"].map(sinRespaldo.motorDe), ["claude", "claude", "claude"], "sin respaldoCodex, sobre el umbral sigue Claude (solo se avisa)");
  sinRespaldo.pausar("claude");
  assert.equal(sinRespaldo.motorDe("construir"), null, "Claude agotado y sin respaldo: espera, no pasa a Codex");
  const config = completarConfig({ ...base, motores: { construir: "codex", respaldoCodex: true } });
  assert.deepEqual(config.comandoCodex, ["codex"]);
  assert.equal(config.pausaLimiteCodexMinutos, 30);
  assert.equal(config.umbralClaude, 80);
  assert.equal(config.vigilarUsoMinutos, 10);
  assert.equal(completarConfig({ ...base, motores: { revisar: "ninguno" } }).motores.revisar, null);
  assert.throws(() => completarConfig({ ...base, motores: { construir: "gpt" } }), /motores\.construir/);
  assert.throws(() => completarConfig({ ...base, motores: { respaldoClaude: "si" } }), /respaldoClaude/);
  assert.throws(() => completarConfig({ ...base, umbralClaude: 150 }), /umbralClaude/);
  assert.throws(() => completarConfig({ ...base, comandoCodex: "codex" }), /comandoCodex/);

  let reloj = 1_000_000;
  const estado = crearEstadoDeMotores(config, { ahora: () => reloj });
  assert.deepEqual(["planear", "construir", "revisar"].map(estado.motorDe), ["claude", "codex", "claude"]);
  estado.ponerClaudeAlto({ periodo: "sesion", porcentaje: 83, reinicio: "3:20pm" });
  assert.deepEqual(["planear", "construir", "revisar"].map(estado.motorDe), ["codex", "codex", "codex"], "sobre el umbral todo va con Codex");
  estado.ponerClaudeAlto(null);
  estado.pausar("codex");
  assert.equal(estado.motorDe("construir"), null, "Codex agotado y sin respaldo: espera, no pasa a Claude");
  assert.equal(estado.motorDe("planear"), "claude");
  assert.equal(motorDeLaEtapa(estado, "subir"), "ninguno", "subir no usa motor");
  reloj += 31 * 60_000;
  assert.equal(estado.motorDe("construir"), "codex", "pasada la pausa, vuelve Codex");
  const conRespaldo = crearEstadoDeMotores(completarConfig({ ...base, motores: { respaldoClaude: true } }), { ahora: () => reloj });
  conRespaldo.pausar("codex");
  assert.equal(conRespaldo.motorDe("construir"), "claude", "con respaldoClaude pasa a Claude");
});

await prueba("choques: archivos y módulos del plan; misma zona o módulo del mismo repo, o dos subidas, esperan en fila", async () => {
  const plan = [
    "Al terminar: sube solo a producción",
    "1. Qué se cambia: el coach (src/features/otra/cosa.ts va en la parte 5, no acá).",
    "**5. Archivos que se tocan:**",
    "- `src/features/coach/servicios/generar-coach.ts` (nuevo).",
    "- src/app/api/trabajador/tablero/[id]/[accion]/route.ts",
    "- prisma/schema.prisma y package.json",
    "Ver https://github.com/AlexMoreR/AgenteLite/blob/main/README.md y PLANEANDO/EN_CURSO.",
    "6. Cómo se va a probar: npm run test:tableros y scripts/check-tableros-reglas.mjs",
  ].join("\n");
  assert.deepEqual(archivosDelPlan(plan).sort(), [
    "package.json",
    "prisma/schema.prisma",
    "src/app/api/trabajador/tablero/[id]/[accion]/route.ts",
    "src/features/coach/servicios/generar-coach.ts",
  ]);
  assert.equal(moduloDe("src/features/coach/servicios/generar-coach.ts"), "features/coach");
  assert.equal(moduloDe("src/app/api/trabajador/tablero/[id]/[accion]/route.ts"), "app/api/trabajador/tablero");
  assert.equal(moduloDe("src/app/(panel)/cliente/chats/page.tsx"), "app/cliente/chats");
  assert.equal(moduloDe("src/lib/agent.ts"), "lib/agent");
  assert.equal(moduloDe("prisma/migrations/2026_x/migration.sql"), "prisma");
  assert.equal(moduloDe("package-lock.json"), "package");

  const repos = { aizencrm: { zonasProtegidas: { CHATS: ["src/chats/**"] } }, gestion: { zonasProtegidas: {} } };
  const h = (id, repo, hacer, planDe, zonaProtegida = []) => huellaDeTarjeta({ id, titulo: id, repo, plan: planDe, zonaProtegida }, hacer, repos[repo]);
  const coach = h("a", "aizencrm", "construir", "Archivos: src/features/coach/a.ts");
  const coach2 = h("b", "aizencrm", "construir", "Archivos: src/features/coach/b.ts");
  const ventas = h("c", "aizencrm", "construir", "Archivos: src/features/ventas/a.ts");
  const chats1 = h("d", "aizencrm", "construir", "Archivos: src/chats/uno.ts");
  const chats2 = h("e", "aizencrm", "construir", "Archivos: src/otra/cosa.ts", ["CHATS"]);
  const sinArchivos = h("f", "aizencrm", "construir", "Cambiar el color del botón.");
  const otroRepo = h("g", "gestion", "construir", "Archivos: src/features/coach/a.ts");
  assert.match(motivoDeChoque(coach, coach2), /módulo features\/coach/);
  assert.equal(motivoDeChoque(coach, ventas), null, "módulos distintos van a la vez");
  assert.match(motivoDeChoque(chats1, chats2), /zona CHATS/);
  assert.match(motivoDeChoque(coach, sinArchivos), /no dice qué archivos/);
  assert.equal(motivoDeChoque(coach, otroRepo), null, "repos distintos nunca chocan");
  assert.equal(motivoDeChoque(coach, h("p", "aizencrm", "planear", "Archivos: src/features/coach/a.ts")), null, "planear solo lee");
  assert.match(motivoDeChoque(h("s1", "aizencrm", "subir", "src/x/a.ts"), h("s2", "aizencrm", "subir", "src/y/b.ts")), /de a una/);
  assert.equal(motivoDeChoque(h("s1", "aizencrm", "subir", "src/x/a.ts"), h("s3", "gestion", "subir", "src/x/a.ts")), null);
  const chocan = candidatasQueChocan(
    [
      { id: "b", titulo: "b", repo: "aizencrm", hacer: "construir", plan: "src/features/coach/b.ts", zonaProtegida: [] },
      { id: "c", titulo: "c", repo: "aizencrm", hacer: "construir", plan: "src/features/ventas/a.ts", zonaProtegida: [] },
    ],
    [coach],
    repos,
  );
  assert.deepEqual(Object.keys(chocan), ["b"]);
});

await prueba("choques: el manual y las notas de cambios pendientes no hacen chocar (la medida de la tarjeta)", async () => {
  const repos = { aizencrm: { zonasProtegidas: {} } };
  const planDe = (codigo, id) =>
    ["Al terminar: sube solo", "**5. Archivos que se tocan:**", `- ${codigo}`, "- docs/que-es-esta-aplicacion.md", `- docs/cambios-pendientes/${id}.md`, "6. Cómo se va a probar: npm test"].join("\n");
  const a = { id: "a", titulo: "a", repo: "aizencrm", hacer: "construir", plan: planDe("src/features/a/x.ts", "aaaa1111"), zonaProtegida: [] };
  const b = { id: "b", titulo: "b", repo: "aizencrm", hacer: "construir", plan: planDe("src/lib/b.ts", "bbbb2222"), zonaProtegida: [] };
  const ha = huellaDeTarjeta(a, "construir", repos.aizencrm);
  const hb = huellaDeTarjeta(b, "construir", repos.aizencrm);
  assert.deepEqual([...ha.modulos], ["features/a"]);
  assert.equal(motivoDeChoque(ha, hb), null, "código distinto: corren en paralelo");
  assert.deepEqual(candidatasQueChocan([b], [ha], repos), {});
  // Aunque la config del repo diga que ningún archivo es "sin choque", el manual y las notas siguen ignorándose.
  const estricta = { ...repos.aizencrm, sinChoque: [] };
  assert.deepEqual([...huellaDeTarjeta(a, "construir", estricta).modulos], ["features/a"]);
  // Las reglas de siempre siguen.
  const mismo = { ...b, plan: planDe("src/features/a/otro.ts", "cccc3333") };
  assert.match(motivoDeChoque(ha, huellaDeTarjeta(mismo, "construir", repos.aizencrm)), /módulo features\/a/);
  assert.match(motivoDeChoque(huellaDeTarjeta(a, "subir", repos.aizencrm), hb.hacer === "construir" ? huellaDeTarjeta(b, "subir", repos.aizencrm) : hb), /de a una/);
  const sinArchivos = huellaDeTarjeta({ ...b, plan: "Cambiar el color del botón." }, "construir", repos.aizencrm);
  assert.match(motivoDeChoque(ha, sinArchivos), /no dice qué archivos/);
  // Un plan que SOLO nombra el manual o las notas no choca con nadie (no es "no dice archivos").
  const soloManual = huellaDeTarjeta({ ...b, plan: "**5. Archivos**\n- docs/que-es-esta-aplicacion.md\n- docs/cambios-pendientes/dddd4444.md\n6. Pruebas" }, "construir", repos.aizencrm);
  assert.equal(soloManual.modulos.size, 0);
  assert.equal(motivoDeChoque(ha, soloManual), null);
  assert.equal(motivoDeChoque(soloManual, huellaDeTarjeta({ ...a, plan: planDe("src/lib/b.ts", "eeee5555") }, "construir", repos.aizencrm)), null);
});

await prueba("instrucciones de construir: no se edita el manual, se deja una nota en docs/cambios-pendientes/<id-corto>.md", async () => {
  const tarjeta = { id: "tarjeta-mfpz7jlu-abc12345", titulo: "Tarea", plan: "Editar docs/que-es-esta-aplicacion.md", link: "x", zonasAprobadas: [] };
  const repo = { clave: "aizencrm", subirSolo: true, instalar: ["npm", "ci"], verificar: [], pruebas: [], zonasProtegidas: {} };
  for (const prompt of [promptDeConstruir(tarjeta, repo, "tablero/x"), promptDeConstruir(tarjeta, repo, "tablero/x", "codex"), promptDeNube(tarjeta, repo, "tablero/x")]) {
    assert.match(prompt, /No edites docs\/que-es-esta-aplicacion\.md, aunque el plan lo diga/);
    assert.ok(prompt.includes("docs/cambios-pendientes/mfpz7jlu".replace("mfpz7jlu", "abc12345") + ".md"), "nombra la nota con el id corto");
  }
});

await prueba("manual de la noche: hora, un solo intento al día, sin notas, con notas, revisión antes de subir y espera si hay una subida", async () => {
  const N = fs.mkdtempSync(path.join(os.tmpdir(), "manual-nocturno-"));
  const remoto = path.join(N, "remoto.git");
  const repoDir = path.join(N, "repo");
  const gn = (cwd, ...args) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const escribirN = (relativo, texto) => {
    fs.mkdirSync(path.dirname(path.join(repoDir, relativo)), { recursive: true });
    fs.writeFileSync(path.join(repoDir, relativo), texto);
  };
  try {
    execFileSync("git", ["init", "--bare", "-b", "main", remoto], { stdio: "ignore" });
    fs.mkdirSync(repoDir);
    gn(repoDir, "init", "-b", "main");
    escribirN(MANUAL, "# Manual\n\n## Qué no existe hoy\n- `viejo`: algo\n\n## Advertencias de operación\n- `otra`: cosa\n");
    escribirN(`${CARPETA_DE_NOTAS}/README.md`, "# Notas\n");
    escribirN("src/a.ts", "// a\n");
    gn(repoDir, "add", "-A");
    gn(repoDir, "commit", "-m", "base");
    gn(repoDir, "remote", "add", "origin", remoto);
    gn(repoDir, "push", "-u", "origin", "main");
    const ramaRemota = (archivo) => execFileSync("git", ["--git-dir", remoto, "show", `main:${archivo}`], { encoding: "utf8" });
    const commitsRemotos = () => execFileSync("git", ["--git-dir", remoto, "rev-list", "--count", "main"], { encoding: "utf8" }).trim();
    const notasEnRemoto = () =>
      execFileSync("git", ["--git-dir", remoto, "ls-tree", "--name-only", "main", `${CARPETA_DE_NOTAS}/`], { encoding: "utf8" })
        .split(/\r?\n/)
        .filter((linea) => linea && !linea.endsWith("README.md"))
        .map((linea) => path.basename(linea));
    const subirNotas = (...nombres) => {
      gn(repoDir, "pull", "--quiet", "origin", "main");
      for (const nombre of nombres) escribirN(`${CARPETA_DE_NOTAS}/${nombre}.md`, `## Qué no existe hoy\n- \`${nombre}\`: nota de ${nombre}\n`);
      gn(repoDir, "add", "-A");
      gn(repoDir, "commit", "-m", `notas ${nombres.join(",")}`);
      gn(repoDir, "push", "origin", "main");
    };

    const base = {
      urlCrm: "https://crm.test",
      claveTrabajador: "aizen_trab_x",
      carpetaTrabajo: path.join(N, "trabajo"),
      comandoClaude: [process.execPath, path.join(AQUI, "claude-falso.mjs")],
      git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
      repos: { aizencrm: { ruta: repoDir, ramaBase: "main", remoto: "origin" } },
    };
    const config = completarConfig(base);
    assert.deepEqual(config.manual, { activo: true, hora: 23, repo: "aizencrm" }, "por defecto: prendido, 23 h, aizencrm");
    assert.throws(() => completarConfig({ ...base, manual: { hora: 30 } }), /manual\.hora/);
    assert.throws(() => completarConfig({ ...base, manual: { activo: "si" } }), /manual\.activo/);

    const registro = { info: () => undefined, aviso: () => undefined, error: () => undefined };
    const avisos = [];
    // Se simula la hora con una fecha fija (Bogotá = UTC-5): 22:00 es antes de las 23; 23:30 ya es la noche.
    let ahora = new Date("2026-10-26T03:00:00Z"); // 22:00 en Bogotá
    assert.equal(horaEnBogota(ahora), 22);
    const manual = crearManualNocturno({ config, registro, avisar: async (texto) => avisos.push(texto), entorno: process.env, ahora: () => ahora });
    const libre = { subiendo: () => false };

    subirNotas("aaaa1111", "bbbb2222");
    assert.equal((await manual.revisar(libre)).motivo, "antes_de_la_hora");
    assert.equal(commitsRemotos(), "2", "antes de la hora no hace nada");

    ahora = new Date("2026-10-26T04:30:00Z"); // 23:30
    assert.equal((await manual.revisar({ subiendo: () => true })).motivo, "subiendo", "si hay una tarea subiendo, espera");
    assert.equal(commitsRemotos(), "2");
    assert.equal(leerEstadoDelManual(config.carpetaTrabajo), null);

    // La sesión cambia un archivo de código: no sube y avisa.
    process.env.CLAUDE_FALSO_MANUAL = "codigo";
    escribirN("src/a.ts", "// a\n"); // el worktree de la prueba no se usa: solo el remoto
    let resultado = await manual.revisar(libre);
    assert.equal(resultado.motivo, "fallo");
    assert.match(resultado.error, /no son el manual ni las notas.*codigo-ajeno/);
    assert.equal(commitsRemotos(), "2", "no subió nada");
    assert.deepEqual(notasEnRemoto(), ["aaaa1111.md", "bbbb2222.md"]);
    assert.match(avisos.at(-1), /No se subió nada/);
    // Borra un título: no sube.
    process.env.CLAUDE_FALSO_MANUAL = "titulo";
    resultado = await manual.revisar(libre);
    assert.equal(resultado.motivo, "fallo");
    assert.equal(commitsRemotos(), "2");
    assert.equal(leerEstadoDelManual(config.carpetaTrabajo).intentos, 2);

    // Bien: pasa las 2 notas, las borra, hace un commit y lo sube.
    delete process.env.CLAUDE_FALSO_MANUAL;
    resultado = await manual.revisar(libre);
    assert.equal(resultado.subio, true);
    assert.equal(resultado.pasadas, 2);
    assert.equal(commitsRemotos(), "3");
    assert.match(execFileSync("git", ["--git-dir", remoto, "log", "-1", "--format=%s", "main"], { encoding: "utf8" }), /^manual: junta 2 notas de cambios pendientes/);
    assert.deepEqual(notasEnRemoto(), []);
    assert.match(ramaRemota(MANUAL), /`aaaa1111`:.*nota de aaaa1111/);
    assert.match(ramaRemota(MANUAL), /## Advertencias de operación/);
    assert.ok(ramaRemota(`${CARPETA_DE_NOTAS}/README.md`), "el README se queda");
    assert.match(avisos.at(-1), /pasé 2 nota\(s\)/);
    assert.equal(fs.existsSync(path.join(config.carpetaTrabajo, "wt", "manual-nocturno")), false, "no deja la copia aparte");

    // Ese mismo día no lo repite (aunque haya notas nuevas).
    subirNotas("cccc3333");
    assert.equal((await manual.revisar(libre)).motivo, "ya_hecho");
    assert.deepEqual(notasEnRemoto(), ["cccc3333.md"]);

    // Otro día, una nota que no se entiende se queda sin borrar.
    ahora = new Date("2026-10-28T04:30:00Z");
    subirNotas("dddd4444");
    process.env.CLAUDE_FALSO_MANUAL = "no-pase";
    resultado = await manual.revisar(libre);
    delete process.env.CLAUDE_FALSO_MANUAL;
    assert.equal(resultado.pasadas, 1);
    assert.deepEqual(notasEnRemoto(), ["cccc3333.md"], "la primera nota (cccc3333) no se pasó y sigue");
    assert.match(avisos.at(-1), /Quedaron sin pasar.*cccc3333\.md/);

    // Otro día sin notas: lo marca como hecho y no sube nada. (Se borran las que quedaban a mano.)
    gn(repoDir, "pull", "origin", "main");
    gn(repoDir, "rm", "-q", `${CARPETA_DE_NOTAS}/cccc3333.md`);
    gn(repoDir, "commit", "-m", "quita nota");
    gn(repoDir, "push", "origin", "main");
    const antes = commitsRemotos();
    ahora = new Date("2026-10-29T04:30:00Z");
    resultado = await manual.revisar(libre);
    assert.equal(resultado.hizo, true);
    assert.equal(resultado.notas, 0);
    assert.equal(commitsRemotos(), antes);
    assert.equal(leerEstadoDelManual(config.carpetaTrabajo).hecho, true);

    // Apagado en la configuración: no hace nada.
    const apagado = crearManualNocturno({ config: completarConfig({ ...base, manual: { activo: false } }), registro, ahora: () => new Date("2026-10-30T04:30:00Z") });
    assert.equal((await apagado.revisar(libre)).motivo, "apagado");
  } finally {
    delete process.env.CLAUDE_FALSO_MANUAL;
    try {
      fs.rmSync(N, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // Windows a veces tiene un archivo abierto un instante.
    }
  }
});

/* ─────────────────────────────────────────────────────────── el escenario ── */

const T = fs.mkdtempSync(path.join(os.tmpdir(), "trabajador-tablero-"));
const REMOTO = path.join(T, "remoto.git");
const REPO = path.join(T, "repo");
const LOGS = { claude: path.join(T, "claude.log"), codex: path.join(T, "codex.log"), ssh: path.join(T, "ssh.log"), gh: path.join(T, "gh.log") };
const USO = path.join(T, "uso.txt");
process.env.CLAUDE_FALSO_LOG = LOGS.claude;
process.env.CODEX_FALSO_LOG = LOGS.codex;
process.env.CLAUDE_FALSO_USO = USO;
process.env.SSH_FALSO_LOG = LOGS.ssh;
process.env.GH_FALSO_LOG = LOGS.gh;
process.env.GH_FALSO_REMOTO = REMOTO;

const g = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=Prueba", "-c", "user.email=prueba@x.co", ...args], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();

fs.mkdirSync(REPO);
execFileSync("git", ["init", "--bare", "-b", "main", REMOTO], { stdio: "ignore" });
g(REPO, "init", "-b", "main");
const archivo = (relativo, texto) => {
  fs.mkdirSync(path.dirname(path.join(REPO, relativo)), { recursive: true });
  fs.writeFileSync(path.join(REPO, relativo), texto);
};
archivo("package.json", '{ "name": "repo-de-prueba", "private": true }\n');
archivo("verificar.mjs", 'import fs from "node:fs";\nif (fs.existsSync("ROMPER_TSC")) { console.error("error TS2322: el tipo no calza"); process.exit(1); }\nconsole.log("tsc ok");\n');
archivo(
  "lint.mjs",
  [
    'import fs from "node:fs"; import path from "node:path";',
    "const salida = [];",
    'const recorrer = (d) => { for (const n of fs.readdirSync(d)) { if (n === ".git" || n === "node_modules") continue; const p = path.join(d, n);',
    '  if (fs.statSync(p).isDirectory()) recorrer(p); else if (fs.readFileSync(p, "utf8").includes("ERROR_" + "LINT")) salida.push({ filePath: path.resolve(p), messages: [{ severity: 2, ruleId: "regla-falsa", message: "error de lint" }] }); } };',
    'recorrer("."); console.log(JSON.stringify(salida)); process.exit(salida.length ? 1 : 0);',
  ].join("\n"),
);
archivo(
  "ensayo.mjs",
  'import fs from "node:fs";\nconst c = "prisma/migrations";\nfor (const d of fs.readdirSync(c)) { if (fs.readFileSync(`${c}/${d}/migration.sql`, "utf8").includes("FALLA_PGLITE")) { console.error("falló " + d); process.exit(1); } }\nconsole.log("pglite ok");\n',
);
archivo("pruebas-largas.mjs", 'for (let i = 1; i <= 400; i += 1) console.log(i === 300 ? "not ok 300 - la prueba que falló" : `ok ${i} - prueba ${i}`);\nprocess.exit(1);\n');
archivo("viejo.txt", "ERROR_LINT (ya estaba en main: no cuenta)\n");
archivo("conflicto.txt", "lo de main\n");
archivo("prisma/migrations/20260101000000_base/migration.sql", "SELECT 1;\n");
g(REPO, "add", "-A");
g(REPO, "commit", "-m", "base");
g(REPO, "remote", "add", "origin", REMOTO);
g(REPO, "push", "-u", "origin", "main");

const shaDe = (ref) => execFileSync("git", ["--git-dir", REMOTO, "rev-parse", ref], { encoding: "utf8" }).trim();
const ramasDelRemoto = () =>
  execFileSync("git", ["--git-dir", REMOTO, "for-each-ref", "--format=%(refname:short)", "refs/heads"], { encoding: "utf8" })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);

/* ── El CRM falso: la misma máquina de estados que /api/trabajador/tablero ── */

const CLAVE = "aizen_trab_prueba";
const tarjetas = new Map();
const llamadas = [];
let avisosSilenciados = false;
const latidoVencido = new Set();
/** Cuántas tuvo el trabajador a la vez (con candado), por etapa: { construir: 2, subir: 1, ... }. */
const aLaVez = {};
const trabajando = () => [...tarjetas.values()].filter((t) => ["PLANEANDO", "EN_CURSO", "SUBIENDO"].includes(t.estado) && t.venceEn && t.venceEn > Date.now());
const anotarALaVez = () => {
  const ahora = trabajando();
  aLaVez.total = Math.max(aLaVez.total ?? 0, ahora.length);
  for (const estado of ["PLANEANDO", "EN_CURSO", "SUBIENDO"]) {
    aLaVez[estado] = Math.max(aLaVez[estado] ?? 0, ahora.filter((t) => t.estado === estado).length);
  }
};
let siguienteId = 1;
const nueva = (titulo, estado, extra = {}) => {
  const id = `tarjeta${String(siguienteId++).padStart(4, "0")}`;
  tarjetas.set(id, { id, titulo, detalle: "", tablero: "Pruebas", estado, repo: "aizencrm", plan: null, resultado: null, zonaProtegida: [], intentos: 0, venceEn: null, ...extra });
  return id;
};
/** Como SQL_CANDIDATAS: primero las SUBIENDO pendientes, después en el orden en que se crearon. */
const candidatasDelFalso = () => {
  // `dependeDe`: ids de las que tienen que estar HECHO antes (las flechas esDependencia; no aplica a SUBIENDO).
  const sinPendientes = (t) => t.estado === "SUBIENDO" || (t.dependeDe ?? []).every((id) => tarjetas.get(id)?.estado === "HECHO");
  const lista = [...tarjetas.values()].filter(
    (t) => (t.estado === "APROBADO" || (t.estado === "PLAN_APROBADO" && t.plan) || (t.estado === "SUBIENDO" && !t.venceEn)) && sinPendientes(t),
  );
  return [...lista.filter((t) => t.estado === "SUBIENDO"), ...lista.filter((t) => t.estado !== "SUBIENDO")];
};
// Reparar solo (24-oct-2026): una tarjeta con `moderno: true` trae lo que manda el CRM nuevo en /tomar
// (reparaciones, topeReparaciones, esperasSeguidas, esParte, ultimosIntentos, ultimoError); sin eso el
// Coordinador se porta como con un CRM viejo (a la primera falla, /error), que es lo que prueban las de arriba.
const esperasSeguidasDe = (t) => {
  const lista = t.intentosLista ?? [];
  const ultimaQueCuenta = lista.map((i) => i.cuentaComoIntento).lastIndexOf(true);
  return lista.slice(ultimaQueCuenta + 1).filter((i) => !i.cuentaComoIntento).length;
};
const paraElTrabajador = (t) => ({
  ...t,
  zonasAprobadas: t.zonaProtegida,
  link: `https://crm.falso/cliente/tablero-ia?tarjeta=${t.id}`,
  ...(t.moderno
    ? {
        reparaciones: t.reparaciones ?? 0,
        topeReparaciones: 3,
        esperasSeguidas: esperasSeguidasDe(t),
        esParte: [...tarjetas.values()].some((otra) => otra.resultado?.partida?.hijas?.includes(t.id)),
        ultimosIntentos: (t.intentosLista ?? []).slice(-6),
        ultimoError: [...(t.intentosLista ?? [])].reverse().find((i) => i.error)?.error ?? null,
      }
    : {}),
});
/** Anota un intento en la tarjeta (el IntentoTarjeta del CRM real). */
const anotarIntento = (t, datos, accion, cuentaComoIntento) => {
  t.intentosLista = [...(t.intentosLista ?? []), { numero: (t.intentosLista?.length ?? 0) + 1, etapa: datos.etapa, categoria: datos.categoria, causa: datos.causa, error: datos.error ?? null, accion, cuentaComoIntento }];
};

const servidor = http.createServer(async (pedido, respuesta) => {
  const contestar = (codigo, datos) => {
    respuesta.writeHead(codigo, { "Content-Type": "application/json" });
    respuesta.end(JSON.stringify(datos));
  };
  if (pedido.method === "GET" && pedido.url === "/api/version") return contestar(200, { version: shaDe("main") });
  if (pedido.headers.authorization !== `Bearer ${CLAVE}`) return contestar(401, { ok: false, error: "Clave inválida" });
  let texto = "";
  for await (const pedazo of pedido) texto += pedazo;
  const cuerpo = texto ? JSON.parse(texto) : {};
  const ahora = Date.now();
  if (pedido.url === "/api/trabajador/tablero/tomar") {
    llamadas.push({ accion: "tomar", cuerpo });
    const { maxParalelo, excluir } = reglas.opcionesDeTomar(cuerpo);
    if (trabajando().length >= maxParalelo) return contestar(200, { ok: true, tarjeta: null, motivo: "ocupado" });
    const elegida = candidatasDelFalso().find((t) => !excluir.includes(t.id));
    if (!elegida) return contestar(200, { ok: true, tarjeta: null, motivo: "nada" });
    const regla = reglas.AL_TOMAR[elegida.estado];
    Object.assign(elegida, { estado: regla.a, venceEn: ahora + 5 * 60_000, intentos: elegida.intentos + 1 });
    anotarALaVez();
    return contestar(200, { ok: true, tarjeta: paraElTrabajador(elegida), hacer: regla.etapa });
  }
  if (pedido.url === "/api/trabajador/aviso") {
    llamadas.push({ accion: "aviso", cuerpo });
    if (avisosSilenciados) return contestar(200, { ok: true, silenciado: true });
    return contestar(200, { ok: true, linea: "Admin" });
  }
  if (pedido.url === "/api/trabajador/tablero/candidatas") {
    llamadas.push({ accion: "candidatas" });
    return contestar(200, {
      ok: true,
      candidatas: candidatasDelFalso().map((t) => ({ ...t, hacer: reglas.AL_TOMAR[t.estado].etapa })),
    });
  }
  const [, id, accion] = pedido.url.match(/^\/api\/trabajador\/tablero\/([^/]+)\/([a-z]+)$/) ?? [];
  const tarjeta = tarjetas.get(id);
  llamadas.push({ accion, id, cuerpo });
  if (!tarjeta) return contestar(404, { ok: false, error: "No existe" });
  const veredicto = reglas.puedeElTrabajador(accion, tarjeta.estado);
  if (veredicto) return contestar(409, { ok: false, error: veredicto });
  if (accion === "latido") {
    if (latidoVencido.has(id)) return contestar(409, { ok: false, error: "El candado de esta tarjeta ya venció" });
    tarjeta.venceEn = ahora + 5 * 60_000;
    return contestar(200, { ok: true });
  }
  if (accion === "soltar") {
    // Con `categoria` (CRM nuevo) deja un intento "esperar" que NO cuenta.
    if (cuerpo.categoria) anotarIntento(tarjeta, cuerpo, "esperar", false);
    tarjeta.estado = { PLANEANDO: "APROBADO", EN_CURSO: "PLAN_APROBADO", SUBIENDO: "SUBIENDO" }[tarjeta.estado];
    Object.assign(tarjeta, { venceEn: null, intentos: Math.max(0, tarjeta.intentos - 1), soltada: cuerpo.motivo });
    return contestar(200, { ok: true, estado: tarjeta.estado });
  }
  if (accion === "reparar") {
    // Como el CRM: tope de 3 reparaciones, vuelve a la fila y deja el intento (con la causa y el error exacto).
    if ((tarjeta.reparaciones ?? 0) >= reglas.TOPE_DE_REPARACIONES) return contestar(409, { ok: false, error: "Ya lleva 3 reparaciones" });
    anotarIntento(tarjeta, cuerpo, "reparar", true);
    Object.assign(tarjeta, { estado: reglas.estadoTrasReparar(tarjeta.estado), venceEn: null, reparaciones: (tarjeta.reparaciones ?? 0) + 1 });
    return contestar(200, { ok: true, estado: tarjeta.estado, reparaciones: tarjeta.reparaciones });
  }
  if (accion === "partir") {
    const partes = reglas.partesDeEntrada(cuerpo.partes);
    anotarIntento(tarjeta, { ...cuerpo, etapa: "construir", categoria: cuerpo.categoria ?? "tarea_muy_grande" }, "partir", false);
    const hijas = [];
    for (const [indice, parte] of partes.entries()) {
      // Cada hija depende de la anterior: se construyen en orden.
      hijas.push(nueva(reglas.tituloDeLaParte(tarjeta.titulo, indice + 1, parte.titulo), "APROBADO", { detalle: parte.detalle, moderno: true, dependeDe: hijas.slice(-1) }));
    }
    Object.assign(tarjeta, { estado: "EN_CURSO", venceEn: null, resultado: { ...(tarjeta.resultado ?? {}), partida: { hijas, causa: cuerpo.causa } } });
    return contestar(200, { ok: true, hijas });
  }
  if (accion === "error" && cuerpo.categoria) {
    // Escalar con motivo: el resumen de máximo 3 líneas y el intento "escalar".
    anotarIntento(tarjeta, cuerpo, "escalar", true);
    tarjeta.estado = "ERROR";
    Object.assign(tarjeta, { venceEn: null, resultado: { ...(tarjeta.resultado ?? {}), error: { motivo: reglas.resumenDeEscalada(cuerpo.motivo), categoria: cuerpo.categoria } } });
    return contestar(200, { ok: true, estado: "ERROR" });
  }
  tarjeta.estado = reglas.TRANSICIONES_DEL_TRABAJADOR[accion].a;
  tarjeta.venceEn = null;
  if (accion === "plan") Object.assign(tarjeta, { plan: reglas.planDeEntrada(cuerpo.plan), resultado: null });
  if (accion === "resultado") {
    tarjeta.resultado = reglas.resultadoDeEntrada(cuerpo);
    if (cuerpo.zonaProtegida) tarjeta.zonaProtegida = reglas.unirZonas(tarjeta.zonaProtegida, reglas.zonasDeEntrada(cuerpo.zonaProtegida));
    tarjeta.estado = reglas.destinoDelResultado({ ...tarjeta.resultado, zonaProtegida: tarjeta.zonaProtegida });
  }
  if (accion === "subida") tarjeta.resultado = { ...tarjeta.resultado, subida: { commit: cuerpo.commit, version: cuerpo.version, linkCommit: cuerpo.linkCommit, ...(cuerpo.vigilancia ? { vigilancia: reglas.vigilanciaDeEntrada(cuerpo.vigilancia) } : {}) } };
  if (accion === "error") {
    tarjeta.resultado = { ...(tarjeta.resultado ?? {}), error: { motivo: reglas.motivoDeEntrada(cuerpo.motivo) } };
    if (cuerpo.zonaProtegida) tarjeta.zonaProtegida = reglas.unirZonas(tarjeta.zonaProtegida, reglas.zonasDeEntrada(cuerpo.zonaProtegida));
  }
  return contestar(200, { ok: true, estado: tarjeta.estado });
});
await new Promise((resolver) => servidor.listen(0, "127.0.0.1", resolver));
const PUERTO = servidor.address().port;

const node = process.execPath;
const falso = (nombre) => path.join(AQUI, nombre);
// Las pruebas de siempre construyen con Claude y no miran el uso; las de los motores lo cambian en `extra`.
const crearConfig = (tiempos = {}, delRepo = {}, extra = {}) =>
  completarConfig({
    urlCrm: `http://127.0.0.1:${PUERTO}`,
    claveTrabajador: CLAVE,
    carpetaTrabajo: path.join(T, "trabajo"),
    comandoClaude: [node, falso("claude-falso.mjs")],
    comandoCodex: [node, falso("codex-falso.mjs")],
    motores: { planear: "claude", construir: "claude", revisar: "claude" },
    vigilarUsoMinutos: 0,
    // Las pruebas de siempre no esperan al PC (la espera tiene su propia prueba) y no vigilan sesiones quietas.
    limites: { esperaMaximaMinutos: 0 },
    atasco: { minutos: 0 },
    // La nube está apagada salvo en las pruebas que la prueban (nubeConfig).
    nube: { activa: false },
    ...extra,
    tiempos: { latidoSegundos: 1, planMinutos: 0.3, construirMinutos: 1, subirMinutos: 1, comandoMinutos: 1, ...tiempos },
    git: { nombre: "Trabajador de prueba", correo: "trabajador@x.co" },
    ssh: { comando: [node, falso("ssh-falso.mjs")], destino: "prueba@servidor-falso", psql: "psql -U postgres", logs: "logs-falso", estado: "estado-falso" },
    repos: {
      aizencrm: {
        ruta: REPO,
        ramaBase: "main",
        remoto: "origin",
        verificar: [[node, "verificar.mjs"]],
        pruebas: [[node, "-e", "console.log('pruebas ok')"]],
        lint: { comando: [node, "lint.mjs"] },
        carpetaMigraciones: "prisma/migrations",
        ensayoPglite: [node, "ensayo.mjs"],
        ensayoProduccion: { tablaGuia: "TarjetaTablero" },
        zonasProtegidas: { BOT_VENTAS: ["src/bot/**"], LIBRO_V3: ["src/agente-v3/**"], META_ADS: ["src/ads/**"], CHATS: ["src/chats/**"] },
        subida: {
          ciBuscar: [node, falso("gh-falso.mjs"), "buscar", "{commit}"],
          ciEsperar: [node, falso("gh-falso.mjs"), "esperar", "{run}"],
          urlVersion: `http://127.0.0.1:${PUERTO}/api/version`,
          campoVersion: "version",
          versionMinutos: 1,
        },
        ...delRepo,
      },
    },
  });

const registro = crearRegistro(path.join(T, "trabajo"), { consola: false, ocultar: [CLAVE] });
const config = crearConfig();
const crm = crearCrm(config);
const vuelta = (otraConfig = config) => unaVuelta({ crm, config: otraConfig, registro });
const leerLog = (archivoLog) =>
  fs.existsSync(archivoLog) ? fs.readFileSync(archivoLog, "utf8").trim().split(/\r?\n/).filter(Boolean).map((linea) => JSON.parse(linea)) : [];
const sinRestos = () => {
  const worktrees = g(REPO, "worktree", "list", "--porcelain").split(/\r?\n/).filter((linea) => linea.startsWith("worktree "));
  assert.equal(worktrees.length, 1, `quedaron worktrees: ${worktrees.join(", ")}`);
  const ramas = g(REPO, "branch", "--format=%(refname:short)").split(/\r?\n/).filter(Boolean);
  assert.deepEqual(ramas, ["main"], "no quedan ramas locales del trabajador");
};

try {
  await prueba("sin nada aprobado: no hace nada", async () => {
    assert.deepEqual(await vuelta(), { hizo: null, motivo: "nada" });
  });

  await prueba("clave equivocada: el CRM contesta 401 y el trabajador no hace nada", async () => {
    const otro = crearCrm({ ...config, claveTrabajador: "aizen_trab_otra" });
    await assert.rejects(unaVuelta({ crm: otro, config, registro }), (error) => error.status === 401);
  });

  // ── El camino feliz completo, con migración ──
  const feliz = nueva("Agregar tabla nueva [migracion]", "APROBADO");
  const mainAntes = shaDe("main");

  await prueba("APROBADO -> PLANEANDO -> PLAN_LISTO: claude en modo plan escribe el plan, con latidos", async () => {
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "planear");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(feliz);
    assert.equal(t.estado, "PLAN_LISTO");
    assert.match(t.plan, /^PLAN para "Agregar tabla nueva \[migracion\]"/);
    assert.ok(llamadas.some((l) => l.accion === "latido" && l.id === feliz), "dio al menos un latido");
    const [llamada] = leerLog(LOGS.claude).slice(-1);
    assert.equal(llamada.modo, "plan");
    assert.ok(llamada.argumentos.includes("-p"));
    // El título dice "migracion": toca la base, es difícil -> Opus, y la firma del plan lo dice.
    assert.equal(llamada.argumentos[llamada.argumentos.indexOf("--model") + 1], "opus");
    assert.match(t.plan, /Plan escrito con: Claude Code \(Opus\)\s*$/);
    assert.match(t.plan, /^RIESGO: BAJO — .+$/m, "el plan trae la línea RIESGO");
    assert.equal(shaDe("main"), mainAntes, "planear no toca main");
    sinRestos();
  });

  await prueba("PLAN_APROBADO -> EN_CURSO -> POR_REVISAR: construye, verifica, ensaya la migración y empuja SOLO la rama", async () => {
    tarjetas.get(feliz).estado = "PLAN_APROBADO"; // el dueño aprobó el plan
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(feliz);
    assert.equal(t.estado, "POR_REVISAR");
    const rama = `tablero/${feliz.slice(-8)}-agregar-tabla-nueva-migracion`;
    assert.equal(t.resultado.rama, rama);
    assert.equal(t.resultado.paso, true);
    assert.equal(t.resultado.linkRama, null, "el remoto de prueba no es GitHub");
    assert.equal(t.resultado.commit, shaDe(rama));
    assert.match(t.resultado.resumen, /RESUMEN: hice/);
    assert.match(t.resultado.resumen, /prisma\/migrations\/20261020130000_nueva\/migration\.sql/);
    assert.match(t.resultado.pruebas, /verificar\.mjs/);
    assert.match(t.resultado.pruebas, /lint sin errores nuevos/);
    assert.match(t.resultado.migracion, /PGlite: ok; producción \(magilus\) dentro de BEGIN…ROLLBACK: ok/);
    assert.equal(shaDe("main"), mainAntes, "construir NUNCA toca main");
    // Riesgo: manda los archivos que cambió y que la migración (aditiva) no tiene nada destructivo.
    const enviado = llamadas.findLast((l) => l.accion === "resultado" && l.id === feliz).cuerpo;
    assert.deepEqual(enviado.archivos, ["prisma/migrations/20261020130000_nueva/migration.sql"]);
    assert.deepEqual(enviado.migracionDestructiva, []);
    assert.ok(!/destructivo/.test(t.resultado.pruebas));
    assert.deepEqual(ramasDelRemoto().sort(), ["main", rama].sort());
    // Claude con acceptEdits, herramientas acotadas y sin push.
    const [llamada] = leerLog(LOGS.claude).slice(-1);
    assert.equal(llamada.modo, "acceptEdits");
    assert.equal(llamada.argumentos[llamada.argumentos.indexOf("--model") + 1], "sonnet", "construir siempre con Sonnet");
    assert.deepEqual(t.resultado.modelo, { plan: "Opus", construir: "sonnet", subagentes: "sonnet" }, "la tarjeta guarda qué modelo hizo cada paso");
    const prohibidas = llamada.argumentos.slice(llamada.argumentos.indexOf("--disallowedTools") + 1);
    assert.ok(prohibidas.includes("Bash(git push:*)"));
    assert.ok(prohibidas.includes("Bash(npx prisma migrate:*)"));
    // El ensayo en "producción": localizó la base con la tabla y corrió BEGIN…ROLLBACK, sin COMMIT.
    const ssh = leerLog(LOGS.ssh);
    const ensayo = ssh.find((l) => l.entrada.includes("CREATE TABLE"));
    assert.match(ensayo.remoto, /-v ON_ERROR_STOP=1 -q -d magilus$/);
    assert.match(ensayo.entrada, /SET lock_timeout = '5s';\nBEGIN;\n/);
    assert.match(ensayo.entrada, /ROLLBACK;\n$/);
    assert.ok(!/^COMMIT;$/m.test(ensayo.entrada));
    sinRestos();
  });

  await prueba("SUBIENDO -> HECHO: rebase, verifica de nuevo, push a main, espera el CI y comprueba la versión", async () => {
    tarjetas.get(feliz).estado = "SUBIENDO"; // el sí final del dueño (pendiente: sin candado)
    tarjetas.get(feliz).venceEn = null;
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "subir");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(feliz);
    assert.equal(t.estado, "HECHO");
    assert.notEqual(shaDe("main"), mainAntes);
    assert.equal(t.resultado.subida.commit, shaDe("main"));
    assert.equal(t.resultado.subida.version, shaDe("main"));
    assert.ok(fs.existsSync(path.join(REMOTO)) && g(REPO, "fetch", "origin") === "");
    assert.ok(g(REPO, "show", "origin/main:prisma/migrations/20261020130000_nueva/migration.sql").includes("CREATE TABLE"));
    const gh = leerLog(LOGS.gh);
    assert.deepEqual(gh.slice(-2), [
      { accion: "buscar", valor: shaDe("main") },
      { accion: "esperar", valor: "4242" },
    ]);
    sinRestos();
  });

  // ── Los ERROR ──
  await prueba("ERROR por tiempo: Claude no termina el plan, se le mata el proceso y queda ERROR", async () => {
    const id = nueva("Plan que no termina [lento]", "APROBADO");
    const inicio = Date.now();
    const resultado = await vuelta(crearConfig({ planMinutos: 0.08 }));
    assert.equal(resultado.ok, false);
    assert.ok(Date.now() - inicio < 30_000, "no esperó los 10 minutos de Claude");
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /tardó más de|Se pasó del tiempo/);
    sinRestos();
  });

  await prueba("zona protegida: toca src/bot/, se marca BOT_VENTAS y queda POR_REVISAR esperando el sí (no sube sola)", async () => {
    const id = nueva("Cambiar el saludo [zona]", "PLAN_APROBADO", { plan: "El plan" });
    const mainAhora = shaDe("main");
    const resultado = await vuelta(crearConfig({}, { subirSolo: true }));
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.equal(t.resultado.subeSolo, false);
    assert.match(t.resultado.resumen, /espera tu sí \(zona BOT_VENTAS \(src\/bot\/respuesta\.ts\)\)/);
    assert.deepEqual(t.zonaProtegida, ["BOT_VENTAS"]);
    assert.equal(shaDe("main"), mainAhora, "no tocó main");
    sinRestos();
  });

  await prueba("con la zona aprobada en la pantalla, el mismo cambio sí pasa", async () => {
    const id = nueva("Cambiar el saludo aprobado [zona]", "PLAN_APROBADO", { plan: "El plan", zonaProtegida: ["BOT_VENTAS"] });
    const resultado = await vuelta();
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    sinRestos();
  });

  // ── Zonas que suben solas (24-oct-2026): bot de ventas, Meta Ads y libro V3 ──
  const SOLAS = { subirSolo: true, zonasQueSubenSolas: ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"], vigilancia: { minutos: 0.02, cadaSegundos: 0.3, maxErroresNuevos: 2 } };
  const configSolas = () => crearConfig({}, SOLAS);
  const conteoLogs = path.join(T, "ssh.log.conteo-logs");
  const reiniciarLogs = () => fs.rmSync(conteoLogs, { force: true });

  await prueba("configuración: la vigilancia trae maxSubidaDeEnvios 1.5 y minEnviosParaComparar 5; un valor que no sirve usa el de por defecto", async () => {
    const con = (vigilancia) => completarConfig({ ...config, repos: { aizencrm: { ruta: REPO, vigilancia } } }).repos.aizencrm.vigilancia;
    assert.equal(con({}).maxSubidaDeEnvios, 1.5);
    assert.equal(con({}).minEnviosParaComparar, 5);
    assert.equal(con({ maxSubidaDeEnvios: 2, minEnviosParaComparar: 10 }).maxSubidaDeEnvios, 2);
    assert.equal(con({ maxSubidaDeEnvios: 2, minEnviosParaComparar: 10 }).minEnviosParaComparar, 10);
    assert.equal(con({ minEnviosParaComparar: "x" }).minEnviosParaComparar, 5);
    assert.throws(() => con({ maxSubidaDeEnvios: 0.5 }), /maxSubidaDeEnvios/);
  });

  await prueba("zonas que suben solas: la configuración exige ssh.logs y rutas de cada zona", async () => {
    const base = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, "..", "config.example.json"), "utf8"));
    assert.ok(Array.isArray(base.repos.aizencrm.zonasQueSubenSolas));
    assert.throws(() => completarConfig({ ...config, ssh: { ...config.ssh, logs: undefined }, repos: { aizencrm: { ...SOLAS, ruta: REPO, zonasProtegidas: { BOT_VENTAS: ["src/bot/**"] } } } }));
  });

  for (const [etiqueta, zona, archivo] of [
    ["bot de ventas", "BOT_VENTAS", "src/bot/respuesta.ts"],
    ["libro V3", "LIBRO_V3", "src/agente-v3/libro.ts"],
    ["Meta Ads (solo lectura)", "META_ADS", "src/ads/lectura.ts"],
    ["chats", "CHATS", "src/chats/bandeja.ts"],
  ]) {
    const marca = { BOT_VENTAS: "[solas-bot]", LIBRO_V3: "[solas-v3]", META_ADS: "[solas-ads]", CHATS: "[solas-chats]" }[zona];
    await prueba(`${etiqueta}: construye, queda SUBIENDO sola, sube a main, vigila y dice "Subió sola (zona …) — vigilancia OK"`, async () => {
      reiniciarLogs();
      const id = nueva(`Cambio de ${etiqueta} ${marca}`, "PLAN_APROBADO", { plan: "El plan" });
      const mainAhora = shaDe("main");
      const construccion = await vuelta(configSolas());
      assert.equal(construccion.ok, true, construccion.motivo);
      const t = tarjetas.get(id);
      assert.equal(t.estado, "SUBIENDO", "sube sola, sin el sí del dueño");
      assert.equal(t.resultado.subeSolo, true);
      assert.deepEqual(t.zonaProtegida, [zona]);
      assert.equal(shaDe("main"), mainAhora, "construir no toca main");
      const subida = await vuelta(configSolas());
      assert.equal(subida.hizo, "subir");
      assert.equal(subida.ok, true, subida.motivo);
      assert.equal(t.estado, "HECHO");
      assert.notEqual(shaDe("main"), mainAhora);
      assert.ok(g(REPO, "show", `origin/main:${archivo}`).length > 0, "el archivo llegó a main");
      assert.equal(t.resultado.subida.vigilancia.ok, true);
      assert.equal(t.resultado.subida.vigilancia.zona, zona);
      assert.ok(leerLog(LOGS.ssh).filter((l) => l.remoto === "logs-falso").length >= 2, "leyó los logs antes y durante la vigilancia");
      sinRestos();
    });
  }

  await prueba("zonas que suben solas: Meta Ads con daily_budget / ACTIVE queda POR_REVISAR esperando el sí (gasto)", async () => {
    const id = nueva("Subir presupuesto [solas-ads-gasto]", "PLAN_APROBADO", { plan: "El plan" });
    const mainAhora = shaDe("main");
    const resultado = await vuelta(configSolas());
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.equal(t.resultado.subeSolo, false);
    assert.match(t.resultado.esperaPor, /gasto en Meta Ads \(daily_budget, pasa algo a ACTIVE\)/);
    assert.match(t.resultado.pruebas, /espera tu sí \(gasto en Meta Ads/);
    assert.equal(shaDe("main"), mainAhora);
    sinRestos();
  });

  await prueba("zonas que suben solas: un plan con la línea GASTO EN META ADS espera aunque el código no tenga las palabras", async () => {
    const id = nueva("Cambio de anuncios [solas-ads]", "PLAN_APROBADO", { plan: "GASTO EN META ADS: crea una campaña nueva\nEl plan" });
    const resultado = await vuelta(configSolas());
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    assert.match(tarjetas.get(id).resultado.esperaPor, /el plan lo declara/);
    sinRestos();
  });

  await prueba("zonas que suben solas: libro V3 sin la simulación V3 y bot sin la prueba de mensajes esperan el sí", async () => {
    const v3 = nueva("Libro sin simular [solas-v3-sin]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(v3).estado, "POR_REVISAR");
    assert.match(tarjetas.get(v3).resultado.esperaPor, /falta la simulación V3/);
    const bot = nueva("Bot sin probar [solas-bot-sin]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(bot).estado, "POR_REVISAR");
    assert.match(tarjetas.get(bot).resultado.esperaPor, /mensajes nuevos a clientes/);
    sinRestos();
  });

  await prueba("zonas que suben solas: un envío nuevo de mensaje en el bot que el plan no menciona no sube solo", async () => {
    const id = nueva("Bot con aviso [solas-bot] [solas-bot-envio]", "PLAN_APROBADO", { plan: "Cambiar el saludo." });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    assert.match(tarjetas.get(id).resultado.esperaPor, /envío de mensaje que el plan no menciona/);
    sinRestos();
  });

  await prueba("zonas que suben solas: CHATS sin la confirmación 'sin mensajes nuevos a clientes' espera el sí del dueño", async () => {
    const id = nueva("Cambio en chats [solas-chats-sin]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    assert.equal(tarjetas.get(id).resultado.subeSolo, false);
    assert.match(tarjetas.get(id).resultado.esperaPor, /chats no mandan mensajes nuevos a clientes/);
    assert.deepEqual(tarjetas.get(id).zonaProtegida, ["CHATS"]);
    sinRestos();
  });

  await prueba("zonas que suben solas: un envío nuevo en src/chats espera el sí aunque el plan lo mencione", async () => {
    const id = nueva("Chats con aviso [solas-chats-envio]", "PLAN_APROBADO", { plan: "Se enviará un mensaje nuevo al cliente." });
    const mainAhora = shaDe("main");
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    assert.match(tarjetas.get(id).resultado.esperaPor, /envío de mensaje en chats/);
    assert.equal(shaDe("main"), mainAhora);
    sinRestos();
  });

  await prueba("zonas que suben solas: si en la vigilancia aparecen errores nuevos, se deshace con un commit nuevo (sin force-push) y queda 'Revertida'", async () => {
    reiniciarLogs();
    const id = nueva("Bot que rompe [solas-bot]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(id).estado, "SUBIENDO");
    const antes = shaDe("main");
    process.env.SSH_FALSO_ERRORES = "1";
    let resultado;
    try {
      resultado = await vuelta(configSolas());
    } finally {
      delete process.env.SSH_FALSO_ERRORES;
    }
    assert.equal(resultado.ok, false);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, /Revertida|error\(es\) nuevo\(s\)/);
    // main tiene el commit de la tarjeta Y encima un revert nuevo (historia intacta: sin force-push).
    g(REPO, "fetch", "origin");
    const log = g(REPO, "log", "--format=%s", "-8", "origin/main");
    assert.match(log, /^revert: deshacer [0-9a-f]{10} \(la vigilancia de 30 min vio una falla\)/m);
    assert.notEqual(shaDe("main"), antes, "main avanzó con el revert");
    assert.equal(g(REPO, "merge-base", "--is-ancestor", antes, "origin/main"), "", "el commit subido sigue en la historia de main");
    assert.equal(llamadas.findLast((l) => l.accion === "error" && l.id === id).cuerpo.reversion.ok, true, "el CRM supo de la reversión");
    assert.ok(llamadas.some((l) => l.accion === "aviso" && l.cuerpo.tipo === "necesita" && /Bot que rompe/.test(l.cuerpo.texto)), "avisó al dueño con tipo necesita");
    assert.match(llamadas.findLast((l) => l.accion === "error" && l.id === id).cuerpo.motivo, /[Rr]evertida/);
    sinRestos();
  });

  const cortaPorEnvios = async (variable, patron, titulo, config = configSolas()) => {
    reiniciarLogs();
    const id = nueva(titulo, "PLAN_APROBADO", { plan: "El plan", moderno: titulo.includes("[moderno]") });
    assert.equal((await vuelta(config)).ok, true);
    assert.equal(tarjetas.get(id).estado, "SUBIENDO");
    const antes = shaDe("main");
    const avisos = llamadas.filter((l) => l.accion === "aviso").length;
    process.env[variable] = "1";
    let resultado;
    try {
      resultado = await vuelta(config);
    } finally {
      delete process.env[variable];
    }
    assert.equal(resultado.ok, false);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, patron);
    g(REPO, "fetch", "origin");
    assert.match(g(REPO, "log", "--format=%s", "-8", "origin/main"), /^revert: deshacer [0-9a-f]{10} \(la vigilancia de 30 min vio una falla\)/m);
    assert.equal(g(REPO, "merge-base", "--is-ancestor", antes, "origin/main"), "", "el commit subido sigue en la historia de main (sin force-push)");
    // La reversión avisa al dueño: tipo "necesita", con el motivo y los commits.
    const nuevos = llamadas.filter((l) => l.accion === "aviso").slice(avisos);
    assert.equal(nuevos.length, 1, "un solo aviso por reversión");
    assert.equal(nuevos[0].cuerpo.tipo, "necesita");
    assert.match(nuevos[0].cuerpo.texto, patron);
    assert.match(nuevos[0].cuerpo.texto, new RegExp(`Commit deshecho: [0-9a-f]{10}`));
    assert.match(nuevos[0].cuerpo.texto, /commit de la reversión: [0-9a-f]{10}/);
    sinRestos();
  };

  await prueba("zonas que suben solas: si los envíos de mensajes suben de golpe, la vigilancia deshace con un commit nuevo y avisa al dueño (necesita)", async () => {
    await cortaPorEnvios("SSH_FALSO_ENVIOS", /suben mucho los envíos de mensajes: 2 por minuto antes de subir y 20 ahora/, "Bot que repite mensajes [solas-bot]");
  });

  await prueba("zonas que suben solas: si los envíos fallan, la vigilancia deshace y avisa (tarjeta moderna, camino de manejarFalla)", async () => {
    await cortaPorEnvios("SSH_FALSO_ENVIOS_FALLIDOS", /suben los envíos de mensajes que fallan: 0 por minuto antes de subir y 1 ahora/, "Bot que falla al enviar [solas-bot] [moderno]");
  });

  await prueba("zonas que suben solas: por debajo de minEnviosParaComparar no corta aunque los envíos se dupliquen", async () => {
    reiniciarLogs();
    const id = nueva("Bot parejo [solas-bot]", "PLAN_APROBADO", { plan: "El plan" });
    const config = crearConfig({}, { ...SOLAS, vigilancia: { ...SOLAS.vigilancia, minEnviosParaComparar: 1000 } });
    assert.equal((await vuelta(config)).ok, true);
    process.env.SSH_FALSO_ENVIOS = "1";
    let resultado;
    try {
      resultado = await vuelta(config);
    } finally {
      delete process.env.SSH_FALSO_ENVIOS;
    }
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(id).estado, "HECHO");
    sinRestos();
  });

  await prueba("zonas que suben solas: mientras una tarjeta se vigila no sube otra (queda esperando su turno)", async () => {
    reiniciarLogs();
    const a = nueva("Bot A [solas-bot]", "PLAN_APROBADO", { plan: "El plan" });
    const b = nueva("Cambio común B", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(a).estado, "SUBIENDO");
    // Se aparta A un momento para que el Coordinador construya B (una SUBIENDO se toma antes que cualquier otra).
    tarjetas.get(a).estado = "POR_REVISAR";
    assert.equal((await vuelta(configSolas())).ok, true);
    tarjetas.get(a).estado = "SUBIENDO";
    assert.equal(tarjetas.get(b).estado, "SUBIENDO");
    const largo = crearConfig({}, { ...SOLAS, vigilancia: { minutos: 0.05, cadaSegundos: 0.5, maxErroresNuevos: 2 } });
    const t0 = Date.now();
    const primera = await crm.tomar({ maxParalelo: 2 });
    const segunda = await crm.tomar({ maxParalelo: 2 });
    assert.deepEqual([primera.hacer, segunda.hacer], ["subir", "subir"]);
    const [ra, rb] = await Promise.all([
      procesar({ crm, config: largo, registro }, primera.tarjeta, "subir"),
      procesar({ crm, config: largo, registro }, segunda.tarjeta, "subir"),
    ]);
    assert.equal(ra.ok, true, ra.motivo);
    assert.equal(rb.ok, true, rb.motivo);
    assert.ok(Date.now() - t0 >= 3000, "la segunda esperó a que la primera terminara su vigilancia de 3 s");
    assert.equal(tarjetas.get(a).estado, "HECHO");
    assert.equal(tarjetas.get(b).estado, "HECHO");
    sinRestos();
  });

  await prueba("riesgo: una migración con DROP y UPDATE manda migracionDestructiva, deja el aviso en pruebas y NO rompe el flujo", async () => {
    const id = nueva("Migración que borra [migracion-drop]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta();
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.equal(t.resultado.paso, true);
    const enviado = llamadas.findLast((l) => l.accion === "resultado" && l.id === id).cuerpo;
    assert.deepEqual(enviado.migracionDestructiva.sort(), ["DROP", "UPDATE"], "el comentario con DELETE y el texto con TRUNCATE no cuentan");
    assert.deepEqual(enviado.archivos, ["prisma/migrations/20261020140000_destructiva/migration.sql"]);
    assert.match(t.resultado.pruebas, /⚠ migración con cambios destructivos: DROP, UPDATE/);
    sinRestos();
  });

  await prueba("riesgo: sin migración, migracionDestructiva es [] y archivos trae lo que cambió", async () => {
    const id = nueva("Cambio chico sin migración", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta()).ok, true);
    const enviado = llamadas.findLast((l) => l.accion === "resultado" && l.id === id).cuerpo;
    assert.deepEqual(enviado.migracionDestructiva, []);
    assert.equal(enviado.archivos.length, 1);
    assert.match(enviado.archivos[0], /^cambio-\d+\.txt$/);
    sinRestos();
  });

  await prueba("ERROR si falla la verificación (tsc): el detalle queda en el motivo", async () => {
    const id = nueva("Romper los tipos [tsc]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /No pasó la verificación\. No se subió nada\.\nDetalle técnico[\s\S]*error TS2322/);
    sinRestos();
  });

  await prueba("ERROR si hay errores NUEVOS de lint (los que ya estaban en main no cuentan)", async () => {
    const id = nueva("Ensuciar el lint [lint]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.match(tarjetas.get(id).resultado.error.motivo, /1 error\(es\) nuevo\(s\):\nnuevo\.txt\|regla-falsa/);
    sinRestos();
  });

  /* ── GitHub Actions revisa la rama (ciDeRama): aizen1 no compila; si falla trae el log; si no responde, cae al modo de antes ── */
  const MARCA_LOCAL = path.join(T, "verificado-en-aizen1.txt");
  const delCi = (buscar, esperar, extra = {}) => ({
    verificar: [[node, "-e", `require("fs").appendFileSync(${JSON.stringify(MARCA_LOCAL)}, "x")`]],
    ciDeRama: { activo: true, buscar: [node, falso("gh-falso.mjs"), buscar, "{commit}"], esperar: [node, falso("gh-falso.mjs"), esperar, "{run}"], log: [node, falso("gh-falso.mjs"), "log", "{run}", "build"], minutos: 0.05, ...extra },
  });

  await prueba("ciDeRama: Actions pasa -> no se compila ni se prueba en aizen1, el ensayo de la migración SÍ corre y la rama ya está subida", async () => {
    fs.rmSync(MARCA_LOCAL, { force: true });
    const ghAntes = leerLog(LOGS.gh).length;
    const sshAntes = leerLog(LOGS.ssh).length;
    const id = nueva("Con Actions [migracion-drop]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta(crearConfig({}, delCi("buscar-rama", "esperar")));
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.match(t.resultado.pruebas, /^✔ verificado en GitHub Actions \(corrida 7001\)/);
    assert.ok(!fs.existsSync(MARCA_LOCAL), "aizen1 no corrió el build/tipos");
    assert.ok(!/lint sin errores nuevos/.test(t.resultado.pruebas), "el lint tampoco: lo hizo Actions");
    const enviado = llamadas.findLast((l) => l.accion === "resultado" && l.id === id).cuerpo;
    assert.equal(enviado.verificadoEn, "github-actions");
    assert.equal(enviado.linkWorkflow, undefined, "el remoto de prueba no es GitHub: no hay link");
    const gh = leerLog(LOGS.gh).slice(ghAntes);
    assert.deepEqual(gh.map((l) => l.accion), ["buscar-rama", "esperar"]);
    assert.equal(gh[0].valor, t.resultado.commit, "buscó la corrida del commit que subió");
    assert.ok(leerLog(LOGS.ssh).slice(sshAntes).some((l) => l.entrada.includes("ALTER TABLE")), "el ensayo de migración corrió por ssh en aizen1");
    assert.match(t.resultado.migracion, /producción \(magilus\) dentro de BEGIN…ROLLBACK: ok/);
    assert.equal(shaDe(t.resultado.rama), t.resultado.commit);
    sinRestos();
  });

  await prueba("ciDeRama: Actions falla en 'build' -> el error trae las líneas exactas del log del paso, categoría 'no compila'", async () => {
    fs.rmSync(MARCA_LOCAL, { force: true });
    const id = nueva("Actions falla [tsc]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta(crearConfig({}, delCi("buscar-rama", "esperar-falla")));
    assert.equal(resultado.ok, false);
    assert.equal(tarjetas.get(id).estado, "ERROR");
    const motivo = tarjetas.get(id).resultado.error.motivo;
    assert.match(motivo, /^No compiló: falló en GitHub Actions \(paso: Build; corrida 7001/);
    assert.match(motivo, /Líneas que fallaron:[\s\S]*Type error: Property 'colorFalso' does not exist on type 'Tarjeta'/);
    assert.match(motivo, /Últimas 30 líneas:\n\s*> next build/, "las líneas sin el prefijo del log de gh");
    assert.ok(!/2026-10-26T10:00/.test(motivo), "sin el prefijo job/paso/hora");
    assert.ok(!fs.existsSync(MARCA_LOCAL), "no se compiló en aizen1 para repetir lo que ya falló");
    const intento = llamadas.findLast((l) => l.id === id && l.cuerpo?.categoria)?.cuerpo;
    if (intento) assert.equal(intento.categoria, "no_compila");
    sinRestos();
  });

  await prueba("ciDeRama: si no aparece la corrida en el tiempo, se compila en aizen1 como hoy y la nota queda en la tarjeta", async () => {
    fs.rmSync(MARCA_LOCAL, { force: true });
    const id = nueva("Sin Actions", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta(crearConfig({}, delCi("buscar-nada", "esperar", { minutos: 0.03 })));
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.match(t.resultado.pruebas, /^⚠ Actions no respondió en 0\.03 min: se compiló en aizen1/);
    assert.ok(fs.existsSync(MARCA_LOCAL), "aizen1 sí compiló");
    assert.match(t.resultado.pruebas, /lint sin errores nuevos/, "y midió el lint de main para comparar");
    const enviado = llamadas.findLast((l) => l.accion === "resultado" && l.id === id).cuerpo;
    assert.equal(enviado.verificadoEn, "aizen1");
    sinRestos();
  });

  await prueba("ciDeRama apagado: todo igual que hoy (no se llama a gh y aizen1 compila)", async () => {
    fs.rmSync(MARCA_LOCAL, { force: true });
    const ghAntes = leerLog(LOGS.gh).length;
    const id = nueva("Con Actions apagado", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta(crearConfig({}, delCi("buscar-rama", "esperar", { activo: false })));
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.ok(fs.existsSync(MARCA_LOCAL));
    assert.equal(leerLog(LOGS.gh).length, ghAntes, "no consultó a gh");
    assert.ok(!/GitHub Actions/.test(tarjetas.get(id).resultado.pruebas));
    sinRestos();
  });

  await prueba("ERROR si Claude no cambió nada", async () => {
    const id = nueva("No hacer nada [nada]", "PLAN_APROBADO", { plan: "El plan" });
    await vuelta();
    assert.match(tarjetas.get(id).resultado.error.motivo, /no cambió ningún archivo/);
    sinRestos();
  });

  await prueba("ERROR al subir si la rama choca con main (conflicto): main no cambia", async () => {
    const id = nueva("Tocar el archivo compartido [conflicto]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta()).ok, true);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    // Mientras tanto alguien cambió lo mismo en main (la copia del repo no la tocó el trabajador: está atrás).
    g(REPO, "pull", "--ff-only", "origin", "main");
    archivo("conflicto.txt", "lo nuevo de main\n");
    g(REPO, "commit", "-am", "otro cambio en main");
    g(REPO, "push", "origin", "main");
    const mainAhora = shaDe("main");
    Object.assign(tarjetas.get(id), { estado: "SUBIENDO", venceEn: null });
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /conflicto en el rebase/);
    assert.equal(shaDe("main"), mainAhora, "no subió nada");
    sinRestos();
  });

  /* ── Reparar solo (24-oct-2026): diagnosticar, reparar, partir, esperar y escalar ── */
  const soltarTodas = (...ids) => {
    for (const id of ids) Object.assign(tarjetas.get(id), { estado: "HECHO", venceEn: null });
  };
  const nuevaModerna = (titulo, estado = "PLAN_APROBADO", extra = {}) => nueva(titulo, estado, { plan: "El plan", moderno: true, ...extra });
  const ultimaDeClaude = (titulo) => leerLog(LOGS.claude).findLast((l) => l.titulo === titulo && l.modo === "acceptEdits");

  await prueba("lección A: si fallan las pruebas, el motivo trae la línea 'not ok 300' (no solo el principio) y la salida completa queda en un archivo", async () => {
    const id = nueva("Pruebas largas [pruebas-largas]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta(crearConfig({}, { pruebas: [[node, "pruebas-largas.mjs"]] }));
    assert.equal(resultado.ok, false);
    const motivo = tarjetas.get(id).resultado.error.motivo;
    assert.match(motivo, /^Fallaron las pruebas que ya existen/);
    assert.match(motivo, /Líneas que fallaron:[\s\S]*not ok 300 - la prueba que falló/);
    assert.match(motivo, /ok 400 - prueba 400/, "y el final de la salida");
    const ruta = motivo.match(/Salida completa: (.+)/)?.[1]?.trim();
    assert.ok(ruta && fs.existsSync(ruta), "la salida completa se guardó en un archivo");
    const lineas = fs.readFileSync(ruta, "utf8").trim().split(/\r?\n/);
    assert.equal(lineas.length, 400);
    assert.equal(lineas[299], "not ok 300 - la prueba que falló");
    sinRestos();
  });

  await prueba("falla -> diagnóstico -> reparar: el siguiente intento recibe la causa y el error exacto, y construir no usa subagentes", async () => {
    const id = nuevaModerna("Se rompe una vez [tsc-una-vez]");
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    assert.equal(resultado.accion, "reparar");
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO", "vuelve a la fila, no queda en ERROR");
    assert.equal(t.reparaciones, 1);
    assert.equal(t.intentosLista.length, 1);
    assert.deepEqual([t.intentosLista[0].categoria, t.intentosLista[0].accion, t.intentosLista[0].etapa], ["no_compila", "reparar", "construir"]);
    assert.match(t.intentosLista[0].causa, /compil/i);
    assert.match(t.intentosLista[0].error, /error TS2322/);
    // Construir no lanza subagentes: Agent y Task bloqueados, no permitidos, y el prompt lo prohíbe.
    const primera = ultimaDeClaude("Se rompe una vez [tsc-una-vez]");
    const permitidas = primera.argumentos.slice(primera.argumentos.indexOf("--allowedTools") + 1, primera.argumentos.indexOf("--disallowedTools"));
    const prohibidas = primera.argumentos.slice(primera.argumentos.indexOf("--disallowedTools") + 1);
    assert.ok(!permitidas.includes("Agent") && !permitidas.includes("Task"));
    assert.ok(prohibidas.includes("Agent") && prohibidas.includes("Task"));
    assert.match(primera.prompt, /PROHIBIDO lanzar subagentes/);
    // Segundo intento: recibe la causa y el error exacto, y corrige eso.
    assert.equal((await vuelta()).ok, true);
    const segunda = ultimaDeClaude("Se rompe una vez [tsc-una-vez]");
    assert.notEqual(segunda.prompt, primera.prompt, "no repite lo mismo");
    assert.match(segunda.prompt, /REPARACIÓN 1 de 3/);
    assert.match(segunda.prompt, /La causa fue: .*compil/i);
    assert.match(segunda.prompt, /error TS2322/);
    assert.match(segunda.prompt, /Corrige solo eso/);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    soltarTodas(id);
    sinRestos();
  });

  await prueba("3 reparaciones que no alcanzan: queda en ERROR con un resumen de 3 líneas (qué falló, qué se probó, qué necesita)", async () => {
    const id = nuevaModerna("Nunca compila [tsc]");
    for (const esperado of ["reparar", "reparar", "reparar", "escalar"]) {
      const resultado = await vuelta();
      assert.equal(resultado.accion, esperado);
    }
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.reparaciones, 3);
    assert.deepEqual(t.intentosLista.map((i) => i.accion), ["reparar", "reparar", "reparar", "escalar"]);
    const lineas = t.resultado.error.motivo.split("\n");
    assert.equal(lineas.length, 3, "máximo 3 líneas");
    assert.match(lineas[0], /^Qué falló:/);
    assert.match(lineas[1], /^Qué se probó:.*3 reparaciones/);
    assert.match(lineas[2], /^Qué necesita de ti:/);
    assert.equal(t.resultado.error.categoria, "no_compila");
    assert.match(t.intentosLista[3].error, /error TS2322/, "el error exacto queda en el intento");
    sinRestos();
  });

  await prueba("límite de Claude: espera sin contar como intento ni reparación y sin ERROR", async () => {
    const id = nuevaModerna("Sin cupo [limite]");
    const resultado = await vuelta();
    assert.equal(resultado.limiteDeUso, true);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO");
    assert.equal(t.reparaciones ?? 0, 0);
    assert.equal(t.intentos, 0, "no gastó el intento");
    assert.deepEqual([t.intentosLista[0].categoria, t.intentosLista[0].accion, t.intentosLista[0].cuentaComoIntento], ["limite_claude", "esperar", false]);
    assert.ok(!llamadas.some((l) => l.accion === "error" && l.id === id));
    soltarTodas(id);
  });

  await prueba("tarea grande: se pasa del tiempo con muchos archivos y se parte en partes que dependen una de otra", async () => {
    const id = nuevaModerna("Tarea enorme [muchos-archivos]");
    const resultado = await vuelta(crearConfig({ construirMinutos: 0.08 }));
    assert.equal(resultado.accion, "partir", resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "EN_CURSO", "la madre espera sus partes");
    assert.equal(t.resultado.partida.hijas.length, 2);
    const [primera, segunda] = t.resultado.partida.hijas;
    assert.deepEqual(tarjetas.get(primera).dependeDe, []);
    assert.deepEqual(tarjetas.get(segunda).dependeDe, [primera], "la parte 2 depende de la 1");
    assert.equal(t.intentosLista.at(-1).accion, "partir");
    assert.equal(t.intentosLista.at(-1).cuentaComoIntento, false);
    // En orden: la primera parte arranca; la segunda espera a que la primera esté HECHO.
    const siguiente = await vuelta();
    assert.equal(siguiente.tarjetaId, primera);
    assert.equal(tarjetas.get(segunda).estado, "APROBADO");
    soltarTodas(id, primera, segunda);
    sinRestos();
  });

  await prueba("dependencias: Marketing no arranca hasta que Ventas esté HECHO (aunque sea más vieja)", async () => {
    const marketing = nueva("Agente de Marketing", "APROBADO");
    const ventas = nueva("Agente de Ventas", "APROBADO");
    tarjetas.get(marketing).dependeDe = [ventas];
    const primera = await vuelta();
    assert.equal(primera.tarjetaId, ventas, "arranca Ventas, no Marketing");
    assert.equal(tarjetas.get(marketing).estado, "APROBADO");
    assert.deepEqual(await vuelta(), { hizo: null, motivo: "nada" }, "con Ventas sin terminar, Marketing espera");
    soltarTodas(ventas);
    const despues = await vuelta();
    assert.equal(despues.tarjetaId, marketing, "con Ventas HECHO, Marketing arranca");
    soltarTodas(marketing);
  });

  await prueba("sesión atascada: sin tocar archivos ni CPU se corta, se diagnostica y, si se repite, se parte la tarea", async () => {
    const id = nuevaModerna("Se queda esperando [atascado]");
    // El reloj de la prueba va acelerado: 15 min -> 2 s, revisando cada 0.3 s.
    const rapida = crearConfig({}, {}, { atasco: { minutos: 0.035, revisarCadaSegundos: 0.3, cpuMinimaSegundos: 30 } });
    const inicio = Date.now();
    const primera = await vuelta(rapida);
    assert.ok(Date.now() - inicio < 60_000, "no esperó los 2 minutos de la sesión quieta");
    assert.equal(primera.categoria, "sesion_atascada");
    assert.equal(primera.accion, "reparar");
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO");
    assert.match(t.intentosLista[0].causa, /atascada|segundo plano/i);
    // El siguiente intento recibe la orden de no esperar nada.
    const segunda = await vuelta(rapida);
    assert.match(ultimaDeClaude("Se queda esperando [atascado]").prompt, /no lances subagentes ni dejes nada en segundo plano/);
    assert.equal(segunda.categoria, "sesion_atascada");
    assert.equal(segunda.accion, "partir", "se atascó otra vez: la tarea se parte");
    assert.equal(t.resultado.partida.hijas.length, 2);
    soltarTodas(id, ...t.resultado.partida.hijas);
    sinRestos();
  });

  await prueba("una a la vez: con una tarjeta trabajando (candado vigente) /tomar contesta ocupado", async () => {
    const id = nueva("Ocupada", "PLANEANDO", { venceEn: Date.now() + 60_000 });
    nueva("Espera su turno", "APROBADO");
    assert.deepEqual(await vuelta(), { hizo: null, motivo: "ocupado" });
    tarjetas.get(id).estado = "HECHO";
  });

  await prueba("vencida: si el latido dice 409, se corta lo que corre y NO se llama /error (el CRM la pasa a ERROR)", async () => {
    // La que esperaba su turno se planea normal; después, una que el CRM da por vencida a mitad del plan.
    assert.equal((await vuelta()).ok, true);
    const id = nueva("Plan largo [medio]", "APROBADO");
    latidoVencido.add(id);
    const inicio = Date.now();
    const resultado = await vuelta();
    assert.equal(resultado.vencida, true);
    assert.ok(Date.now() - inicio < 6000, "cortó a Claude antes de los 6 s");
    assert.ok(!llamadas.some((l) => l.accion === "error" && l.id === id), "no llamó /error");
    assert.equal(tarjetas.get(id).estado, "PLANEANDO");
    sinRestos();
  });

  /* ── En paralelo (22-oct-2026) ── */
  const sinMedir = { medir: () => ({ cpu: 0, memoria: 0 }), parar: () => undefined };
  const planificar = (otraConfig, medidor = sinMedir) => crearPlanificador({ crm, config: otraConfig, registro, medidor });
  /** Corre el bucle del trabajador (llenar + esperar) hasta que se cumpla `listo`. */
  async function correrHasta(planificador, listo, ms = 60_000) {
    const limite = Date.now() + ms;
    while (!listo()) {
      if (Date.now() > limite) {
        // Para saber dónde se quedó: el estado de cada tarjeta viva y lo último que se le pidió al CRM.
        const estados = [...tarjetas.values()].filter((t) => !["HECHO", "ERROR"].includes(t.estado) || Date.now() - (t.venceEn ?? 0) < ms).map((t) => `${t.titulo}: ${t.estado}`);
        throw new Error(`no terminó a tiempo\n${estados.join("\n")}\núltimas llamadas: ${llamadas.slice(-8).map((l) => `${l.accion} ${l.id ?? ""}`).join(", ")}\ncorriendo: ${JSON.stringify(planificador.estado().tareas.map((t) => [t.titulo, t.etapa]))}`);
      }
      await planificador.llenar();
      await planificador.esperar(300);
    }
    await planificador.esperarTodas();
  }
  const enParalelo = crearConfig({}, { subirSolo: true });
  const reiniciarALaVez = () => {
    for (const clave of Object.keys(aLaVez)) delete aLaVez[clave];
  };

  await prueba("paralelo: dos del mismo repo en módulos distintos se planean y construyen a la vez, y suben a main de a una", async () => {
    for (const t of tarjetas.values()) if (!["HECHO", "ERROR", "POR_REVISAR", "PLAN_LISTO"].includes(t.estado)) t.estado = "HECHO";
    reiniciarALaVez();
    const mainAntes = shaDe("main");
    const a = nueva("Cambio en ventas [mod:ventas]", "APROBADO");
    const b = nueva("Cambio en coach [mod:coach]", "APROBADO");
    const planificador = planificar({ ...enParalelo, maxParalelo: 3 });
    await correrHasta(planificador, () => [a, b].every((id) => tarjetas.get(id).estado === "PLAN_LISTO"));
    assert.equal(aLaVez.PLANEANDO, 2, "los dos planes a la vez");
    for (const id of [a, b]) tarjetas.get(id).estado = "PLAN_APROBADO"; // el dueño aprobó los planes
    await correrHasta(planificador, () => [a, b].every((id) => tarjetas.get(id).estado === "HECHO"), 120_000);
    assert.equal(aLaVez.EN_CURSO, 2, "construyó las dos a la vez");
    assert.equal(aLaVez.SUBIENDO, 1, "la cola de subida: de a una");
    const enMain = g(REPO, "log", "--format=%s", `${mainAntes}..origin/main`);
    assert.match(enMain, /Cambio en ventas/);
    assert.match(enMain, /Cambio en coach/);
    sinRestos();
    planificador.parar();
  });

  await prueba("paralelo: dos que tocan el mismo módulo NO se construyen a la vez (la segunda espera en fila)", async () => {
    reiniciarALaVez();
    const plan = "PLAN\n5. Archivos: src/coach/cambio.ts";
    const a = nueva("Coach uno [mod:coach]", "PLAN_APROBADO", { plan });
    const b = nueva("Coach dos [mod:coach]", "PLAN_APROBADO", { plan });
    const planificador = planificar({ ...enParalelo, maxParalelo: 3 });
    await correrHasta(planificador, () => [a, b].every((id) => tarjetas.get(id).estado === "HECHO"), 120_000);
    assert.equal(aLaVez.EN_CURSO, 1, "una construye y la otra espera");
    assert.equal(aLaVez.total, 1);
    sinRestos();
    planificador.parar();
  });

  await prueba("paralelo: con la CPU sobre el límite no abre otra sesión (la que corre sigue)", async () => {
    reiniciarALaVez();
    const a = nueva("Plan uno [mod:x]", "APROBADO");
    const b = nueva("Plan dos [mod:y]", "APROBADO");
    const planificador = planificar({ ...enParalelo, maxParalelo: 3 }, { medir: () => ({ cpu: 99, memoria: 10 }), parar: () => undefined });
    await correrHasta(planificador, () => [a, b].every((id) => tarjetas.get(id).estado === "PLAN_LISTO"));
    assert.equal(aLaVez.total, 1, "de a una mientras la CPU está alta");
    planificador.parar();
  });

  await prueba("latido: planificador.estado() dice qué corre (etapa, dónde, modelo, intento) y que espera al PC cuando está lleno", async () => {
    reiniciarALaVez();
    const suyas = [nueva("Plan uno [mod:x]", "APROBADO"), nueva("Plan dos [mod:y]", "APROBADO")];
    const planificador = planificar({ ...enParalelo, maxParalelo: 3 }, { medir: () => ({ cpu: 99, memoria: 10 }), parar: () => undefined });
    assert.deepEqual(planificador.estado().tareas, []);
    await planificador.llenar();
    const estado = planificador.estado();
    assert.equal(estado.tareas.length, 1, "la segunda no se abre con el PC lleno");
    const [tarea] = estado.tareas;
    assert.equal(tarea.etapa, "planeando");
    assert.equal(tarea.lugar, "aizen1");
    assert.equal(tarea.motor, "claude");
    assert.ok(["opus", "sonnet"].includes(tarea.modelo), `modelo ${tarea.modelo}`);
    assert.equal(tarea.reparacion, 0);
    assert.ok(Number.isFinite(Date.parse(tarea.inicioEn)));
    assert.equal(estado.esperandoPc, true);
    assert.match(estado.motivoEspera, /CPU 99 %/);
    assert.equal(estado.uso.limiteAlcanzado, false);
    await planificador.esperarTodas();
    assert.deepEqual(planificador.estado().tareas, []);
    for (const id of suyas) tarjetas.get(id).estado = "HECHO"; // que no estorben a la prueba que sigue
    planificador.parar();
  });

  await prueba("límite de uso de Claude: la tarjeta se suelta SIN error (vuelve a APROBADO); con respaldoCodex, mientras Claude está en pausa, planea Codex", async () => {
    const id = nueva("Plan sin cupo [limite]", "APROBADO");
    const otra = nueva("Espera la pausa [mod:z]", "APROBADO");
    const planificador = planificar({
      ...enParalelo,
      maxParalelo: 1,
      motores: { ...enParalelo.motores, respaldoCodex: true },
      tiempos: { ...enParalelo.tiempos, pausaLimiteMinutos: 10 },
    });
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "APROBADO");
    assert.equal(t.intentos, 0, "no gastó el intento");
    assert.match(t.soltada, /Claude llegó a su límite de uso/);
    assert.ok(!llamadas.some((l) => l.accion === "error" && l.id === id), "no llamó /error");
    const claudeAntes = leerLog(LOGS.claude).length;
    await planificador.llenar();
    await planificador.esperarTodas();
    assert.equal(tarjetas.get(id).estado, "PLAN_LISTO");
    assert.match(tarjetas.get(id).plan, /\(Codex\)[\s\S]*Plan escrito con: Codex$/);
    assert.equal(leerLog(LOGS.claude).length, claudeAntes, "en pausa no llama a Claude");
    for (const x of [id, otra]) tarjetas.get(x).estado = "HECHO";
    planificador.parar();
  });

  /* ── Motores: Codex construye, Claude planea y revisa (23-oct-2026) ── */
  const conCodex = (motores = {}, extra = {}) =>
    crearConfig({}, {}, { motores: { planear: "claude", construir: "codex", revisar: "claude", ...motores }, ...extra });

  await prueba("codex: construye con `codex exec` (sandbox workspace-write, sin bypass), Claude revisa y el resultado dice el motor", async () => {
    const id = nueva("Cambio hecho por Codex", "PLAN_APROBADO", { plan: "El plan\n\nPlan escrito con: Claude Code" });
    const mainAhora = shaDe("main");
    const resultado = await vuelta(conCodex());
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.deepEqual(t.resultado.motor, { plan: "claude", construir: "codex", revisar: "claude" });
    assert.match(t.resultado.resumen, /RESUMEN: Codex hizo "Cambio hecho por Codex"/);
    assert.match(t.resultado.resumen, /Revisión \(claude\): REVISIÓN: todo bien \(claude\)/);
    assert.match(t.resultado.resumen, /Motores: plan claude · construir codex · revisar claude \(Sonnet\)\./);
    assert.deepEqual(t.resultado.modelo, { revisar: "sonnet" }, "con Codex solo se anota el modelo de Claude (la revisión)");
    assert.match(t.resultado.resumen, /cambio-codex-\d+\.txt/, "el commit lo hizo el trabajador con lo que escribió Codex");
    assert.equal(t.resultado.commit, shaDe(t.resultado.rama));
    assert.equal(shaDe("main"), mainAhora, "construir NUNCA toca main");
    const [llamada] = leerLog(LOGS.codex).slice(-1);
    assert.equal(llamada.argumentos[0], "exec");
    assert.equal(llamada.sandbox, "workspace-write");
    for (const opcion of ["--cd", "--skip-git-repo-check", "--output-last-message"]) assert.ok(llamada.argumentos.includes(opcion), opcion);
    assert.equal(llamada.argumentos.at(-1), "-", "el prompt va por stdin");
    assert.ok(!llamada.argumentos.some((a) => /dangerously|bypass/.test(a)));
    const [revisor] = leerLog(LOGS.claude).slice(-1);
    assert.equal(revisor.modo, "acceptEdits", "la revisión de Claude edita con herramientas acotadas");
    const texto = fs.readFileSync(path.join(T, "trabajo", "logs", fs.readdirSync(path.join(T, "trabajo", "logs"))[0]), "utf8");
    assert.match(texto, /construir: motor: codex/);
    sinRestos();
  });

  await prueba("codex con límite: la tarjeta se suelta SIN error y NO pasa a Claude", async () => {
    const id = nueva("Sin cupo en Codex [codex-limite]", "PLAN_APROBADO", { plan: "El plan" });
    const claudeAntes = leerLog(LOGS.claude).length;
    const resultado = await vuelta(conCodex());
    assert.equal(resultado.limiteDeUso, true);
    assert.equal(resultado.motor, "codex");
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO");
    assert.equal(t.intentos, 0, "no gastó el intento");
    assert.match(t.soltada, /Codex llegó a su límite de uso/);
    assert.ok(!llamadas.some((l) => l.accion === "error" && l.id === id), "no llamó /error");
    assert.equal(leerLog(LOGS.claude).length, claudeAntes, "no usó Claude");
    t.estado = "HECHO";
    sinRestos();
  });

  await prueba("codex con límite y respaldoClaude=true: construye Claude (desde la base limpia)", async () => {
    const id = nueva("Codex agotado, respaldo [codex-limite]", "PLAN_APROBADO", { plan: "El plan" });
    const resultado = await vuelta(conCodex({ respaldoClaude: true }));
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.equal(t.resultado.motor.construir, "claude");
    assert.equal(t.resultado.motor.revisar, undefined, "lo de Claude no pasa por otra revisión");
    assert.match(t.resultado.resumen, /RESUMEN: hice "Codex agotado/);
    const [llamada] = leerLog(LOGS.claude).slice(-1);
    assert.equal(llamada.modo, "acceptEdits");
    sinRestos();
  });

  await prueba("uso de Claude >= 80 %: planear pasa a Codex y NO sale ningún WhatsApp (ni por el umbral ni por no poder leer el uso); queda estado-uso.json", async () => {
    fs.writeFileSync(USO, "Current session: 83% used · resets Oct 23, 3:20pm (America/Bogota)\nCurrent week (all models): 6% used · resets Oct 30, 7am (America/Bogota)\n");
    const avisos = () => llamadas.filter((l) => l.accion === "aviso");
    const antes = avisos().length;
    const id = nueva("Plan con Claude alto", "APROBADO");
    // vigilarUsoMinutos chiquito: mira en cada llenar.
    const planificador = planificar({ ...conCodex({ respaldoCodex: true }, { vigilarUsoMinutos: 0.0001 }), maxParalelo: 1 });
    const claudeAntes = leerLog(LOGS.claude).filter((l) => !l.argumentos.includes("/usage")).length;
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_LISTO");
    assert.match(t.plan, /Plan escrito con: Codex$/);
    assert.equal(leerLog(LOGS.codex).at(-1).sandbox, "read-only", "Codex planea sin poder escribir");
    assert.equal(leerLog(LOGS.claude).filter((l) => !l.argumentos.includes("/usage")).length, claudeAntes, "no planeó con Claude");
    assert.ok(leerLog(LOGS.claude).some((l) => l.argumentos.join(" ").endsWith("-p --model haiku /usage")), "leyó el uso con claude -p /usage");
    assert.equal(avisos().length, antes, "el umbral no avisa por WhatsApp");
    const estadoUso = JSON.parse(fs.readFileSync(path.join(T, "trabajo", "estado-uso.json"), "utf8"));
    assert.equal(estadoUso.avisado.sesion.reinicio, "Oct 23, 3:20pm (America/Bogota)");
    const texto = fs.readFileSync(path.join(T, "trabajo", "logs", fs.readdirSync(path.join(T, "trabajo", "logs"))[0]), "utf8");
    assert.match(texto, /Claude al 83 % \(sesión\): planear y revisar pasan a Codex hasta 3:20pm/);
    // Uso ilegible: se trata como bajo y tampoco avisa.
    fs.rmSync(USO);
    await new Promise((r) => setTimeout(r, 20));
    await planificador.llenar();
    assert.equal(avisos().length, antes, "no poder leer el uso tampoco avisa por WhatsApp");
    await planificador.esperarTodas();
    planificador.parar();
  });

  await prueba("límite de Claude con todo en pausa: UN aviso tipo 'limite' con la hora de vuelta; si el CRM lo silencia se reintenta", async () => {
    const avisos = () => llamadas.filter((l) => l.accion === "aviso");
    const id = nueva("Plan sin cupo [limite]", "APROBADO");
    const configLimite = { ...enParalelo, maxParalelo: 1, tiempos: { ...enParalelo.tiempos, pausaLimiteMinutos: 10 } };
    const antes = avisos().length;
    const planificador = planificar(configLimite);
    await planificador.llenar();
    await planificador.esperarTodas();
    // Claude quedó en pausa y no hay otro motor: la siguiente pasada avisa.
    await planificador.llenar();
    assert.equal(avisos().length, antes + 1, "un aviso");
    const llamada = avisos().at(-1);
    assert.equal(llamada.cuerpo.tipo, "limite");
    assert.match(llamada.cuerpo.texto, /^⛔ Claude llegó a su límite de uso: Sistemas quedó en pausa\.\nVuelve a trabajar solo a las \d{1,2}:\d{2} [ap]\. ?m\.\nVer: /);
    assert.ok(llamada.cuerpo.texto.split("\n").length <= 3, "3 líneas o menos");
    await planificador.llenar();
    assert.equal(avisos().length, antes + 1, "la misma pausa no avisa otra vez");
    planificador.parar();
    // Silenciado (9 p. m. a 7 a. m.): no se da por avisado y se reintenta pasado el silencio.
    const otro = planificar(configLimite);
    avisosSilenciados = true;
    await otro.llenar();
    await otro.esperarTodas();
    await otro.llenar();
    assert.equal(avisos().length, antes + 2, "lo intentó una vez");
    avisosSilenciados = false;
    await otro.llenar();
    assert.equal(avisos().length, antes + 3, "pasado el silencio se reintenta y sale");
    await otro.llenar();
    assert.equal(avisos().length, antes + 3, "y no se repite");
    otro.parar();
    tarjetas.get(id).estado = "HECHO";
  });

  /* ── La nube (25-oct-2026): tareas grandes y de desborde con `claude --cloud` ── */

  const enlaceDe = (titulo) => `https://claude.ai/code/session_FALSA_${Buffer.from(titulo).toString("hex").slice(0, 24)}`;
  // La nube prendida, con el `gh` y el `claude --cloud` falsos. Sin terminal real (la prueba de "auto" lo cambia).
  const nubeConfig = (nube = {}, tiempos = {}) =>
    crearConfig({ construirNubeMinutos: 2, ...tiempos }, { subirSolo: true, github: "prueba/repo" }, {
      maxParalelo: 2,
      nube: { activa: true, maxTareas: 8, vigilarCadaSegundos: 0.3, esperaMinutos: 1, lanzarMinutos: 1, terminal: "sin-terminal", comandoGh: [node, falso("gh-falso.mjs")], ...nube },
    });
  const despejar = () => {
    for (const t of tarjetas.values()) if (!["HECHO", "ERROR", "POR_REVISAR", "PLAN_LISTO"].includes(t.estado)) t.estado = "HECHO";
    reiniciarALaVez();
  };
  const planDe = (modulo, archivos = 1) =>
    `PLAN\n4. Migración: no.\n5. Archivos:\n${Array.from({ length: archivos }, (_, i) => `src/${modulo}/parte-${i + 1}.ts`).join("\n")}\n6. Pruebas: verificar.mjs`;
  const llamadasALaNube = (desde) => leerLog(LOGS.claude).slice(desde).filter((l) => l.argumentos.includes("--cloud"));

  // La COLA QUE VENCE TARJETAS (26-oct-2026): "GitHub Actions 1/3" y "3/3" se tomaron para construir en aizen1 con la cola
  // de pasos pesados llena de verificaciones de la nube; esperaron ~90 min su npm ci y el candado del CRM venció con ERROR.
  await prueba("cola de pasos pesados con trabajo en fila: no se toma una tarjeta nueva para construir en aizen1 (espera sin candado)", async () => {
    despejar();
    const cola = crearColaPesada({ maximo: 1 });
    const soltarCorriendo = await cola.tomar({ prioridad: PRIORIDAD.verificar, que: "nube abcd npm ci" });
    const enFila = cola.tomar({ prioridad: PRIORIDAD.verificar, que: "nube efgh npm ci" });
    const id = nueva("Chica con la cola llena", "PLAN_APROBADO", { plan: planDe("colallena", 1) });
    const planificador = crearPlanificador({ crm, config: crearConfig(), registro, medidor: sinMedir, colaPesada: cola });
    await planificador.llenar();
    assert.equal(tarjetas.get(id).estado, "PLAN_APROBADO", "no se tomó (no tiene candado que se venza)");
    assert.equal(planificador.corriendo(), 0);
    const espera = planificador.estado().esperas.find((e) => e.tarjetaId === id);
    assert.match(espera?.motivo ?? "", /cola de pasos pesados de aizen1 tiene 1 en fila/);
    // Se vacía la fila: ahora sí se toma y se construye.
    soltarCorriendo();
    (await enFila)();
    await planificador.llenar();
    await correrHasta(planificador, () => !["PLAN_APROBADO", "EN_CURSO"].includes(tarjetas.get(id).estado));
    assert.notEqual(tarjetas.get(id).estado, "ERROR", tarjetas.get(id).resultado?.error?.motivo);
    await planificador.esperarTodas();
    planificador.parar();
    sinRestos();
  });

  await prueba("cola de pasos pesados: si una tarea nueva de aizen1 espera más de colaPesada.esperaMaximaMinutos para empezar, se suelta sin ERROR ni intento (antes de que venza en el CRM)", async () => {
    despejar();
    const cola = crearColaPesada({ maximo: 1 });
    const soltarCorriendo = await cola.tomar({ prioridad: PRIORIDAD.verificar, que: "nube abcd build" });
    const id = nueva("Espera demasiado su npm ci", "PLAN_APROBADO", { plan: planDe("colalarga", 1) });
    const otraConfig = crearConfig({}, { instalar: [node, "-e", "0"] }, { colaPesada: { maximo: 1, esperaMaximaMinutos: 0.02 } });
    const planificador = crearPlanificador({ crm, config: otraConfig, registro, medidor: sinMedir, colaPesada: cola });
    await planificador.llenar();
    assert.equal(planificador.corriendo(), 1, "se tomó: la cola tenía uno corriendo pero nadie en fila");
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO", "volvió a la fila del tablero");
    assert.equal(t.intentos, 0, "no contó el intento");
    assert.equal(t.resultado?.error, undefined, "sin ERROR");
    assert.match(t.soltada, /Esperé 0.02 min turno para .*instalar|Esperé 0.02 min turno para/);
    assert.equal(cola.estado().esperando, 0, "salió de la cola");
    soltarCorriendo();
    planificador.parar();
    despejar();
    sinRestos();
  });

  await prueba("nube: pushDeRama sin forzar no pisa lo que dejó la nube; con forzar (las ramas de aizen1) sí", async () => {
    const clon = path.join(T, "clon-push");
    execFileSync("git", ["clone", "--quiet", REMOTO, clon], { stdio: "ignore" });
    const rama = "tablero/prueba-sin-force";
    g(clon, "checkout", "--quiet", "-b", "de-la-nube", "origin/main");
    fs.writeFileSync(path.join(clon, "de-la-nube.txt"), "nube\n");
    g(clon, "add", "-A");
    g(clon, "commit", "-m", "de la nube");
    await pushDeRama(clon, "origin", rama, { forzar: false });
    const dejado = shaDe(rama);
    // Otra historia que sale de main (lo que haría aizen1 al rehacer la rama): sin --force no entra.
    g(clon, "checkout", "--quiet", "-b", "otra", "origin/main");
    fs.writeFileSync(path.join(clon, "otra.txt"), "otra\n");
    g(clon, "add", "-A");
    g(clon, "commit", "-m", "otra");
    await assert.rejects(pushDeRama(clon, "origin", rama, { forzar: false }), /rejected|non-fast-forward/);
    assert.equal(shaDe(rama), dejado, "la rama de la nube queda intacta");
    await pushDeRama(clon, "origin", rama);
    assert.notEqual(shaDe(rama), dejado, "las ramas de aizen1 siguen rehaciéndose con --force");
    await assert.rejects(pushDeRama(clon, "origin", "main", { forzar: false }), /no es una rama del Coordinador/);
    execFileSync("git", ["--git-dir", REMOTO, "branch", "-D", rama], { stdio: "ignore" });
  });

  await prueba("nube: con 2 corriendo en aizen1, la tercera aprobada va a la nube (desborde); la que espera plan NO; la nube no ocupa puesto de aizen1", async () => {
    despejar();
    const desde = leerLog(LOGS.claude).length;
    const a = nueva("Chica uno [mod:uno]", "PLAN_APROBADO", { plan: planDe("uno") });
    const b = nueva("Chica dos [mod:dos]", "PLAN_APROBADO", { plan: planDe("dos") });
    const c = nueva("Desborde tres [mod:tres]", "PLAN_APROBADO", { plan: planDe("tres") });
    const d = nueva("Espera su plan cuatro [mod:cuatro]", "APROBADO");
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    assert.deepEqual(planificador.cupos(), { aizen1: 2, nube: 1 }, "aizen1 con 2 y la tercera en la nube");
    const tareas = planificador.estado().tareas;
    assert.equal(tareas.find((t) => t.tarjetaId === c).lugar, "nube");
    assert.equal(tareas.find((t) => t.tarjetaId === a).lugar, "aizen1");
    assert.equal(tareas.find((t) => t.tarjetaId === c).motor, "claude");
    assert.equal(tarjetas.get(d).estado, "APROBADO", "la que espera plan no va a la nube: espera su puesto en aizen1");
    assert.match(planificador.estado().esperas.find((e) => e.tarjetaId === d)?.motivo ?? "", /puesto en aizen1/);
    await correrHasta(planificador, () => [a, b, c].every((id) => tarjetas.get(id).estado === "HECHO") && tarjetas.get(d).estado === "PLAN_LISTO", 180_000);
    assert.equal(aLaVez.EN_CURSO, 3, "dos en aizen1 y una en la nube, construyendo a la vez");
    const nube = llamadasALaNube(desde);
    assert.equal(nube.length, 1, "solo la tercera salió a la nube");
    assert.equal(nube[0].titulo, "Desborde tres [mod:tres]");
    assert.match(nube[0].cwd, /-nube$/, "lanzada desde un worktree de la rama");
    assert.deepEqual(nube[0].argumentos, ["-p", "--cloud", "--model", "sonnet", "--output-format", "json"], "la nube pide Sonnet para construir, igual que aizen1");
    assert.match(nube[0].prompt, /MODELO PEDIDO: Sonnet/);
    assert.equal(tarjetas.get(c).resultado.modelo.construir, "sonnet", "la tarjeta guarda el modelo con que corrió la nube");
    assert.equal(tarjetas.get(c).resultado.construidoEn, "nube");
    assert.equal(tarjetas.get(c).resultado.linkSesion, enlaceDe("Desborde tres [mod:tres]"));
    assert.equal(tarjetas.get(a).resultado.construidoEn, "aizen1");
    assert.equal(tarjetas.get(a).resultado.linkSesion, undefined);
    // El link de la sesión llegó al CRM en el latido (con dónde se construye); en aizen1 el latido dice aizen1.
    assert.ok(llamadas.some((l) => l.accion === "latido" && l.id === c && l.cuerpo.lugar === "nube" && l.cuerpo.sesion === enlaceDe("Desborde tres [mod:tres]")), "latido con el link");
    assert.ok(llamadas.some((l) => l.accion === "latido" && [a, b].includes(l.id) && l.cuerpo.lugar === "aizen1" && l.cuerpo.sesion === undefined), "latido de aizen1 sin link");
    assert.ok(!llamadas.some((l) => l.accion === "latido" && l.id === c && l.cuerpo.lugar === "aizen1"), "la de la nube nunca avisa que construye en aizen1 (el CRM le daría 90 min)");
    // Lo que hizo la nube quedó en main: la rama no se rehízo.
    assert.match(g(REPO, "log", "--format=%s", "origin/main"), /cambios de la nube/);
    assert.ok(esRamaDelTrabajador(tarjetas.get(c).resultado.rama));
    sinRestos();
    planificador.parar();
  });

  await prueba("nube: una tarea grande (9 archivos) va a la nube aunque aizen1 tenga puesto libre; una de pocos archivos se queda en aizen1", async () => {
    despejar();
    const desde = leerLog(LOGS.claude).length;
    const grande = nueva("Grande nueve archivos", "PLAN_APROBADO", { plan: planDe("grande", 9) });
    const chica = nueva("Chica tres archivos [mod:chica]", "PLAN_APROBADO", { plan: planDe("chica", 3) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    assert.deepEqual(planificador.cupos(), { aizen1: 1, nube: 1 }, "aizen1 tenía puesto libre y la grande igual va a la nube");
    await correrHasta(planificador, () => [grande, chica].every((id) => tarjetas.get(id).estado === "HECHO"), 180_000);
    assert.deepEqual(llamadasALaNube(desde).map((l) => l.titulo), ["Grande nueve archivos"]);
    assert.equal(tarjetas.get(grande).resultado.construidoEn, "nube");
    assert.equal(tarjetas.get(chica).resultado.construidoEn, "aizen1");
    // La instrucción que recibió la nube: el plan completo, CLAUDE.md, las lecciones y la rama; ninguna clave.
    const { prompt } = llamadasALaNube(desde)[0];
    assert.match(prompt, /PLAN APROBADO:\nPLAN\n4\. Migración: no\./);
    assert.match(prompt, /lee el archivo CLAUDE\.md/);
    assert.match(prompt, /DEJA TODO EN LA RAMA tablero\//);
    assert.match(prompt, /últimas 30 líneas del error/);
    assert.match(prompt, /export DATABASE_URL="postgresql:\/\/trabajador:no-usar@127\.0\.0\.1:1\/no_usar"/);
    assert.ok(!prompt.includes(CLAVE) && !/aizen_trab_/.test(prompt), "la clave del Coordinador nunca va a la nube");
    sinRestos();
    planificador.parar();
  });

  await prueba("nube: tope de seguridad de tareas en la nube; la que no cabe espera su puesto sin error", async () => {
    despejar();
    const uno = nueva("Grande uno", "PLAN_APROBADO", { plan: planDe("gran-uno", 9) });
    const dos = nueva("Grande dos", "PLAN_APROBADO", { plan: planDe("gran-dos", 9) });
    const planificador = planificar(nubeConfig({ maxTareas: 1 }));
    await planificador.llenar();
    assert.deepEqual(planificador.cupos(), { aizen1: 0, nube: 1 });
    assert.equal(tarjetas.get(dos).estado, "PLAN_APROBADO", "la segunda grande espera: la grande no se queda en aizen1");
    assert.match(planificador.estado().esperas.find((e) => e.tarjetaId === dos)?.motivo ?? "", /puesto en la nube/);
    await correrHasta(planificador, () => [uno, dos].every((id) => tarjetas.get(id).estado === "HECHO"), 240_000);
    assert.equal(aLaVez.EN_CURSO, 1, "nunca dos en la nube con tope 1");
    planificador.parar();
  });

  await prueba("nube: si la nube deja FALLO, la tarjeta pasa a ERROR con las últimas 30 líneas y el link; el reintento usa otra rama (sin --force)", async () => {
    despejar();
    const id = nueva("Falla en la nube [nube-fallo]", "PLAN_APROBADO", { plan: planDe("fallo", 9) });
    const intentar = async () => {
      const planificador = planificar(nubeConfig());
      await planificador.llenar();
      await planificador.esperarTodas();
      planificador.parar();
    };
    await intentar();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    const motivo = t.resultado.error.motivo;
    assert.match(motivo, /resultado FALLO \(build=FALLO tests=OK\)/);
    assert.match(motivo, /linea 35 del error/);
    assert.match(motivo, /linea 6 del error/);
    assert.ok(!motivo.includes("linea 5 del error"), "solo las últimas 30 de 35 líneas");
    assert.ok(motivo.includes(enlaceDe("Falla en la nube [nube-fallo]")), "el link de la sesión para mirarla");
    const rama = nombreDeRama(t);
    assert.ok(ramasDelRemoto().includes(rama), "la rama queda en GitHub");
    sinRestos();
    // Reintentar: la rama de la vez anterior sigue ahí (con lo de la nube) y no se toca; esta vez usa otra.
    Object.assign(t, { estado: "PLAN_APROBADO", venceEn: null });
    const antes = shaDe(rama);
    await intentar();
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.ok(ramasDelRemoto().includes(`${rama}-nube2`), "el reintento usa su propia rama");
    assert.equal(shaDe(rama), antes, "la rama del primer intento queda intacta");
    sinRestos();
  });

  await prueba("nube: con el límite de uso al lanzar, la tarjeta se suelta sin error y sin gastar intento", async () => {
    despejar();
    const id = nueva("Sin cupo en la nube [nube-limite]", "PLAN_APROBADO", { plan: planDe("limite", 9) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO", "vuelve a la fila");
    assert.equal(t.intentos, 0, "no gasta el intento");
    assert.match(t.soltada, /límite de uso/);
    assert.equal(t.resultado?.error, undefined, "sin ERROR");
    planificador.parar();
    sinRestos();
  });

  await prueba("nube: modelo no disponible: la tarjeta se suelta sin gastar intento y nunca se lanza con Opus", async () => {
    despejar();
    const desde = leerLog(LOGS.claude).length;
    const id = nueva("Modelo caído [nube-modelo-no-disponible]", "PLAN_APROBADO", { plan: planDe("modelocaido", 9) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO", "vuelve a la fila");
    assert.equal(t.intentos, 0, "no gasta el intento");
    assert.equal(t.resultado?.error, undefined, "sin ERROR");
    const lanzadas = llamadasALaNube(desde);
    assert.ok(lanzadas.length >= 1 && lanzadas.every((l) => l.argumentos[l.argumentos.indexOf("--model") + 1] === "sonnet"), "siempre Sonnet");
    planificador.parar();
    sinRestos();
  });

  await prueba("nube: si --cloud no acepta --model, se lanza sin él y la tarjeta lo dice en una línea", async () => {
    despejar();
    const desde = leerLog(LOGS.claude).length;
    const id = nueva("Sin model [nube-sin-model]", "PLAN_APROBADO", { plan: planDe("sinmodel", 9) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await correrHasta(planificador, () => tarjetas.get(id).estado === "HECHO", 180_000);
    const lanzadas = llamadasALaNube(desde);
    assert.equal(lanzadas.length, 2, "un intento con --model y otro sin él");
    assert.ok(lanzadas[0].argumentos.includes("--model") && !lanzadas[1].argumentos.includes("--model"));
    assert.match(lanzadas[1].prompt, /MODELO PEDIDO: Sonnet/, "el modelo va pedido en el prompt");
    const r = tarjetas.get(id).resultado;
    assert.match(r.resumen, /La nube no deja elegir modelo; se pidió en el prompt\./);
    assert.equal(r.modelo?.construir, undefined, "no se anota un modelo que no se pudo forzar");
    planificador.parar();
    sinRestos();
  });

  await prueba("nube: si el límite de uso llega a la sesión de la nube (FALLO con el aviso), también se suelta sin error", async () => {
    despejar();
    const id = nueva("Límite dentro de la nube [nube-fallo-limite]", "PLAN_APROBADO", { plan: planDe("limite2", 9) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_APROBADO");
    assert.equal(t.intentos, 0);
    assert.equal(t.resultado?.error, undefined);
    planificador.parar();
    sinRestos();
  });

  await prueba("nube: si `claude --cloud` no da el link (sin node-pty o la terminal falla), se detiene y propone GitHub Actions", async () => {
    despejar();
    const id = nueva("Pide terminal [nube-sin-terminal]", "PLAN_APROBADO", { plan: planDe("terminal", 9) });
    const planificador = planificar(nubeConfig({ terminal: "auto" }));
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, /sin que alguien toque la terminal/);
    assert.match(t.resultado.error.motivo, /GitHub Actions \(tarjeta cmvmjh9a504dp2mrpg7cazs8u\)/);
    // "auto" ya no intenta `claude -p --cloud` (la CLI no lo deja): sin node-pty lo dice; con node-pty, lo que dijo Claude.
    assert.match(t.resultado.error.motivo, /node-pty no está instalado|not a TTY/);
    assert.match(t.resultado.error.motivo, /-p --cloud no se intenta/);
    planificador.parar();
    sinRestos();
  });

  // La terminal real (node-pty): solo si está instalado (en aizen1 sí; en otros PCs se salta).
  const hayPty = await import("node-pty").then(
    () => true,
    () => false,
  );
  const saltada = hayPty ? "" : " (SALTADA: no hay node-pty)";
  await prueba(`nube: por la terminal real la descripción va como argumento justo después de --cloud (multilínea, comillas, acentos), se lee el link entre colores y se cierra la terminal${saltada}`, async () => {
    if (!hayPty) return;
    despejar();
    const desde = leerLog(LOGS.claude).length;
    const titulo = 'Terminal real "comillas" y acentos: camión ñandú [mod:pty]';
    const nota = `Nota: dice "hola" y 'chao' con \\ barra & y % y ^ y | y "fin\\".`;
    const id = nueva(titulo, "PLAN_APROBADO", { plan: `${planDe("pty", 9)}\n${nota}` });
    const planificador = planificar(nubeConfig({ terminal: "pty" }));
    await planificador.llenar();
    await correrHasta(planificador, () => tarjetas.get(id).estado === "HECHO", 180_000);
    const [llamada] = llamadasALaNube(desde);
    assert.ok(llamada, "se lanzó la nube");
    assert.equal(llamada.terminal, true, "en una terminal real");
    assert.equal(llamada.argumentos[0], "--cloud");
    assert.ok(llamada.argumentos[1].startsWith("Eres el Coordinador"), "la descripción es el argumento justo después de --cloud");
    assert.deepEqual(llamada.argumentos.slice(2), ["--model", "sonnet"]);
    assert.equal(llamada.titulo, titulo, "el título con comillas y acentos llegó entero");
    assert.match(llamada.prompt, /PLAN APROBADO:\nPLAN\n4\. Migración: no\./);
    assert.ok(llamada.prompt.includes(nota), "comillas, barras y símbolos intactos");
    assert.match(llamada.prompt, /DEJA TODO EN LA RAMA tablero\//);
    assert.equal(tarjetas.get(id).resultado.construidoEn, "nube");
    assert.ok(llamadas.some((l) => l.accion === "latido" && l.id === id && l.cuerpo.sesion === enlaceDe(titulo)), "el link (limpio de colores) llegó al CRM");
    planificador.parar();
    sinRestos();
  });

  await prueba(`nube: si la terminal real no da el link a tiempo, la cierra y no cuelga al Coordinador${saltada}`, async () => {
    if (!hayPty) return;
    const config = nubeConfig({ terminal: "pty", lanzarMinutos: 0.05 });
    const inicio = Date.now();
    await assert.rejects(lanzarEnNube({ config, registro: null, senal: null }, { cwd: AQUI, prompt: "Tarea: nunca da el link [nube-sin-link]\n\nsin rama", modelo: null }), /no dio el link en 3 s/);
    assert.ok(Date.now() - inicio < 20_000, "no se quedó colgado");
  });

  await prueba("nube: reconoce la pregunta \"¿Confías en esta carpeta?\" como la dibuja la CLI y dónde está la marca", () => {
    // Lo que de verdad imprimió claude 2.1 en una carpeta nueva (26-oct-2026), con sus saltos de cursor y colores.
    const real =
      "\u001b[?25l\u001b[2J\u001b[m\u001b[H\u001b[1m\u001b[3;2HAccessing\u001b[1Cworkspace:\u001b[m\u001b[7;2HQuick\u001b[1Csafety\u001b[1Ccheck:\u001b[1CIs\u001b[1Cthis\u001b[1Ca\u001b[1Cproject\u001b[1Cyou\u001b[1Ccreated\u001b[1Cor\u001b[1Cone\u001b[1Cyou\u001b[1Ctrust?" +
      "\u001b[38;2;153;153;153m\u001b[12;2HSecurity\u001b[1Cguide\u001b[38;2;177;185;249m\u001b[14;2H❯\u001b[1CNo,\u001b[1Cexit\u001b[m\u001b[15;4HYes,\u001b[1CI\u001b[1Ctrust\u001b[1Cthis\u001b[1Cfolder\u001b[38;2;153;153;153m\u001b[17;2HEnter\u001b[1Cto\u001b[1Cconfirm\u001b[1C·\u001b[1CEsc\u001b[1Cto\u001b[1Ccancel\u001b[>0q\u001b[?u\u001b[m";
    assert.deepEqual(preguntaDeConfianza(real), { marcadaSi: false }, "marcada en No (el ESC[>0q no cuenta como marca)");
    const trasLaFlecha = `${real}\u001b[14;2H \u001b[1CNo, exit\u001b[38;2;177;185;249m\u001b[15;2H❯\u001b[1CYes, I trust this folder\u001b[m`;
    assert.deepEqual(preguntaDeConfianza(trasLaFlecha), { marcadaSi: true });
    assert.deepEqual(preguntaDeConfianza("Do you trust the files in this folder?\n❯ 1. Yes, proceed\n  2. No, exit"), { marcadaSi: true });
    assert.equal(preguntaDeConfianza("\u001b[1mCloud session:\u001b[0m https://claude.ai/code/session_x"), null);
    assert.equal(estaDentroDe(path.join(T, "trabajo", "wt", "abcd-nube"), path.join(T, "trabajo")), true);
    assert.equal(estaDentroDe(path.join(T, "trabajo-otro"), path.join(T, "trabajo")), false);
    assert.equal(estaDentroDe(AQUI, path.join(T, "trabajo")), false);
  });

  await prueba(`nube: la terminal real acepta sola "¿Confías en esta carpeta?" en un worktree del Coordinador y sigue hasta el link${saltada}`, async () => {
    if (!hayPty) return;
    despejar();
    const registroConfianza = `${LOGS.claude}.confianza`;
    fs.rmSync(registroConfianza, { force: true });
    const titulo = "Worktree nuevo pide confianza [nube-confianza]";
    const id = nueva(titulo, "PLAN_APROBADO", { plan: planDe("confianza", 9) });
    const planificador = planificar(nubeConfig({ terminal: "pty" }));
    await planificador.llenar();
    await correrHasta(planificador, () => ["HECHO", "ERROR"].includes(tarjetas.get(id).estado), 180_000);
    assert.equal(tarjetas.get(id).estado, "HECHO", tarjetas.get(id).resultado?.error?.motivo);
    const [respuesta] = leerLog(registroConfianza);
    assert.equal(respuesta?.confianza, true, "contestó Sí (no Enter a ciegas sobre No, exit)");
    assert.ok(estaDentroDe(respuesta.cwd, path.join(T, "trabajo")), "en la carpeta de trabajo");
    assert.ok(llamadas.some((l) => l.accion === "latido" && l.id === id && l.cuerpo.sesion === enlaceDe(titulo)), "dio el link después de la pregunta");
    planificador.parar();
    sinRestos();
  });

  await prueba(`nube: fuera de la carpeta de trabajo NO acepta la pregunta de confianza: falla enseguida y lo dice${saltada}`, async () => {
    if (!hayPty) return;
    const registroConfianza = `${LOGS.claude}.confianza`;
    fs.rmSync(registroConfianza, { force: true });
    const config = nubeConfig({ terminal: "pty", lanzarMinutos: 1 });
    const inicio = Date.now();
    await assert.rejects(lanzarEnNube({ config, registro: null, senal: null }, { cwd: AQUI, prompt: "Tarea: carpeta ajena [nube-confianza]\n\nsin rama", modelo: null }), /no está dentro de la carpeta de trabajo del Coordinador: no la acepto sola/);
    assert.ok(Date.now() - inicio < 30_000, "no esperó el minuto entero");
    assert.deepEqual(leerLog(registroConfianza), [], "no contestó nada");
  });

  await prueba("nube: si la sesión nunca deja el commit 'resultado:', la tarjeta pasa a ERROR con el link de la sesión", async () => {
    despejar();
    const id = nueva("Se quedó pensando [nube-sin-resultado]", "PLAN_APROBADO", { plan: planDe("pensando", 9) });
    const planificador = planificar(nubeConfig({ esperaMinutos: 0.03 }));
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, /no dejó el commit "resultado:"/);
    assert.ok(t.resultado.error.motivo.includes(enlaceDe("Se quedó pensando [nube-sin-resultado]")));
    planificador.parar();
    sinRestos();
  });

  // CONFIAR EN LA NUBE (26-oct-2026, regla del dueño): con build=OK y tests=OK en la nube, aizen1 no compila ni prueba
  // NADA. Los comandos pesados del repo (instalar, verificar, pruebas, lint, PGlite) dejan una marca si alguien los corre.
  const MARCAS_PESADAS = path.join(T, "pesados.log");
  // El lint tiene que contestar JSON (eslint --format json): la marca del lint imprime "[]".
  const marcar = (que) => [node, "-e", `require("fs").appendFileSync(${JSON.stringify(MARCAS_PESADAS)}, ${JSON.stringify(`${que}\n`)});${que === "lint" ? 'console.log("[]")' : ""}`];
  const pesadosCorridos = () => (fs.existsSync(MARCAS_PESADAS) ? fs.readFileSync(MARCAS_PESADAS, "utf8").split("\n").filter(Boolean) : []);
  const configQueConfia = (nube = {}) =>
    crearConfig(
      { construirNubeMinutos: 2 },
      { subirSolo: true, github: "prueba/repo", instalar: marcar("npm ci"), verificar: [marcar("tsc"), marcar("build")], pruebas: [marcar("tests")], lint: { comando: marcar("lint") }, ensayoPglite: marcar("pglite") },
      { maxParalelo: 2, nube: { activa: true, maxTareas: 8, vigilarCadaSegundos: 0.3, esperaMinutos: 1, lanzarMinutos: 1, terminal: "sin-terminal", comandoGh: [node, falso("gh-falso.mjs")], ...nube } },
    );
  /** Una tarjeta SUBIENDO como la deja construir en la nube: rama tablero/… en GitHub (el remoto) con el código que verificó la nube. */
  const subiendoDeLaNube = (titulo, nombre, { relativo = `src-${nombre}.txt`, texto = "lo que hizo la nube\n" } = {}) => {
    g(REPO, "pull", "--quiet", "--ff-only", "origin", "main");
    const base = g(REPO, "rev-parse", "HEAD");
    const clon = path.join(T, `clon-${nombre}`);
    fs.rmSync(clon, { recursive: true, force: true });
    execFileSync("git", ["clone", "--quiet", REMOTO, clon], { stdio: "ignore" });
    const rama = `tablero/${nombre}`;
    g(clon, "checkout", "--quiet", "-b", rama, "origin/main");
    fs.mkdirSync(path.dirname(path.join(clon, relativo)), { recursive: true });
    fs.writeFileSync(path.join(clon, relativo), texto);
    g(clon, "add", "-A");
    g(clon, "commit", "--quiet", "-m", "cambios de la nube");
    g(clon, "commit", "--quiet", "--allow-empty", "-m", "resultado: build=OK tests=OK segundos=42");
    g(clon, "push", "--quiet", "origin", rama);
    const commit = g(clon, "rev-parse", "HEAD");
    fs.rmSync(clon, { recursive: true, force: true });
    return nuevaModerna(titulo, "SUBIENDO", {
      plan: planDe(nombre, 1),
      resultado: { paso: true, rama, commit, base, subeSolo: true, construidoEn: "nube", linkSesion: "https://claude.ai/code/session_FALSA_subida" },
    });
  };
  const cambiarMain = async (relativo, texto) => {
    g(REPO, "pull", "--quiet", "--ff-only", "origin", "main");
    archivo(relativo, texto);
    g(REPO, "add", "-A");
    g(REPO, "commit", "--quiet", "-m", `main cambia ${relativo}`);
    g(REPO, "push", "--quiet", "origin", "main");
    // Los git de arriba bloquean el proceso varios segundos: el CRM falso cierra sus conexiones viejas (keep-alive de
    // 5 s) apenas se desbloquea; se le da un momento para que el primer pedido no caiga en una conexión que se cierra.
    await new Promise((resolver) => setTimeout(resolver, 300));
  };

  await prueba("nube con build=OK y tests=OK: aizen1 no corre npm ci, tsc, build, pruebas, lint ni PGlite; solo revisa nombres y sube", async () => {
    despejar();
    fs.rmSync(MARCAS_PESADAS, { force: true });
    const id = nueva("Grande que confía en la nube", "PLAN_APROBADO", { plan: planDe("confia", 9) });
    const planificador = planificar(configQueConfia());
    await planificador.llenar();
    await correrHasta(planificador, () => ["HECHO", "ERROR"].includes(tarjetas.get(id).estado), 180_000);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "HECHO", t.resultado?.error?.motivo);
    assert.equal(t.resultado.construidoEn, "nube");
    assert.deepEqual(pesadosCorridos(), [], "aizen1 no compiló ni probó nada");
    assert.match(t.resultado.pruebas, /build=OK y tests=OK en la nube sobre este mismo código/);
    planificador.parar();
    sinRestos();
  });

  await prueba("nube: con confiarEnResultado=false se vuelve a verificar en aizen1 (como antes)", async () => {
    despejar();
    fs.rmSync(MARCAS_PESADAS, { force: true });
    const id = nueva("Grande que no confía", "PLAN_APROBADO", { plan: planDe("noconfia", 9) });
    const planificador = planificar(configQueConfia({ confiarEnResultado: false }));
    await planificador.llenar();
    await correrHasta(planificador, () => ["HECHO", "ERROR"].includes(tarjetas.get(id).estado), 180_000);
    assert.ok(["npm ci", "tsc", "build", "tests"].every((paso) => pesadosCorridos().includes(paso)), `corrió: ${pesadosCorridos().join(", ")}; ${tarjetas.get(id).estado}: ${tarjetas.get(id).resultado?.error?.motivo ?? ""}`);
    planificador.parar();
    despejar();
    sinRestos();
  });

  await prueba("subir lo de la nube: si main cambió .md u OTROS archivos (no los de la tarea), sube sin compilar ni probar nada en aizen1", async () => {
    despejar();
    const id = subiendoDeLaNube("Sube tras cambios ajenos en main", "solo-md");
    await cambiarMain("NOTAS-solo-md.md", "solo texto\n");
    await cambiarMain("src/otra-cosa.ts", "export const x = 1;\n");
    fs.rmSync(MARCAS_PESADAS, { force: true });
    const planificador = planificar(configQueConfia());
    await planificador.llenar();
    await correrHasta(planificador, () => ["HECHO", "ERROR", "PLAN_APROBADO"].includes(tarjetas.get(id).estado), 120_000);
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "HECHO", t.resultado?.error?.motivo);
    assert.deepEqual(pesadosCorridos(), [], "aizen1 no compiló ni probó nada");
    assert.match(g(REPO, "log", "--format=%s", "origin/main"), /cambios de la nube/);
    planificador.parar();
    sinRestos();
  });

  await prueba("subir lo de la nube: si main cambió un archivo que la tarea también cambia, NO sube ni compila: vuelve a verificarse en la NUBE", async () => {
    despejar();
    const desde = leerLog(LOGS.claude).length;
    // Un archivo de 9 líneas: la nube cambia la primera y main la última (el rebase no choca, pero la mezcla no se probó).
    const lineas = Array.from({ length: 9 }, (_, i) => `linea ${i + 1}`);
    await cambiarMain("src/compartido.ts", `${lineas.join("\n")}\n`);
    const id = subiendoDeLaNube("Sube tras cambio de código [mod:otra-vez]", "codigo-nuevo", { relativo: "src/compartido.ts", texto: `${["LINEA 1 DE LA NUBE", ...lineas.slice(1)].join("\n")}\n` });
    await cambiarMain("src/compartido.ts", `${[...lineas.slice(0, 8), "LINEA 9 DE MAIN"].join("\n")}\n`);
    fs.rmSync(MARCAS_PESADAS, { force: true });
    const planificador = planificar(configQueConfia());
    await planificador.llenar();
    await correrHasta(planificador, () => tarjetas.get(id).estado === "HECHO" || tarjetas.get(id).estado === "ERROR", 180_000);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "HECHO", t.resultado?.error?.motivo);
    const reparacion = (t.intentosLista ?? []).find((intento) => intento.accion === "reparar");
    assert.ok(reparacion, "se mandó a reparar (no ERROR)");
    assert.match(reparacion.causa ?? "", /\[estrategia: nube\]$/);
    assert.match(reparacion.error ?? "", /cambió archivos que la tarea también cambia y la nube no verificó juntos \(src\/compartido\.ts\)/);
    assert.equal(llamadasALaNube(desde).length, 1, "se volvió a construir y verificar en la nube (es chica: sin la estrategia iría a aizen1)");
    assert.equal(t.resultado.construidoEn, "nube");
    assert.deepEqual(pesadosCorridos(), [], "aizen1 nunca compiló ni probó");
    planificador.parar();
    sinRestos();
  });

  await prueba("nube: si la sesión de la nube sube un archivo .env, no se sube nada", async () => {
    despejar();
    const id = nueva("Sube un secreto [nube-env]", "PLAN_APROBADO", { plan: planDe("secreto", 9) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await planificador.esperarTodas();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, /archivos \.env/);
    planificador.parar();
    sinRestos();
  });

  await prueba("el log dice qué tarjeta corre en cada sesión y cuántas corren al tiempo", async () => {
    const archivos = fs.readdirSync(path.join(T, "trabajo", "logs"));
    const texto = fs.readFileSync(path.join(T, "trabajo", "logs", archivos[0]), "utf8");
    assert.match(texto, /\[s1 [A-Za-z0-9]{8}\] tomé "/);
    assert.match(texto, /\[s2 [A-Za-z0-9]{8}\] tomé "/);
    assert.match(texto, /corriendo 2\/3 tarjetas al tiempo en aizen1: s1 "/);
  });

  await prueba("el registro se escribe por día en carpetaTrabajo/logs y nunca muestra la clave", async () => {
    const archivos = fs.readdirSync(path.join(T, "trabajo", "logs"));
    assert.equal(archivos.length, 1);
    assert.match(archivos[0], /^trabajador-\d{4}-\d{2}-\d{2}\.log$/);
    const texto = fs.readFileSync(path.join(T, "trabajo", "logs", archivos[0]), "utf8");
    assert.match(texto, /tomé "Agregar tabla nueva/);
    assert.ok(!texto.includes(CLAVE));
  });
} finally {
  servidor.close();
  try {
    fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows a veces tiene un archivo abierto un instante: queda en la carpeta temporal.
  }
}

console.log(`\n${pruebas} pruebas, todas bien`);

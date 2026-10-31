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
import { crearPlanificador, crearRevisorDeNuevo, crearSemaforo, procesar, reparacionDeLaTarjeta, unaVuelta } from "../lib/bucle.mjs";
import { PRIORIDAD, crearColaPesada } from "../lib/cola.mjs";
import { archivosDelPlan, candidatasQueChocan, huellaDeTarjeta, moduloDe, motivoDeChoque } from "../lib/choques.mjs";
import { completarConfig } from "../lib/config.mjs";
import { MAX_LECCIONES, agenteDelRepo, anotarLeccion, leccionDe, leccionesParaElPrompt, necesitoDe, tresLineasDe } from "../lib/agentes.mjs";
import { crearCrm } from "../lib/crm.mjs";
import { CARPETA_DE_NOTAS, MANUAL, crearManualNocturno, horaEnBogota, leerEstadoDelManual } from "../lib/manual-nocturno.mjs";
import { guionDeEnsayo, sqlParaEnsayo } from "../lib/ensayo.mjs";
import { esRamaDelTrabajador, idCorto, nombreDeRama, pushDeRama, rebaseSobre, webDeGithub } from "../lib/git.mjs";
import { esDeMigraciones, promptDeResolverChoque, resolverChoque, respuestaDelChoque } from "../lib/resolver-choque.mjs";
import { LARGO_MAXIMO_DEL_AVISO, decidir, diagnosticar, recortarAviso, resumenDeEscalada, textoDelAvisoDeReversion } from "../lib/diagnostico.mjs";
import {
  CONFIRMACION_REVISION_DE_NUEVO,
  buscarCorridaDelDespliegue,
  esLimiteDeUso,
  planParaLaNube,
  promptDeConstruir,
  promptDeNube,
  promptDelPlan,
  reglasDeZonasQueSubenSolas,
  sePuedeRevisarDeNuevo,
} from "../lib/etapas.mjs";
import { MAX_DESCRIPCION, descripcionParaLaNube, esCommitDeInicio, esTareaGrande, estaDentroDe, esperarResultado, lanzarEnNube, lineaSinRepo, linkDeLaSesionFija, linkDeSesion, nombreDelProyecto, olvidarSinAcceso, sesionFijaDe, sinAccesoALaNube, preguntaDeConfianza, preguntaDelCommit, resultadoDelCommit, seccionDelPlan, trabajaConMigracion } from "../lib/nube.mjs";
import { preguntasAbiertasDelPlan, primeraPreguntaAbierta } from "../lib/preguntas-abiertas.mjs";
import {
  PREGUNTA_POR_DEFECTO,
  REVISORES,
  dosLineasDeLaSesion,
  dosLineasDelCoordinador,
  estadoParaElPanel,
  motivoDeRevisionQueNoPaso,
  progresoDelCommit,
  promptDeRevisor,
  revisarConCuatro,
  revisorPorClave,
  sonDosLineasParaElDueno,
  textoParaLaNube,
  tocaPantallas,
  veredictoDeLaRespuesta,
} from "../lib/revisores.mjs";
import { criteriosDelPlan, evidenciaDeCriterios, instruccionDeEvidencia, porQueFaltanCriterios, porQueUnSupuestoEsDeNegocio, seccionFinalDelPlan } from "../lib/criterios.mjs";
import { debePartirAntes, parteDelSistema, partesDelSistemaDelPlan, partesSinAlcanceNuevo } from "../lib/reparto.mjs";
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
import { GRACIA_SERVER_ACTION_MIN, enviosDeLog, erroresDeLog, erroresNuevosDeLog, esLineaDeErrorReal, esperaAlDueno, globARegex, lineasDeErrorNuevasDeLog, minutosDeLaVentana, motivoPorElQueNoSubeSola, pruebaExtraDeLasZonas, zonasTocadas } from "../lib/zonas.mjs";
import { crearRescatador, decidirRescate } from "../lib/rescate-por-revisar.mjs";

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const reglas = cargar("src/features/tableros-inteligentes/services/reglas-trabajador.ts");
const reglasDeRiesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts");

const sinMedirAqui = { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined };

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ─────────────────────────────────────────────────────────── piezas puras ── */

await prueba("zonas: esLineaDeErrorReal no cuenta error vacío, resultado ok ni conteos en cero, y sí los errores de verdad", async () => {
  const nota = (resto) => `[nota-de-voz] {"paso":"subida",${resto},"status":200,"ms":120}`;
  assert.equal(esLineaDeErrorReal(nota('"resultado":"ok","error":null')), false);
  assert.equal(esLineaDeErrorReal(nota('"resultado":"ok"')), false);
  assert.equal(esLineaDeErrorReal(nota('"error":""')), false);
  assert.equal(esLineaDeErrorReal(nota('"error":false')), false);
  assert.equal(esLineaDeErrorReal('{"ok":true,"error":null}'), false);
  assert.equal(esLineaDeErrorReal("resumen errores: 0"), false);
  assert.equal(esLineaDeErrorReal("build finished with 0 errors"), false);
  assert.equal(esLineaDeErrorReal(nota('"error":"timeout"')), true);
  assert.equal(esLineaDeErrorReal(nota('"error":null,"detalle":"ECONNREFUSED 10.0.0.1"')), true);
  assert.equal(esLineaDeErrorReal(nota('"error":null,"nota":"unhandled"')), true);
  assert.equal(esLineaDeErrorReal("connect ECONNREFUSED 127.0.0.1:5432"), true);
  assert.equal(esLineaDeErrorReal("Unhandled rejection en el bot"), true);
  assert.equal(esLineaDeErrorReal("todo bien"), false);
});

await prueba("zonas: 'Failed to find Server Action' no cuenta en los primeros 10 minutos y después sí", async () => {
  const linea = 'Error: Failed to find Server Action "abc123". This request might be from an older or newer deployment.';
  assert.equal(GRACIA_SERVER_ACTION_MIN, 10);
  assert.equal(esLineaDeErrorReal(linea, { minutosDesdeSubir: 3 }), false);
  assert.equal(esLineaDeErrorReal(linea, { minutosDesdeSubir: 12 }), true);
  assert.equal(esLineaDeErrorReal(linea), true, "sin minutos cuenta como antes");
  assert.equal(esLineaDeErrorReal(linea, { minutosDesdeSubir: 3, graciaServerActionMin: 0 }), true);
  assert.deepEqual(erroresNuevosDeLog(linea, [], { minutosDesdeSubir: 3 }), []);
  assert.equal(erroresNuevosDeLog(linea, [], { minutosDesdeSubir: 12 }).length, 1);
  assert.equal(erroresDeLog(`${linea}\nconnect ECONNREFUSED 1.1.1.1:80`, { minutosDesdeSubir: 3 }).length, 1, "ECONNREFUSED sigue contando");
  // la línea exacta, no la huella con #
  assert.equal(lineasDeErrorNuevasDeLog(`  ${linea}  `, [], { minutosDesdeSubir: 12 })[0].linea, linea);
});

await prueba("zonas: un envío con error null cuenta como enviado y uno con error timeout como fallido", async () => {
  const log = ['sendText {"error":null}', 'sendText {"error":"timeout"}'].join("\n");
  assert.deepEqual(enviosDeLog(log, undefined, 1), { enviados: 1, fallidos: 1 });
});

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

await prueba("zonas: la prueba extra de chats y del bot la hace el Coordinador con el diff; un envío nuevo, gasto en Meta Ads o el libro V3 sin simular siguen esperando (27-oct)", async () => {
  const SOLAS = ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"];
  const sinEnvio = "+export const x = 1;\n";
  const conEnvio = "+export const avisar = (x) => sendMessage(x);\n";
  const prueba = (zonas, diff, texto = "", plan = "El plan") => pruebaExtraDeLasZonas({ zonas, zonasQueSubenSolas: SOLAS, diffs: { todo: diff }, plan, texto });
  // Sin la frase del constructor: el motivo de antes sigue por defecto, pero con la comprobación del Coordinador ya no. Ese motivo
  // no espera al dueño (30-oct-2026): va a ERROR, nunca a POR_REVISAR.
  const sinFrase = motivoPorElQueNoSubeSola({ zonas: ["CHATS"], zonasQueSubenSolas: SOLAS, diffs: { todo: sinEnvio }, plan: "", texto: "" });
  assert.match(sinFrase, /falta la prueba/);
  assert.equal(esperaAlDueno(sinFrase), false);
  const chats = prueba(["CHATS"], sinEnvio);
  assert.equal(chats.esperaPor, null);
  assert.match(chats.confirmaciones.join("\n"), /^✔ chats: sin mensajes nuevos a clientes \(comprobado por el Coordinador/);
  const bot = prueba(["BOT_VENTAS", "CHATS"], sinEnvio);
  assert.equal(bot.confirmaciones.length, 2);
  // Si el constructor ya escribió la frase, no se repite.
  assert.deepEqual(prueba(["CHATS"], sinEnvio, "✔ chats: sin mensajes nuevos a clientes").confirmaciones, []);
  // Un envío nuevo en chats no sube solo aunque el plan lo mencione; en el bot, si el plan no lo menciona.
  assert.match(prueba(["CHATS"], conEnvio, "", "Se enviará un mensaje nuevo").esperaPor, /agrega un envío nuevo de mensaje a clientes en chats/);
  assert.deepEqual(prueba(["CHATS"], conEnvio).confirmaciones, []);
  assert.match(prueba(["BOT_VENTAS"], conEnvio).esperaPor, /envío de mensaje que el plan no menciona/);
  // Meta Ads con señales de gasto, o el plan que lo declara, sigue esperando.
  assert.match(prueba(["META_ADS"], "+const c = { daily_budget: 5 };\n").esperaPor, /gasto en Meta Ads/);
  assert.match(prueba(["META_ADS"], sinEnvio, "", "GASTO EN META ADS: prende la campaña").esperaPor, /gasto en Meta Ads/);
  // El libro V3 necesita su simulación: el diff no la comprueba.
  assert.match(prueba(["LIBRO_V3"], sinEnvio).esperaPor, /falta la simulación V3/);
});

await prueba("zonas: esperaAlDueno solo es verdadero para el gasto en Meta Ads; chats y el bot quedan en ERROR con el motivo (30-oct)", () => {
  assert.equal(esperaAlDueno("gasto en Meta Ads (daily_budget)"), true);
  assert.equal(esperaAlDueno("gasto en Meta Ads (el plan lo declara)"), true);
  assert.equal(esperaAlDueno("agrega un envío nuevo de mensaje a clientes en chats"), false);
  assert.equal(esperaAlDueno("falta la prueba de que los chats no mandan mensajes nuevos a clientes (✔ chats: sin mensajes nuevos a clientes)"), false);
  assert.equal(esperaAlDueno("el cambio agrega un envío de mensaje que el plan no menciona"), false);
  assert.equal(esperaAlDueno(""), false);
  assert.equal(esperaAlDueno(null), false);
  assert.equal(esperaAlDueno(undefined), false);
  // Lo que se le dice al que construye: chats y el bot ya no "esperan el sí"; Meta Ads y el libro V3 no cambian.
  const reglas = reglasDeZonasQueSubenSolas({ zonasQueSubenSolas: ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"] });
  const linea = (inicio) => reglas.split("\n").find((l) => l.startsWith(inicio)) ?? "";
  for (const zona of ["- Chats:", "- Bot de ventas:"]) {
    assert.doesNotMatch(linea(zona), /espera el sí del dueño/, zona);
    assert.match(linea(zona), /queda en ERROR con el motivo/, zona);
  }
  assert.match(linea("- Chats:"), /✔ chats: sin mensajes nuevos a clientes/);
  assert.match(linea("- Bot de ventas:"), /✔ sin mensajes nuevos a clientes/);
  assert.match(linea("- Meta Ads:"), /sigue esperando el sí del dueño/);
  assert.match(linea("- Libro V3:"), /✔ simulación V3: sin cambios fuera de lo pedido/);
});

await prueba("diagnóstico: la categoría \"zona\" (chats o bot que no suben solos) va directo a ERROR, sin reparar (30-oct)", () => {
  const error = Object.assign(new Error("No sube: agrega un envío nuevo de mensaje a clientes en chats"), { categoria: "zona" });
  const diagnostico = diagnosticar({ error, etapa: "construir", textoLog: "", tarjeta: { id: "z1", reparaciones: 0, topeReparaciones: 2 } });
  assert.equal(diagnostico.categoria, "zona");
  assert.match(diagnostico.causa, /^No sube: agrega un envío nuevo de mensaje a clientes en chats/);
  const decision = decidir({ diagnostico, tarjeta: { id: "z1", reparaciones: 0, topeReparaciones: 2, ultimosIntentos: [] }, etapa: "construir", config: {} });
  assert.equal(decision.accion, "escalar");
  const resumen = resumenDeEscalada({ tarjeta: { ultimosIntentos: [] }, diagnostico });
  assert.match(resumen, /No sube: agrega un envío nuevo de mensaje a clientes en chats/);
  assert.doesNotMatch(resumen, /espera tu sí/);
});

await prueba("rescate: una tarjeta POR_REVISAR que solo esperaba la prueba extra sube sola; con un envío nuevo, dinero en el CRM o V3 no", async () => {
  const repo = { clave: "aizencrm", subirSolo: true, zonasQueSubenSolas: ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"], zonasProtegidas: { CHATS: ["src/chats/**"], LIBRO_V3: ["src/agente-v3/**"], OTRA: ["src/pagos/**"] } };
  const diffDe = (archivos, texto) => ({ archivos, diffDe: async () => texto });
  const base = { id: "t1", titulo: "Buscador de la bandeja", repo: "aizencrm", plan: "Un buscador.", zonaProtegida: ["CHATS"], commit: "abc", base: "def", esperaPor: "falta la prueba de que los chats no mandan mensajes nuevos a clientes" };
  const sube = await decidirRescate(base, repo, diffDe(["src/chats/buscador.ts"], "+export const x = 1;\n"));
  assert.equal(sube.accion, "subir");
  assert.match(sube.confirmacion, /✔ chats: sin mensajes nuevos a clientes/);
  const envio = await decidirRescate(base, repo, diffDe(["src/chats/buscador.ts"], "+x.sendMessage(y);\n"));
  assert.equal(envio.accion, "esperar");
  assert.match(envio.motivo, /agrega un envío nuevo de mensaje a clientes en chats/);
  const v3 = await decidirRescate({ ...base, zonaProtegida: ["LIBRO_V3"] }, repo, diffDe(["src/agente-v3/libro.ts"], "+x\n"));
  assert.equal(v3.accion, "saltar");
  const conAprobacion = await decidirRescate({ ...base, zonaProtegida: [], esperaPor: null, aprobadaPorElDueno: true }, repo, diffDe(["src/otra/cosa.ts"], "+x\n"));
  assert.equal(conAprobacion.accion, "subir");
  assert.match(conAprobacion.confirmacion, /sí del dueño ya dado/);

  // El rescatador habla con el CRM, no repite lo ya decidido y respeta la configuración.
  const llamadas = [];
  const crm = {
    porRevisar: async () => ({ tarjetas: [base, { ...base, id: "t2", titulo: "Con envío" }, { ...base, id: "t3", repo: "otro" }] }),
    rescatar: async (id, datos) => llamadas.push([id, datos]),
  };
  const avisos = [];
  const registro = { info: () => {}, aviso: (m) => avisos.push(m) };
  const diffs = { t1: diffDe(["src/chats/buscador.ts"], "+x\n"), t2: diffDe(["src/chats/a.ts"], "+x.sendMessage(y);\n") };
  const rescatador = crearRescatador({ crm, config: { repos: { aizencrm: repo } }, registro, diffDeLaRama: async (_repo, tarjeta) => diffs[tarjeta.id] });
  const primera = await rescatador.revisar({ forzar: true });
  assert.equal(primera.rescatadas.length, 2);
  assert.deepEqual(llamadas.map(([id, datos]) => [id, datos.sube]), [["t1", true], ["t2", false]]);
  await rescatador.revisar({ forzar: true });
  assert.equal(llamadas.length, 2, "no repite lo ya decidido");
  assert.deepEqual(avisos, []);
  // Un repo que no sube solo no se toca.
  const sinSubir = crearRescatador({ crm, config: { repos: { aizencrm: { ...repo, subirSolo: false } } }, registro, diffDeLaRama: async () => { throw new Error("no se debe leer"); } });
  assert.deepEqual((await sinSubir.revisar({ forzar: true })).rescatadas, []);
  // Un 409 del CRM (dinero, Meta Ads) se avisa en el registro y no se vuelve a pedir.
  const crm409 = { porRevisar: async () => ({ tarjetas: [base] }), rescatar: async () => { throw Object.assign(new Error("Espera el sí del dueño: dinero"), { status: 409 }); } };
  const de409 = crearRescatador({ crm: crm409, config: { repos: { aizencrm: repo } }, registro, diffDeLaRama: async () => diffs.t1 });
  await de409.revisar({ forzar: true });
  assert.equal(avisos.length, 1);
  await de409.revisar({ forzar: true });
  assert.equal(avisos.length, 1);
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
  const estado = { tareas: [{ tarjetaId: "t1", titulo: "Algo", agente: "Agente CRM", etapa: "probando", lugar: "aizen1" }], esperandoPc: true, motivoEspera: "CPU 92 % (límite 85 %)", esperas: [{ tarjetaId: "t2", motivo: "misma zona" }], uso: { limiteAlcanzado: false, motor: null, reiniciaEn: null } };
  const cuerpo = armarLatido({ estado, medidor: { medir: () => ({ cpu: 40, memoria: 55 }) }, carga: { memoriaUsadaGb: 22, memoriaTotalGb: 40, discoLibreGb: 120.5, discoTotalGb: 500 } });
  assert.equal(cuerpo.nombre, "aizen1");
  assert.equal(cuerpo.tareas[0].etapa, "probando");
  assert.equal(cuerpo.tareas[0].agente, "Agente CRM", "el latido lleva el agente de cada tarea");
  assert.deepEqual(cuerpo.carga, { cpu: 40, memoriaPorciento: 55, memoriaUsadaGb: 22, memoriaTotalGb: 40, discoLibreGb: 120.5, discoTotalGb: 500, esperandoPc: true, motivoEspera: "CPU 92 % (límite 85 %)" });
  assert.equal(cuerpo.esperas[0].tarjetaId, "t2");
  // Un medidor que falla no tumba el latido: la carga va en null.
  const sinMedidor = armarLatido({ estado, medidor: { medir: () => { throw new Error("x"); } }, carga: null });
  assert.equal(sinMedidor.carga.cpu, null);
  assert.equal(sinMedidor.carga.discoLibreGb, null);
});

await prueba("agentes: el prompt del plan, de construir y de la nube empieza con la identidad del agente del proyecto; el revisor no cambia", async () => {
  const tarjeta = { id: "t1", titulo: "Algo", tablero: "T", detalle: "d", intentos: 1, plan: "El plan", zonasAprobadas: [] };
  const casos = [
    [{ clave: "aizencrm", ruta: "/r/crm" }, "Eres el Agente CRM del proyecto aizencrm; el Coordinador de Sistemas te pasó esta tarjeta."],
    [{ clave: "gestion", ruta: "/r/gestion" }, "Eres el Agente Gestión del proyecto gestion; el Coordinador de Sistemas te pasó esta tarjeta."],
    [{ clave: "messenger-basic", ruta: "/r/mb" }, "Eres el Agente Marketplace (NETMAGI) del proyecto messenger-basic;"],
    [{ clave: "gestion", ruta: "/r/gestion", agente: { nombre: "Agente Cuentas" } }, "Eres el Agente Cuentas del proyecto gestion;"],
  ];
  for (const [repo, inicio] of casos) {
    for (const prompt of [promptDelPlan(tarjeta, repo), promptDelPlan(tarjeta, repo, "codex"), promptDeConstruir(tarjeta, repo, "tablero/x"), promptDeNube(tarjeta, repo, "tablero/x")]) {
      assert.ok(prompt.startsWith(inicio), `${repo.clave}: ${prompt.slice(0, 120)}`);
      assert.ok(!prompt.includes("Coordinador del Tablero IA"), "ya se llama Coordinador de Sistemas");
    }
  }
  // La identidad va en el MISMO primer bloque: el recorte de la nube sigue partiendo por bloques.
  assert.ok(!promptDeNube(tarjeta, casos[0][0], "tablero/x").split("\n\n")[0].includes("PLAN APROBADO"));
  // Las lecciones del agente se nombran en su identidad.
  const conLecciones = promptDeConstruir(tarjeta, { clave: "aizencrm", ruta: "/r/crm", agente: { lecciones: "docs/lecciones.md" } }, "tablero/x");
  assert.match(conLecciones, /lecciones de .*docs[\\/]lecciones\.md/);
});

await prueba("agentes: la configuración inválida del agente da error, la válida se completa y un proyecto apagado no cuenta", async () => {
  const base = { urlCrm: "https://app.aizenbot.com", claveTrabajador: "aizen_trab_x", repos: { aizencrm: { ruta: "." } } };
  const con = (agente) => ({ ...base, repos: { aizencrm: { ruta: ".", agente } } });
  assert.throws(() => completarConfig(con({ maxEnParalelo: 0 })), /agente\.maxEnParalelo/);
  assert.throws(() => completarConfig(con({ maxEnParalelo: 9 })), /agente\.maxEnParalelo/);
  assert.throws(() => completarConfig(con({ maxEnParalelo: 1.5 })), /agente\.maxEnParalelo/);
  assert.throws(() => completarConfig(con({ nombre: "" })), /agente\.nombre/);
  assert.throws(() => completarConfig(con({ nombre: 7 })), /agente\.nombre/);
  assert.throws(() => completarConfig(con({ lecciones: 5 })), /agente\.lecciones/);
  assert.throws(() => completarConfig(con("Agente CRM")), /repos\.aizencrm\.agente/);
  assert.deepEqual(completarConfig(con({ nombre: "Agente CRM", lecciones: "docs/l.md", maxEnParalelo: 2 })).repos.aizencrm.agente, { nombre: "Agente CRM", lecciones: "docs/l.md", maxEnParalelo: 2 });
  // marketing apagado (activo:false) no da error aunque no tenga ruta ni carpeta, y no queda en la lista de proyectos.
  const ejemplo = JSON.parse(fs.readFileSync(path.join(AQUI, "..", "config.example.json"), "utf8"));
  assert.equal(ejemplo.repos.marketing.activo, false);
  assert.deepEqual(ejemplo.repos.marketing.agente.nombre, "Agente Marketing");
  const completa = completarConfig(ejemplo);
  assert.ok(!("marketing" in completa.repos));
  assert.deepEqual(Object.values(completa.repos).map((r) => [r.clave, r.agente.nombre, r.agente.maxEnParalelo]), [["aizencrm", "Agente CRM", 2], ["gestion", "Agente Gestión", 1], ["messenger-basic", "Agente Marketplace (NETMAGI)", 1]]);
  assert.doesNotThrow(() => completarConfig({ ...base, repos: { aizencrm: { ruta: "." }, marketing: { activo: false } } }));
  // Prendido, el mismo bloque se completa como los demás.
  assert.ok("marketing" in completarConfig({ ...base, repos: { aizencrm: { ruta: "." }, marketing: { ...ejemplo.repos.marketing, activo: true } } }).repos);
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

await prueba("cerebro: si la tarjeta trae lo que el cerebro ya decidió, el plan lo recibe; sin cerebro el prompt no cambia", async () => {
  const repo = { clave: "aizencrm", subirSolo: true, zonasProtegidas: {} };
  const base = { titulo: "Cambiar precios", tablero: "T", detalle: "d", intentos: 1 };
  const sin = promptDelPlan(base, repo);
  const con = promptDelPlan({ ...base, cerebro: "- Reglas/precios.md: Camilla $1.200.000" }, repo);
  assert.ok(!sin.includes("CEREBRO"));
  assert.match(con, /CEREBRO del negocio ya tiene decidido/);
  assert.match(con, /Reglas\/precios\.md: Camilla \$1\.200\.000/);
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
  assert.match(prompt, /^Eres el Agente CRM del proyecto aizencrm; el Coordinador de Sistemas te pasó esta tarjeta[\s\S]*Contesta SOLO con el plan\.$/);
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
  // 30-oct-2026: el plan que va a la nube no puede ordenar subir a main (lo hace el Coordinador).
  assert.equal(planParaLaNube("Pruebas en verde. Sube a main.\n6) Fin"), "Pruebas en verde. Deja todo en tu rama (el Coordinador lo sube a main).\n6) Fin");
  assert.equal(planParaLaNube("Haz push a main"), "Deja todo en tu rama (el Coordinador lo sube a main).");
  assert.equal(planParaLaNube("El Coordinador sube a main después"), "El Coordinador sube a main después");
  assert.equal(planParaLaNube("git checkout main"), "git checkout main");
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

/* ── 29-oct-2026: 0 HECHO, 19 en ERROR y el 62 % del uso semanal en reintentos (tarjeta ykpl83z3) ── */

const LINK_PRUEBA = "https://claude.ai/code/session_01XuE6FZe3k8GDZESRjd9996";

await prueba("29-oct: la nube sin resultado, la nube que pregunta y el plan con preguntas van directo al dueño (sin reparar), con el link", async () => {
  const sinResultado = diagnosticar({
    error: Object.assign(new Error(`La sesión de la nube no dejó el commit "resultado:" en la rama tablero/ykpl83z3-${"x".repeat(80)} en 120 min (¿se quedó pensando o hizo una pregunta?). Mírala: ${LINK_PRUEBA}`), { categoria: "nube_sin_resultado" }),
    etapa: "construir",
  });
  assert.equal(sinResultado.categoria, "nube_sin_resultado");
  assert.ok(sinResultado.causa.endsWith(LINK_PRUEBA), `el link no se corta: ${sinResultado.causa}`);
  assert.ok(sinResultado.causa.length <= 200);
  // Sin la categoría (un error que llega como texto), el mensaje igual se reconoce (y no como tiempo_agotado).
  assert.equal(diagnosticar({ error: new Error(`La sesión de la nube no dio señal (ni el commit "inicio:" ni ningún otro) en la rama r en 20 min: se cortó la espera. Mírala: ${LINK_PRUEBA}`), etapa: "construir" }).categoria, "nube_sin_resultado");
  assert.equal(diagnosticar({ error: new Error(`La sesión de la nube hizo una pregunta y paró: ¿Qué ruta usa el CRM?. Mírala: ${LINK_PRUEBA}`), etapa: "construir" }).categoria, "nube_pregunta");
  for (const categoria of ["nube_sin_resultado", "nube_pregunta", "plan_con_preguntas"]) {
    const decision = decidir({ diagnostico: { categoria, causa: "x" }, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "construir" });
    assert.deepEqual([decision.accion, decision.cuenta], ["escalar", true], categoria);
  }
  const resumen = resumenDeEscalada({ tarjeta: {}, intentos: [], diagnostico: sinResultado });
  assert.match(resumen, new RegExp(LINK_PRUEBA.replace(/[.]/g, "\\.")));
  assert.match(resumen.split("\n")[2], /^Qué necesita de ti: Abrir el link de la sesión de la nube/);
});

await prueba("29-oct: la misma causa 2 veces en la tarjeta (contando todos los intentos) se escala; las ajenas a la tarea no", async () => {
  const compila = { categoria: "no_compila", causa: "No compila" };
  const dos = [{ accion: "reparar", categoria: "no_compila" }, { accion: "esperar", categoria: "limite_claude" }, { accion: "partir", categoria: "no_compila" }];
  assert.equal(decidir({ diagnostico: compila, tarjeta: { reparaciones: 1, ultimosIntentos: dos }, etapa: "construir" }).accion, "escalar", "2 iguales (reparar y partir) -> escala");
  assert.match(decidir({ diagnostico: compila, tarjeta: { reparaciones: 1, ultimosIntentos: dos }, etapa: "construir" }).motivo, /ya falló 2 veces/);
  // Una sola igual: se repara, y como es la 2ª seguida con Sonnet, con Opus.
  const una = decidir({ diagnostico: compila, tarjeta: { reparaciones: 1, ultimosIntentos: [{ accion: "reparar", categoria: "no_compila" }] }, etapa: "construir", modeloConstruir: "sonnet" });
  assert.deepEqual([una.accion, una.estrategia], ["reparar", "opus"]);
  // Las ajenas a la tarea siguen con su tope de esperas.
  const pc = { categoria: "pc_sobrecargado", causa: "PC" };
  const muchas = Array.from({ length: 3 }, () => ({ accion: "esperar", categoria: "pc_sobrecargado" }));
  assert.equal(decidir({ diagnostico: pc, tarjeta: { esperasSeguidas: 3, ultimosIntentos: muchas }, etapa: "construir" }).accion, "esperar");
  const cortado = { categoria: "coordinador_cortado", causa: "cortado" };
  assert.equal(decidir({ diagnostico: cortado, tarjeta: { esperasSeguidas: 2, ultimosIntentos: muchas.map((i) => ({ ...i, categoria: "coordinador_cortado" })) }, etapa: "construir" }).accion, "esperar");
  // tiempo_agotado la 2ª vez todavía se parte (antes de escalar a la 3ª).
  const lento = { categoria: "tiempo_agotado", causa: "lento" };
  assert.equal(decidir({ diagnostico: lento, tarjeta: { ultimosIntentos: [{ accion: "reparar", categoria: "tiempo_agotado" }] }, etapa: "construir" }).accion, "partir");
});

/* ── 30-oct-2026: diagnóstico antes de reintentar (tarjeta t8qupn87): no repetir a ciegas y nunca ERROR sin motivo ── */

await prueba("30-oct: dos fallas seguidas con la MISMA causa en planear terminan en escalar (sin un tercer intento igual)", async () => {
  const falla = { categoria: "otra", causa: "El plan no dice qué archivos toca (línea 12)" };
  const primera = decidir({ diagnostico: falla, tarjeta: { reparaciones: 0, intentos: 1, ultimosIntentos: [] }, etapa: "planear" });
  assert.equal(primera.accion, "reparar");
  assert.equal(primera.causa, falla.causa, "antes de reparar arma la causa en una frase");
  assert.match(primera.queCambia, /primer arreglo/);
  // La segunda falla es la misma (cambia solo un número): no hay estrategia distinta en planear -> escala.
  const previos = [{ accion: "reparar", etapa: "planear", categoria: "otra", causa: "El plan no dice qué archivos toca (línea 7)" }];
  const segunda = decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, intentos: 2, ultimosIntentos: previos }, etapa: "planear" });
  assert.deepEqual([segunda.accion, segunda.cuenta, segunda.motivo], ["escalar", true, "misma causa que el intento anterior, nada distinto que probar"]);
  assert.equal(segunda.mismaCausa, true);
  // El resumen para el dueño lo dice.
  const resumen = resumenDeEscalada({ tarjeta: { reparaciones: 1 }, intentos: previos, diagnostico: falla, decision: segunda });
  assert.equal(resumen.split("\n").length, 3);
  assert.match(resumen.split("\n")[1], /misma causa que el intento anterior, nada distinto que probar/);
  // Una espera en medio (límite de Claude) no cuenta como intento anterior: se compara con la reparación.
  const conEspera = [...previos, { accion: "esperar", categoria: "limite_claude", causa: "cupo" }];
  assert.equal(decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, ultimosIntentos: conEspera }, etapa: "planear" }).accion, "escalar");
});

await prueba("30-oct: una causa distinta a la anterior sí se repara, y QUÉ CAMBIA lo dice", async () => {
  const previos = [{ accion: "reparar", etapa: "planear", categoria: "otra", causa: "El plan no dice qué archivos toca" }];
  const distinta = decidir({ diagnostico: { categoria: "otra", causa: "El plan contradice al cerebro del negocio" }, tarjeta: { reparaciones: 1, ultimosIntentos: previos }, etapa: "planear" });
  assert.equal(distinta.accion, "reparar");
  assert.match(distinta.queCambia, /distinta a la del intento anterior \(otra: El plan no dice qué archivos toca\)/);
  // Misma categoría pero otra causa también se repara.
  const otraCategoria = decidir({ diagnostico: { categoria: "fallan_pruebas", causa: "Fallaron las pruebas: not ok 3" }, tarjeta: { reparaciones: 1, ultimosIntentos: previos }, etapa: "planear" });
  assert.equal(otraCategoria.accion, "reparar");
});

await prueba("30-oct: construir con la misma causa: primero Opus; si Opus ya se usó, se parte; si es una parte, escala", async () => {
  const falla = { categoria: "no_compila", causa: "El código no compila: error TS2322: el tipo no calza" };
  const previo = (causa) => [{ accion: "reparar", etapa: "construir", categoria: "no_compila", causa }];
  const opus = decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, ultimosIntentos: previo(falla.causa) }, etapa: "construir", modeloConstruir: "sonnet" });
  assert.deepEqual([opus.accion, opus.estrategia], ["reparar", "opus"]);
  assert.match(opus.queCambia, /Opus/);
  // La marca de estrategia no hace distinta la causa: Opus ya se usó -> se parte.
  const yaOpus = previo(`${falla.causa} [estrategia: opus]`);
  assert.equal(decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, ultimosIntentos: yaOpus }, etapa: "construir", modeloConstruir: "sonnet" }).accion, "partir");
  const parte = decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, esParte: true, ultimosIntentos: yaOpus }, etapa: "construir", modeloConstruir: "sonnet" });
  assert.deepEqual([parte.accion, parte.motivo], ["escalar", "misma causa que el intento anterior, nada distinto que probar"]);
  // La causa tal como la guarda el CRM (le agrega " (estrategia: opus)" y recorta a 200): igual se reconoce Opus.
  const comoElCrm = (marcada) => {
    const cola = " (estrategia: opus)";
    return `${marcada.slice(0, 200 - cola.length)}${cola}`;
  };
  const delCrm = previo(comoElCrm(`${falla.causa} [estrategia: opus]`));
  assert.equal(decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, ultimosIntentos: delCrm }, etapa: "construir", modeloConstruir: "sonnet" }).accion, "partir");
  const larga = { ...falla, causa: `El código no compila: ${"x".repeat(170)}` };
  const cortada = previo(comoElCrm(`${larga.causa.slice(0, 159)}… [estrategia: opus]`));
  assert.equal(decidir({ diagnostico: larga, tarjeta: { reparaciones: 1, ultimosIntentos: cortada }, etapa: "construir", modeloConstruir: "sonnet" }).accion, "partir", "con la causa larga recortada también");
  assert.equal(reparacionDeLaTarjeta({ reparaciones: 1, ultimosIntentos: [{ accion: "reparar", categoria: "no_compila", causa: "X [estrategia: op (estrategia: opus)" }] }).causa, "X");
  assert.equal(reparacionDeLaTarjeta({ reparaciones: 1, ultimosIntentos: [{ accion: "reparar", categoria: "no_compila", causa: "X [estrategia: op (estrategia: opus)" }] }).estrategia, "opus");
  // Verificar en la nube: la 1ª vez se repara en la nube; si eso ya se probó y la causa es la misma, escala.
  const nube = decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, ultimosIntentos: previo(falla.causa) }, etapa: "subir", verificarEnNube: true });
  assert.deepEqual([nube.accion, nube.estrategia], ["reparar", "nube"]);
  assert.match(nube.queCambia, /nube/);
  assert.equal(decidir({ diagnostico: falla, tarjeta: { reparaciones: 1, ultimosIntentos: previo(`${falla.causa} [estrategia: nube]`) }, etapa: "subir", verificarEnNube: true }).accion, "escalar");
  // Las esperas no cambian: el PC lleno con la misma causa sigue esperando.
  const pc = { categoria: "pc_sobrecargado", causa: "PC" };
  assert.equal(decidir({ diagnostico: pc, tarjeta: { esperasSeguidas: 1, ultimosIntentos: [{ accion: "reparar", categoria: "pc_sobrecargado", causa: "PC" }] }, etapa: "construir" }).accion, "esperar");
});

await prueba("30-oct: el bucle no gasta un intento igual: escala con la causa y el motivo, y al reparar manda CAUSA y QUÉ CAMBIA", async () => {
  const config = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", carpetaTrabajo: fs.mkdtempSync(path.join(os.tmpdir(), "misma-causa-")), repos: { a: { ruta: "." } } });
  const llamadas = [];
  const crmFalso = {
    latido: async () => ({ ok: true }),
    reparar: async (id, datos) => (llamadas.push(["reparar", id, datos]), { ok: true, reparaciones: 1 }),
    error: async (id, motivo, zonas, reversion, extra) => (llamadas.push(["error", id, motivo, extra]), { ok: true }),
    soltar: async () => ({ ok: true }),
  };
  const lineas = [];
  const registroFalso = { info: (m) => lineas.push(m), aviso: (m) => lineas.push(m), error: (m) => lineas.push(m) };
  // Una etapa que este Coordinador no conoce falla siempre con el mismo error: sirve para probar la decisión sin Claude.
  const causa = 'El CRM pidió "repetir", que este Coordinador no sabe hacer (¿hay que actualizarlo?).';
  const base = { id: "mc1", titulo: "Misma causa", repo: "aizencrm", topeReparaciones: 3, intentos: 2 };
  const igual = await procesar({ crm: crmFalso, config, registro: registroFalso }, { ...base, reparaciones: 1, ultimosIntentos: [{ accion: "reparar", etapa: "repetir", categoria: "otra", causa }] }, "repetir");
  assert.equal(igual.accion, "escalar");
  assert.equal(llamadas.filter(([que]) => que === "reparar").length, 0, "no hay un tercer intento igual");
  const [, , motivo, extra] = llamadas.find(([que]) => que === "error");
  assert.match(motivo, /misma causa que el intento anterior, nada distinto que probar/);
  assert.ok(extra.causa.trim(), "crm.error lleva la causa");
  // Con otra causa antes: se repara, con la causa y lo que cambia.
  llamadas.length = 0;
  const distinta = await procesar({ crm: crmFalso, config, registro: registroFalso }, { ...base, reparaciones: 1, ultimosIntentos: [{ accion: "reparar", etapa: "repetir", categoria: "no_compila", causa: "No compila" }] }, "repetir");
  assert.equal(distinta.accion, "reparar");
  const [, , datos] = llamadas.find(([que]) => que === "reparar");
  assert.equal(datos.causa, causa);
  assert.ok(lineas.some((linea) => /^CAUSA: .+ \| QUÉ CAMBIA: la falla es distinta/.test(linea)), "queda escrito antes de reparar");
});

await prueba("30-oct: el prompt de la reparación empieza con CAUSA y QUÉ CAMBIA (armado con los intentos guardados)", async () => {
  const repo = { clave: "aizencrm", ruta: "." };
  const tarjeta = {
    id: "rp1",
    titulo: "Reparar con causa",
    detalle: "x",
    plan: "El plan",
    repo: "aizencrm",
    reparaciones: 2,
    topeReparaciones: 3,
    ultimoError: "error TS2322",
    ultimosIntentos: [
      { accion: "reparar", etapa: "construir", categoria: "fallan_pruebas", causa: "Fallaron las pruebas: not ok 4" },
      { accion: "reparar", etapa: "construir", categoria: "no_compila", causa: "El código no compila: error TS2322 [estrategia: opus]" },
    ],
  };
  const prompt = promptDeConstruir({ ...tarjeta, reparacion: reparacionDeLaTarjeta(tarjeta) }, repo, "tablero/rp1");
  const bloque = prompt.slice(prompt.indexOf("\nCAUSA: ") + 1);
  const [causa, queCambia, reparacion] = bloque.split("\n");
  assert.equal(causa, "CAUSA: El código no compila: error TS2322 (categoría: no_compila)", "sin la marca de estrategia");
  assert.match(queCambia, /^QUÉ CAMBIA: se construye con un modelo más fuerte \(Opus\)/);
  assert.match(reparacion, /^REPARACIÓN 2 de 3/);
  // Sin estrategia y con otra causa antes, QUÉ CAMBIA lo dice; sin intentos previos, es el primer arreglo.
  const sinMarca = { ...tarjeta, ultimosIntentos: [tarjeta.ultimosIntentos[0], { ...tarjeta.ultimosIntentos[1], causa: "El código no compila: error TS2322" }] };
  assert.match(reparacionDeLaTarjeta(sinMarca).queCambia, /distinta a la del intento anterior \(fallan_pruebas/);
  assert.match(reparacionDeLaTarjeta({ ...tarjeta, reparaciones: 1, ultimosIntentos: [tarjeta.ultimosIntentos[0]] }).queCambia, /primer arreglo/);
});

await prueba("31-oct: choca con main no gasta reparación: 1º a 3º choque seguido se reconstruye (cuenta: false), el 4º escala; choque_de_logica siempre escala", () => {
  const choque = { categoria: "choca_con_main", causa: "Choca con lo nuevo de main: conflicto en el rebase de tablero/x" };
  const choques = (n) => Array.from({ length: n }, () => ({ accion: "esperar", categoria: "choca_con_main", causa: choque.causa, cuentaComoIntento: false }));
  for (const previos of [0, 1, 2]) {
    const decision = decidir({ diagnostico: choque, tarjeta: { reparaciones: 1, topeReparaciones: 3, ultimosIntentos: [{ accion: "reparar", categoria: "no_compila", causa: "X", cuentaComoIntento: true }, ...choques(previos)] }, etapa: "subir" });
    assert.deepEqual([decision.accion, decision.cuenta, decision.arreglo], ["esperar", false, "reconstruir"], `${previos + 1}º choque seguido`);
  }
  // Ni la regla de "misma categoría 2 veces" ni la de "misma causa" ni el tope de reparaciones lo frenan: no es culpa de la tarea.
  assert.equal(decidir({ diagnostico: choque, tarjeta: { reparaciones: 3, topeReparaciones: 3, ultimosIntentos: [{ accion: "reparar", categoria: "choca_con_main", causa: choque.causa, cuentaComoIntento: true }, ...choques(2)] }, etapa: "subir" }).cuenta, false);
  const cuarto = decidir({ diagnostico: choque, tarjeta: { reparaciones: 0, ultimosIntentos: choques(3) }, etapa: "subir" });
  assert.equal(cuarto.accion, "escalar", "el 4º choque seguido escala");
  assert.equal(cuarto.motivo.includes("\n"), false, "el motivo en una línea");
  assert.match(cuarto.motivo, /4 veces seguidas/);
  // Una falla que sí cuenta en medio corta la racha: vuelve a reconstruir.
  assert.equal(decidir({ diagnostico: choque, tarjeta: { ultimosIntentos: [...choques(3), { accion: "reparar", categoria: "no_compila", causa: "X", cuentaComoIntento: true }] }, etapa: "subir" }).accion, "esperar");
  // Otras esperas en medio (límite de Claude) no cortan la racha.
  assert.equal(decidir({ diagnostico: choque, tarjeta: { ultimosIntentos: [...choques(2), { accion: "esperar", categoria: "limite_claude", cuentaComoIntento: false }, ...choques(1)] }, etapa: "subir" }).accion, "escalar");
  // El CRM cuenta igual (los topes del Coordinador y del CRM son los mismos).
  assert.equal(reglas.TOPE_DE_CHOQUES_SEGUIDOS, 3);
  assert.equal(reglas.choquesSeguidos(choques(3)), 3);
  assert.equal(reglas.puedeReconstruirPorChoque(2), null);
  assert.match(reglas.puedeReconstruirPorChoque(3), /3 veces seguidas/);
  // choque_de_logica: categoría nueva, siempre escala, no se repara sola.
  assert.ok(reglas.CATEGORIAS_DE_INTENTO.includes("choque_de_logica"));
  const logica = decidir({ diagnostico: { categoria: "choque_de_logica", causa: "main y la tarea no encajan" }, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "subir" });
  assert.deepEqual([logica.accion, logica.cuenta], ["escalar", true]);
  assert.match(resumenDeEscalada({ tarjeta: {}, intentos: [], diagnostico: { categoria: "choque_de_logica", causa: "" } }), /choque de lógica[\s\S]*decidir cómo juntarlos/);
});

await prueba("31-oct: el bucle reconstruye un choque con main con /reparar cuenta: false; si el CRM ya no deja (409), escala", async () => {
  const config = completarConfig({ urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", carpetaTrabajo: fs.mkdtempSync(path.join(os.tmpdir(), "choque-")), repos: { a: { ruta: "." } } });
  const llamadas = [];
  let tope = false;
  const crmFalso = {
    latido: async () => ({ ok: true }),
    reparar: async (id, datos) => {
      llamadas.push(["reparar", id, datos]);
      if (tope) throw Object.assign(new Error("Ya chocó con main 3 veces seguidas"), { status: 409 });
      return { ok: true, reparaciones: 0 };
    },
    error: async (id, motivo) => (llamadas.push(["error", id, motivo]), { ok: true }),
    soltar: async (id) => (llamadas.push(["soltar", id]), { ok: true }),
  };
  const registroFalso = { info: () => {}, aviso: () => {}, error: () => {} };
  // Una etapa que este Coordinador no conoce falla siempre, con su nombre en el error: así el error dice "choca con lo nuevo".
  const base = { id: "ch1", titulo: "Choque", repo: "aizencrm", topeReparaciones: 3, reparaciones: 0, intentos: 1, ultimosIntentos: [] };
  const primera = await procesar({ crm: crmFalso, config, registro: registroFalso }, base, "Choca con lo nuevo de main: conflicto en el rebase");
  assert.equal(primera.categoria, "choca_con_main");
  const [, , datos] = llamadas.find(([que]) => que === "reparar");
  assert.deepEqual([datos.cuenta, datos.categoria], [false, "choca_con_main"]);
  assert.equal(llamadas.some(([que]) => que === "error" || que === "soltar"), false, "ni ERROR ni soltar");
  llamadas.length = 0;
  tope = true;
  const otra = await procesar({ crm: crmFalso, config, registro: registroFalso }, base, "Choca con lo nuevo de main: conflicto en el rebase");
  assert.equal(otra.accion, "escalar");
  assert.equal(llamadas.filter(([que]) => que === "error").length, 1, "con el 409 del CRM se escala");
});

await prueba("31-oct: resolver-choque lee la última línea (CHOQUE_SIMPLE / CHOQUE_DE_LOGICA) y reconoce las migraciones", () => {
  assert.deepEqual(respuestaDelChoque("Junté las dos.\nCHOQUE_SIMPLE: OK\n"), { tipo: "simple" });
  assert.deepEqual(respuestaDelChoque("Miré.\n**CHOQUE_DE_LOGICA: las dos cambian el precio**\n"), { tipo: "logica", motivo: "las dos cambian el precio" }, "sin el formato de markdown");
  assert.deepEqual(respuestaDelChoque("CHOQUE_DE_LOGICA: las dos cambian el precio"), { tipo: "logica", motivo: "las dos cambian el precio" });
  assert.equal(respuestaDelChoque("CHOQUE_SIMPLE: OK\nY algo más al final"), null, "solo cuenta la última línea");
  assert.equal(respuestaDelChoque(""), null);
  assert.equal(esDeMigraciones("prisma/migrations/2026_x/migration.sql"), true);
  assert.equal(esDeMigraciones("prisma/schema.prisma"), false);
  assert.equal(esDeMigraciones("db/mig/a.sql", "db/mig/"), true);
  const orden = promptDeResolverChoque({ tarjeta: { titulo: "Una tarea" }, ramaBase: "main", conflicto: ["src/a.ts"] });
  assert.match(orden, /^RESOLVER EL CHOQUE CON MAIN/);
  assert.match(orden, /^Tarea: Una tarea$/m);
  assert.match(orden, /^- src\/a\.ts$/m);
  assert.match(orden, /CHOQUE_SIMPLE: OK\nCHOQUE_DE_LOGICA: /);
});

await prueba("31-oct: resolver-choque: migración sin llamar a Claude, archivos de más, marcas que quedan y verificar que falla cancelan el rebase", async () => {
  const D = fs.mkdtempSync(path.join(os.tmpdir(), "resolver-choque-"));
  const gr = (...args) => execFileSync("git", ["-c", "user.name=P", "-c", "user.email=p@x.co", ...args], { cwd: D, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const escribir = (relativo, texto) => {
    fs.mkdirSync(path.dirname(path.join(D, relativo)), { recursive: true });
    fs.writeFileSync(path.join(D, relativo), texto);
  };
  try {
    gr("init", "-b", "main");
    escribir("a.txt", "base\n");
    escribir("otro.txt", "otro\n");
    escribir("prisma/migrations/1_x/migration.sql", "SELECT 1;\n");
    gr("add", "-A");
    gr("commit", "-m", "base");
    // La rama cambia a.txt y la migración; main cambia lo mismo después.
    gr("checkout", "-b", "tarea");
    escribir("a.txt", "de la tarea\n");
    gr("commit", "-am", "tarea a");
    escribir("prisma/migrations/1_x/migration.sql", "SELECT 2;\n");
    gr("commit", "-am", "tarea migración");
    gr("checkout", "main");
    escribir("a.txt", "de main\n");
    escribir("prisma/migrations/1_x/migration.sql", "SELECT 3;\n");
    gr("commit", "-am", "main");
    gr("checkout", "tarea");
    const cabeza = gr("rev-parse", "HEAD");
    const identidad = { nombre: "P", correo: "p@x.co" };
    const enRebase = () => fs.existsSync(path.join(D, ".git", "rebase-merge")) || fs.existsSync(path.join(D, ".git", "rebase-apply"));
    const comun = { carpeta: D, tarjeta: { titulo: "T" }, ramaBase: "main", carpetaMigraciones: "prisma/migrations", identidad };
    const juntar = (archivo) => {
      const texto = fs.readFileSync(path.join(D, archivo), "utf8");
      fs.writeFileSync(path.join(D, archivo), texto.split("\n").filter((linea) => !/^(<{7}|={7}|>{7})/.test(linea)).join("\n"));
    };
    let llamadas = 0;

    // 1. Choque simple en a.txt y después la migración: la 2ª vuelta va directo a choque de lógica, sin llamar a Claude.
    let rebase = await rebaseSobre(D, "main", { identidad, carpetaTrabajo: `${D}-trabajo`, nombre: "prueba", dejarConflicto: true });
    assert.deepEqual([rebase.ok, rebase.conflicto, rebase.cabeza], [false, ["a.txt"], cabeza]);
    assert.ok(enRebase(), "el rebase quedó a medias");
    let salida = await resolverChoque({ ...comun, rebase, verificar: async () => ["✔ verificado"], correrClaude: async () => (llamadas += 1, juntar("a.txt"), "CHOQUE_SIMPLE: OK") });
    assert.equal(salida.resultado, "logica", salida.motivo);
    assert.match(salida.motivo, /migración \(prisma\/migrations\/1_x\/migration\.sql\)/);
    assert.equal(llamadas, 1, "Claude solo resolvió a.txt; la migración no la toca");
    assert.deepEqual([enRebase(), gr("rev-parse", "HEAD")], [false, cabeza], "rebase cancelado y la rama como estaba");

    // 2. La sesión cambia un archivo que no estaba en conflicto: no se le cree.
    rebase = await rebaseSobre(D, "main", { identidad, carpetaTrabajo: `${D}-trabajo`, nombre: "prueba", dejarConflicto: true });
    salida = await resolverChoque({ ...comun, rebase, verificar: async () => [], correrClaude: async () => (juntar("a.txt"), fs.appendFileSync(path.join(D, "otro.txt"), "de más\n"), "CHOQUE_SIMPLE: OK") });
    assert.equal(salida.resultado, "no_se_pudo");
    assert.match(salida.motivo, /no estaban en conflicto \(otro\.txt\)/);
    assert.deepEqual([enRebase(), gr("rev-parse", "HEAD"), gr("status", "--porcelain")], [false, cabeza, ""]);

    // 3. Dice CHOQUE_SIMPLE pero deja las marcas.
    rebase = await rebaseSobre(D, "main", { identidad, carpetaTrabajo: `${D}-trabajo`, nombre: "prueba", dejarConflicto: true });
    salida = await resolverChoque({ ...comun, rebase, verificar: async () => [], correrClaude: async () => "CHOQUE_SIMPLE: OK" });
    assert.deepEqual([salida.resultado, /marcas <<<<<<< en a\.txt/.test(salida.motivo)], ["no_se_pudo", true]);
    assert.equal(gr("rev-parse", "HEAD"), cabeza);

    // 4. Sin la migración en la rama: se junta, el rebase termina y, si verificar falla, se cancela igual (la rama vuelve a la cabeza).
    gr("reset", "--hard", "HEAD~1");
    const sinMigracion = gr("rev-parse", "HEAD");
    rebase = await rebaseSobre(D, "main", { identidad, carpetaTrabajo: `${D}-trabajo`, nombre: "prueba", dejarConflicto: true });
    salida = await resolverChoque({ ...comun, rebase, verificar: async () => { throw new Error("No compiló: falló el build\ndetalle"); }, correrClaude: async () => (juntar("a.txt"), "CHOQUE_SIMPLE: OK") });
    assert.deepEqual([salida.resultado, salida.motivo], ["no_se_pudo", "lo juntado no pasa build o pruebas: No compiló: falló el build"]);
    assert.deepEqual([enRebase(), gr("rev-parse", "HEAD")], [false, sinMigracion]);

    // 5. Y si verifica: el rebase terminó encima de main con las dos versiones.
    rebase = await rebaseSobre(D, "main", { identidad, carpetaTrabajo: `${D}-trabajo`, nombre: "prueba", dejarConflicto: true });
    salida = await resolverChoque({ ...comun, rebase, verificar: async () => ["✔ verificado"], correrClaude: async () => (juntar("a.txt"), "CHOQUE_SIMPLE: OK") });
    assert.equal(salida.resultado, "simple");
    assert.match(salida.pruebas[0], /choque con main resuelto solo \(a\.txt\)/);
    assert.equal(salida.pruebas[1], "✔ verificado");
    assert.equal(enRebase(), false);
    assert.equal(gr("merge-base", "HEAD", "main"), gr("rev-parse", "main"), "quedó encima de main");
    assert.equal(fs.readFileSync(path.join(D, "a.txt"), "utf8"), "de main\nde la tarea\n");

    // 6. Una falla del entorno (límite de uso) se relanza con el rebase cancelado.
    gr("reset", "--hard", sinMigracion);
    rebase = await rebaseSobre(D, "main", { identidad, carpetaTrabajo: `${D}-trabajo`, nombre: "prueba", dejarConflicto: true });
    await assert.rejects(resolverChoque({ ...comun, rebase, verificar: async () => [], correrClaude: async () => { throw Object.assign(new Error("límite"), { limiteDeUso: true }); } }), /límite/);
    assert.deepEqual([enRebase(), gr("rev-parse", "HEAD")], [false, sinMigracion]);
  } finally {
    fs.rmSync(D, { recursive: true, force: true, maxRetries: 3 });
    fs.rmSync(`${D}-trabajo`, { recursive: true, force: true, maxRetries: 3 });
  }
});

await prueba("30-oct: crm.error y crm.reparar nunca salen con el motivo o la causa vacíos", async () => {
  const cuerpos = [];
  const fetchFalso = async (url, opciones) => {
    cuerpos.push([url.split("/").pop(), JSON.parse(opciones.body)]);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const crm = crearCrm({ urlCrm: "https://crm.test", claveTrabajador: "k" }, { fetch: fetchFalso });
  await crm.error("t1", "   ", undefined, undefined, { etapa: "planear", categoria: "otra", causa: "" });
  await crm.error("t2", "");
  await crm.reparar("t3", { etapa: "construir", categoria: "no_compila", causa: " " });
  const [[, error1], [, error2], [, reparar]] = cuerpos;
  assert.equal(error1.motivo, "El Coordinador no supo la causa (etapa planear).");
  assert.equal(error1.causa, "El Coordinador no supo la causa (etapa planear).");
  assert.equal(error2.motivo, "El Coordinador no supo la causa (etapa ?).");
  assert.equal(reparar.causa, "El Coordinador no supo la causa (etapa construir).");
  // Lo que sí trae texto viaja tal cual.
  await crm.error("t4", "No compila", undefined, undefined, { etapa: "construir", categoria: "no_compila", causa: "error TS2322" });
  assert.deepEqual([cuerpos[3][1].motivo, cuerpos[3][1].causa], ["No compila", "error TS2322"]);
});

await prueba("31-oct: crm.aviso manda tarjetaId en el cuerpo solo cuando viene", async () => {
  const cuerpos = [];
  const fetchFalso = async (url, opciones) => {
    cuerpos.push([url, JSON.parse(opciones.body)]);
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  const crm = crearCrm({ urlCrm: "https://crm.test", claveTrabajador: "k" }, { fetch: fetchFalso });
  await crm.aviso("hola", "necesita", "tar_1");
  await crm.aviso("se agotó", "limite");
  await crm.aviso("solo texto");
  assert.ok(cuerpos.every(([url]) => url === "https://crm.test/api/trabajador/aviso"));
  assert.deepEqual(cuerpos.map(([, cuerpo]) => cuerpo), [
    { texto: "hola", tipo: "necesita", tarjetaId: "tar_1" },
    { texto: "se agotó", tipo: "limite" },
    { texto: "solo texto" },
  ]);
});

await prueba("29-oct: preguntas abiertas del plan (la sección PREGUNTAS ABIERTAS y las frases de duda); el plan de ykpl83z3 las tiene", async () => {
  const ykpl = [
    "Al terminar: espera tu sí",
    "RIESGO: ALTO — Lee saldos de dinero. No cambia ningún dato, pero hay que confirmar con el CRM cómo se envía el mensaje.",
    "APROBAR PLAN: SOLO",
    "## 3. Riesgos",
    "- **Cómo se envía el WhatsApp:** No pude comprobar que exista una dirección HTTP con llave.",
    "  - Antes de construir hay que revisar con el CRM cuál es esa entrada.",
    "## 6. Cómo se va a probar",
    "- Pruebas de la regla pura.",
    "",
    "Lo que no revisé y queda pendiente:",
    "- El contrato exacto de envío de WhatsApp del CRM.",
    "",
    "Plan escrito con: Claude Code (Sonnet)",
  ].join("\n");
  const preguntas = preguntasAbiertasDelPlan(ykpl);
  assert.equal(preguntas.length, 4);
  assert.match(preguntas[0], /hay que confirmar con el CRM/);
  assert.match(preguntas[3], /^Lo que no revisé y queda pendiente: El contrato exacto de envío de WhatsApp del CRM\.$/);
  assert.match(primeraPreguntaAbierta(ykpl), /hay que confirmar/);
  // La sección: "ninguna" no cuenta; una lista numerada sí.
  assert.deepEqual(preguntasAbiertasDelPlan("## 1. Qué se cambia\nUn botón.\n\nPREGUNTAS ABIERTAS: ninguna\n\nPlan escrito con: x"), []);
  assert.deepEqual(preguntasAbiertasDelPlan("**PREGUNTAS ABIERTAS:**\n- Ninguna.\n"), []);
  assert.deepEqual(preguntasAbiertasDelPlan("## 6. Pruebas\nx\n\nPREGUNTAS ABIERTAS:\n1. ¿Existe la ruta del CRM?\n2. Qué línea usa\n\nPlan escrito con: x"), ["¿Existe la ruta del CRM?", "Qué línea usa"]);
  assert.deepEqual(preguntasAbiertasDelPlan("PREGUNTAS ABIERTAS: ¿Quién recibe el aviso?"), ["¿Quién recibe el aviso?"]);
  // Lo de negocio no es una duda: una venta que "queda pendiente de pago".
  assert.deepEqual(preguntasAbiertasDelPlan("## 1. Qué se cambia\nLa venta queda pendiente de pago hasta el abono.\nPREGUNTAS ABIERTAS: ninguna"), []);
  assert.equal(primeraPreguntaAbierta("Un plan limpio.\nPREGUNTAS ABIERTAS: ninguna"), null);
  // La instrucción de planear pide la sección.
  const repo = { clave: "aizencrm" };
  assert.match(promptDelPlan({ id: "t", titulo: "t", detalle: "d", tablero: "E" }, repo), /"PREGUNTAS ABIERTAS:"[^\n]*"PREGUNTAS ABIERTAS: ninguna"/);
});

await prueba("29-oct: la nube deja 'inicio:' y, si pregunta, 'pregunta:'; esperarResultado corta enseguida o a los sinSenalMinutos", async () => {
  assert.equal(preguntaDelCommit("pregunta: ¿Cuál es la ruta del CRM para mandar WhatsApp?"), "¿Cuál es la ruta del CRM para mandar WhatsApp?");
  assert.equal(preguntaDelCommit("Pregunta:   "), null);
  assert.equal(preguntaDelCommit("arreglar la pregunta: x"), null);
  assert.ok(esCommitDeInicio("inicio: tablero/x") && !esCommitDeInicio("tablero: inicio: x"));
  const texto = promptDeNube({ id: "t", titulo: "t", detalle: "d", tablero: "E", plan: "p" }, { clave: "aizencrm" }, "tablero/abc");
  assert.match(texto, /git commit --allow-empty -m "inicio: tablero\/abc" && git push origin tablero\/abc/);
  assert.match(texto, /NO preguntes en el chat[^\n]*git commit --allow-empty -m "pregunta: <la pregunta en una línea>"/);
  // Un `gh` falso: contesta los commits que dice GH_COMMITS_PRUEBA (JSON por línea, del más nuevo al más viejo).
  const gh = [process.execPath, "-e", "process.stdout.write(process.env.GH_COMMITS_PRUEBA || '')"];
  const esperar = (commits, nube) => {
    process.env.GH_COMMITS_PRUEBA = commits.map((c) => JSON.stringify(c)).join("\n");
    const contexto = { config: { nube: { comandoGh: gh, vigilarCadaSegundos: 0.05, esperaMinutos: 1, sinSenalMinutos: 1, ...nube } }, registro: { info() {}, aviso() {} } };
    return esperarResultado(contexto, { repo: { github: "a/b", ruta: AQUI }, rama: "tablero/abc", vistos: new Set(["viejo"]), reloj: { resta: () => 1e9 }, link: LINK_PRUEBA });
  };
  try {
    const empezo = Date.now();
    await assert.rejects(esperar([{ sha: "p1", mensaje: "pregunta: ¿Qué ruta usa el CRM?" }, { sha: "i1", mensaje: "inicio: tablero/abc" }]), (error) => {
      assert.equal(error.categoria, "nube_pregunta");
      assert.match(error.message, /hizo una pregunta y paró: ¿Qué ruta usa el CRM\?/);
      assert.ok(error.message.includes(LINK_PRUEBA));
      return true;
    });
    assert.ok(Date.now() - empezo < 20_000, "la pregunta corta enseguida, no a los 120 min");
    // Ni inicio ni nada: corta a los sinSenalMinutos (acá 0,002 min) aunque la espera larga sea de 1 min.
    await assert.rejects(esperar([{ sha: "viejo", mensaje: "base" }], { sinSenalMinutos: 0.002 }), (error) => {
      assert.equal(error.categoria, "nube_sin_resultado");
      assert.match(error.message, /no dio señal/);
      return true;
    });
    // Con inicio pero sin resultado: respeta la espera larga y al vencer es nube_sin_resultado (no tiempo_agotado).
    await assert.rejects(esperar([{ sha: "i1", mensaje: "inicio: tablero/abc" }], { sinSenalMinutos: 0.001, esperaMinutos: 0.004 }), (error) => {
      assert.equal(error.categoria, "nube_sin_resultado");
      assert.match(error.message, /no dejó el commit "resultado:"/);
      return true;
    });
    // Un "resultado:" después de la pregunta (más nuevo) manda.
    const bien = await esperar([{ sha: "r1", mensaje: "resultado: build=OK tests=OK segundos=9" }, { sha: "p1", mensaje: "pregunta: x" }]);
    assert.deepEqual([bien.paso, bien.sha], [true, "r1"]);
  } finally {
    delete process.env.GH_COMMITS_PRUEBA;
  }
  // La configuración: sinSenalMinutos por defecto 20, validado y nunca más que la espera.
  const base = { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", carpetaTrabajo: os.tmpdir(), repos: { aizencrm: { ruta: AQUI } } };
  assert.equal(completarConfig(base).nube.sinSenalMinutos, 20);
  assert.equal(completarConfig({ ...base, nube: { esperaMinutos: 10, sinSenalMinutos: 30 } }).nube.sinSenalMinutos, 10);
  assert.throws(() => completarConfig({ ...base, nube: { sinSenalMinutos: 0 } }), /nube\.sinSenalMinutos/);
});

await prueba("29-oct: un plan que toca más de una parte del sistema se parte antes de construir; partir compara por parte, no por nombre exacto", async () => {
  const planYkpl = [
    "## 1. Qué se cambia",
    "Una ruta en Gestión, como `/api/catalogo` y `/api/transporte`, y un script con cron diario en aizen1, como el respaldo nocturno.",
    "## 5. Archivos que se tocan",
    "- `src/app/api/alertas/cuentas/route.ts`",
    "- `src/modules/alertas-cuentas/domain/alerta-cuentas.ts`",
    "- `src/modules/alertas-cuentas/domain/alerta-cuentas.test.ts`",
    "- `src/modules/alertas-cuentas/application/revisar-cuentas.ts`",
    "- `scripts/alertas/avisar-cuentas.sh`",
    "- `src/modules/balances/infrastructure/prisma-money-without-account.ts`",
    "- `CLAUDE.md`",
    "- `docs/asesor/gestion.md`",
    "## 6. Cómo se va a probar",
  ].join("\n");
  assert.deepEqual(parteDelSistema("src/app/api/alertas/cuentas/route.ts"), { clave: "app/api/alertas", nombre: "alerta" });
  assert.deepEqual(parteDelSistema("src/modules/alertas-cuentas/domain/x.ts"), { clave: "modules/alertas-cuentas", nombre: "alerta" });
  assert.equal(parteDelSistema("src/lib/prisma.ts"), null, "el pegamento no es una parte");
  assert.equal(parteDelSistema("src/app/actions/x-actions.ts"), null);
  assert.equal(parteDelSistema("docs/asesor/gestion.md"), null);
  const { partes, otroSistema } = partesDelSistemaDelPlan(planYkpl);
  assert.equal(partes.length, 2, partes.join(" | "));
  assert.match(otroSistema, /cron diario en aizen1/);
  const decision = debePartirAntes({ plan: planYkpl });
  assert.equal(decision.partir, true);
  assert.match(decision.motivo, /3 partes del sistema/);
  assert.equal(debePartirAntes({ plan: planYkpl }, { soloPorPartes: true }).partir, true);
  // Pantalla + su módulo del mismo tema es UNA parte; una sola parte en la nube no se parte.
  const unaParte = "## 5. Archivos\n- src/features/tableros-inteligentes/services/x.ts\n- src/app/cliente/tablero-ia/page.tsx\n- src/app/actions/tableros-inteligentes-actions.ts\n- prisma/schema.prisma";
  assert.equal(partesDelSistemaDelPlan(unaParte).partes.length, 1);
  assert.equal(debePartirAntes({ plan: unaParte }, { soloPorPartes: true }).partir, false);
  assert.equal(debePartirAntes({ plan: planYkpl, esParte: true }).partir, false, "una parte no se parte más");
  // Otro repo nombrado en el plan cuenta como otro sistema.
  assert.ok(partesDelSistemaDelPlan("## 5. Archivos\n- src/features/a/x.ts\nY en el repo gestion una ruta nueva.", { otrosRepos: ["gestion"] }).otroSistema);
  // Las partes de ykpl83z3 que se rechazaron el 29-oct ("lib, modules, prisma, scripts/respaldo", "app/api/transporte/ubicaciones"): ahora pasan.
  const partesYkpl = [
    { titulo: "Regla y ruta", detalle: "## Archivos\n- src/modules/alertas-cuentas/domain/alerta-cuentas.ts\n- src/app/api/alertas/cuentas/route.ts\n- src/lib/prisma.ts\n- prisma/schema.prisma\n- Ver src/app/api/transporte/ubicaciones/route.ts y src/app/api/catalogo/productos/route.ts como molde" },
    { titulo: "Script y cron", detalle: "## Archivos\n- scripts/alertas/avisar-cuentas.sh\n- como scripts/respaldo/respaldo.sh" },
  ];
  assert.deepEqual(partesSinAlcanceNuevo(planYkpl, partesYkpl), { ok: true, fuera: [] });
  // Una parte de verdad nueva (un tema que el plan no nombra) sigue fuera.
  assert.deepEqual(partesSinAlcanceNuevo(planYkpl, [...partesYkpl, { titulo: "Extra", detalle: "- src/modules/nomina/x.ts" }]), { ok: false, fuera: ["modules/nomina"] });
});

/* ── 29-oct-2026: la revisión de los 4 (seguridad, experiencia, diseño, código) antes de subir ── */

await prueba("29-oct revisión: veredictos, pantallas, 'resultado:' con y sin revision=, la categoría revision_no_paso (sin reparar) y la instrucción de la nube", async () => {
  assert.deepEqual(veredictoDeLaRespuesta("APROBADO\n(nada que decir)"), { estado: "APROBADO", cambios: [] });
  assert.deepEqual(veredictoDeLaRespuesta("Miré todo.\n**VEREDICTO: CAMBIOS**\n- src/a.ts: validar quién llama\n2. src/b.ts: falta el caso vacío\nGracias."), {
    estado: "CAMBIOS",
    cambios: ["src/a.ts: validar quién llama", "src/b.ts: falta el caso vacío"],
  });
  assert.deepEqual(veredictoDeLaRespuesta("CAMBIOS"), { estado: "CAMBIOS", cambios: ["(no dijo qué cambiar)"] });
  assert.equal(veredictoDeLaRespuesta("Me parece razonable.").estado, "sin respuesta", "sin veredicto no frena");
  assert.equal(veredictoDeLaRespuesta(`CAMBIOS\n${Array.from({ length: 9 }, (_, i) => `- a${i}.ts: x`).join("\n")}`).cambios.length, 5, "como mucho 5 pedidos");
  assert.ok(!tocaPantallas(["trabajador-tablero/lib/a.mjs", "src/lib/x.ts"]) && tocaPantallas(["src/app/cliente/page.tsx"]) && tocaPantallas(["src/app/globals.css"]));
  assert.equal(revisorPorClave("Diseño").clave, "diseno");
  assert.equal(revisorPorClave("CODIGO").clave, "codigo");
  // El commit "resultado:" de una sesión VIEJA (sin revision=) sigue igual: sin campos nuevos.
  assert.deepEqual(resultadoDelCommit("resultado: build=OK tests=OK segundos=9"), { build: "OK", tests: "OK", segundos: 9, paso: true, detalle: "" });
  const ok = resultadoDelCommit("resultado: build=OK tests=OK segundos=9 revision=OK\n\nseguridad: APROBADO");
  assert.deepEqual([ok.paso, ok.revision, ok.revisor, ok.motivoRevision, ok.segundos], [true, "OK", null, null, 9]);
  const fallo = resultadoDelCommit("resultado: build=OK tests=OK segundos=9 revision=FALLO revisor=seguridad motivo=src/a.ts: validar quién llama\n\nseguridad: CAMBIOS — src/a.ts");
  assert.deepEqual([fallo.paso, fallo.revision, fallo.revisor, fallo.motivoRevision], [true, "FALLO", "seguridad", "src/a.ts: validar quién llama"]);
  assert.equal(fallo.detalle, "seguridad: CAMBIOS — src/a.ts");
  assert.equal(resultadoDelCommit('resultado: build=OK tests=OK revisión=FALLO revisor="codigo" motivo="falta la prueba"').motivoRevision, "falta la prueba");
  // El diagnóstico: con la categoría o solo por el texto; no se repara sola (como nube_sin_resultado) y dice qué hacer.
  const motivo = motivoDeRevisionQueNoPaso([{ revisor: REVISORES[0], cambios: ["src/api/ruta.ts: validar quién llama"] }], { link: LINK_PRUEBA });
  assert.match(motivo, /^La revisión no pasó tras 2 vueltas de corrección: seguridad pidió: src\/api\/ruta\.ts: validar quién llama\n/);
  const diagnostico = diagnosticar({ error: Object.assign(new Error(motivo), { categoria: "revision_no_paso" }), etapa: "construir" });
  assert.equal(diagnostico.categoria, "revision_no_paso");
  assert.ok(diagnostico.causa.startsWith("La revisión no pasó tras 2 vueltas de corrección: seguridad pidió") && diagnostico.causa.endsWith(LINK_PRUEBA), diagnostico.causa);
  assert.equal(diagnosticar({ error: new Error("La revisión no pasó tras 2 vueltas de corrección: código pidió: x"), etapa: "construir" }).categoria, "revision_no_paso");
  const decision = decidir({ diagnostico, tarjeta: { reparaciones: 0, ultimosIntentos: [] }, etapa: "construir" });
  assert.deepEqual([decision.accion, decision.cuenta], ["escalar", true]);
  const resumen = resumenDeEscalada({ tarjeta: {}, intentos: [], diagnostico }).split("\n");
  assert.match(resumen[0], /^Qué falló: La revisión no pasó/);
  assert.match(resumen[2], /^Qué necesita de ti: Leer qué pidió el revisor/);
  // La instrucción de la nube: los 4 subagentes en primer plano (seguridad en Opus, los demás en Sonnet), 2 correcciones,
  // el campo revision= y las 2 líneas para el dueño (corta).
  const tarjeta = { id: "t", titulo: "t", detalle: "d", tablero: "E", plan: "p" };
  const texto = promptDeNube(tarjeta, { clave: "aizencrm" }, "tablero/abc", { modeloRevisar: "sonnet", modeloRevisarSeguridad: "opus" });
  assert.match(texto, /REVISIÓN \(obligatoria[^\n]*4 subagentes \(herramienta Agent o Task, cada uno con el model que dice abajo\) y ESPERA aquí sus respuestas/);
  assert.match(texto, /^- seguridad \(model "opus"\): /m);
  for (const clave of ["experiencia", "diseno", "codigo"]) assert.match(texto, new RegExp(`^- ${clave} \\(model "sonnet"\\): `, "m"), clave);
  assert.match(texto, /DUEÑO 1: <por qué se paró[^\n]*DUEÑO 2: <la decisión que necesita, como pregunta cerrada/);
  assert.match(texto, /NO lances experiencia ni diseno/);
  assert.match(texto, /Máximo 2 correcciones/);
  assert.match(texto, /resultado: build=OK tests=OK segundos=<N> revision=OK/);
  assert.match(texto, /revision=FALLO revisor=<seguridad\|experiencia\|diseno\|codigo> motivo=/);
  assert.match(texto, /Los ÚNICOS subagentes permitidos son los 4 de la REVISIÓN/);
  assert.ok(textoParaLaNube().length < 3200, `el bloque de la nube es corto (${textoParaLaNube().length})`);
  const sinRevision = promptDeNube(tarjeta, { clave: "aizencrm" }, "tablero/abc", { revision: false });
  assert.ok(!/REVISIÓN \(obligatoria|revision=/.test(sinRevision), "con la revisión apagada la nube no la hace");
  // La configuración: prendida y 2 vueltas por defecto; validada.
  const base = { urlCrm: "https://crm.test", claveTrabajador: "aizen_trab_x", carpetaTrabajo: os.tmpdir(), repos: { aizencrm: { ruta: AQUI } } };
  assert.deepEqual(completarConfig(base).revision, { activa: true, vueltas: 2 });
  assert.deepEqual(completarConfig({ ...base, revision: { activa: false } }).revision, { activa: false, vueltas: 2 });
  assert.throws(() => completarConfig({ ...base, revision: { vueltas: 3 } }), /revision\.vueltas/);
});

await prueba("29-oct revisión: revisarConCuatro aprueba a la primera, corrige en 1 vuelta (solo re-revisa al que pidió), no pasa tras 2 y sin pantallas no lanza experiencia ni diseño", async () => {
  const correr = async (archivos, contesta) => {
    const llamadas = [];
    const correcciones = [];
    const resultado = await revisarConCuatro({
      archivos,
      revisar: async (revisor, { vuelta, anterior }) => {
        llamadas.push(`${revisor.clave}@${vuelta}${anterior ? "+" : ""}`);
        return contesta(revisor.clave, vuelta);
      },
      corregir: async (pendientes, vuelta) => correcciones.push(`${vuelta}:${pendientes.map((p) => p.revisor.clave).join(",")}`),
    });
    return { resultado, llamadas, correcciones };
  };
  const limpia = await correr(["src/x.ts"], () => "APROBADO");
  assert.equal(limpia.resultado.paso, true);
  assert.deepEqual(limpia.llamadas.sort(), ["codigo@1", "seguridad@1"], "sin pantallas: experiencia y diseño no se lanzan");
  assert.match(limpia.resultado.texto, /APROBADA a la primera — seguridad APROBADO · experiencia no aplica · diseño no aplica · código APROBADO/);
  const conPantallas = await correr(["src/app/page.tsx"], () => "APROBADO");
  assert.equal(conPantallas.llamadas.length, 4, "con pantallas van los 4");
  const unaVuelta = await correr(["src/x.ts"], (clave, vuelta) => (clave === "codigo" && vuelta === 1 ? "CAMBIOS\n- src/x.ts: falta el caso vacío" : "APROBADO"));
  assert.equal(unaVuelta.resultado.paso, true);
  assert.deepEqual(unaVuelta.correcciones, ["1:codigo"]);
  assert.deepEqual(unaVuelta.llamadas.sort(), ["codigo@1", "codigo@2+", "seguridad@1"], "la 2ª vuelta solo re-revisa al que pidió");
  assert.match(unaVuelta.resultado.texto, /APROBADA tras 1 corrección/);
  const nunca = await correr(["src/x.ts"], (clave) => (clave === "seguridad" ? "CAMBIOS\n- src/api/ruta.ts: validar quién llama" : "APROBADO"));
  assert.equal(nunca.resultado.paso, false);
  assert.deepEqual(nunca.correcciones, ["1:seguridad", "2:seguridad"], "máximo 2 correcciones");
  assert.equal(nunca.llamadas.filter((l) => l.startsWith("seguridad")).length, 3);
  assert.deepEqual(nunca.resultado.pendientes.map((p) => [p.revisor.clave, p.cambios]), [["seguridad", ["src/api/ruta.ts: validar quién llama"]]]);
  // Un revisor que se cae (no por límite) no frena; el límite de uso sí se propaga.
  const caido = await revisarConCuatro({
    archivos: ["a.ts"],
    revisar: async (revisor) => {
      if (revisor.clave === "codigo") throw new Error("se cayó");
      return "APROBADO";
    },
    corregir: async () => {},
  });
  assert.equal(caido.paso, true);
  assert.equal(caido.informes.codigo.estado, "sin respuesta");
  const sinCupo = revisarConCuatro({
    archivos: ["a.ts"],
    revisar: async () => {
      throw Object.assign(new Error("límite"), { limiteDeUso: true });
    },
    corregir: async () => {},
  });
  await assert.rejects(sinCupo, /límite/);
  // El progreso para el panel: antes de cada vuelta los que revisan en gris, después el veredicto de cada uno.
  const progreso = [];
  await revisarConCuatro({
    archivos: ["src/x.ts"],
    revisar: async (revisor, { vuelta }) => (revisor.clave === "codigo" && vuelta === 1 ? "CAMBIOS\n- x" : "APROBADO"),
    corregir: async () => {},
    alAvanzar: (dato) => progreso.push(`R${dato.vuelta} ${Object.values(dato.revisores).join(",")}`),
  });
  assert.deepEqual(progreso, [
    "R1 revisando,no_aplica,no_aplica,revisando",
    "R1 aprobado,no_aplica,no_aplica,cambios",
    "R2 aprobado,no_aplica,no_aplica,revisando",
    "R2 aprobado,no_aplica,no_aplica,aprobado",
  ]);
});

await prueba("29-oct revisión: los commits de progreso de la nube ('revision: R1 seguridad=OK ux=CAMBIOS …') se leen, van al panel y cuentan como señal", async () => {
  assert.deepEqual(progresoDelCommit("revision: R1 seguridad=OK ux=CAMBIOS diseno=NA codigo=REVISANDO"), {
    vuelta: 1,
    revisores: { seguridad: "aprobado", experiencia: "cambios", diseno: "no_aplica", codigo: "revisando" },
  });
  assert.deepEqual(progresoDelCommit("Revisión: R2 código=APROBADO").revisores, { seguridad: "revisando", experiencia: "revisando", diseno: "revisando", codigo: "aprobado" });
  assert.equal(progresoDelCommit("resultado: build=OK tests=OK revision=OK"), null, "el resultado no es progreso");
  assert.equal(progresoDelCommit("tablero: revision: R1"), null);
  assert.equal(progresoDelCommit("revision: sin vuelta"), null);
  assert.equal(resultadoDelCommit("revision: R1 seguridad=OK"), null);
  assert.deepEqual(estadoParaElPanel({ seguridad: { estado: "APROBADO" }, experiencia: { estado: "no aplica" }, codigo: { estado: "CAMBIOS" } }, [REVISORES[3]]), {
    seguridad: "aprobado",
    experiencia: "no_aplica",
    diseno: "revisando",
    codigo: "revisando",
  });
  // esperarResultado: el progreso más nuevo va a contexto.fase("revisando") una vez, y es señal (no corta por "sin señal").
  const gh = [process.execPath, "-e", "process.stdout.write(process.env.GH_COMMITS_PRUEBA || '')"];
  const fases = [];
  const contexto = {
    config: { nube: { comandoGh: gh, vigilarCadaSegundos: 0.05, esperaMinutos: 0.004, sinSenalMinutos: 0.001 } },
    registro: { info() {}, aviso() {} },
    fase: (etapa, extra) => fases.push([etapa, extra.lugar, extra.revision.vuelta, extra.revision.revisores.codigo]),
  };
  process.env.GH_COMMITS_PRUEBA = [
    { sha: "r2", mensaje: "revision: R2 seguridad=OK codigo=REVISANDO" },
    { sha: "r1", mensaje: "revision: R1 seguridad=OK codigo=CAMBIOS" },
  ]
    .map((c) => JSON.stringify(c))
    .join("\n");
  try {
    await assert.rejects(esperarResultado(contexto, { repo: { github: "a/b", ruta: AQUI }, rama: "tablero/abc", vistos: new Set(), reloj: { resta: () => 1e9 }, link: LINK_PRUEBA }), (error) => {
      assert.equal(error.categoria, "nube_sin_resultado");
      assert.match(error.message, /no dejó el commit "resultado:"/, "con progreso hubo señal: corta por la espera larga, no por 'no dio señal'");
      return true;
    });
  } finally {
    delete process.env.GH_COMMITS_PRUEBA;
  }
  assert.deepEqual(fases, [["revisando", "nube", 2, "revisando"]], "solo el más nuevo, una vez");
});

await prueba("29-oct revisión: las 2 líneas para el dueño (por qué se paró / pregunta cerrada con opciones): de la sesión o, si no, del Coordinador", () => {
  const pendientes = [{ revisor: REVISORES[0], cambios: ["src/api/ruta.ts: validar quién llama", "src/api/otra.ts: no devolver el error interno"] }, { revisor: REVISORES[3], cambios: ["x"] }];
  const lineas = dosLineasDelCoordinador(pendientes);
  assert.equal(lineas.length, 2);
  assert.equal(lineas[0], "Se paró porque el revisor de seguridad (también código) no aprobó tras 2 correcciones: pide src/api/ruta.ts: validar quién llama; src/api/otra.ts: no devolver el error interno.");
  assert.equal(lineas[1], PREGUNTA_POR_DEFECTO);
  assert.ok(sonDosLineasParaElDueno(lineas), "tiene la forma pedida");
  assert.ok(lineas.every((linea) => !linea.includes("\n") && linea.length <= 280));
  assert.ok(dosLineasDelCoordinador([{ revisor: REVISORES[3], cambios: ["y".repeat(900)] }])[0].length <= 280, "cabe en la línea del CRM");
  // La forma: 2 líneas, la 2ª una pregunta cerrada (¿…?) con opciones (" o ").
  assert.ok(!sonDosLineasParaElDueno(["Se paró por seguridad, pide validar quién llama."]), "una sola línea no");
  assert.ok(!sonDosLineasParaElDueno(["Se paró por seguridad, pide validar quién llama.", "Dime qué hago."]), "sin pregunta no");
  assert.ok(!sonDosLineasParaElDueno(["Se paró por seguridad, pide validar quién llama.", "¿Qué hago?"]), "sin opciones no");
  // Las que redactó la sesión de la nube en el cuerpo del commit.
  const cuerpo = "seguridad: CAMBIOS — x\nDUEÑO 1: La revisión de seguridad no aprobó: pide validar quién llama en src/api/ruta.ts.\nDUEÑO 2: ¿Lo subo así, lo corrijo con tu indicación o lo cierro?";
  assert.deepEqual(dosLineasDeLaSesion(cuerpo), ["La revisión de seguridad no aprobó: pide validar quién llama en src/api/ruta.ts.", "¿Lo subo así, lo corrijo con tu indicación o lo cierro?"]);
  assert.equal(dosLineasDeLaSesion("DUEÑO 1: algo corto\nDUEÑO 2: decide tú"), null, "mal formadas: las arma el Coordinador");
  assert.equal(dosLineasDeLaSesion("seguridad: CAMBIOS"), null);
});

await prueba("29-oct criterios de aceptación: el plan los pide (antes de PREGUNTAS ABIERTAS), quien construye deja la evidencia y los revisores la leen; espejo con el CRM", () => {
  const plan = [
    "## 1. Qué se cambia",
    "Un reporte.",
    "## 6. Cómo se va a probar",
    "npm test",
    "",
    "CRITERIOS DE ACEPTACIÓN:",
    "1. `npm run test:reportes` pasa.",
    "2. La página /cliente/reportes muestra la tabla de ventas por mes.",
    "",
    "**FUERA DE ALCANCE:**",
    "- Exportar a Excel.",
    "",
    "SUPUESTOS:",
    "- El mes se cuenta en hora de Bogotá, como el resto de reportes.",
    "",
    "PREGUNTAS ABIERTAS: ninguna",
    "",
    "Plan escrito con: Claude Code (Opus)",
  ].join("\n");
  assert.deepEqual(criteriosDelPlan(plan), ["`npm run test:reportes` pasa.", "La página /cliente/reportes muestra la tabla de ventas por mes."]);
  assert.deepEqual(seccionFinalDelPlan(plan, "fuera de alcance"), ["Exportar a Excel."]);
  assert.deepEqual(seccionFinalDelPlan(plan, "supuestos"), ["El mes se cuenta en hora de Bogotá, como el resto de reportes."]);
  assert.equal(porQueFaltanCriterios(plan), null);
  assert.equal(porQueUnSupuestoEsDeNegocio(plan), null);
  const sinCriterios = plan.replace(/CRITERIOS DE ACEPTACIÓN:\n1\.[^\n]*\n2\.[^\n]*\n/, "CRITERIOS DE ACEPTACIÓN: ninguno\n");
  assert.match(porQueFaltanCriterios(sinCriterios), /no trae CRITERIOS DE ACEPTACIÓN/);
  const deNegocio = plan.replace("- El mes se cuenta en hora de Bogotá, como el resto de reportes.", "- El envío a Bogotá queda gratis porque el pedido no dice el precio.");
  assert.match(porQueUnSupuestoEsDeNegocio(deNegocio), /decisión de negocio: El envío a Bogotá queda gratis/);
  // El espejo del CRM (reglas-riesgo.ts) dice lo mismo.
  for (const texto of [plan, sinCriterios, deNegocio, "Un plan viejo sin secciones."]) {
    assert.deepEqual(reglasDeRiesgo.seccionFinalDelPlan(texto, "criterios de aceptacion"), criteriosDelPlan(texto));
    assert.equal(reglasDeRiesgo.porQueFaltanCriterios(texto), porQueFaltanCriterios(texto));
    assert.equal(reglasDeRiesgo.porQueUnSupuestoEsDeNegocio(texto), porQueUnSupuestoEsDeNegocio(texto));
  }
  // La instrucción de planear pide las 3 secciones en orden, antes de PREGUNTAS ABIERTAS.
  const delPlan = promptDelPlan({ id: "t", titulo: "t", detalle: "d", tablero: "E" }, { clave: "aizencrm" });
  const donde = ["\"CRITERIOS DE ACEPTACIÓN:\"", "\"FUERA DE ALCANCE:\"", "\"SUPUESTOS:\"", "\"PREGUNTAS ABIERTAS:\""].map((seccion) => delPlan.indexOf(seccion));
  assert.ok(donde.every((i, n) => i > 0 && (n === 0 || i > donde[n - 1])), `en orden: ${donde}`);
  assert.match(delPlan, /cómo se comprueba: un comando, una página y qué debe mostrar, o un archivo y qué debe contener/);
  // Construir (aizen1 y nube) deja la evidencia; un plan viejo sin criterios no la pide.
  const tarjeta = { id: "t", titulo: "t", detalle: "d", tablero: "E", plan };
  assert.match(promptDeConstruir(tarjeta, { clave: "aizencrm" }, "tablero/x"), /CRITERIOS DE ACEPTACIÓN \(2[^\n]*evidencia en tu RESUMEN final[^\n]*"CRITERIO <n>: OK\|FALLA — /);
  assert.match(promptDeNube(tarjeta, { clave: "aizencrm" }, "tablero/x"), /evidencia en el CUERPO del commit "resultado:"/);
  assert.match(promptDeNube(tarjeta, { clave: "aizencrm" }, "tablero/x"), /Dales también tu evidencia de los CRITERIOS DE ACEPTACIÓN[^\n]*\n[^\n]*con lo que pidió cada uno para que compruebe que se arregló/);
  const viejo = { ...tarjeta, plan: "El plan" };
  assert.equal(instruccionDeEvidencia(viejo.plan, "x"), "");
  assert.ok(!/CRITERIO <n>/.test(promptDeConstruir(viejo, { clave: "aizencrm" }, "tablero/x")), "un plan viejo se construye como antes");
  // Los revisores leen los criterios (están en el plan) y la evidencia; el de código pide CAMBIOS si falta o no se cumple.
  const evidencia = evidenciaDeCriterios("RESUMEN: listo\nCRITERIO 1: OK — npm run test:reportes: 12 pruebas bien\ncriterio 2: FALLA — la página no carga\nQué se hizo: x");
  assert.deepEqual(evidencia, ["CRITERIO 1: OK — npm run test:reportes: 12 pruebas bien", "criterio 2: FALLA — la página no carga"]);
  const codigo = REVISORES.find((revisor) => revisor.clave === "codigo");
  const delRevisor = promptDeRevisor(codigo, { tarjeta, repo: { clave: "aizencrm" }, rama: "tablero/x", diff: "d", vuelta: 2, anterior: { cambios: ["a.ts: falta el caso vacío"] }, evidencia });
  assert.match(delRevisor, /EVIDENCIA de los criterios de aceptación[^\n]*\nCRITERIO 1: OK/);
  assert.match(delRevisor, /CAMBIOS si alguno no se cumple o no tiene evidencia/);
  assert.match(delRevisor, /En la vuelta anterior pediste esto; mira si quedó corregido:\n- a\.ts: falta el caso vacío/);
});

await prueba("aviso de reversión al dueño: máximo 3 líneas y 500 caracteres aunque el motivo sea larguísimo (26-oct-2026: uno de 869 no salió)", () => {
  const motivo = `Se subió, no arrancó y se deshizo; producción vuelve a la versión anterior.\nCommit deshecho: 602d0beb01 (revert 66918ed0e7).\nDetalle técnico: Subió a main (commit 602d0beb01) pero el CI falló: 'servicio' is assigned a value but never used\n${"error  A require() style import is forbidden\n".repeat(30)}`;
  const reversion = { commit: "602d0beb01d949b85e6bdc7200fa4229ed4dc069", revert: "66918ed0e7dbd48e0c40520e8b2a499a84afdf0b", ok: true };
  const texto = textoDelAvisoDeReversion(`Paralelo de verdad — parte 1: ${"Workflow de GitHub Actions ".repeat(10)}`, motivo, reversion);
  assert.ok(texto.length <= LARGO_MAXIMO_DEL_AVISO, `tiene ${texto.length} caracteres`);
  const lineas = texto.split("\n");
  assert.equal(lineas.length, 3);
  assert.match(lineas[1], /^Motivo: Subió a main \(commit 602d0beb01\) pero el CI falló/, "la causa técnica, no la frase genérica");
  assert.match(lineas[2], /Commit deshecho: 602d0beb01; commit de la reversión: 66918ed0e7\. Detalle en el tablero\./);
  const urgente = textoDelAvisoDeReversion("x", "y".repeat(2000), { commit: "abc", revert: null, ok: false });
  assert.ok(urgente.length <= LARGO_MAXIMO_DEL_AVISO && urgente.startsWith("URGENTE:") && urgente.split("\n").length === 3);
  const largo = recortarAviso(`uno\ndos\ntres\ncuatro\n${"z".repeat(900)}`);
  assert.ok(largo.length <= 500 && largo.split("\n").length === 3);
});

await prueba("subida: la corrida que decide 'deshacer' es la del workflow de despliegue (workflowDespliegue), no la de revisión", () => {
  const buscar = ["gh", "run", "list", "--repo", "AlexMoreR/AgenteLite", "--commit", "{commit}", "--json", "databaseId", "--jq", ".[0].databaseId"];
  assert.deepEqual(buscarCorridaDelDespliegue(buscar, "docker-image.yml").slice(0, 5), ["gh", "run", "list", "--workflow", "docker-image.yml"]);
  assert.deepEqual(buscarCorridaDelDespliegue(buscar, null), buscar, "sin configurar: igual que antes");
  const yaFijado = ["gh", "run", "list", "--workflow", "otro.yml", "--commit", "{commit}"];
  assert.deepEqual(buscarCorridaDelDespliegue(yaFijado, "docker-image.yml"), yaFijado, "si el comando ya dice --workflow, no se toca");
  const falso = ["node", "gh-falso.mjs", "buscar", "{commit}"];
  assert.deepEqual(buscarCorridaDelDespliegue(falso, "docker-image.yml"), falso, "otro comando (no gh run list): no se toca");
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
  // 29-oct-2026: el revisor de seguridad va en Opus (revisarSeguridad) y `desde` (cambios con fecha) viene vacío.
  assert.deepEqual(porDefecto.modelos, { planear: "opus", planearSencillo: "sonnet", construir: "sonnet", revisar: "sonnet", revisarSeguridad: "opus", subagentes: "sonnet", leer: "haiku", desde: [] });
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
  assert.equal(config.vigilarUsoMinutos, 5);
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
// Falla solo si la tarea dejó FALLA_PRUEBAS (27-oct-2026: lo que falla igual en main ya no se le cobra a la tarea).
archivo("pruebas-largas.mjs", 'import fs from "node:fs";\nif (!fs.existsSync("FALLA_PRUEBAS")) process.exit(0);\nfor (let i = 1; i <= 400; i += 1) console.log(i === 300 ? "not ok 300 - la prueba que falló" : `ok ${i} - prueba ${i}`);\nprocess.exit(1);\n');
// Unas pruebas que YA fallan en main (27-oct-2026): siempre "not ok 3 - prueba vieja"; si la tarea deja FALLA_NUEVA, además "not ok 4 - prueba nueva".
archivo("pruebas-viejas.mjs", 'import fs from "node:fs";\nconsole.log("ok 1 - a");\nconsole.log("not ok 3 - prueba vieja");\nif (fs.existsSync("FALLA_NUEVA")) console.log("not ok 4 - prueba nueva");\nprocess.exit(1);\n');
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
/** true: la tarjeta de limpieza que crea el CRM falso queda APROBADO (como el real) y entra a la fila; false: no estorba a las demás pruebas. */
let limpiezaEnLaFila = false;
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
  if (pedido.url === "/api/trabajador/tablero/por-revisar") {
    // Como porRevisarDelTrabajador (30-oct-2026): solo la lista nueva `paraRevisarDeNuevo` (la de rescatar no se prueba acá).
    llamadas.push({ accion: "por-revisar" });
    const paraRevisarDeNuevo = [...tarjetas.values()]
      .filter((t) => t.estado === "POR_REVISAR" && t.resultado?.paso === true && reglas.soloChatsOBot(t.zonaProtegida) && !reglas.esGastoEnMetaAds(t.resultado?.esperaPor))
      .map((t) => ({ id: t.id, titulo: t.titulo, repo: t.repo, zonaProtegida: t.zonaProtegida, paso: true, rama: t.resultado.rama ?? null, base: t.resultado.base ?? null, commit: t.resultado.commit ?? null, esperaPor: t.resultado.esperaPor ?? null }));
    return contestar(200, { ok: true, tarjetas: [], paraRevisarDeNuevo });
  }
  const [, id, accion] = pedido.url.match(/^\/api\/trabajador\/tablero\/([^/]+)\/([a-z_-]+)$/) ?? [];
  const tarjeta = tarjetas.get(id);
  llamadas.push({ accion, id, cuerpo });
  if (!tarjeta) return contestar(404, { ok: false, error: "No existe" });
  const veredicto = reglas.puedeElTrabajador(accion, tarjeta.estado);
  if (veredicto) return contestar(409, { ok: false, error: veredicto });
  if (accion === "latido") {
    if (latidoVencido.has(id)) return contestar(409, { ok: false, error: "El candado de esta tarjeta ya venció" });
    // Como el CRM real: un latido sin candado (la tarjeta ya soltó su candado con el resultado) no lo vuelve a armar. Sin esto, un latido
    // que llegaba un instante después del /resultado dejaba la tarjeta SUBIENDO "con candado" y nadie la tomaba (prueba intermitente).
    if (!tarjeta.venceEn) return contestar(409, { ok: false, error: "El candado de esta tarjeta ya venció" });
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
  if (accion === "reparar" && cuerpo.cuenta === false && cuerpo.categoria === "choca_con_main") {
    // Como el CRM (31-oct-2026): choca con main -> vuelve a construir sin sumar reparación; tope de 3 choques seguidos.
    const tope = reglas.puedeReconstruirPorChoque(reglas.choquesSeguidos(tarjeta.intentosLista ?? []));
    if (tope) return contestar(409, { ok: false, error: tope });
    anotarIntento(tarjeta, cuerpo, "esperar", false);
    Object.assign(tarjeta, { estado: reglas.estadoTrasReparar(tarjeta.estado), venceEn: null, intentos: Math.max(0, tarjeta.intentos - 1) });
    return contestar(200, { ok: true, estado: tarjeta.estado, reparaciones: tarjeta.reparaciones ?? 0 });
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
  if (accion === "depender") {
    // Como el CRM (27-oct-2026): pone la flecha hacia las tarjetas que existan (por id o título) y, si alguna no está HECHO,
    // PLANEANDO -> APROBADO y EN_CURSO -> PLAN_APROBADO sin gastar el intento.
    const origenes = [...tarjetas.values()].filter((t) => t.id !== id && (cuerpo.referencias ?? []).some((r) => r === t.id || r.toLowerCase() === t.titulo.toLowerCase()));
    tarjeta.dependeDe = [...new Set([...(tarjeta.dependeDe ?? []), ...origenes.map((t) => t.id)])];
    const pendientes = origenes.filter((t) => t.estado !== "HECHO");
    const etiqueta = pendientes.length ? `Esperando a ${pendientes.map((t) => `«${t.titulo}»`).join(" y ")}` : null;
    const vuelve = { PLANEANDO: "APROBADO", EN_CURSO: "PLAN_APROBADO" }[tarjeta.estado];
    if (etiqueta && vuelve) {
      anotarIntento(tarjeta, { etapa: cuerpo.etapa ?? "planear", categoria: "otra", causa: etiqueta }, "esperar", false);
      Object.assign(tarjeta, { estado: vuelve, venceEn: null, intentos: Math.max(0, tarjeta.intentos - 1) });
    }
    return contestar(200, { ok: true, estado: tarjeta.estado, creadas: origenes.map((t) => t.id), esperando: etiqueta, soltada: Boolean(etiqueta && vuelve) });
  }
  if (accion === "ya-hecha") {
    tarjeta.resultado = { ...(tarjeta.resultado ?? {}), yaEstabaHecho: { commit: cuerpo.commit, motivo: cuerpo.motivo, nota: reglas.notaDeYaHecha(cuerpo.commit) } };
    Object.assign(tarjeta, { estado: "HECHO", venceEn: null });
    return contestar(200, { ok: true, estado: "HECHO" });
  }
  if (accion === "limpieza") {
    // UNA sola tarjeta de limpieza por repo: si hay una abierta, se le agregan los errores que no tenía.
    const titulo = reglas.tituloDeLimpieza(cuerpo.repo);
    const abierta = [...tarjetas.values()].find((t) => t.titulo === titulo && !["HECHO", "FALLIDO"].includes(t.estado));
    if (abierta) {
      const nuevos = cuerpo.errores.filter((e) => !abierta.detalle.includes(e));
      abierta.detalle += nuevos.map((e) => `\n- ${e}`).join("");
      return contestar(200, { ok: true, creada: false, agregados: nuevos.length, tarjetaId: abierta.id });
    }
    // El CRM real la deja en APROBADO; las pruebas de siempre no quieren que entre a la fila (limpiezaEnLaFila).
    const idNueva = nueva(titulo, limpiezaEnLaFila ? "APROBADO" : "POR_APROBAR", { detalle: cuerpo.errores.map((e) => `- ${e}`).join("\n"), moderno: true });
    return contestar(200, { ok: true, creada: true, agregados: cuerpo.errores.length, tarjetaId: idNueva });
  }
  if (accion === "revisar_de_nuevo") {
    // Como revisarDeNuevo de services/trabajador.ts: subeSolo -> SUBIENDO pendiente con commit, base y pruebas; si no, ERROR con el motivo.
    if (cuerpo.subeSolo) {
      const { esperaPor: _quitada, ...sinEspera } = tarjeta.resultado;
      void _quitada;
      tarjeta.resultado = { ...sinEspera, subeSolo: true, commit: cuerpo.commit ?? sinEspera.commit, base: cuerpo.base ?? sinEspera.base, pruebas: [...(cuerpo.pruebas ?? []), sinEspera.pruebas ?? ""].join("\n") };
      Object.assign(tarjeta, { estado: "SUBIENDO", venceEn: null });
    } else {
      tarjeta.resultado = { ...tarjeta.resultado, error: { motivo: `construido, no sube: ${reglas.motivoDeEntrada(cuerpo.motivo)}` } };
      Object.assign(tarjeta, { estado: "ERROR", venceEn: null });
    }
    return contestar(200, { ok: true, estado: tarjeta.estado });
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
  if (accion === "subida") tarjeta.resultado = { ...tarjeta.resultado, subida: { commit: cuerpo.commit, version: cuerpo.version, linkCommit: cuerpo.linkCommit, ...(cuerpo.vigilancia ? { vigilancia: reglas.vigilanciaDeEntrada(cuerpo.vigilancia) } : {}), ...(cuerpo.resumenTres ? { resumenTres: reglas.resumenDeTresLineasDeEntrada(cuerpo.resumenTres) } : {}) } };
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
    // Las 3 líneas con que el agente cerró construir viajan con la subida (no por WhatsApp).
    const subida = llamadas.findLast((l) => l.accion === "subida" && l.id === feliz).cuerpo;
    assert.deepEqual(Object.keys(subida.resumenTres), ["hizo", "ahora", "revisar"]);
    assert.match(subida.resumenTres.hizo, /^Se hizo "Agregar tabla nueva/);
    assert.equal(subida.resumenTres.ahora, "Un archivo nuevo en el proyecto.");
    assert.equal(subida.resumenTres.revisar, "Mirar que el cambio sea el esperado.");
    assert.deepEqual(t.resultado.subida.resumenTres, subida.resumenTres);
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

  await prueba("zona protegida: toca src/bot/, se marca BOT_VENTAS y queda en ERROR \"construido, no sube\" (no sube sola, no espera el sí)", async () => {
    const id = nueva("Cambiar el saludo [zona]", "PLAN_APROBADO", { plan: "El plan" });
    const mainAhora = shaDe("main");
    const resultado = await vuelta(crearConfig({}, { subirSolo: true }));
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
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
    assert.equal(tarjetas.get(id).estado, "ERROR");
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
    assert.equal(con({}).graciaServerActionMinutos, 10);
    assert.equal(con({ graciaServerActionMinutos: 5 }).graciaServerActionMinutos, 5);
    assert.equal(con({ graciaServerActionMinutos: 0 }).graciaServerActionMinutos, 0);
    assert.equal(con({ graciaServerActionMinutos: "x" }).graciaServerActionMinutos, 10);
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

  await prueba("zonas que suben solas: libro V3 sin la simulación V3 espera el sí (el diff no la puede comprobar)", async () => {
    const v3 = nueva("Libro sin simular [solas-v3-sin]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(v3).estado, "POR_REVISAR");
    assert.match(tarjetas.get(v3).resultado.esperaPor, /falta la simulación V3/);
    sinRestos();
  });

  await prueba("zonas que suben solas: bot sin la frase del constructor y sin envíos nuevos: el Coordinador la escribe y sube sola (27-oct)", async () => {
    reiniciarLogs();
    const bot = nueva("Bot sin probar [solas-bot-sin]", "PLAN_APROBADO", { plan: "El plan" });
    const construida = await vuelta(configSolas());
    assert.equal(construida.ok, true, construida.motivo);
    assert.equal(tarjetas.get(bot).estado, "SUBIENDO");
    assert.equal(tarjetas.get(bot).resultado.esperaPor, undefined);
    assert.match(tarjetas.get(bot).resultado.pruebas, /✔ sin mensajes nuevos a clientes \(comprobado por el Coordinador/);
    const subida = await vuelta(configSolas());
    assert.equal(subida.ok, true, subida.motivo);
    assert.equal(tarjetas.get(bot).estado, "HECHO");
    sinRestos();
  });

  await prueba("zonas que suben solas: un envío nuevo de mensaje en el bot que el plan no menciona no sube solo: ERROR con el motivo (30-oct)", async () => {
    const id = nueva("Bot con aviso [solas-bot] [solas-bot-envio]", "PLAN_APROBADO", { plan: "Cambiar el saludo.", moderno: true });
    const mainAhora = shaDe("main");
    const resultado = await vuelta(configSolas());
    assert.equal(resultado.ok, false);
    assert.equal(resultado.categoria, "zona");
    assert.equal(resultado.accion, "escalar");
    assert.equal(tarjetas.get(id).estado, "ERROR");
    assert.match(tarjetas.get(id).resultado.error.motivo, /No sube: el cambio agrega un envío de mensaje que el plan no menciona/);
    assert.doesNotMatch(tarjetas.get(id).resultado.error.motivo, /espera tu sí/);
    assert.equal(shaDe("main"), mainAhora);
    sinRestos();
  });

  await prueba("zonas que suben solas: CHATS sin la confirmación del constructor y sin envíos nuevos: el Coordinador la escribe y sube sola (27-oct)", async () => {
    reiniciarLogs();
    const id = nueva("Cambio en chats [solas-chats-sin]", "PLAN_APROBADO", { plan: "El plan" });
    assert.equal((await vuelta(configSolas())).ok, true);
    assert.equal(tarjetas.get(id).estado, "SUBIENDO");
    assert.equal(tarjetas.get(id).resultado.subeSolo, true);
    assert.match(tarjetas.get(id).resultado.pruebas, /✔ chats: sin mensajes nuevos a clientes \(comprobado por el Coordinador/);
    assert.deepEqual(tarjetas.get(id).zonaProtegida, ["CHATS"]);
    const subida = await vuelta(configSolas());
    assert.equal(subida.ok, true, subida.motivo);
    assert.equal(tarjetas.get(id).estado, "HECHO");
    sinRestos();
  });

  await prueba("zonas que suben solas: un envío nuevo en src/chats queda en ERROR \"No sube: …\" aunque el plan lo mencione, sin reintento (30-oct)", async () => {
    const id = nueva("Chats con aviso [solas-chats-envio]", "PLAN_APROBADO", { plan: "Se enviará un mensaje nuevo al cliente.", moderno: true });
    const mainAhora = shaDe("main");
    const resultado = await vuelta(configSolas());
    // El Coordinador corta con ERROR y el motivo; nunca POR_REVISAR esperando el sí.
    assert.equal(resultado.ok, false);
    assert.equal(resultado.categoria, "zona");
    assert.equal(resultado.accion, "escalar", "no se repara sola");
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.match(t.resultado.error.motivo, /No sube: agrega un envío nuevo de mensaje a clientes en chats/);
    assert.doesNotMatch(t.resultado.error.motivo, /espera tu sí/);
    assert.ok(!(t.intentosLista ?? []).some((intento) => intento.accion === "reparar"), "no se reintentó");
    assert.equal(t.intentosLista?.at(-1)?.accion, "escalar");
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
    assert.match(t.resultado.error.motivo, /\[minuto \d+\] .*Unhandled rejection en el bot/, "el motivo nombra la línea exacta");
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
    assert.equal(nuevos[0].cuerpo.tarjetaId, id, "lleva el id de la tarjeta");
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

  // 31-oct-2026: el choque con main al subir lo resuelve una sesión corta de Claude (resolver-choque.mjs).
  const atrasDeMain = async (titulo, textoDeMain) => {
    const id = nueva(titulo, "PLAN_APROBADO", { plan: "El plan", moderno: true });
    assert.equal((await vuelta()).ok, true);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    // La rama queda atrás de main: alguien cambió el mismo archivo y además otro archivo.
    g(REPO, "pull", "--ff-only", "origin", "main");
    archivo("conflicto.txt", textoDeMain);
    archivo(`otro-de-main-${id}.txt`, "otro cambio de main\n");
    g(REPO, "add", "-A");
    g(REPO, "commit", "-m", `main cambia lo mismo que ${id}`);
    g(REPO, "push", "origin", "main");
    Object.assign(tarjetas.get(id), { estado: "SUBIENDO", venceEn: null });
    return id;
  };

  await prueba("choque simple con main al subir: Claude junta las dos versiones, se verifica y sube (HECHO, sin crm.error y sin sumar reparaciones)", async () => {
    const id = await atrasDeMain("Juntar sola con main [conflicto] [choque-simple]", "main cambió esto\n");
    const mainAntes = shaDe("main");
    const llamadasAntes = llamadas.length;
    const resultado = await vuelta();
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "HECHO");
    assert.equal(t.resultado.error, undefined);
    assert.equal(llamadas.slice(llamadasAntes).some((l) => l.id === id && ["error", "reparar"].includes(l.accion)), false, "ni crm.error ni reparar");
    assert.equal(t.reparaciones ?? 0, 0, "no suma reparaciones");
    // main tiene las dos versiones, encima de lo que ya estaba.
    assert.equal(g(REPO, "--git-dir", REMOTO, "show", "main:conflicto.txt"), "main cambió esto\nlo de la rama");
    assert.equal(g(REPO, "--git-dir", REMOTO, "merge-base", "--is-ancestor", mainAntes, "main"), "");
    // La sesión corta corrió en la carpeta de subida, con la orden de resolver solo lo que chocó.
    const sesion = leerLog(LOGS.claude).findLast((l) => l.prompt.startsWith("RESOLVER EL CHOQUE CON MAIN"));
    assert.ok(sesion, "se llamó a la sesión que resuelve el choque");
    assert.match(sesion.cwd, /-subir$/);
    assert.match(sesion.prompt, /^- conflicto\.txt$/m);
    assert.equal(t.resultado.subida.commit, shaDe("main"), "lo que subió es lo juntado");
    sinRestos();
  });

  await prueba("choque de lógica con main al subir: ERROR con el motivo en una línea y la categoría choque_de_logica; main no cambia", async () => {
    const id = await atrasDeMain("No encajan con main [conflicto] [choque-logica]", "main cambió esto de otra forma\n");
    const mainAhora = shaDe("main");
    const resultado = await vuelta();
    assert.equal(resultado.ok, false);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.resultado.error.categoria, "choque_de_logica");
    const [queFallo] = t.resultado.error.motivo.split("\n");
    assert.match(queFallo, /^Qué falló: Choque de lógica con lo nuevo de main: main cambió el texto del archivo compartido y la tarea también, de forma distinta/);
    assert.equal(t.intentosLista.at(-1).categoria, "choque_de_logica");
    assert.equal(t.intentosLista.at(-1).causa.includes("\n"), false, "el motivo en una línea");
    assert.equal(t.reparaciones ?? 0, 0, "no se repara sola");
    assert.equal(shaDe("main"), mainAhora, "no subió nada");
    sinRestos();
  });

  await prueba("CRM simulado: reconstruir por choque con main (/reparar cuenta: false) guarda un intento que no cuenta, vuelve a construir y no sube 'reparaciones'; el 4º da 409", async () => {
    const crm = crearCrm(crearConfig());
    const id = nueva("Choca con main sin gastar [solo-crm]", "SUBIENDO", { plan: "El plan", moderno: true, reparaciones: 1, intentos: 2 });
    const datos = { etapa: "subir", categoria: "choca_con_main", causa: "Choca con lo nuevo de main", cuenta: false };
    for (const vez of [1, 2, 3]) {
      Object.assign(tarjetas.get(id), { estado: "SUBIENDO", venceEn: null });
      const respuesta = await crm.reparar(id, datos);
      const t = tarjetas.get(id);
      assert.equal(respuesta.reparaciones, 1, `choque ${vez}: no sube reparaciones`);
      assert.deepEqual([t.estado, t.reparaciones], ["PLAN_APROBADO", 1], `choque ${vez}: vuelve a construir`);
      assert.deepEqual([t.intentosLista.at(-1).accion, t.intentosLista.at(-1).cuentaComoIntento], ["esperar", false]);
    }
    Object.assign(tarjetas.get(id), { estado: "SUBIENDO", venceEn: null });
    await assert.rejects(crm.reparar(id, datos), (error) => error.status === 409 && /3 veces seguidas/.test(error.message));
    assert.equal(tarjetas.get(id).reparaciones, 1);
    Object.assign(tarjetas.get(id), { estado: "HECHO", venceEn: null });
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
    // 30-oct-2026: el bloque de la reparación empieza con CAUSA y QUÉ CAMBIA (antes de "REPARACIÓN 1 de 3").
    assert.match(segunda.prompt, /\nCAUSA: [^\n]*compil[^\n]*\nQUÉ CAMBIA: es el primer arreglo[^\n]*\nREPARACIÓN 1 de 3/i);
    assert.match(segunda.prompt, /error TS2322/);
    assert.match(segunda.prompt, /Corrige solo eso/);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    soltarTodas(id);
    sinRestos();
  });

  await prueba("la misma causa 2 veces y la 3ª no se repara: queda en ERROR con un resumen de 3 líneas (qué falló, qué se probó, qué necesita)", async () => {
    const id = nuevaModerna("Nunca compila [tsc]");
    // 29-oct-2026: con 2 fallas iguales ya no se reintenta a ciegas (antes eran 3 reparaciones).
    for (const esperado of ["reparar", "reparar", "escalar"]) {
      const resultado = await vuelta();
      assert.equal(resultado.accion, esperado);
    }
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.reparaciones, 2);
    assert.deepEqual(t.intentosLista.map((i) => i.accion), ["reparar", "reparar", "escalar"]);
    const lineas = t.resultado.error.motivo.split("\n");
    assert.equal(lineas.length, 3, "máximo 3 líneas");
    assert.match(lineas[0], /^Qué falló:/);
    assert.match(lineas[1], /^Qué se probó:.*2 reparaciones/);
    assert.match(lineas[2], /^Qué necesita de ti:/);
    assert.equal(t.resultado.error.categoria, "no_compila");
    assert.match(t.intentosLista[2].error, /error TS2322/, "el error exacto queda en el intento");
    sinRestos();
  });

  await prueba("29-oct: un plan con preguntas abiertas que se aprobó solo no se construye: ERROR plan_con_preguntas y un aviso al dueño; aprobado por el dueño, sí", async () => {
    const plan = "## 1. Qué se cambia\nUn aviso.\n## 3. Riesgos\nAntes de construir hay que revisar con el CRM cuál es la entrada.\n## 5. Archivos que se tocan\n- src/features/a/x.ts\n\nPREGUNTAS ABIERTAS:\n- ¿Qué ruta del CRM manda el WhatsApp?";
    const avisosAntes = llamadas.filter((l) => l.accion === "aviso").length;
    const id = nuevaModerna("Plan con dudas [preguntas]", "PLAN_APROBADO", { plan });
    const resultado = await vuelta();
    assert.deepEqual([resultado.ok, resultado.accion, resultado.categoria], [false, "escalar", "plan_con_preguntas"]);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.reparaciones ?? 0, 0, "no gasta reparaciones");
    assert.match(t.resultado.error.motivo, /^Qué falló: El plan tiene preguntas abiertas: ¿Qué ruta del CRM manda el WhatsApp\?/, "primero la sección PREGUNTAS ABIERTAS");
    assert.equal(ultimaDeClaude("Plan con dudas [preguntas]"), undefined, "no abre la sesión de construir");
    const avisos = llamadas.filter((l) => l.accion === "aviso").slice(avisosAntes);
    assert.equal(avisos.length, 1);
    assert.equal(avisos[0].cuerpo.tipo, "necesita");
    assert.equal(avisos[0].cuerpo.tarjetaId, id, "lleva el id de la tarjeta");
    assert.match(avisos[0].cuerpo.texto, /no se construye: el plan tiene preguntas abiertas/);
    // El dueño aprobó el plan tal cual (pantalla o voz): se construye.
    const id2 = nuevaModerna("Plan con dudas aprobado [preguntas]", "PLAN_APROBADO", { plan, planAprobadoPorElDueno: true });
    assert.equal((await vuelta()).ok, true);
    assert.equal(tarjetas.get(id2).estado, "POR_REVISAR");
    soltarTodas(id2);
    sinRestos();
  });

  /* ── 29-oct-2026: la revisión de los 4 en aizen1 (Sonnet, solo lectura; corrige el mismo que construyó) ── */
  const revisionesDe = (titulo) => leerLog(`${LOGS.claude}.revisores`).filter((l) => l.titulo === titulo);

  await prueba("29-oct revisión en aizen1: pasa a la primera (seguridad con Opus, código con Sonnet, en modo plan; sin pantallas, experiencia y diseño no aplican)", async () => {
    const titulo = "Revisión limpia";
    const id = nuevaModerna(titulo);
    const resultado = await vuelta();
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.match(t.resultado.resumen, /Revisión \(4 revisores\): APROBADA a la primera — seguridad APROBADO · experiencia no aplica · diseño no aplica · código APROBADO\./);
    const revisiones = revisionesDe(titulo);
    assert.deepEqual(revisiones.map((r) => r.revisor).sort(), ["código", "seguridad"]);
    assert.deepEqual(Object.fromEntries(revisiones.map((r) => [r.revisor, r.modelo])), { seguridad: "opus", código: "sonnet" }, "seguridad en Opus, el resto en Sonnet");
    assert.ok(revisiones.every((r) => r.modo === "plan"), "solo lectura");
    soltarTodas(id);
    sinRestos();
  });

  await prueba("29-oct revisión en aizen1: código pide un cambio, el mismo motor corrige en 1 vuelta, se re-revisa solo código y sube con la corrección", async () => {
    const titulo = "Revisión con un cambio [rev-cambios-1]";
    const id = nuevaModerna(titulo);
    const resultado = await vuelta();
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.match(t.resultado.resumen, /APROBADA tras 1 corrección/);
    assert.ok(t.resultado.archivos.includes("correccion-1.txt"), "la corrección queda en la rama");
    assert.deepEqual(revisionesDe(titulo).map((r) => `${r.revisor}@${r.vuelta}`).sort(), ["código@1", "código@2", "seguridad@1"]);
    const correccion = leerLog(LOGS.claude).findLast((l) => l.titulo === titulo && l.prompt.includes("CORRECCIÓN DE LA REVISIÓN 1 de 2"));
    assert.ok(correccion, "la corrección la pidió el Coordinador");
    assert.equal(correccion.modo, "acceptEdits");
    assert.equal(correccion.argumentos[correccion.argumentos.indexOf("--model") + 1], "sonnet", "el mismo modelo que construyó");
    assert.match(correccion.prompt, /código:\n- cambio\.txt: falta el caso vacío/);
    soltarTodas(id);
    sinRestos();
  });

  await prueba("29-oct revisión en aizen1: tras 2 correcciones seguridad sigue pidiendo cambios -> ERROR revision_no_paso, sin reparar, con qué pidió y qué necesita de ti", async () => {
    const titulo = "Revisión que no pasa [rev-no-pasa]";
    const id = nuevaModerna(titulo);
    const resultado = await vuelta();
    assert.deepEqual([resultado.ok, resultado.accion, resultado.categoria], [false, "escalar", "revision_no_paso"]);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.reparaciones ?? 0, 0, "no se repara sola");
    assert.equal(t.resultado.error.categoria, "revision_no_paso");
    // Las 2 líneas para el dueño (aizen1: las arma el Coordinador con el informe de los revisores).
    assert.deepEqual(t.resultado.error.motivo.split("\n"), [
      "Se paró porque el revisor de seguridad no aprobó tras 2 correcciones: pide src/api/ruta.ts: validar quién llama antes de leer los datos.",
      "¿Lo subo así, lo corrijo con tu indicación o lo cierro?",
    ]);
    assert.match(t.intentosLista.at(-1).error, /^La revisión no pasó tras 2 vueltas de corrección: seguridad pidió: src\/api\/ruta\.ts: validar quién llama/, "el detalle técnico queda en el intento");
    assert.equal(revisionesDe(titulo).filter((r) => r.revisor === "seguridad").length, 3, "1ª revisión + 2 re-revisiones");
    assert.equal(leerLog(LOGS.claude).filter((l) => l.titulo === titulo && l.prompt.includes("CORRECCIÓN DE LA REVISIÓN")).length, 2, "máximo 2 correcciones");
    assert.ok(!ramasDelRemoto().includes(nombreDeRama(t)), "no se subió nada");
    sinRestos();
  });

  /* ── Mejora continua (26-oct-2026): lecciones, resumen de 3 líneas y "NECESITO:" ── */
  const archivoDeLecciones = path.join(T, "trabajo", "lecciones", "aizencrm.md");
  const avisosDeNecesita = () => llamadas.filter((l) => l.accion === "aviso" && l.cuerpo.tipo === "necesita");

  await prueba("lecciones: una falla anota una lección y la siguiente sesión (plan y construir) la ve en sus instrucciones", async () => {
    fs.rmSync(archivoDeLecciones, { force: true });
    const id = nuevaModerna("Falla y se arregla [tsc-una-vez]");
    assert.equal((await vuelta()).accion, "reparar");
    const texto = fs.readFileSync(archivoDeLecciones, "utf8");
    assert.match(texto, /^### \d{4}-\d{2}-\d{2} · fallo · no_compila · huella:[0-9a-f]{8}$/m);
    assert.match(texto, /- Tarjeta: Falla y se arregla \[tsc-una-vez\]/);
    assert.match(texto, /- Cómo se arregló: La tarjeta vuelve a la fila para repararla \(reparación 1 de 3\)/);
    assert.match(texto, /- Regla: Corre `npx tsc --noEmit` y el build antes de terminar/);
    // La segunda sesión (construir de nuevo) trae la lección en sus instrucciones.
    assert.equal((await vuelta()).ok, true);
    const reparada = ultimaDeClaude("Falla y se arregla [tsc-una-vez]");
    assert.match(reparada.prompt, /Lecciones de este proyecto: no repitas estas fallas\./);
    assert.match(reparada.prompt, /Regla: Corre `npx tsc --noEmit` y el build antes de terminar/);
    // Y también la de planear de otra tarjeta del mismo proyecto.
    nuevaModerna("Otra tarea del proyecto", "APROBADO");
    assert.equal((await vuelta()).hizo, "planear");
    const plan = leerLog(LOGS.claude).findLast((l) => l.titulo === "Otra tarea del proyecto" && l.modo === "plan");
    assert.match(plan.prompt, /Lecciones de este proyecto: no repitas estas fallas\./);
    assert.match(plan.prompt, /Regla: Corre `npx tsc --noEmit`/);
    // Subió después de fallar: queda escrito cómo se arregló (y las 3 líneas viajan con la subida).
    Object.assign(tarjetas.get(id), { estado: "SUBIENDO", venceEn: null });
    const subida = await vuelta();
    assert.equal(subida.hizo, "subir");
    assert.equal(subida.ok, true, subida.motivo);
    assert.match(fs.readFileSync(archivoDeLecciones, "utf8"), /^### \d{4}-\d{2}-\d{2} · bien · no_compila · huella:[0-9a-f]{8}$/m);
    assert.match(fs.readFileSync(archivoDeLecciones, "utf8"), /Cómo se arregló: Subió después de 1 reparación\./);
    const enviada = llamadas.findLast((l) => l.accion === "subida" && l.id === id).cuerpo;
    assert.deepEqual(Object.keys(enviada.resumenTres), ["hizo", "ahora", "revisar"]);
    soltarTodas(id);
    for (const t of tarjetas.values()) if (t.titulo === "Otra tarea del proyecto") soltarTodas(t.id);
    sinRestos();
  });

  await prueba("lecciones: la misma falla otra vez no agrega otra entrada, y una tarjeta que sube a la primera no anota nada", async () => {
    const antes = fs.readFileSync(archivoDeLecciones, "utf8");
    const entradasAntes = (antes.match(/^### /gm) ?? []).length;
    const id = nuevaModerna("Se rompe de nuevo [tsc-una-vez]");
    assert.equal((await vuelta()).accion, "reparar");
    const despues = fs.readFileSync(archivoDeLecciones, "utf8");
    assert.equal((despues.match(/^### /gm) ?? []).length, entradasAntes, "la misma huella no se repite");
    assert.match(despues, /fallo · no_compila · huella:[0-9a-f]{8} · veces:2/);
    assert.equal((await vuelta()).ok, true);
    soltarTodas(id);
    // Sube a la primera: nada que aprender.
    const limpia = nuevaModerna("Todo bien a la primera", "APROBADO");
    await vuelta();
    Object.assign(tarjetas.get(limpia), { estado: "PLAN_APROBADO", venceEn: null });
    assert.equal((await vuelta()).ok, true);
    Object.assign(tarjetas.get(limpia), { estado: "SUBIENDO", venceEn: null });
    assert.equal((await vuelta()).ok, true);
    assert.equal((fs.readFileSync(archivoDeLecciones, "utf8").match(/^### /gm) ?? []).length, entradasAntes);
    soltarTodas(limpia);
    sinRestos();
  });

  await prueba("lecciones: sin repetir la huella, con tope de entradas (las viejas se resumen sin perder ninguna) y sin romper si no se puede escribir", async () => {
    const carpeta = fs.mkdtempSync(path.join(os.tmpdir(), "lecciones-"));
    const agente = agenteDelRepo({ clave: "gestion", ruta: "/r/gestion" }, undefined, carpeta);
    assert.equal(agente.archivoLeccionesAprendidas, path.join(carpeta, "lecciones", "gestion.md"));
    assert.equal(agenteDelRepo({ clave: "gestion", ruta: "/r/gestion" }).archivoLeccionesAprendidas, "", "sin carpeta de trabajo no hay archivo");
    const fecha = new Date("2026-10-26T15:00:00Z");
    const una = leccionDe({ tarjeta: { id: "abcdefgh1234", titulo: "Reporte" }, resultado: "fallo", diagnostico: { categoria: "fallan_pruebas", causa: "Fallaron las pruebas" }, etapa: "construir", arreglo: "Se repara", ahora: fecha });
    assert.match(una.fecha, /^2026-10-26$/);
    assert.match(una.regla, /pruebas/);
    assert.match(una.huella, /^[0-9a-f]{8}$/);
    assert.equal(anotarLeccion(agente, una), "agregada");
    assert.equal(anotarLeccion(agente, una), "repetida");
    assert.equal((fs.readFileSync(agente.archivoLeccionesAprendidas, "utf8").match(/^### /gm) ?? []).length, 1);
    // 45 lecciones distintas: quedan MAX_LECCIONES recientes y el resto resumido, una línea cada una.
    for (let n = 1; n <= 45; n += 1) {
      anotarLeccion(agente, leccionDe({ tarjeta: { id: `t${n}`, titulo: `Tarea ${n}` }, resultado: "fallo", diagnostico: { categoria: "lint", causa: `Falla de lint número ${n}` }, etapa: "construir", ahora: fecha }));
    }
    const texto = fs.readFileSync(agente.archivoLeccionesAprendidas, "utf8");
    assert.equal(MAX_LECCIONES, 40);
    assert.equal((texto.match(/^### /gm) ?? []).length, 40);
    const viejas = texto.split("## Lecciones viejas (resumidas)")[1].split("\n").filter((linea) => linea.startsWith("- huella:"));
    assert.equal(viejas.length, 6, "46 en total - 40 = 6 resumidas");
    assert.match(viejas[0], /^- huella:[0-9a-f]{8} · 2026-10-26 · fallan_pruebas · fallo — .*pruebas/);
    // Una huella ya resumida tampoco se agrega otra vez: cuenta una vez más (iba en 2, pasa a 3).
    assert.equal(anotarLeccion(agente, una), "repetida");
    assert.match(fs.readFileSync(agente.archivoLeccionesAprendidas, "utf8"), /\(×3\)/);
    // Al prompt van las últimas 8, una línea cada una.
    const lineas = leccionesParaElPrompt(agente).split("\n");
    assert.equal(lineas.length, 8);
    assert.match(lineas.at(-1), /Falla de lint número 45/);
    assert.ok(lineas.every((linea) => linea.startsWith("- (falló: lint)") && linea.length < 520));
    // Un archivo dañado no mete texto raro ni rompe.
    fs.writeFileSync(agente.archivoLeccionesAprendidas, "\u0000\u0001 basura\n### nada\n- x\n".repeat(3), "utf8");
    assert.equal(leccionesParaElPrompt(agente), "");
    assert.equal(leccionesParaElPrompt({ archivoLeccionesAprendidas: path.join(carpeta, "no-existe.md") }), "");
    // Si no se puede escribir (la carpeta de lecciones es un archivo), no lanza.
    const sinPermiso = agenteDelRepo({ clave: "x", ruta: "/r/x" }, undefined, path.join(carpeta, "lecciones", "gestion.md"));
    const avisos = [];
    assert.equal(anotarLeccion(sinPermiso, una, { registro: { aviso: (m) => avisos.push(m) } }), "no_se_pudo");
    assert.match(avisos[0], /no se pudo anotar la lección/);
    fs.rmSync(carpeta, { recursive: true, force: true });
  });

  await prueba("resumen de 3 líneas y NECESITO: el prompt de construir las pide y las funciones las leen", async () => {
    const tarjeta = { id: "t1", titulo: "Algo", tablero: "T", detalle: "d", intentos: 1, plan: "El plan", zonasAprobadas: [] };
    const repo = { clave: "aizencrm", ruta: "/r/crm" };
    for (const prompt of [promptDeConstruir(tarjeta, repo, "tablero/x"), promptDeNube(tarjeta, repo, "tablero/x")]) {
      assert.match(prompt, /Qué se hizo:/);
      assert.match(prompt, /Qué se ve ahora:/);
      assert.match(prompt, /Qué revisar juntos:/);
      assert.match(prompt, /NECESITO: <clave\|acceso\|decisión>/);
      assert.ok(!prompt.includes("Lecciones de este proyecto"), "sin lecciones no se menciona el bloque");
      assert.match(prompt, /Nunca le escribas a un cliente/);
    }
    assert.match(promptDelPlan(tarjeta, repo), /NECESITO: <clave\|acceso\|decisión>/);
    assert.match(promptDeConstruir(tarjeta, repo, "tablero/x", "claude", { lecciones: "- (falló: lint) algo → Regla: x" }), /Lecciones de este proyecto: no repitas estas fallas\.\n- \(falló: lint\) algo/);
    assert.deepEqual(tresLineasDe("texto\n**Qué se hizo:** Cambié X\n- Qué se ve ahora: Y\nQué revisar juntos:   Z\nQué se hizo: "), { hizo: "Cambié X", ahora: "Y", revisar: "Z" });
    assert.equal(tresLineasDe("sin nada"), null);
    assert.deepEqual(necesitoDe("hola\nNECESITO: clave de Stripe para probar"), { tipo: "clave", detalle: "de Stripe para probar" });
    assert.deepEqual(necesitoDe("**NECESITO:** decisión — ¿A o B?"), { tipo: "decisión", detalle: "¿A o B?" });
    assert.equal(necesitoDe("NECESITO: cosas raras"), null);
    assert.equal(necesitoDe("no necesito nada, NECESITO: clave dentro de una frase"), null);
  });

  await prueba("NECESITO al construir: la tarjeta queda en 'Por revisar' con el motivo, sale UN aviso 'necesita' y no se reintenta", async () => {
    const id = nuevaModerna("Cobrar con la pasarela [necesito]");
    const antes = avisosDeNecesita().length;
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "POR_REVISAR");
    assert.equal(t.resultado.paso, false);
    assert.match(t.resultado.resumen, /^El agente necesita clave: de la API de pagos para probar el cobro/);
    const nuevos = avisosDeNecesita().slice(antes);
    assert.equal(nuevos.length, 1, "un solo aviso");
    assert.match(nuevos[0].cuerpo.texto, /Agente CRM necesita una clave para "Cobrar con la pasarela \[necesito\]": de la API de pagos/);
    assert.equal(nuevos[0].cuerpo.tarjetaId, id, "lleva el id de la tarjeta");
    const delId = llamadas.filter((l) => l.id === id).map((l) => l.accion);
    assert.ok(!delId.includes("reparar") && !delId.includes("error") && !delId.includes("soltar"), `no se reintenta: ${delId.join(",")}`);
    assert.equal(delId.filter((a) => a === "resultado").length, 1);
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR", "sigue esperando al dueño");
    sinRestos();
  });

  await prueba("NECESITO al planear: el plan queda en 'Plan listo' esperando el sí del dueño y sale UN aviso 'necesita'", async () => {
    const id = nuevaModerna("Leer el píxel [necesito]", "APROBADO");
    const antes = avisosDeNecesita().length;
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "planear");
    assert.equal(resultado.ok, true, resultado.motivo);
    const t = tarjetas.get(id);
    assert.equal(t.estado, "PLAN_LISTO");
    assert.match(t.plan, /^APROBAR PLAN: ESPERA TU SÍ — el agente necesita acceso: al panel de Meta para leer el píxel/);
    assert.ok(reglasDeRiesgo.porQueElPlanEsperaTuSi(t.plan), "el CRM no lo aprueba solo (aunque el plan diga APROBAR PLAN: SOLO)");
    const nuevos = avisosDeNecesita().slice(antes);
    assert.equal(nuevos.length, 1);
    assert.match(nuevos[0].cuerpo.texto, /Agente CRM necesita un acceso para "Leer el píxel \[necesito\]": al panel de Meta/);
    assert.match(nuevos[0].cuerpo.texto, /El plan quedó listo esperando tu sí/);
    assert.equal(nuevos[0].cuerpo.tarjetaId, id, "lleva el id de la tarjeta");
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
    // (pausaUso apagada: aquí se prueba el paso a Codex; la pausa por uso tiene sus propias pruebas más abajo)
    const planificador = planificar({ ...conCodex({ respaldoCodex: true }, { vigilarUsoMinutos: 0.0001, pausaUso: { activa: false } }), maxParalelo: 1 });
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

  /* ── Pausa por uso de Claude (26-oct-2026): al llegar al umbral se detiene todo, con orden ── */

  const pausaConfig = (extra = {}) =>
    crearConfig({ construirMinutos: 1 }, { subirSolo: true }, { maxParalelo: 2, vigilarUsoMinutos: 0.0001, pausaUso: { vigilarCercaMinutos: 0.0001 }, ...extra });
  const usoAl = (sesion) => fs.writeFileSync(USO, `Current session: ${sesion}% used · resets Oct 26, 3:20pm (America/Bogota)\nCurrent week (all models): 6% used · resets Oct 30, 7am (America/Bogota)\n`);
  const avisosDeLimite = () => llamadas.filter((l) => l.accion === "aviso" && l.cuerpo.tipo === "limite");
  const tomadas = () => llamadas.filter((l) => l.accion === "tomar").length;
  /** Vueltas del bucle (llenar + esperar) hasta que se cumpla `listo`. No espera a las sesiones que corren. */
  async function vueltasHasta(planificador, listo, ms = 40_000) {
    const limite = Date.now() + ms;
    while (!listo()) {
      if (Date.now() > limite) throw new Error(`no se cumplió a tiempo; corriendo: ${JSON.stringify(planificador.estado().tareas.map((t) => [t.titulo, t.etapa]))}; llamadas: ${llamadas.slice(-6).map((l) => l.accion).join(",")}`);
      await planificador.llenar();
      await planificador.esperar(200);
    }
  }
  const despejarFila = () => {
    for (const t of tarjetas.values()) if (!["HECHO", "ERROR", "POR_REVISAR", "PLAN_LISTO"].includes(t.estado)) t.estado = "HECHO";
    reiniciarALaVez();
  };
  const dormirUnPoco = (ms) => new Promise((resolver) => setTimeout(resolver, ms));

  await prueba("pausa por uso: al 79 % sigue, al 80 % y al 100 % para todo (un solo WhatsApp, avance guardado, sin ERROR ni intento) y al reiniciarse retoma primero lo detenido", async () => {
    despejarFila();
    for (const t of tarjetas.values()) if (t.estado === "PLAN_LISTO" || t.estado === "POR_REVISAR") t.estado = "HECHO";
    fs.rmSync(path.join(T, "trabajo", "estado-uso.json"), { force: true });
    const config = pausaConfig();
    const planeando = nuevaModerna("Plan lento de la pausa [lento]", "APROBADO", { plan: null });
    const construyendo = nuevaModerna("Construye grande de la pausa [muchos-archivos]", "PLAN_APROBADO", { plan: "PLAN\n5. Archivos: src/pausa/uno.ts" });
    const antesDeAvisos = avisosDeLimite().length;

    // 79 %: trabaja con normalidad y no sale ningún WhatsApp; el panel dice 79 %.
    usoAl(79);
    const planificador = planificar(config);
    await vueltasHasta(planificador, () => planificador.estado().tareas.length === 2);
    assert.equal(planificador.estado().pausaUso.pausado, false);
    assert.equal(planificador.estado().pausaUso.sesion.porcentaje, 79);
    assert.equal(avisosDeLimite().length, antesDeAvisos, "al 79 % no hay aviso");
    await vueltasHasta(planificador, () => leerLog(LOGS.claude).some((l) => l.titulo === "Construye grande de la pausa [muchos-archivos]" && l.modo === "acceptEdits"));
    await dormirUnPoco(2500); // que la sesión alcance a escribir sus archivos antes de cortarla

    // 80 %: las dos se detienen con orden y vuelven a la fila.
    usoAl(80);
    await vueltasHasta(planificador, () => planificador.estado().tareas.length === 0);
    for (const id of [planeando, construyendo]) {
      const t = tarjetas.get(id);
      assert.ok(!llamadas.some((l) => l.accion === "error" && l.id === id), "sin ERROR");
      assert.equal(t.intentos, 0, "no gastó el intento");
      assert.equal(t.reparaciones ?? 0, 0);
      assert.match(t.soltada, /Pausado por uso de Claude/);
      assert.deepEqual([t.intentosLista.at(-1).categoria, t.intentosLista.at(-1).accion, t.intentosLista.at(-1).cuentaComoIntento], ["limite_claude", "esperar", false]);
    }
    assert.equal(tarjetas.get(planeando).estado, "APROBADO");
    assert.equal(tarjetas.get(construyendo).estado, "PLAN_APROBADO");
    assert.match(tarjetas.get(construyendo).soltada, /queda guardado/);
    const patch = path.join(T, "trabajo", "intentos", idCorto(construyendo), "trabajo.patch");
    assert.ok(fs.existsSync(patch), "quedó el archivo de avance de la que construía");
    assert.match(fs.readFileSync(patch, "utf8"), /src\/grande\/parte-1\.ts/);
    assert.equal(planificador.estado().pausaUso.pausado, true, "el panel dice pausado");
    assert.equal(avisosDeLimite().length, antesDeAvisos + 1, "un solo WhatsApp");
    const aviso = avisosDeLimite().at(-1).cuerpo.texto;
    assert.match(aviso, /^⛔ Se paró todo: el uso de Claude llegó al 80 %\.\nSe reanuda el .*3:20 p\. m\.\.\nVer: /);
    assert.ok(aviso.split("\n").length <= 3, "máximo 3 líneas");
    sinRestos();

    // Varias vueltas más (y al 100 %): no toma ninguna tarjeta y no repite el aviso.
    const tomasAntes = tomadas();
    usoAl(100);
    for (let i = 0; i < 4; i += 1) {
      await planificador.llenar();
      await dormirUnPoco(20);
    }
    assert.equal(tomadas(), tomasAntes, "en pausa no toma tarjetas nuevas");
    assert.equal(avisosDeLimite().length, antesDeAvisos + 1, "al 100 % sigue habiendo un solo aviso");
    planificador.parar();

    // El Coordinador se reinicia en plena pausa: sigue pausado y no repite el WhatsApp.
    const reiniciado = planificar(config);
    await reiniciado.llenar();
    await reiniciado.llenar();
    assert.equal(reiniciado.estado().pausaUso.pausado, true);
    assert.equal(tomadas(), tomasAntes);
    assert.equal(avisosDeLimite().length, antesDeAvisos + 1, "reiniciado no repite el WhatsApp");

    // Reinicio del uso: baja al 5 %, sale de la pausa, retoma (el avance se reaplica y el agente lo sabe) y avisa en una línea.
    usoAl(5);
    await vueltasHasta(reiniciado, () => reiniciado.estado().tareas.length === 2);
    assert.equal(reiniciado.estado().pausaUso.pausado, false);
    assert.equal(avisosDeLimite().length, antesDeAvisos + 2, "un aviso más: volvió");
    const volvio = avisosDeLimite().at(-1).cuerpo.texto;
    assert.match(volvio, /Volvió a trabajar: el uso de Claude se reinició\./);
    assert.equal(volvio.split("\n").length, 1, "una línea");
    await vueltasHasta(reiniciado, () => leerLog(LOGS.claude).filter((l) => l.titulo === "Construye grande de la pausa [muchos-archivos]" && l.modo === "acceptEdits").length >= 2);
    const retomada = leerLog(LOGS.claude).filter((l) => l.titulo === "Construye grande de la pausa [muchos-archivos]" && l.modo === "acceptEdits").at(-1);
    assert.match(retomada.prompt, /RETOMADA: .*YA está aplicado/s, "el agente recibe el avance guardado en sus instrucciones");
    for (const id of [planeando, construyendo]) latidoVencido.add(id);
    await reiniciado.esperarTodas();
    for (const id of [planeando, construyendo]) latidoVencido.delete(id);
    soltarTodas(planeando, construyendo);
    reiniciado.parar();
    despejarFila();
  });

  await prueba("pausa por uso: apagada no pausa ni al 100 % y apagarla en plena pausa la levanta; con el umbral en 60 % pausa al 60 %", async () => {
    despejarFila();
    fs.rmSync(path.join(T, "trabajo", "estado-uso.json"), { force: true });
    const config = pausaConfig();
    const id = nuevaModerna("Construye con el interruptor [muchos-archivos]", "PLAN_APROBADO", { plan: "PLAN\n5. Archivos: src/interruptor/uno.ts" });
    usoAl(100);
    const planificador = planificar(config);
    planificador.ajustarPausaUso({ activa: false, umbral: 80 }); // lo que el CRM devuelve en el latido
    await vueltasHasta(planificador, () => planificador.estado().tareas.length === 1);
    assert.equal(planificador.estado().pausaUso.pausado, false, "apagada: ni al 100 % pausa");
    assert.equal(planificador.estado().pausaUso.activa, false);
    // Con el umbral en 60 % y el interruptor prendido, el 100 % pausa y detiene la tarjeta.
    await dormirUnPoco(1500);
    planificador.ajustarPausaUso({ activa: true, umbral: 60 });
    await vueltasHasta(planificador, () => planificador.estado().tareas.length === 0);
    assert.equal(planificador.estado().pausaUso.pausado, true);
    assert.equal(planificador.estado().pausaUso.umbral, 60);
    assert.equal(tarjetas.get(id).estado, "PLAN_APROBADO");
    // Apagarla en plena pausa la levanta: vuelve a tomar la tarjeta sin que baje el uso y sin avisar "volvió".
    const avisosAntes = avisosDeLimite().length;
    planificador.ajustarPausaUso({ activa: false, umbral: 60 });
    await vueltasHasta(planificador, () => planificador.estado().tareas.length === 1);
    assert.equal(planificador.estado().pausaUso.pausado, false);
    assert.equal(avisosDeLimite().length, avisosAntes, "el dueño la apagó: no se manda 'volvió a trabajar'");
    latidoVencido.add(id);
    await planificador.esperarTodas();
    latidoVencido.delete(id);
    soltarTodas(id);
    planificador.parar();
    usoAl(5);
    despejarFila();
  });

  await prueba("pausa por uso: si no se puede leer el uso (3 veces seguidas) no se pausa, el panel lo dice y sale UN solo aviso", async () => {
    despejarFila();
    fs.rmSync(path.join(T, "trabajo", "estado-uso.json"), { force: true });
    fs.rmSync(USO, { force: true }); // `claude -p /usage` contesta algo ilegible
    const antes = avisosDeLimite().length;
    const planificador = planificar(pausaConfig());
    for (let i = 0; i < 6; i += 1) {
      await planificador.llenar();
      await dormirUnPoco(20);
    }
    const estado = planificador.estado().pausaUso;
    assert.equal(estado.pausado, false, "sin número no se pausa");
    assert.ok(estado.sinLeerDesde, "el panel dice desde cuándo no puede leer");
    assert.equal(avisosDeLimite().length, antes + 1, "un solo aviso, no uno por vuelta");
    assert.match(avisosDeLimite().at(-1).cuerpo.texto, /No pude leer el uso de Claude desde las/);
    usoAl(5);
    planificador.parar();
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

  await prueba("nube: con todoEnLaNube, una chica se construye en la nube y aizen1 queda con 0 construyendo", async () => {
    despejar();
    const a = nueva("Todo nube uno [mod:tnu]", "PLAN_APROBADO", { plan: planDe("tnu") });
    const b = nueva("Todo nube dos [mod:tnd]", "PLAN_APROBADO", { plan: planDe("tnd") });
    const planificador = planificar(nubeConfig({ todoEnLaNube: true }));
    await planificador.llenar();
    assert.deepEqual(planificador.cupos(), { aizen1: 0, nube: 2 }, "nada construye en aizen1");
    for (const id of [a, b]) assert.equal(planificador.estado().tareas.find((t) => t.tarjetaId === id).lugar, "nube");
    await correrHasta(planificador, () => [a, b].every((id) => tarjetas.get(id).estado === "HECHO"), 180_000);
    assert.equal(tarjetas.get(a).resultado.construidoEn, "nube");
  });

  await prueba("nube: un proyecto con construirEn \"aizen1\" se construye en aizen1 aunque todoEnLaNube esté prendido", async () => {
    despejar();
    const a = nueva("Gestión en aizen1 [mod:gea]", "PLAN_APROBADO", { plan: planDe("gea") });
    const config = crearConfig({ construirNubeMinutos: 2 }, { subirSolo: true, github: "prueba/repo", construirEn: "aizen1" }, {
      maxParalelo: 2,
      nube: { activa: true, maxTareas: 8, todoEnLaNube: true, vigilarCadaSegundos: 0.3, esperaMinutos: 1, lanzarMinutos: 1, terminal: "sin-terminal", comandoGh: [node, falso("gh-falso.mjs")] },
    });
    const planificador = planificar(config);
    await planificador.llenar();
    assert.deepEqual(planificador.cupos(), { aizen1: 1, nube: 0 }, "nada va a la nube");
    assert.equal(planificador.estado().tareas.find((x) => x.tarjetaId === a).lugar, "aizen1");
    await correrHasta(planificador, () => tarjetas.get(a).estado === "HECHO", 180_000);
    assert.equal(tarjetas.get(a).resultado.construidoEn, "aizen1");
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
    assert.deepEqual(nube[0].argumentos.slice(0, 6), ["-p", "--cloud", "--model", "sonnet", "--output-format", "json"], "la nube pide Sonnet para construir, igual que aizen1");
    // El chequeo previo (29-oct-2026): --debug-file al lado del worktree (fuera de él), y se borra al terminar.
    assert.equal(nube[0].argumentos[6], "--debug-file");
    assert.equal(nube[0].argumentos[7], `${nube[0].cwd}.debug-nube.log`);
    assert.equal(fs.existsSync(nube[0].argumentos[7]), false, "el log de la CLI no queda");
    assert.ok(!/git fetch origin/.test(nube[0].prompt), "en modo cli la sesión ya arranca en la rama: no se le pide cambiar");
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

  await prueba("29-oct revisión en la nube: revision=FALLO (build y pruebas OK) -> ERROR revision_no_paso sin reparar, con el revisor, lo que pidió y el link", async () => {
    despejar();
    const titulo = "Revisión de la nube no pasa [nube-rev-fallo]";
    const desde = leerLog(LOGS.claude).length;
    const id = nueva(titulo, "PLAN_APROBADO", { plan: planDe("revfallo", 9), moderno: true });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await planificador.esperarTodas();
    planificador.parar();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.reparaciones ?? 0, 0, "no se repara sola");
    assert.equal(t.resultado.error.categoria, "revision_no_paso");
    // Las 2 líneas para el dueño las redactó la misma sesión de la nube (DUEÑO 1 / DUEÑO 2 en el cuerpo del commit).
    assert.deepEqual(t.resultado.error.motivo.split("\n"), [
      "La revisión de seguridad no aprobó: pide que src/api/ruta.ts revise quién llama antes de leer los datos.",
      "¿Lo subo así, lo corrijo con tu indicación o lo cierro?",
    ]);
    const intento = t.intentosLista.at(-1);
    assert.ok(intento.causa.includes(enlaceDe(titulo)), "la causa trae el link de la sesión");
    assert.match(intento.error, /Informes de los revisores:\nseguridad: CAMBIOS — src\/api\/ruta\.ts: validar quién llama/);
    // La instrucción que recibió la nube trae la revisión (seguridad en Opus, los demás en Sonnet, progreso y revision=).
    const [lanzada] = llamadasALaNube(desde);
    assert.match(lanzada.prompt, /^- seguridad \(model "opus"\)/m);
    assert.match(lanzada.prompt, /^- codigo \(model "sonnet"\)/m);
    assert.match(lanzada.prompt, /git commit --allow-empty -m "revision: R<N> seguridad=/);
    sinRestos();
  });

  await prueba("29-oct revisión en la nube: revision=OK sigue como siempre y el resumen lo dice; un 'resultado:' viejo sin revision= también sigue", async () => {
    despejar();
    const id = nueva("Revisión de la nube pasa [nube-rev-ok]", "PLAN_APROBADO", { plan: planDe("revok", 9) });
    const vieja = nueva("Sesión vieja sin revisión", "PLAN_APROBADO", { plan: planDe("revvieja", 9) });
    const planificador = planificar(nubeConfig());
    await planificador.llenar();
    await planificador.esperarTodas();
    planificador.parar();
    for (const [cual, texto] of [
      [id, /Revisión \(4 revisores, en la nube\): APROBADA\./],
      [vieja, /la sesión de la nube no dejó revision= en su commit \(sesión vieja o se le pasó\): no consta/],
    ]) {
      const t = tarjetas.get(cual);
      assert.notEqual(t.estado, "ERROR", t.resultado?.error?.motivo);
      assert.equal(t.resultado.paso, true);
      assert.match(t.resultado.resumen, texto);
    }
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

  /* ── La SESIÓN FIJA y el chequeo previo (29-oct-2026): Gestión con el repo seleccionado ── */

  const FIJA = "session_01FijaDePrueba";
  const fijaConfig = (sesionFija = FIJA, nube = {}) =>
    crearConfig({ construirNubeMinutos: 2 }, { subirSolo: true, github: "prueba/repo", agente: { nombre: "Agente Gestión" }, nube: { sesionFija } }, {
      maxParalelo: 2,
      nube: { activa: true, maxTareas: 8, vigilarCadaSegundos: 0.3, esperaMinutos: 1, lanzarMinutos: 1, terminal: "sin-terminal", comandoGh: [node, falso("gh-falso.mjs")], todoEnLaNube: true, ...nube },
    });
  const llamadasAFija = (desde, id = FIJA) => leerLog(LOGS.claude).slice(desde).filter((l) => l.argumentos.includes("--cloud") && l.argumentos.includes(id));

  await prueba("sesión fija (config y piezas): sin nada no hay sesión fija; el id es session_…; el prompt empieza con la tarea nueva y prohíbe conectores", () => {
    assert.deepEqual(crearConfig().repos.aizencrm.nube, { sesionFija: null }, "sin nada: como siempre");
    assert.equal(crearConfig().nube.chequeoPrevio, true);
    assert.equal(crearConfig().nube.sinAccesoMinutos, 60);
    assert.deepEqual(crearConfig({}, { nube: { sesionFija: "" } }).repos.aizencrm.nube, { sesionFija: null }, "vacía (como en el ejemplo) = sin sesión fija");
    assert.throws(() => crearConfig({}, { nube: { sesionFija: "https://claude.ai/code/x" } }), /nube\.sesionFija/);
    const repo = fijaConfig().repos.aizencrm;
    assert.equal(sesionFijaDe(repo), FIJA);
    assert.equal(nombreDelProyecto(repo), "Gestión");
    assert.equal(linkDeLaSesionFija({ ok: true, session_id: FIJA }, FIJA), `https://claude.ai/code/${FIJA}`);
    assert.equal(lineaSinRepo("x\n[DEBUG] GitHub app is not installed on AlexMoreR/Gestion\ny"), "GitHub app is not installed on AlexMoreR/Gestion");
    assert.equal(lineaSinRepo("[DEBUG] [teleportToRemote] Bundling (reason: github_preflight_failed)"), "Bundling (reason: github_preflight_failed)");
    assert.equal(lineaSinRepo("[DEBUG] GitHub app is installed on AlexMoreR/AgenteLite"), null);
    const prompt = promptDeNube({ id: "t1", titulo: "T", plan: "p" }, repo, "tablero/abc-t", { sesionFija: true });
    assert.match(prompt, /^TAREA NUEVA E INDEPENDIENTE/, "lo primero: la tarea es nueva");
    assert.match(prompt.split("\n\n")[0], /git fetch origin && git checkout -B tablero\/abc-t origin\/tablero\/abc-t/);
    assert.match(prompt, /Usar CUALQUIER conector o herramienta MCP/);
    const sinFija = promptDeNube({ id: "t1", titulo: "T", plan: "p" }, repo, "tablero/abc-t");
    assert.ok(!/TAREA NUEVA|git checkout -B/.test(sinFija), "sin sesión fija no");
    assert.match(sinFija, /Usar CUALQUIER conector o herramienta MCP/, "la prohibición de conectores va siempre");
    // El diagnóstico: por la categoría o por el texto; no se repara solo.
    assert.equal(diagnosticar({ error: new Error("La sesión fija de Gestión no responde (la nube no tiene acceso al repo x): salió con código 1"), etapa: "construir" }).categoria, "nube_sin_acceso_repo");
    assert.equal(diagnosticar({ error: new Error("La nube no tiene acceso al repo AlexMoreR/Gestion: no conectó"), etapa: "construir" }).categoria, "nube_sin_acceso_repo");
    assert.equal(decidir({ diagnostico: { categoria: "nube_sin_acceso_repo" }, tarjeta: {}, etapa: "construir" }).accion, "escalar");
  });

  await prueba("sesión fija: /clear y la tarea a la misma sesión (sin crear otra); la segunda tarjeta del proyecto espera 'la sesión de Gestión está ocupada'; las dos quedan HECHO", async () => {
    despejar();
    olvidarSinAcceso();
    const desde = leerLog(LOGS.claude).length;
    const a = nueva("Gestión fija uno [mod:fijauno]", "PLAN_APROBADO", { plan: planDe("fijauno") });
    const b = nueva("Gestión fija dos [mod:fijados]", "PLAN_APROBADO", { plan: planDe("fijados") });
    const planificador = planificar(fijaConfig());
    await planificador.llenar();
    assert.equal(planificador.cupos().nube, 1, "una sola a la vez en la sesión fija");
    const enCola = [a, b].find((id) => tarjetas.get(id).estado === "PLAN_APROBADO");
    assert.ok(enCola, "la otra espera en la fila sin candado");
    assert.match(planificador.estado().esperas.find((e) => e.tarjetaId === enCola)?.motivo ?? "", /la sesión de Gestión está ocupada/);
    await correrHasta(planificador, () => [a, b].every((id) => ["HECHO", "ERROR"].includes(tarjetas.get(id).estado)), 240_000);
    await planificador.esperarTodas();
    planificador.parar();
    for (const id of [a, b]) {
      const t = tarjetas.get(id);
      assert.equal(t.estado, "HECHO", t.resultado?.error?.motivo);
      assert.equal(t.resultado.construidoEn, "nube");
      assert.equal(t.resultado.linkSesion, `https://claude.ai/code/${FIJA}`);
    }
    assert.equal(aLaVez.EN_CURSO, 1, "nunca dos construyendo a la vez en la sesión fija");
    const fija = llamadasAFija(desde);
    assert.equal(llamadasALaNube(desde).length, fija.length, "no se creó ninguna sesión nueva con claude --cloud");
    assert.deepEqual(fija.map((l) => (l.prompt === "/clear" ? "/clear" : "tarea")), ["/clear", "tarea", "/clear", "tarea"], "/clear antes de cada tarea");
    for (const llamada of fija) {
      assert.deepEqual([llamada.argumentos[0], llamada.argumentos.slice(2)], ["-p", ["--cloud", FIJA, "--output-format", "json"]]);
    }
    const tarea = fija[1];
    const rama = tarjetas.get(tarea.titulo === "Gestión fija uno [mod:fijauno]" ? a : b).resultado.rama;
    assert.match(tarea.prompt, /^TAREA NUEVA E INDEPENDIENTE/);
    assert.ok(tarea.prompt.includes(`git fetch origin && git checkout -B ${rama} origin/${rama}`));
    assert.match(tarea.prompt, /DEJA TODO EN LA RAMA tablero\//);
    sinRestos();
  });

  await prueba("sesión fija: si no responde (no existe o archivada) -> ERROR nube_sin_acceso_repo sin reparar ('la sesión fija de Gestión no responde') y el proyecto queda marcado", async () => {
    despejar();
    olvidarSinAcceso();
    const muerta = "session_MUERTA01";
    const desde = leerLog(LOGS.claude).length;
    const id = nueva("Gestión con la sesión muerta [mod:fijamuerta]", "PLAN_APROBADO", { plan: planDe("fijamuerta"), moderno: true });
    let planificador = planificar(fijaConfig(muerta));
    await planificador.llenar();
    await planificador.esperarTodas();
    planificador.parar();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.resultado.error.categoria, "nube_sin_acceso_repo");
    assert.equal(t.reparaciones ?? 0, 0, "no se repara sola");
    assert.match(t.resultado.error.motivo, /la sesión fija de Gestión no responde/i);
    assert.ok(sinAccesoALaNube("aizencrm"), "el proyecto quedó marcado");
    // La siguiente del proyecto no se manda: espera en la fila.
    const otra = nueva("Gestión siguiente [mod:fijamuerta2]", "PLAN_APROBADO", { plan: planDe("fijamuerta2") });
    planificador = planificar(fijaConfig(muerta));
    await planificador.llenar();
    assert.equal(tarjetas.get(otra).estado, "PLAN_APROBADO");
    assert.match(planificador.estado().esperas.find((e) => e.tarjetaId === otra)?.motivo ?? "", /la nube no tiene acceso al repo de "aizencrm"/);
    assert.equal(llamadasAFija(desde, muerta).length, 1, "solo el /clear de la primera: la segunda no gastó nada");
    planificador.parar();
    olvidarSinAcceso();
    tarjetas.get(otra).estado = "HECHO";
    sinRestos();
  });

  await prueba("chequeo previo (sin sesión fija): el log de --debug-file dice github_preflight_failed -> ERROR nube_sin_acceso_repo enseguida (sin esperar la señal), con el link", async () => {
    despejar();
    olvidarSinAcceso();
    const titulo = "Gestión sin app de GitHub [nube-sin-app]";
    const id = nueva(titulo, "PLAN_APROBADO", { plan: planDe("sinapp"), moderno: true });
    const planificador = planificar(nubeConfig({ todoEnLaNube: true }));
    const inicio = Date.now();
    await planificador.llenar();
    await planificador.esperarTodas();
    planificador.parar();
    const t = tarjetas.get(id);
    assert.equal(t.estado, "ERROR");
    assert.equal(t.resultado.error.categoria, "nube_sin_acceso_repo");
    assert.equal(t.reparaciones ?? 0, 0, "no se repara sola");
    assert.ok(Date.now() - inicio < 30_000, `no esperó la señal de la sesión (${Date.now() - inicio} ms)`);
    assert.match(t.resultado.error.motivo, /La nube no tiene acceso al repo prueba\/repo/);
    assert.match(t.resultado.error.motivo, /github_preflight_failed|GitHub app is not installed/);
    assert.ok(JSON.stringify(t).includes(enlaceDe(titulo)), "con el link de la sesión que quedó sin repo");
    assert.ok(sinAccesoALaNube("aizencrm"), "el proyecto quedó marcado");
    olvidarSinAcceso();
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
    assert.ok(llamada.argumentos[1].startsWith("Eres el Agente CRM"), "la descripción es el argumento justo después de --cloud");
    assert.deepEqual(llamada.argumentos.slice(2, 4), ["--model", "sonnet"]);
    assert.equal(llamada.argumentos[4], "--debug-file", "con el chequeo previo");
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
    // 29-oct-2026: sin ningún commit (ni "inicio:") corta a los sinSenalMinutos (acá iguales a la espera).
    assert.match(t.resultado.error.motivo, /no dejó el commit "resultado:"|no dio señal/);
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
    // 31-oct-2026: el choque con main se reconstruye sin gastar reparación (intento "esperar" que no cuenta).
    const reparacion = (t.intentosLista ?? []).find((intento) => intento.categoria === "choca_con_main");
    assert.ok(reparacion, "se mandó a reconstruir (no ERROR)");
    assert.deepEqual([reparacion.accion, reparacion.cuentaComoIntento, t.reparaciones ?? 0], ["esperar", false, 0]);
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

  /* ── Revisión previa (27-oct-2026): los 4 casos del 26-oct, con las tarjetas de ese día ── */
  const cerrarLoDeAntes = () => {
    for (const t of tarjetas.values()) if (!["HECHO", "ERROR"].includes(t.estado)) Object.assign(t, { estado: "HECHO", venceEn: null });
  };
  const sinFinal = (id) => assert.ok(!["FALLIDO", "ERROR"].includes(tarjetas.get(id).estado), `${tarjetas.get(id).titulo} terminó en ${tarjetas.get(id).estado}`);
  const avisosAlDueno = () => llamadas.filter((l) => l.accion === "aviso").length;
  const deLaTarjeta = (id) => llamadas.filter((l) => l.id === id).map((l) => l.accion);

  await prueba("caso 1 — 'Alertas de Tecnología' depende de la página de alertas (aún no HECHO): espera sin intento ni reparación y arranca sola", async () => {
    cerrarLoDeAntes();
    const avisos = avisosAlDueno();
    // La página todavía no está en main (IDEA: nadie la toma). Antes de planear, la dependencia está en el detalle.
    const pagina = nuevaModerna("Prioridad y página de alertas", "IDEA");
    const alertas = nuevaModerna("Alertas de Tecnología", "APROBADO", { plan: null, detalle: "Se apoya en la tarjeta «Prioridad y página de alertas»: usa su página." });
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "planear");
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(alertas).estado, "APROBADO", "esperando, sin ERROR");
    assert.equal(tarjetas.get(alertas).intentos, 0, "no gastó intento");
    assert.equal(tarjetas.get(alertas).reparaciones ?? 0, 0);
    assert.deepEqual(tarjetas.get(alertas).dependeDe, [pagina], "la flecha de dependencia");
    assert.ok(!leerLog(LOGS.claude).some((l) => l.titulo === "Alertas de Tecnología"), "no se abrió ninguna sesión de Claude");
    // Mientras la página no esté HECHO, el CRM no la ofrece.
    assert.equal((await vuelta()).hizo, null);
    // La página sube a main: arranca sola.
    tarjetas.get(pagina).estado = "HECHO";
    const arranca = await vuelta();
    assert.equal(arranca.hizo, "planear");
    assert.equal(tarjetas.get(alertas).estado, "PLAN_LISTO");
    sinFinal(alertas);
    assert.equal(avisosAlDueno(), avisos, "ningún aviso al dueño");
    soltarTodas(alertas);
    sinRestos();
  });

  await prueba("caso 1 — con el plan aprobado, si el plan nombra una tarjeta que no está en main, no se construye y vuelve a 'Plan aprobado'", async () => {
    const pagina = nuevaModerna("Página de alertas del plan", "IDEA");
    const id = nuevaModerna("Alertas de Tecnología (plan)", "PLAN_APROBADO", { plan: "PLAN\n1. Requiere la «Página de alertas del plan» ya terminada.\n5. Archivos: cambio.txt" });
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(id).estado, "PLAN_APROBADO");
    assert.equal(tarjetas.get(id).intentos, 0);
    assert.equal(tarjetas.get(id).reparaciones ?? 0, 0);
    assert.ok(!leerLog(LOGS.claude).some((l) => l.titulo === "Alertas de Tecnología (plan)"), "no se abrió la sesión de construir");
    tarjetas.get(pagina).estado = "HECHO";
    const construye = await vuelta();
    assert.equal(construye.hizo, "construir");
    assert.equal(tarjetas.get(id).estado, "POR_REVISAR");
    soltarTodas(id);
    sinRestos();
  });

  await prueba("caso 1 — DEPENDE_DE de la sesión (al planear y al construir): la tarjeta espera, sin intento, reparación, FALLIDO ni ERROR", async () => {
    const pagina = nuevaModerna("Página de alertas", "IDEA");
    const planear = nuevaModerna("Alertas por sesión [depende-sesion]", "APROBADO", { plan: null });
    const antes = avisosAlDueno();
    assert.equal((await vuelta()).hizo, "planear");
    assert.equal(tarjetas.get(planear).estado, "APROBADO", "al planear vuelve a Aprobado");
    assert.equal(tarjetas.get(planear).intentos, 0);
    assert.deepEqual(tarjetas.get(planear).dependeDe, [pagina]);
    assert.equal(tarjetas.get(planear).plan, null, "no se guardó como plan");
    soltarTodas(planear);
    const construir = nuevaModerna("Alertas por sesión [depende-sesion] construir", "PLAN_APROBADO");
    assert.equal((await vuelta()).hizo, "construir");
    assert.equal(tarjetas.get(construir).estado, "PLAN_APROBADO", "al construir vuelve a Plan aprobado");
    assert.equal(tarjetas.get(construir).intentos, 0);
    assert.equal(tarjetas.get(construir).reparaciones ?? 0, 0, "ni una reparación");
    assert.deepEqual(tarjetas.get(construir).dependeDe, [pagina]);
    const acciones = deLaTarjeta(construir);
    assert.ok(!acciones.includes("reparar") && !acciones.includes("error"), acciones.join(","));
    assert.equal(avisosAlDueno(), antes, "ningún aviso al dueño");
    soltarTodas(pagina, construir);
    sinRestos();
  });

  await prueba("caso 2 — 'Registro de retroactivos' ya estaba en main: HECHO con la nota 'ya estaba hecho (commit X)', sin pedirle nada al dueño", async () => {
    cerrarLoDeAntes();
    const antes = avisosAlDueno();
    const id = nuevaModerna("Registro de retroactivos [ya-hecho]", "PLAN_APROBADO");
    const ramasAntes = ramasDelRemoto().join();
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(id).estado, "HECHO");
    assert.equal(tarjetas.get(id).resultado.yaEstabaHecho.nota, `ya estaba hecho (commit ${tarjetas.get(id).resultado.yaEstabaHecho.commit})`);
    assert.equal(shaDe("main").slice(0, 7), tarjetas.get(id).resultado.yaEstabaHecho.commit.slice(0, 7), "el commit es el de main");
    assert.equal(ramasDelRemoto().join(), ramasAntes, "no empujó ninguna rama");
    assert.ok(!deLaTarjeta(id).some((a) => ["reparar", "error", "soltar"].includes(a)), deLaTarjeta(id).join(","));
    assert.equal(avisosAlDueno(), antes);
    sinRestos();
  });

  await prueba("caso 2 — al planear también: YA_ESTA_HECHO con un commit de main cierra la tarjeta", async () => {
    const id = nuevaModerna("Registro de retroactivos (plan) [ya-hecho]", "APROBADO", { plan: null });
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "planear");
    assert.equal(tarjetas.get(id).estado, "HECHO");
    assert.match(tarjetas.get(id).resultado.yaEstabaHecho.nota, /^ya estaba hecho \(commit [0-9a-f]{7,}\)$/);
    sinRestos();
  });

  await prueba("caso 2 — con un commit que NO está en main, no se cierra: sigue como siempre (se repara)", async () => {
    const id = nuevaModerna("Registro de retroactivos [ya-hecho-falso]", "PLAN_APROBADO");
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.notEqual(tarjetas.get(id).estado, "HECHO");
    assert.ok(!tarjetas.get(id).resultado?.yaEstabaHecho);
    assert.equal(resultado.accion, "reparar", "no_cambio_nada, como hoy");
    assert.ok(!deLaTarjeta(id).includes("ya-hecha"));
    soltarTodas(id);
    sinRestos();
  });

  await prueba("caso 3 — main trae errores viejos de lint: las tareas limpias pasan y se crea UNA sola tarjeta de limpieza", async () => {
    cerrarLoDeAntes();
    limpiezaEnLaFila = true;
    const antes = avisosAlDueno();
    const ids = ["Paralelo de verdad", "GitHub Actions 1/3", "GitHub Actions 3/3"].map((titulo) => nuevaModerna(titulo));
    for (const id of ids) {
      const resultado = await vuelta();
      assert.equal(resultado.hizo, "construir");
      assert.equal(resultado.ok, true, resultado.motivo);
      assert.equal(tarjetas.get(id).estado, "POR_REVISAR", tarjetas.get(id).resultado?.error?.motivo);
      assert.equal(tarjetas.get(id).resultado.paso, true);
      assert.ok(!("erroresViejos" in tarjetas.get(id).resultado), "la lista no viaja en el resultado");
      sinFinal(id);
    }
    const limpiezas = [...tarjetas.values()].filter((t) => t.titulo === "Limpieza: main trae errores viejos (aizencrm)" && t.estado !== "HECHO");
    assert.equal(limpiezas.length, 1, "una sola tarjeta de limpieza, no tres");
    assert.equal(limpiezas[0].estado, "APROBADO");
    assert.match(limpiezas[0].detalle, /lint\|viejo\.txt\|regla-falsa\|error de lint/);
    assert.equal(llamadas.filter((l) => l.accion === "limpieza" && ids.includes(l.id)).length, 3, "las tres la pidieron");
    assert.equal(avisosAlDueno(), antes, "ningún aviso al dueño");
    soltarTodas(...ids, limpiezas[0].id);
    limpiezaEnLaFila = false;
    sinRestos();
  });

  await prueba("caso 3 — una tarea con un error de lint NUEVO sí falla (main ya tenía otro, no este)", async () => {
    const id = nuevaModerna("Ensucia el lint [lint]");
    const resultado = await vuelta();
    assert.equal(resultado.hizo, "construir");
    assert.equal(resultado.ok, false);
    assert.match(resultado.motivo, /lint/i);
    soltarTodas(id);
    sinRestos();
  });

  await prueba("caso 3 — pruebas que ya fallan en main: la tarea limpia pasa (se mide main una vez); una falla NUEVA sigue frenando", async () => {
    const conPruebasViejas = crearConfig({}, { pruebas: [[node, "pruebas-viejas.mjs"]] });
    const medidosDeMain = () => fs.readdirSync(path.join(T, "trabajo", "cache", "main")).length;
    const medidosAntes = fs.existsSync(path.join(T, "trabajo", "cache", "main")) ? medidosDeMain() : 0;
    const limpia = nuevaModerna("Tarea limpia con pruebas viejas");
    const resultado = await vuelta(conPruebasViejas);
    assert.equal(resultado.ok, true, resultado.motivo);
    assert.equal(tarjetas.get(limpia).estado, "POR_REVISAR");
    assert.match(tarjetas.get(limpia).resultado.pruebas, /falla igual en main \(1 falla\(s\) vieja\(s\)\)/);
    assert.equal(medidosDeMain(), medidosAntes + 1, "main se midió una vez");
    // Otra tarea del mismo main: usa lo guardado, no vuelve a correr main.
    const otra = nuevaModerna("Otra tarea limpia con pruebas viejas");
    assert.equal((await vuelta(conPruebasViejas)).ok, true);
    assert.equal(tarjetas.get(otra).estado, "POR_REVISAR");
    assert.equal(medidosDeMain(), medidosAntes + 1, "la segunda usó lo guardado");
    // Una prueba nueva que se rompe: la falla es de la tarea.
    const rota = nuevaModerna("Rompe una prueba nueva [falla-nueva]");
    const fallo = await vuelta(conPruebasViejas);
    assert.equal(fallo.ok, false);
    assert.match(fallo.motivo, /prueba nueva/);
    assert.notEqual(tarjetas.get(rota).estado, "POR_REVISAR");
    soltarTodas(limpia, otra, rota);
    sinRestos();
  });

  await prueba("caso 4 — una espera por choque se suelta sola cuando la otra termina (HECHO o con falla), aunque el Coordinador siga lleno", async () => {
    cerrarLoDeAntes();
    for (const [titulo, falla] of [["Ventas: la línea Admin nunca suma", false], ["Ventas: la línea Admin nunca suma (con falla) [tsc]", true]]) {
      const plan = "PLAN\n5. Archivos: src/ventas/cambio.ts";
      const ventas = nueva(`${titulo} [mod:ventas]`, "PLAN_APROBADO", { plan });
      const bloqueada = nueva(`Alertas de ventas ${falla ? "B" : "A"} [mod:ventas]`, "PLAN_APROBADO", { plan, moderno: true });
      const planificador = planificar({ ...enParalelo, maxParalelo: 3 });
      await planificador.llenar(); // toma ventas; la otra choca y queda en espera
      assert.equal(planificador.corriendo(), 1);
      assert.equal(planificador.estado().esperas.find((e) => e.tarjetaId === bloqueada)?.contra, ventas);
      await planificador.esperarTodas();
      // Con ventas ya terminada (HECHO o con falla) y sin volver a llenar, la espera no se queda mostrando "choca con…".
      assert.ok(!planificador.estado().esperas.some((e) => e.tarjetaId === bloqueada), "la espera se soltó");
      await correrHasta(planificador, () => tarjetas.get(bloqueada).estado !== "PLAN_APROBADO", 120_000);
      assert.notEqual(tarjetas.get(bloqueada).estado, "PLAN_APROBADO", "volvió a la fila y la tomaron");
      sinFinal(bloqueada);
      await planificador.esperarTodas();
      planificador.parar();
      soltarTodas(ventas, bloqueada);
    }
    sinRestos();
  });

  await prueba("caso 4 — una carpeta o un glob del plan choca con el archivo de la otra: no se toma mientras corre la primera, espera con 'contra' = la primera y se toma sola al terminar", async () => {
    cerrarLoDeAntes();
    // Antes (módulo "ventas" contra "ventas/cambio") no chocaban: las dos tocaban src/ventas/cambio.ts a la vez.
    const primera = nueva("Ventas: cambia el archivo de ventas [mod:ventas]", "PLAN_APROBADO", { plan: "PLAN\n5. Archivos: src/ventas/cambio.ts" });
    const segunda = nueva("Ventas: ordena toda la carpeta [mod:ventas]", "PLAN_APROBADO", { plan: "PLAN\n5. Archivos: `src/ventas/**`", moderno: true });
    const planificador = planificar({ ...enParalelo, maxParalelo: 3 });
    await planificador.llenar(); // toma la primera; la segunda choca y queda en espera
    assert.equal(planificador.corriendo(), 1);
    assert.equal(tarjetas.get(segunda).estado, "PLAN_APROBADO", "la segunda no se tomó");
    const espera = planificador.estado().esperas.find((e) => e.tarjetaId === segunda);
    assert.equal(espera?.contra, primera);
    assert.match(espera?.motivo ?? "", /src\/ventas/);
    await planificador.esperarTodas();
    assert.ok(!planificador.estado().esperas.some((e) => e.tarjetaId === segunda), "la espera se soltó");
    await correrHasta(planificador, () => tarjetas.get(segunda).estado !== "PLAN_APROBADO", 120_000);
    assert.notEqual(tarjetas.get(segunda).estado, "PLAN_APROBADO", "se tomó sola cuando terminó la primera");
    sinFinal(segunda);
    await planificador.esperarTodas();
    planificador.parar();
    soltarTodas(primera, segunda);
    sinRestos();
  });

  // ── REVISAR DE NUEVO lo que quedó en Por revisar (30-oct-2026): tarjetas de CHATS en POR_REVISAR, rebase, build, pruebas y envíos ──
  {
    const configRevisar = () => crearConfig({}, { subirSolo: true, zonasQueSubenSolas: ["BOT_VENTAS", "META_ADS", "LIBRO_V3", "CHATS"], vigilancia: { minutos: 0.02, cadaSegundos: 0.3, maxErroresNuevos: 2 } });
    const cerrarLasDemas = () => {
      for (const t of tarjetas.values()) if (!["HECHO", "ERROR"].includes(t.estado)) Object.assign(t, { estado: "HECHO", venceEn: null });
    };
    const cambiarMainRevisar = async (relativo, texto) => {
      g(REPO, "pull", "--quiet", "--ff-only", "origin", "main");
      archivo(relativo, texto);
      g(REPO, "add", "-A");
      g(REPO, "commit", "--quiet", "-m", `main cambia ${relativo}`);
      g(REPO, "push", "--quiet", "origin", "main");
      await new Promise((resolver) => setTimeout(resolver, 300));
    };
    /** Una tarjeta POR_REVISAR de CHATS como las 8 viejas: su rama tablero/… en el remoto, construida sobre el main de ese momento. */
    const porRevisarDeChats = (titulo, nombre, archivos) => {
      g(REPO, "pull", "--quiet", "--ff-only", "origin", "main");
      const base = g(REPO, "rev-parse", "HEAD");
      const clon = path.join(T, `clon-rn-${nombre}`);
      fs.rmSync(clon, { recursive: true, force: true });
      execFileSync("git", ["clone", "--quiet", REMOTO, clon], { stdio: "ignore" });
      const rama = `tablero/rn-${nombre}`;
      g(clon, "checkout", "--quiet", "-b", rama, "origin/main");
      for (const [relativo, texto] of Object.entries(archivos)) {
        fs.mkdirSync(path.dirname(path.join(clon, relativo)), { recursive: true });
        fs.writeFileSync(path.join(clon, relativo), texto);
      }
      g(clon, "add", "-A");
      g(clon, "commit", "--quiet", "-m", `cambios de ${nombre}`);
      g(clon, "push", "--quiet", "origin", rama);
      const commit = g(clon, "rev-parse", "HEAD");
      fs.rmSync(clon, { recursive: true, force: true });
      const id = nueva(titulo, "POR_REVISAR", {
        plan: "El plan",
        zonaProtegida: ["CHATS"],
        resultado: { paso: true, rama, commit, base, subeSolo: false, pruebas: "✔ build de cuando se construyó", esperaPor: "falta el sí del dueño (construida antes de la regla nueva)" },
      });
      return { id, rama, commit, base };
    };
    /** El revisor de la vuelta, mirando solo la tarjeta de la prueba (otras pruebas dejan tarjetas POR_REVISAR). */
    const revisorDe = (id, config) =>
      crearRevisorDeNuevo({
        crm: { ...crm, porRevisar: async () => {
          const respuesta = await crm.porRevisar();
          return { ...respuesta, paraRevisarDeNuevo: respuesta.paraRevisarDeNuevo.filter((t) => t.id === id) };
        } },
        config,
        registro,
        hayVigilancia: () => false,
      });

    await prueba("revisar de nuevo: solo tarjetas que pasaron, con rama tablero/… y zonas solo CHATS / BOT_VENTAS", async () => {
      const base = { paso: true, rama: "tablero/abc-chats", zonaProtegida: ["CHATS"] };
      assert.equal(sePuedeRevisarDeNuevo(base), true);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, zonaProtegida: ["CHATS", "BOT_VENTAS"] }), true);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, zonaProtegida: ["BOT_VENTAS"] }), true);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, paso: false }), false);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, rama: "main" }), false);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, rama: "claude/otra" }), false);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, zonaProtegida: [] }), false);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, zonaProtegida: ["CHATS", "META_ADS"] }), false);
      assert.equal(sePuedeRevisarDeNuevo({ ...base, zonaProtegida: ["LIBRO_V3"] }), false);
    });

    await prueba("revisar de nuevo: de a una, no arranca en vigilancia, una falla del PC o la red se reintenta después de las otras y un 409 no se repite", async () => {
      const lista = [
        { id: "a", titulo: "A", repo: "aizencrm", paso: true, rama: "tablero/a", zonaProtegida: ["CHATS"] },
        { id: "b", titulo: "B", repo: "aizencrm", paso: true, rama: "tablero/b", zonaProtegida: ["BOT_VENTAS"] },
        { id: "c", titulo: "C", repo: "otro-repo", paso: true, rama: "tablero/c", zonaProtegida: ["CHATS"] },
      ];
      const crmFalso = { porRevisar: async () => ({ tarjetas: [], paraRevisarDeNuevo: lista }) };
      let vigilando = true;
      const vistas = [];
      const fallas = { a: "red", b: "409" };
      const revisor = crearRevisorDeNuevo({
        crm: crmFalso,
        config: { repos: { aizencrm: {} } },
        registro: { info: () => undefined, aviso: () => undefined },
        hayVigilancia: () => vigilando,
        revisar: async (contexto, tarjeta) => {
          vistas.push(tarjeta.id);
          assert.equal(contexto.crm, crmFalso);
          if (fallas[tarjeta.id] === "red") throw new Error("git fetch origin falló: Could not resolve host");
          if (fallas[tarjeta.id] === "409") throw Object.assign(new Error("Espera el sí del dueño: toca dinero"), { status: 409 });
          return { accion: "subir" };
        },
      });
      assert.equal((await revisor.revisar()).hizo, false, "con una vigilancia de 30 min en curso no arranca");
      assert.deepEqual(vistas, []);
      vigilando = false;
      const primera = await revisor.revisar();
      assert.deepEqual([primera.tarjetaId, primera.accion], ["a", "reintentar"], "falla de red: sigue en Por revisar");
      const segunda = await revisor.revisar();
      assert.deepEqual([segunda.tarjetaId, segunda.accion], ["b", "esperar"], "la que no se intentó va antes que la que falló");
      delete fallas.a;
      const tercera = await revisor.revisar();
      assert.deepEqual([tercera.tarjetaId, tercera.accion], ["a", "subir"], "la b (409) no se vuelve a pedir; la a se reintenta");
      assert.deepEqual(vistas, ["a", "b", "a"], "de a una por vuelta; la del repo que no está en este PC no se toca");
    });

    await prueba("revisar de nuevo: una tarjeta de CHATS en Por revisar que pasa -> rebase sobre main, build y pruebas otra vez, SUBIENDO y sube con la vigilancia de 30 min", async () => {
      cerrarLasDemas();
      const { id, rama, commit: viejo } = porRevisarDeChats("Chats: arreglo viejo que pasa", "pasa", { "src/chats/rn-pasa.ts": "export const arreglo = 1;\n" });
      await cambiarMainRevisar("src/otra-cosa-rn.ts", "export const otra = 2;\n");
      const mainAntes = shaDe("main");
      const config = configRevisar();
      const salida = await revisorDe(id, config).revisar();
      const t = tarjetas.get(id);
      assert.equal(salida.accion, "subir", salida.motivo);
      assert.equal(t.estado, "SUBIENDO");
      assert.equal(t.resultado.esperaPor, undefined, "el motivo viejo se borra");
      assert.notEqual(shaDe(rama), viejo, "la rama quedó con el rebase");
      assert.equal(execFileSync("git", ["--git-dir", REMOTO, "rev-parse", `${rama}^`], { encoding: "utf8" }).trim(), mainAntes, "la rama queda encima de main");
      assert.equal(t.resultado.commit, shaDe(rama));
      assert.equal(t.resultado.base, mainAntes);
      assert.ok(t.resultado.pruebas.includes(CONFIRMACION_REVISION_DE_NUEVO), t.resultado.pruebas);
      assert.match(t.resultado.pruebas, /✔ .*verificar\.mjs/, "corrió la verificación");
      assert.equal(shaDe("main"), mainAntes, "revisar de nuevo no toca main");
      const enviadas = llamadas.filter((l) => l.id === id && l.accion === "revisar_de_nuevo");
      assert.equal(enviadas.length, 1);
      assert.equal(enviadas[0].cuerpo.subeSolo, true);
      // La subida de siempre: main no cambió y la rama es la que se probó -> no vuelve a compilar; vigilancia y HECHO.
      const subida = await vuelta(config);
      assert.equal(subida.hizo, "subir");
      assert.equal(subida.ok, true, subida.motivo);
      assert.equal(t.estado, "HECHO");
      assert.ok(execFileSync("git", ["--git-dir", REMOTO, "ls-tree", "-r", "--name-only", "main"], { encoding: "utf8" }).includes("src/chats/rn-pasa.ts"), "subió a main");
      assert.equal(t.resultado.subida.vigilancia?.ok, true, "con la vigilancia de 30 min");
      sinRestos();
    });

    await prueba("revisar de nuevo: si choca con main y no se resuelve solo, queda en ERROR «choca con lo ya subido: <archivos> (motivo)» y no se empuja nada", async () => {
      cerrarLasDemas();
      const { id, rama, commit } = porRevisarDeChats("Chats: arreglo viejo que choca", "choca", { "src/chats/rn-choca.ts": "export const lado = 'tarea';\n" });
      await cambiarMainRevisar("src/chats/rn-choca.ts", "export const lado = 'main';\n");
      const salida = await revisorDe(id, configRevisar()).revisar();
      const t = tarjetas.get(id);
      assert.equal(salida.accion, "error");
      assert.equal(t.estado, "ERROR");
      assert.equal(t.resultado.error.motivo, "construido, no sube: choca con lo ya subido: src/chats/rn-choca.ts (la sesión no terminó con CHOQUE_SIMPLE: OK ni CHOQUE_DE_LOGICA)");
      assert.equal(shaDe(rama), commit, "la rama queda como estaba");
      sinRestos();
    });

    await prueba("revisar de nuevo: un choque de lógica con main queda en ERROR «choque de lógica con lo ya subido: <motivo>» y no se empuja nada", async () => {
      cerrarLasDemas();
      const { id, rama, commit } = porRevisarDeChats("Chats: arreglo viejo que no encaja [choque-logica]", "logica", { "src/chats/rn-logica.ts": "export const lado = 'tarea';\n" });
      await cambiarMainRevisar("src/chats/rn-logica.ts", "export const lado = 'main';\n");
      const salida = await revisorDe(id, configRevisar()).revisar();
      const t = tarjetas.get(id);
      assert.equal(salida.accion, "error");
      assert.equal(t.estado, "ERROR");
      assert.equal(t.resultado.error.motivo, "construido, no sube: choque de lógica con lo ya subido: main cambió el texto del archivo compartido y la tarea también, de forma distinta");
      assert.equal(shaDe(rama), commit, "la rama queda como estaba");
      sinRestos();
    });

    await prueba("revisar de nuevo: si después del rebase no queda nada (o solo .md) queda en ERROR «obsoleta: lo que hacía ya está en main»", async () => {
      cerrarLasDemas();
      const { id } = porRevisarDeChats("Chats: arreglo viejo que ya está", "obsoleta", { "src/chats/rn-obsoleta.ts": "export const ya = true;\n", "docs/nota-rn.md": "una nota\n" });
      await cambiarMainRevisar("src/chats/rn-obsoleta.ts", "export const ya = true;\n");
      const salida = await revisorDe(id, configRevisar()).revisar();
      const t = tarjetas.get(id);
      assert.equal(salida.accion, "error");
      assert.equal(t.estado, "ERROR");
      assert.equal(t.resultado.error.motivo, "construido, no sube: obsoleta: lo que hacía ya está en main");
      sinRestos();
    });

    await prueba("revisar de nuevo: si agrega un envío nuevo a clientes en chats queda en ERROR «agrega envío nuevo a clientes: <línea>», aunque compile y pase las pruebas", async () => {
      cerrarLasDemas();
      const { id, rama, commit } = porRevisarDeChats("Chats: aviso nuevo al cliente", "envio", { "src/chats/rn-envio.ts": "// comentario: sendMessage no cuenta\nexport async function avisar(api, numero) {\n  await api.sendMessage(numero, 'hola');\n}\n" });
      const salida = await revisorDe(id, configRevisar()).revisar();
      const t = tarjetas.get(id);
      assert.equal(salida.accion, "error");
      assert.equal(t.estado, "ERROR");
      assert.equal(t.resultado.error.motivo, "construido, no sube: agrega envío nuevo a clientes: await api.sendMessage(numero, 'hola');");
      assert.equal(shaDe(rama), commit, "no se empujó la rama");
      sinRestos();
    });

    await prueba("revisar de nuevo: si no compila queda en ERROR con las líneas que fallaron; sin red sigue en Por revisar", async () => {
      cerrarLasDemas();
      const { id } = porRevisarDeChats("Chats: arreglo viejo que ya no compila", "tsc", { "src/chats/rn-tsc.ts": "export const x = 1;\n", ROMPER_TSC: "si\n" });
      const salida = await revisorDe(id, configRevisar()).revisar();
      const t = tarjetas.get(id);
      assert.equal(salida.accion, "error");
      assert.equal(t.estado, "ERROR");
      assert.match(t.resultado.error.motivo, /^construido, no sube: no pasa build o pruebas: No pasó la verificación.*error TS2322: el tipo no calza/);
      // Sin red (el remoto no existe): la tarjeta no se mueve y se reintenta en la vuelta siguiente.
      const { id: otra } = porRevisarDeChats("Chats: arreglo viejo sin red", "sin-red", { "src/chats/rn-sin-red.ts": "export const y = 1;\n" });
      const sinRed = crearConfig({}, { remoto: "remoto-que-no-existe", subirSolo: true });
      const reintento = await revisorDe(otra, sinRed).revisar();
      assert.equal(reintento.accion, "reintentar", reintento.motivo);
      assert.equal(tarjetas.get(otra).estado, "POR_REVISAR");
      Object.assign(tarjetas.get(otra), { estado: "HECHO" });
      sinRestos();
    });
  }

} finally {
  servidor.close();
  try {
    fs.rmSync(T, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // Windows a veces tiene un archivo abierto un instante: queda en la carpeta temporal.
  }
}

console.log(`\n${pruebas} pruebas, todas bien`);

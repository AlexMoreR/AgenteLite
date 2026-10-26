// Pruebas del AGENTE DE ÁREA (Ventas): el envío de WhatsApp internos y el resumen del día, con una base
// FALSA (sin red ni Postgres). Lo importante: un cliente nunca recibe nada, con el interruptor apagado no
// sale nada, y hay un solo mensaje por persona y por día.
// Correr: npm run test:agentes-de-area
import assert from "node:assert/strict";
import fs from "node:fs";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const WS = "ws1";
const ALEXANDER = "573001112233";
const ASESORA_1 = "573004445566";
const ASESORA_2 = "573007778899";
const CLIENTE = "573120000000";
const LINEA_ADMIN = { canalId: "canal-admin", instancia: "instancia-admin" };

// ── La base falsa ───────────────────────────────────────────────────────────────────────────────
const ajustes = new Map();
const envios = [];
const dias = [];
let contador = 0;
const coincide = (fila, donde = {}) => Object.entries(donde).every(([k, v]) => fila[k] === v);

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { key: where.key, value: ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
    },
  },
  agenteDeAreaEnvio: {
    create: async ({ data }) => {
      if (data.claveDelDia && envios.some((e) => e.claveDelDia === data.claveDelDia)) {
        throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const fila = { id: `e${++contador}`, claveDelDia: null, motivo: null, createdAt: new Date(), updatedAt: new Date(), ...data };
      envios.push(fila);
      return fila;
    },
    findUnique: async ({ where }) => envios.find((e) => e.claveDelDia === where.claveDelDia) ?? null,
    update: async ({ where, data }) => {
      const fila = envios.find((e) => e.id === where.id);
      Object.assign(fila, data, { updatedAt: new Date() });
      return fila;
    },
    findMany: async ({ where }) => envios.filter((e) => coincide(e, where)),
  },
  agenteDeAreaDia: {
    findUnique: async ({ where }) => dias.find((d) => coincide(d, where.workspaceId_area_fecha)) ?? null,
    upsert: async ({ where, create, update }) => {
      const previo = dias.find((d) => coincide(d, where.workspaceId_area_fecha));
      if (previo) Object.assign(previo, update);
      else dias.push({ id: `d${++contador}`, ...create });
    },
  },
  workspaceMember: { findMany: async () => [] },
};

const salidas = [];
let fallaElEnvio = false;
let hayLinea = true;
const mocks = {
  "@/lib/prisma": { prisma },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (datos) => {
      if (fallaElEnvio) throw new Error("línea caída");
      salidas.push(datos);
    },
  },
  "@/features/avisos-gravedad/servicios/enrutador": {
    leerConfigGravedad: async () => ({}),
    lineaInterna: async () => (hayLinea ? LINEA_ADMIN : null),
  },
};

const reglas = cargar("src/features/agentes-de-area/dominio/reglas.ts", mocks);
const config = cargar("src/features/agentes-de-area/servicios/config.ts", mocks);
const enviosSrv = cargar("src/features/agentes-de-area/servicios/envios.ts", mocks);
const resumenes = cargar("src/features/agentes-de-area/servicios/resumenes.ts", mocks);

function reiniciar({ activo }) {
  ajustes.clear();
  envios.length = 0;
  dias.length = 0;
  salidas.length = 0;
  fallaElEnvio = false;
  hayLinea = true;
  ajustes.set(
    `agente-v3:avisos:${WS}`,
    JSON.stringify({
      canalId: "canal-admin",
      destinos: [
        { numero: ALEXANDER, soloDe: null },
        { numero: ASESORA_1, soloDe: "u-ingrid", userId: "u-ingrid" },
        { numero: ASESORA_2, soloDe: "u-maria", userId: "u-maria" },
      ],
    }),
  );
  if (activo) ajustes.set(`agente-area:ventas:${WS}`, JSON.stringify({ activo: true }));
}
const mandar = (numero, texto = "Hola, esta es tu lista del día", ahora = new Date("2026-10-26T12:30:00Z")) =>
  enviosSrv.mandarAlEquipo({ workspaceId: WS, area: "ventas", numero, texto, ahora });

// ── El interruptor ──────────────────────────────────────────────────────────────────────────────
await prueba("sin fila o con basura el interruptor está apagado", async () => {
  assert.equal(reglas.leerInterruptor(null), false);
  assert.equal(reglas.leerInterruptor("no es json"), false);
  assert.equal(reglas.leerInterruptor('{"activo":"si"}'), false);
  assert.equal(reglas.leerInterruptor('{"activo":true}'), true);
  reiniciar({ activo: false });
  assert.equal(await config.agenteActivo(WS, "ventas"), false);
  await config.fijarInterruptor(WS, "ventas", true);
  assert.equal(await config.agenteActivo(WS, "ventas"), true);
});

await prueba("con el interruptor apagado NO sale nada y queda anotado el motivo", async () => {
  reiniciar({ activo: false });
  const r = await mandar(ALEXANDER);
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /interruptor apagado/);
  assert.equal(salidas.length, 0);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].estado, "BLOQUEADO");
  assert.equal(envios[0].claveDelDia, null, "un bloqueado no ocupa el cupo del día");
});

await prueba("al prender el interruptor el mismo día, el mensaje que se bloqueó sí puede salir", async () => {
  reiniciar({ activo: false });
  await mandar(ASESORA_1);
  ajustes.set(`agente-area:ventas:${WS}`, JSON.stringify({ activo: true }));
  const r = await mandar(ASESORA_1);
  assert.equal(r.enviado, true);
  assert.equal(salidas.length, 1);
});

// ── Nunca a un cliente ──────────────────────────────────────────────────────────────────────────
await prueba("un número de cliente es RECHAZADO por el servidor aunque el interruptor esté prendido", async () => {
  reiniciar({ activo: true });
  const r = await mandar(CLIENTE);
  assert.equal(r.enviado, false);
  assert.equal(r.motivo, "ese número no es del equipo");
  assert.equal(salidas.length, 0);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].estado, "BLOQUEADO");
});

await prueba("el número se compara solo con dígitos (con + o espacios sigue siendo del equipo; uno parecido no)", async () => {
  reiniciar({ activo: true });
  assert.equal((await mandar(`+57 300 111 2233`)).enviado, true);
  assert.equal((await mandar("57300111223")).enviado, false);
  assert.equal((await mandar("")).enviado, false);
  assert.equal((await mandar(undefined)).enviado, false);
});

await prueba("sin lista de equipo configurada no sale nada a nadie", async () => {
  reiniciar({ activo: true });
  ajustes.delete(`agente-v3:avisos:${WS}`);
  assert.equal((await mandar(ALEXANDER)).enviado, false);
  assert.equal(salidas.length, 0);
});

await prueba("texto vacío o demasiado largo se rechaza", async () => {
  reiniciar({ activo: true });
  assert.equal((await mandar(ALEXANDER, "   ")).enviado, false);
  assert.equal((await mandar(ALEXANDER, "x".repeat(reglas.MAX_TEXTO_ENVIO + 1))).enviado, false);
  assert.equal(salidas.length, 0);
});

// ── Línea Admin ─────────────────────────────────────────────────────────────────────────────────
await prueba("siempre sale por la línea interna (Admin) y nunca por otra", async () => {
  reiniciar({ activo: true });
  await mandar(ALEXANDER);
  await mandar(ASESORA_1);
  assert.equal(salidas.length, 2);
  assert.ok(salidas.every((s) => s.instanceName === LINEA_ADMIN.instancia));
  assert.deepEqual(salidas.map((s) => s.phoneNumber), [ALEXANDER, ASESORA_1]);
});

await prueba("sin línea interna no sale nada (no se inventa otra línea)", async () => {
  reiniciar({ activo: true });
  hayLinea = false;
  const r = await mandar(ALEXANDER);
  assert.equal(r.enviado, false);
  assert.match(r.motivo, /línea interna/);
  assert.equal(salidas.length, 0);
});

// ── Uno por persona y por día ───────────────────────────────────────────────────────────────────
await prueba("el mensaje de Alexander sale UNA sola vez en el día", async () => {
  reiniciar({ activo: true });
  const primero = await mandar(ALEXANDER, "Números de ayer");
  const segundo = await mandar(ALEXANDER, "Otra vez los números");
  assert.equal(primero.enviado, true);
  assert.equal(primero.tipo, "ALEXANDER");
  assert.equal(segundo.enviado, false);
  assert.equal(segundo.estado, "YA_ENVIADO");
  assert.equal(segundo.motivo, "ya se le mandó hoy");
  assert.equal(salidas.length, 1);
  assert.equal(salidas[0].text, "Números de ayer");
});

await prueba("cada asesora recibe UN solo mensaje: el segundo de la misma asesora no sale, el de otra sí", async () => {
  reiniciar({ activo: true });
  const a = await mandar(ASESORA_1, "Lista de Ingrid");
  const b = await mandar(ASESORA_1, "Otra lista de Ingrid");
  const c = await mandar(ASESORA_2, "Lista de María");
  assert.deepEqual([a.enviado, b.enviado, c.enviado], [true, false, true]);
  assert.equal(a.tipo, "ASESORA");
  assert.deepEqual(salidas.map((s) => s.text), ["Lista de Ingrid", "Lista de María"]);
});

await prueba("al día siguiente la misma persona sí puede recibir otro", async () => {
  reiniciar({ activo: true });
  await mandar(ASESORA_1, "lunes", new Date("2026-10-26T12:30:00Z"));
  const martes = await mandar(ASESORA_1, "martes", new Date("2026-10-27T12:30:00Z"));
  assert.equal(martes.enviado, true);
  assert.equal(salidas.length, 2);
});

await prueba("si la línea falla queda FALLO, no ocupa el día y el reintento sale sin duplicar", async () => {
  reiniciar({ activo: true });
  fallaElEnvio = true;
  const falla = await mandar(ALEXANDER);
  assert.equal(falla.estado, "FALLO");
  assert.match(falla.motivo, /línea caída/);
  assert.equal(salidas.length, 0);
  fallaElEnvio = false;
  const reintento = await mandar(ALEXANDER);
  assert.equal(reintento.enviado, true);
  const otro = await mandar(ALEXANDER);
  assert.equal(otro.estado, "YA_ENVIADO");
  assert.equal(salidas.length, 1);
});

await prueba("un envío 'en camino' viejo (se cayó el proceso) se puede reintentar; uno reciente no", async () => {
  reiniciar({ activo: true });
  const ahora = new Date("2026-10-26T12:30:00Z");
  await prisma.agenteDeAreaEnvio.create({
    data: { workspaceId: WS, area: "ventas", fecha: "2026-10-26", numero: ALEXANDER, tipo: "ALEXANDER", texto: "x", estado: "ENVIANDO", claveDelDia: `${WS}:ventas:2026-10-26:${ALEXANDER}` },
  });
  envios[0].updatedAt = new Date(ahora.getTime() - 60_000);
  assert.equal((await mandar(ALEXANDER, "hola", ahora)).estado, "YA_ENVIADO");
  envios[0].updatedAt = new Date(ahora.getTime() - 20 * 60_000);
  assert.equal((await mandar(ALEXANDER, "hola", ahora)).enviado, true);
  assert.equal(salidas.length, 1);
});

// ── El resumen del día ──────────────────────────────────────────────────────────────────────────
await prueba("guardar el resumen dos veces el mismo día deja UNO solo (el segundo reemplaza)", async () => {
  reiniciar({ activo: false });
  const base = { fecha: "2026-10-26", subagentes: { cerrador: { listas: 3 } }, texto_alexander: "uno" };
  const primero = await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "ventas", args: base, hoy: "2026-10-26" });
  const segundo = await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "ventas", args: { ...base, texto_alexander: "dos", salio_tarde: true, nota_tarde: "aizen1 prendió a las 07:42" }, hoy: "2026-10-26" });
  assert.equal(primero.reemplazo, false);
  assert.equal(segundo.reemplazo, true);
  assert.equal(dias.length, 1);
  assert.equal(dias[0].textoAlexander, "dos");
  assert.equal(dias[0].salioTarde, true);
});

await prueba("el resumen queda como PRUEBA si el interruptor está apagado, y como real si está prendido", async () => {
  reiniciar({ activo: false });
  assert.equal((await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "ventas", args: {}, hoy: "2026-10-26" })).esPrueba, true);
  reiniciar({ activo: true });
  assert.equal((await resumenes.guardarResumenDelDia({ workspaceId: WS, area: "ventas", args: {}, hoy: "2026-10-26" })).esPrueba, false);
});

await prueba("el resumen revisa lo que manda el agente", async () => {
  assert.throws(() => reglas.leerResumenDelAgente({ fecha: "2026-02-31" }, "2026-10-26"), /AAAA-MM-DD/);
  assert.throws(() => reglas.leerResumenDelAgente({ subagentes: [] }, "2026-10-26"), /objeto/);
  assert.throws(() => reglas.leerResumenDelAgente({ sugeridos: "x" }, "2026-10-26"), /lista/);
  const r = reglas.leerResumenDelAgente(
    { sugeridos: [{ asesora: "Ingrid", conversacion_id: "c1", telefono: "+57 312 000 0000" }, { asesora: "sin id" }] },
    "2026-10-26",
  );
  assert.equal(r.fecha, "2026-10-26");
  assert.equal(r.sugeridos.length, 1);
  assert.equal(r.sugeridos[0].telefono, "573120000000");
});

// ── Reglas puras ────────────────────────────────────────────────────────────────────────────────
await prueba("fechas de Colombia: antes de las 5 a. m. UTC todavía es el día anterior", async () => {
  assert.equal(reglas.fechaBogota(new Date("2026-10-26T04:59:00Z")), "2026-10-25");
  assert.equal(reglas.fechaBogota(new Date("2026-10-26T05:00:00Z")), "2026-10-26");
  assert.equal(reglas.diaAnterior("2026-03-01"), "2026-02-28");
  assert.equal(reglas.inicioDelDiaBogota("2026-10-26").toISOString(), "2026-10-26T05:00:00.000Z");
});

await prueba("quién es Alexander: el destino de avisos sin 'soloDe'", async () => {
  const destinos = [{ numero: ALEXANDER, soloDe: null }, { numero: ASESORA_1, soloDe: "u1" }];
  assert.equal(reglas.tipoDeDestino(ALEXANDER, destinos), "ALEXANDER");
  assert.equal(reglas.tipoDeDestino(ASESORA_1, destinos), "ASESORA");
});

await prueba("medir sugeridos: le escribieron / respondió / compró (el bot no cuenta)", async () => {
  const t = (m) => new Date(`2026-10-26T${m}:00Z`);
  const sinHumano = reglas.medirSugerido([{ direction: "OUTBOUND", humano: false, en: t("14:00") }, { direction: "INBOUND", humano: false, en: t("14:05") }], false);
  assert.deepEqual(sinHumano, { leEscribieron: false, respondio: false, compro: false });
  const respondio = reglas.medirSugerido([{ direction: "OUTBOUND", humano: true, en: t("14:00") }, { direction: "INBOUND", humano: false, en: t("14:05") }], true);
  assert.deepEqual(respondio, { leEscribieron: true, respondio: true, compro: true });
  const antes = reglas.medirSugerido([{ direction: "INBOUND", humano: false, en: t("13:00") }, { direction: "OUTBOUND", humano: true, en: t("14:00") }], false);
  assert.equal(antes.respondio, false, "lo que dijo el cliente ANTES de que le escribieran no cuenta como respuesta");
});

await prueba("tiempos de respuesta: solo cuenta lo que contestó una persona", async () => {
  const t = (m) => new Date(`2026-10-26T${m}:00Z`);
  const tiempos = reglas.tiemposDeRespuesta([
    { direction: "INBOUND", humano: false, en: t("14:00") },
    { direction: "OUTBOUND", humano: false, en: t("14:01") },
    { direction: "OUTBOUND", humano: true, en: t("14:10") },
    { direction: "INBOUND", humano: false, en: t("15:00") },
    { direction: "INBOUND", humano: false, en: t("15:02") },
    { direction: "OUTBOUND", humano: true, en: t("15:20") },
  ]);
  assert.deepEqual(tiempos, [10, 20]);
  assert.equal(reglas.mediana([10, 20]), 15);
  assert.equal(reglas.mediana([]), null);
});

// ── Está conectado al MCP, sin tocar lo protegido ───────────────────────────────────────────────
await prueba("las 4 herramientas están en el MCP y solo se usan piezas del Supervisor sin cambiarlas", async () => {
  const herramientas = fs.readFileSync(`${RAIZ}/src/lib/mcp/herramientas.ts`, "utf8");
  assert.ok(herramientas.includes("...HERRAMIENTAS_MCP_AGENTES_DE_AREA"));
  assert.ok(herramientas.includes("esHerramientaDeAgentesDeArea(nombre)"));
  const mcp = fs.readFileSync(`${RAIZ}/src/lib/mcp/agentes-de-area.ts`, "utf8");
  for (const nombre of ["numeros_de_ventas", "guardar_resumen_del_dia", "mandar_whatsapp_al_equipo", "agente_de_ventas"]) {
    assert.ok(mcp.includes(`name: "${nombre}"`), nombre);
  }
  const envio = fs.readFileSync(`${RAIZ}/src/features/agentes-de-area/servicios/envios.ts`, "utf8");
  assert.ok(envio.includes("lineaInterna"));
  // Ninguna ruta del agente toca chats, el bot, el libro V3 ni Meta Ads.
  for (const archivo of [envio, mcp]) {
    assert.ok(!/agente-v3\/servicios|meta-ads|ads-generator|prisma\.(message|conversation)\.(create|update|delete)/.test(archivo.replace(/agente-v3:avisos/g, "")));
  }
});

console.log(`\n${pruebas} pruebas pasaron`);

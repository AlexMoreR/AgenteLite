// Pruebas del % DE RESPUESTA A LOS SEGUIMIENTOS (herramienta MCP `respuesta_a_seguimientos`, solo lectura):
// la cuenta (dominio), la lectura con una base de mentira (servicio) y la herramienta. Sin base ni red.
// Correr: npm run test:respuesta-a-seguimientos
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const dom = cargar("src/features/seguimientos/dominio/respuesta-a-seguimientos.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// 3-nov-2026, 10:00 de Bogotá (15:00 UTC): dentro de la base.
const T0 = new Date("2026-11-03T15:00:00Z");
const en = (min) => new Date(T0.getTime() + min * 60_000);
const HORA = 60;
const BASE = { desde: "2026-11-02", hasta: "2026-11-06" };
const AHORA = new Date("2026-11-20T15:00:00Z");

/** Un chat donde el cliente ya respondió la bienvenida antes del seguimiento (minuto 0). */
function chatQueRespondio(extra = []) {
  return [
    { direction: "OUTBOUND", type: "TEXT", createdAt: en(-120) }, // bienvenida
    { direction: "INBOUND", type: "TEXT", createdAt: en(-110) }, // respondió
    ...extra,
  ];
}
const seguimiento = (conversationId, min, extra = {}) => ({
  conversationId,
  contactId: `contacto-${conversationId}`,
  en: en(min),
  origen: "agente-v3-seguimiento",
  marcaDeIA: null,
  ...extra,
});

function medir({ seguimientos, follows = [], chats, ahora = AHORA, rango = BASE }) {
  return dom.medirRango({ rango, seguimientos, follows, mensajesPorChat: new Map(Object.entries(chats)), ahora });
}

/* ---------------------------------------------------------------------------------------------- */

await prueba("cuenta la respuesta en 24 h y la separa en texto de la IA y texto fijo", () => {
  const r = medir({
    seguimientos: [
      seguimiento("a", 0, { origen: "agente-v3-seguimiento-ia" }),
      seguimiento("b", 0, { origen: "follow", marcaDeIA: true }),
      seguimiento("c", 0),
      seguimiento("d", 0, { origen: "follow", marcaDeIA: false }),
    ],
    follows: [
      { contactId: "contacto-b", name: "Etapa Nuevo · 1", followRuleId: null, executedAt: en(1) },
      { contactId: "contacto-d", name: null, followRuleId: "regla-1", executedAt: en(-2) },
    ],
    chats: {
      a: chatQueRespondio([{ direction: "INBOUND", type: "AUDIO", createdAt: en(30) }]),
      b: chatQueRespondio(),
      c: chatQueRespondio([{ direction: "INBOUND", type: "IMAGE", createdAt: en(23 * HORA) }]),
      d: chatQueRespondio([{ direction: "INBOUND", type: "TEXT", createdAt: en(25 * HORA) }]), // tarde
    },
  });
  assert.deepEqual(
    { ia: [r.texto_de_ia.envios, r.texto_de_ia.respondieron], fijo: [r.texto_fijo.envios, r.texto_fijo.respondieron] },
    { ia: [2, 1], fijo: [2, 1] },
  );
  assert.equal(r.total.envios, 4);
  assert.equal(r.total.respondieron, 2);
  // Menos de 30 envíos: no se da el %.
  assert.match(r.total.porcentaje, /faltan datos \(menos de 30 envíos\)/);
});

await prueba("la respuesta después del siguiente seguimiento no cuenta para el anterior", () => {
  const r = medir({
    seguimientos: [seguimiento("a", 0), seguimiento("a", 2 * HORA)],
    chats: { a: chatQueRespondio([{ direction: "INBOUND", type: "TEXT", createdAt: en(3 * HORA) }]) },
  });
  // El primero no tuvo respuesta antes del segundo; el segundo sí.
  assert.equal(r.total.envios, 2);
  assert.equal(r.total.respondieron, 1);
});

await prueba("no cuenta a quien no había respondido la bienvenida, ni los manuales, ni los follows sin unir", () => {
  const r = medir({
    seguimientos: [
      seguimiento("sinBienvenida", 0),
      seguimiento("manual", 0, { origen: "follow" }),
      seguimiento("campana", 0, { origen: "follow" }),
      seguimiento("huerfano", 0, { origen: "follow" }),
    ],
    follows: [
      { contactId: "contacto-manual", name: "Recordar llamar", followRuleId: null, executedAt: en(0) },
      { contactId: "contacto-campana", name: "Campaña: Black Friday", followRuleId: null, executedAt: en(0) },
      // El del huérfano se ejecutó 30 min antes: no es el suyo.
      { contactId: "contacto-huerfano", name: "Etapa Nuevo · 1", followRuleId: null, executedAt: en(-30) },
    ],
    chats: {
      sinBienvenida: [
        { direction: "INBOUND", type: "TEXT", createdAt: en(-200) }, // el texto del anuncio
        { direction: "OUTBOUND", type: "TEXT", createdAt: en(-120) },
        { direction: "INBOUND", type: "TEXT", createdAt: en(10) }, // respondió después del seguimiento
      ],
      manual: chatQueRespondio(),
      campana: chatQueRespondio(),
      huerfano: chatQueRespondio(),
    },
  });
  assert.equal(r.total.envios, 0);
  assert.deepEqual(r.no_se_cuentan, {
    no_habia_respondido_la_bienvenida: 1,
    no_automaticos: 2,
    sin_su_follow: 1,
    todavia_sin_24_horas: 0,
  });
});

await prueba("un seguimiento sin respuesta cuyas 24 h no han pasado queda pendiente; fuera del rango no cuenta", () => {
  const ahora = en(5 * HORA);
  const r = medir({
    seguimientos: [seguimiento("a", 0), seguimiento("b", 0), seguimiento("fuera", -3 * 24 * HORA)],
    chats: {
      a: chatQueRespondio(),
      b: chatQueRespondio([{ direction: "INBOUND", type: "TEXT", createdAt: en(HORA) }]),
      fuera: chatQueRespondio(),
    },
    ahora,
    rango: { desde: "2026-11-03", hasta: "2026-11-03" },
  });
  assert.equal(r.no_se_cuentan.todavia_sin_24_horas, 1);
  assert.equal(r.total.envios, 1);
  assert.equal(r.total.respondieron, 1);
});

await prueba("con 30 envíos o más da el % con un decimal, y la diferencia en puntos", () => {
  const muchos = (prefijo, n, responden, extra = {}) => {
    const seguimientos = [];
    const chats = {};
    for (let i = 0; i < n; i += 1) {
      const id = `${prefijo}${i}`;
      seguimientos.push(seguimiento(id, 0, extra));
      chats[id] = chatQueRespondio(i < responden ? [{ direction: "INBOUND", type: "TEXT", createdAt: en(10) }] : []);
    }
    return { seguimientos, chats };
  };
  const antes = medir(muchos("x", 30, 6));
  assert.equal(antes.total.porcentaje, 20);
  assert.equal(antes.texto_fijo.porcentaje, 20);
  assert.match(antes.texto_de_ia.porcentaje, /faltan datos/);
  const despues = medir(muchos("y", 40, 13, { origen: "agente-v3-seguimiento-ia" }));
  assert.equal(despues.total.porcentaje, 32.5);
  assert.equal(dom.diferenciaEnPuntos(antes.total, despues.total), 12.5);
  assert.match(dom.diferenciaEnPuntos(antes.texto_de_ia, despues.texto_de_ia), /faltan datos/);
  const frase = dom.resumenParaDecir(antes, despues);
  assert.match(frase, /contestó el 20 % \(6 de 30\)/);
  assert.match(frase, /\+12\.5 puntos/);
  assert.match(frase, /no prueba la causa/);
});

await prueba("fechas: hora de Bogotá, rangos válidos y tope de días", () => {
  assert.equal(dom.diaDeBogota(new Date("2026-11-07T04:59:00Z")), "2026-11-06");
  assert.equal(dom.diaDeBogota(new Date("2026-11-07T05:00:00Z")), "2026-11-07");
  const { inicio, fin } = dom.limitesDelRango(BASE);
  assert.equal(new Date(inicio).toISOString(), "2026-11-02T05:00:00.000Z");
  assert.equal(new Date(fin).toISOString(), "2026-11-07T04:59:59.999Z");
  assert.deepEqual(dom.erroresDelRango("base", BASE), []);
  assert.match(dom.erroresDelRango("base", { desde: "2026-11-31", hasta: "2026-12-01" })[0], /AAAA-MM-DD/);
  assert.match(dom.erroresDelRango("base", { desde: "2026-11-06", hasta: "2026-11-02" })[0], /va después/);
  assert.match(dom.erroresDelRango("base", { desde: "2026-01-01", hasta: "2026-12-31" })[0], /máximo 62 días/);
});

/* ----------------------------------------------------------------------------------------------
   El servicio con una base de mentira: solo lee, del negocio de la clave
---------------------------------------------------------------------------------------------- */

const consultas = [];
const prismaFalso = {
  message: {
    findMany: async (args) => {
      consultas.push({ tabla: "message", args });
      if (args.where.OR) {
        return [
          { conversationId: "c1", contactId: "k1", createdAt: en(0), rawPayload: { source: "agente-v3-seguimiento-ia" } },
          { conversationId: "c2", contactId: "k2", createdAt: en(0), rawPayload: { source: "follow", seguimientoQueEscucha: { deIA: true } } },
        ];
      }
      return [
        { conversationId: "c1", direction: "OUTBOUND", type: "TEXT", createdAt: en(-120) },
        { conversationId: "c1", direction: "INBOUND", type: "TEXT", createdAt: en(-100) },
        { conversationId: "c1", direction: "INBOUND", type: "TEXT", createdAt: en(20) },
        { conversationId: "c2", direction: "OUTBOUND", type: "TEXT", createdAt: en(-120) },
        { conversationId: "c2", direction: "INBOUND", type: "TEXT", createdAt: en(-100) },
      ];
    },
  },
  follow: {
    findMany: async (args) => {
      consultas.push({ tabla: "follow", args });
      return [{ contactId: "k2", name: "Sin responder · 1", followRuleId: null, executedAt: en(0) }];
    },
  },
};
const servicio = cargar("src/features/seguimientos/services/respuesta-a-seguimientos.ts", { "@/lib/prisma": { prisma: prismaFalso } });

await prueba("servicio: lee solo los seguimientos salientes del negocio y no escribe nada", async () => {
  consultas.length = 0;
  const { medicion, cortado } = await servicio.medirRespuestaEnElRango("ws-1", BASE, AHORA);
  assert.equal(cortado, false);
  assert.equal(medicion.texto_de_ia.envios, 2);
  assert.equal(medicion.texto_de_ia.respondieron, 1);
  const seguimientos = consultas.find((c) => c.tabla === "message" && c.args.where.OR);
  assert.equal(seguimientos.args.where.workspaceId, "ws-1");
  assert.equal(seguimientos.args.where.direction, "OUTBOUND");
  assert.deepEqual(
    seguimientos.args.where.OR.map((o) => o.rawPayload.equals),
    ["follow", "agente-v3-seguimiento", "agente-v3-seguimiento-ia"],
  );
  const mensajes = consultas.find((c) => c.tabla === "message" && !c.args.where.OR);
  assert.equal(mensajes.args.where.workspaceId, "ws-1");
  assert.deepEqual(mensajes.args.where.conversationId.in.sort(), ["c1", "c2"]);
  // Los mensajes se leen sin contenido.
  assert.deepEqual(Object.keys(mensajes.args.select).sort(), ["conversationId", "createdAt", "direction", "type"]);
  const follows = consultas.find((c) => c.tabla === "follow");
  assert.equal(follows.args.where.workspaceId, "ws-1");
  assert.equal(follows.args.where.status, "EXECUTED");
  assert.ok(consultas.every((c) => ["message", "follow"].includes(c.tabla)));
  const codigo = fs.readFileSync(new URL("../src/features/seguimientos/services/respuesta-a-seguimientos.ts", import.meta.url), "utf8");
  assert.doesNotMatch(codigo, /\.(create|update|upsert|delete|createMany|updateMany|deleteMany)\(|\$executeRaw|\$queryRaw/);
});

/* ----------------------------------------------------------------------------------------------
   La herramienta del MCP
---------------------------------------------------------------------------------------------- */

const permiso = { si: true };
const pedidos = [];
const mcp = cargar("src/lib/mcp/respuesta-a-seguimientos.ts", {
  "@/lib/mcp/supervisor": { puedeVerElSupervisor: async () => permiso.si },
  "@/features/seguimientos/services/respuesta-a-seguimientos": {
    SEGUIMIENTOS_MAXIMOS_POR_RANGO: 20_000,
    medirRespuestaEnElRango: async (workspaceId, rango) => {
      pedidos.push({ workspaceId, rango });
      const grupo = { envios: 0, respondieron: 0, porcentaje: "faltan datos (menos de 30 envíos)" };
      return {
        medicion: { desde: rango.desde, hasta: rango.hasta, total: grupo, texto_de_ia: grupo, texto_fijo: grupo, no_se_cuentan: {} },
        cortado: false,
      };
    },
  },
});

await prueba("MCP: es de solo lectura, por defecto la base es del 2 al 6 de nov y el negocio sale de la clave", async () => {
  const [herramienta] = mcp.HERRAMIENTAS_MCP_RESPUESTA_A_SEGUIMIENTOS;
  assert.equal(herramienta.name, "respuesta_a_seguimientos");
  assert.deepEqual(herramienta.annotations, { readOnlyHint: true, destructiveHint: false, openWorldHint: false });
  assert.ok(!("workspaceId" in herramienta.inputSchema.properties));
  assert.ok(mcp.esHerramientaDeRespuestaASeguimientos("respuesta_a_seguimientos"));

  pedidos.length = 0;
  const r = await mcp.ejecutarHerramientaMcpRespuestaASeguimientos("respuesta_a_seguimientos", { workspaceId: "otro" }, { workspaceId: "ws-1", userId: "u-1" });
  assert.deepEqual(pedidos.map((p) => p.workspaceId), ["ws-1", "ws-1"]);
  assert.deepEqual(pedidos[0].rango, { desde: "2026-11-02", hasta: "2026-11-06" });
  assert.equal(pedidos[1].rango.desde, "2026-11-07");
  assert.match(r.diferencia_en_puntos.total, /faltan datos/);
  assert.ok(r.advertencias.some((a) => /no prueba la causa/i.test(a)));
  assert.match(r.resumen_para_decir, /faltan datos/);

  const otros = mcp.rangosPedidos({ base_desde: "2026-10-01", base_hasta: "2026-10-05", despues_desde: "2026-11-10", despues_hasta: "2026-11-14" }, AHORA);
  assert.deepEqual(otros, { base: { desde: "2026-10-01", hasta: "2026-10-05" }, despues: { desde: "2026-11-10", hasta: "2026-11-14" } });
  assert.throws(() => mcp.rangosPedidos({ base_desde: "ayer" }, AHORA), /AAAA-MM-DD/);
  // Sin "hasta": hoy en Bogotá; si hoy todavía no llega al "desde", el mismo día (no falla).
  assert.deepEqual(mcp.rangosPedidos({}, AHORA).despues, { desde: "2026-11-07", hasta: "2026-11-20" });
  assert.deepEqual(mcp.rangosPedidos({}, new Date("2026-11-07T03:00:00Z")).despues, { desde: "2026-11-07", hasta: "2026-11-07" });
});

await prueba("MCP: sin permiso de Supervisor no lee nada", async () => {
  permiso.si = false;
  pedidos.length = 0;
  await assert.rejects(
    mcp.ejecutarHerramientaMcpRespuestaASeguimientos("respuesta_a_seguimientos", {}, { workspaceId: "ws-1", userId: "u-2" }),
    /no tiene permiso/,
  );
  assert.equal(pedidos.length, 0);
  permiso.si = true;
});

await prueba("MCP: la herramienta está registrada en herramientas.ts", () => {
  const codigo = fs.readFileSync(new URL("../src/lib/mcp/herramientas.ts", import.meta.url), "utf8");
  assert.match(codigo, /\.\.\.HERRAMIENTAS_MCP_RESPUESTA_A_SEGUIMIENTOS,/);
  assert.match(codigo, /if \(esHerramientaDeRespuestaASeguimientos\(nombre\)\) \{\s*return ejecutarHerramientaMcpRespuestaASeguimientos\(nombre, args, contexto\);/);
});

console.log(`\n${pruebas} pruebas OK`);

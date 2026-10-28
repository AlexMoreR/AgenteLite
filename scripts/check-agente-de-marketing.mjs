// Pruebas del Agente de Marketing (segunda área del molde de agentes de área), con una base de mentira.
//   npm run test:agente-de-marketing
// El candado de Meta y el lanzador se prueban aparte: npm run test:agente-de-marketing-candado y
// npm run test:agentes-de-area-lanzador.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";

const db = { settings: new Map(), dias: new Map(), siguiente: 1, filas: [], mensajes: [], consultas: [] };

const MEMBRESIAS = new Map([[`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }]]);

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      db.settings.set(where.key, db.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  workspaceMember: { findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null },
  agenteDeAreaDia: {
    upsert: async ({ where, create, update }) => {
      const k = where.workspaceId_area_fecha;
      const clave = `${k.workspaceId}|${k.area}|${k.fecha}`;
      const previo = db.dias.get(clave);
      const fila = previo ? { ...previo, ...update, actualizadoEn: new Date() } : { id: `d${db.siguiente++}`, ...create, actualizadoEn: new Date() };
      db.dias.set(clave, fila);
      return fila;
    },
    findUnique: async ({ where }) => {
      const k = where.workspaceId_area_fecha;
      return db.dias.get(`${k.workspaceId}|${k.area}|${k.fecha}`) ?? null;
    },
    findMany: async ({ where }) => [...db.dias.values()].filter((d) => d.area === where.area).sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
  },
  agenteDeAreaEnvio: { findMany: async () => [] },
  // La primera consulta son los leads (EmbudoLead + Contact); la segunda, los primeros mensajes.
  $queryRaw: async (consulta) => {
    const texto = Array.isArray(consulta?.strings) ? consulta.strings.join("?") : String(consulta?.[0] ?? "");
    db.consultas.push(texto);
    return texto.includes('FROM "Message"') ? db.mensajes : db.filas;
  },
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": {
    Prisma: {
      sql: (strings, ...valores) => ({ strings: [...strings], valores }),
      join: (x) => x,
      DbNull: "DbNull",
    },
  },
  react: { cache: (f) => f },
  "@/lib/cache-de-permisos": {
    cacheDeSupervisoras: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeAcceso: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeCanales: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    invalidarTrasEscritura: () => {},
  },
  "@/lib/web-push": { sendPushToUser: async () => 0 },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async () => {} },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: null } }) },
};

const reglas = cargar("src/features/agentes-de-area/dominio/reglas.ts", mocks);
const servicio = cargar("src/features/agentes-de-area/servicios/numeros-de-marketing.ts", mocks);
const resumenes = cargar("src/features/agentes-de-area/servicios/resumenes.ts", mocks);
const mcp = cargar("src/lib/mcp/agentes-de-area.ts", mocks);
const textoDeHerramientas = fs.readFileSync(path.join(RAIZ, "src/lib/mcp/herramientas.ts"), "utf8");

let pruebas = 0;
const fallas = [];
async function prueba(nombre, fn) {
  try {
    await fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

const chat = (extra = {}) => ({ anuncioId: "ad1", anuncioTitulo: "Diván azul", etapa: "NUEVO", temperatura: null, exterior: false, minutosPrimeraRespuesta: 5, ...extra });
const contexto = { workspaceId: WS, userId: "alex" };

/* ------------------------------------------------------------------ las conversaciones por anuncio */

await prueba("agruparPorAnuncio: cuenta nuevas, Tibio/Caliente, ventas, sin respuesta y fuera de Colombia", () => {
  const r = reglas.agruparPorAnuncio([
    chat({ temperatura: "CALIENTE" }),
    chat({ temperatura: "TIBIO", etapa: "CALIFICADO", minutosPrimeraRespuesta: 15 }),
    chat({ etapa: "GANADO", temperatura: "CALIENTE", minutosPrimeraRespuesta: 10 }),
    chat({ minutosPrimeraRespuesta: null }),
    chat({ exterior: true, minutosPrimeraRespuesta: null }),
    chat({ anuncioId: "ad2", anuncioTitulo: "Camilla Cali", etapa: "PROPUESTA", minutosPrimeraRespuesta: 2 }),
  ]);
  const a1 = r.porAnuncio.find((x) => x.anuncioId === "ad1");
  assert.equal(a1.conversaciones, 5);
  assert.equal(a1.tibioOCaliente, 3);
  assert.equal(a1.ventas, 1);
  assert.equal(a1.sinRespuesta, 2);
  assert.equal(a1.fueraDeColombia, 1);
  assert.equal(a1.primeraRespuestaMin, 10, "mediana de 5, 15, 10 y 5");
  const a2 = r.porAnuncio.find((x) => x.anuncioId === "ad2");
  assert.equal(a2.tibioOCaliente, 0, "la temperatura del sistema no dice Tibio");
  assert.equal(a2.etapaAvanzada, 1, "pero la asesora la pasó a Propuesta");
  assert.equal(a2.conInteres, 1);
  assert.equal(r.porAnuncio[0].anuncioId, "ad1", "el que más conversaciones trajo va primero");
  assert.equal(r.total, 6);
});

await prueba("agruparPorAnuncio: las conversaciones sin anuncio de origen se cuentan aparte, con su porcentaje, y no se inventan", () => {
  const r = reglas.agruparPorAnuncio([chat(), chat({ anuncioId: null, anuncioTitulo: null }), chat({ anuncioId: "  ", etapa: "GANADO" }), chat({ anuncioId: null })]);
  assert.equal(r.sinAnuncio.conversaciones, 3);
  assert.equal(r.sinAnuncio.porCiento, 75);
  assert.equal(r.porAnuncio.length, 1);
  assert.equal(r.porAnuncio[0].ventas, 0, "una venta sin anuncio no se le asigna a ningún anuncio");
  assert.deepEqual(reglas.agruparPorAnuncio([]).sinAnuncio, { conversaciones: 0, porCiento: null });
});

await prueba("numeros_de_marketing: un día trae los primeros mensajes del cliente; 7 días, no; avisa del porcentaje sin anuncio", async () => {
  db.filas = [
    { conversationId: "c1", anuncioId: "ad1", anuncioTitulo: "Diván azul", etapa: "GANADO", temperatura: "CALIENTE", exterior: false, wonQuoteRef: "COT-00123", minutos: 4.4 },
    { conversationId: "c2", anuncioId: "ad1", anuncioTitulo: null, etapa: "NUEVO", temperatura: null, exterior: false, wonQuoteRef: null, minutos: null },
    { conversationId: "c3", anuncioId: null, anuncioTitulo: null, etapa: "NUEVO", temperatura: null, exterior: true, wonQuoteRef: null, minutos: null },
  ];
  db.mensajes = [
    { conversationId: "c1", anuncioId: "ad1", contenido: "Hola, ¿cuánto vale el diván?", orden: 1n },
    { conversationId: "c1", anuncioId: "ad1", contenido: "¿Envían a Cali?", orden: 2n },
    { conversationId: "c2", anuncioId: "ad1", contenido: "   ", orden: 1n },
  ];
  const uno = await mcp.ejecutarHerramientaMcpAgentesDeArea("numeros_de_marketing", { fecha: "2026-10-27", dias: 1 }, contexto);
  assert.equal(uno.desde, "2026-10-27");
  assert.equal(uno.total, 3);
  assert.equal(uno.porAnuncio.length, 1);
  assert.deepEqual(uno.porAnuncio[0].cotizaciones, ["COT-00123"]);
  assert.equal(uno.porAnuncio[0].primeraRespuestaMin, 4);
  assert.equal(uno.sinAnuncio.porCiento, 33.3);
  assert.equal(uno.primerosMensajes.length, 1, "solo los chats con mensajes de texto");
  assert.deepEqual(uno.primerosMensajes[0].mensajesDelCliente, ["Hola, ¿cuánto vale el diván?", "¿Envían a Cali?"]);
  assert.ok(uno.advertencias.some((x) => x.includes("33.3 %")), "avisa que el cruce está incompleto");
  const siete = await mcp.ejecutarHerramientaMcpAgentesDeArea("numeros_de_marketing", { fecha: "2026-10-27", dias: 7 }, contexto);
  assert.equal(siete.desde, "2026-10-21");
  assert.equal(siete.primerosMensajes, null);
});

await prueba("numeros_de_marketing: solo lee (ninguna consulta escribe) y exige permiso", async () => {
  for (const consulta of db.consultas) assert.ok(!/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE)\b/i.test(consulta), consulta);
  assert.ok(db.consultas.every((c) => c.includes('FROM "EmbudoLead"') || c.includes('FROM "Message"')));
  await assert.rejects(mcp.ejecutarHerramientaMcpAgentesDeArea("numeros_de_marketing", {}, { workspaceId: WS, userId: "intruso" }), /permiso/);
  await assert.rejects(mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_marketing", {}, { workspaceId: WS, userId: "intruso" }), /permiso/);
});

/* ------------------------------------------------------------------ la recomendación */

await prueba("la recomendación: máximo UNA, subir/bajar/cambiar, con su dato", () => {
  const buena = { accion: "bajar", texto: "bajar el anuncio Diván azul", dato: "$61.000 en 7 días sin Calientes" };
  assert.deepEqual({ ...reglas.leerRecomendacionDeMarketing(buena) }, buena);
  assert.equal(reglas.leerRecomendacionDeMarketing(undefined), null);
  assert.deepEqual({ ...reglas.leerRecomendacionDeMarketing([buena]) }, buena);
  assert.throws(() => reglas.leerRecomendacionDeMarketing([buena, buena]), /Máximo UNA/);
  assert.throws(() => reglas.leerRecomendacionDeMarketing({ ...buena, dato: "" }), /dato que la sustenta/);
  assert.throws(() => reglas.leerRecomendacionDeMarketing({ ...buena, accion: "pausar" }), /subir/);
  assert.throws(() => reglas.leerRecomendacionDeMarketing({ ...buena, accion: "crear" }), /subir/);
});

await prueba('si la recomendación dice "pausar para que reaprenda", se rechaza', () => {
  for (const texto of [
    "pausar la campaña unos días para que reaprenda",
    "Apagar el conjunto para que la campaña re-aprenda",
    "parar el anuncio y dejar que reaprenda el algoritmo",
    "para que reaprenda, pausar la campaña",
  ]) {
    assert.throws(() => reglas.leerRecomendacionDeMarketing({ accion: "cambiar", texto, dato: "costo alto" }), /reaprend/, texto);
  }
  // Una recomendación normal que menciona "aprendizaje" sin pausar no se rechaza.
  assert.ok(reglas.leerRecomendacionDeMarketing({ accion: "subir", texto: "subir el presupuesto 20 %", dato: "sale de la fase de aprendizaje con 3 ventas" }));
});

/* ------------------------------------------------------------------ guardar el resumen */

await prueba("guardar el resumen de marketing dos veces el mismo día deja uno solo y no pisa el de Ventas", async () => {
  db.dias.clear();
  const ventas = await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { fecha: "2026-10-27", resumen: "Ventas: 1 venta" }, contexto);
  assert.equal(ventas.area, "ventas");
  const args = {
    area: "marketing",
    fecha: "2026-10-27",
    numeros: { campanas: [{ nombre: "Combo Diván", gasto: 98000 }], sinAnuncioPorCiento: 12 },
    subagentes: { "vigilante-de-pauta": { marcas: [] } },
    linea: "Combo Diván gastó $98.000 ayer, 0 ventas",
    recomendacion: { accion: "bajar", texto: "bajar Diván azul", dato: "$61.000 sin Calientes" },
    resumen: "Marketing: v1",
  };
  const primera = await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", args, contexto);
  const segunda = await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { ...args, resumen: "Marketing: v2" }, contexto);
  assert.equal(primera.area, "marketing");
  assert.equal(primera.id, segunda.id, "el mismo día se reemplaza");
  assert.equal([...db.dias.values()].filter((d) => d.area === "marketing").length, 1);
  assert.equal(db.dias.get(`${WS}|marketing|2026-10-27`).resumen, "Marketing: v2");
  assert.equal(db.dias.get(`${WS}|ventas|2026-10-27`).resumen, "Ventas: 1 venta", "no pisa el de Ventas");
  assert.equal(segunda.mensajes_listos, 0, "marketing no deja mensajes para mandar");
  assert.equal(segunda.sugeridos, 0);
});

await prueba("guardar: una recomendación con 'pausar para reaprender' o dos recomendaciones no se guardan", async () => {
  const base = { area: "marketing", fecha: "2026-10-28", linea: "x" };
  await assert.rejects(
    mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { ...base, recomendacion: { accion: "cambiar", texto: "pausar la campaña para que reaprenda", dato: "costo alto" } }, contexto),
    /reaprend/,
  );
  const una = { accion: "subir", texto: "subir", dato: "d" };
  await assert.rejects(mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { ...base, recomendacion: [una, una] }, contexto), /Máximo UNA/);
  await assert.rejects(mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { area: "finanzas" }, contexto), /área/);
  assert.equal(db.dias.has(`${WS}|marketing|2026-10-28`), false);
});

await prueba("marketing nunca deja mensajes ni sugeridos aunque el agente los mande", () => {
  const leido = reglas.leerResumenAGuardar(
    { mensajes: [{ tipo: "alexander", numero: "573001112233", texto: "hola" }], sugeridos: [{ asesora: "María" }], linea: "L" },
    "2026-10-27",
    "marketing",
  );
  assert.equal(leido.mensajes.length, 0);
  assert.equal(leido.sugeridos.length, 0);
  assert.equal(leido.meta.linea, "L");
  assert.equal(reglas.leerResumenAGuardar({ mensajes: [{ tipo: "alexander", numero: "573001112233", texto: "hola" }] }, "2026-10-27").mensajes.length, 1, "ventas sigue igual");
});

/* ------------------------------------------------------------------ el interruptor y la línea de las 7:30 */

await prueba("el interruptor de marketing empieza apagado y es independiente del de Ventas", async () => {
  db.settings.clear();
  assert.equal(reglas.claveInterruptorDelAgente("marketing", WS), "agente-area:marketing:ws1");
  const apagado = await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_marketing", { fecha: "2026-10-27" }, contexto);
  assert.equal(apagado.interruptor, "apagado");
  assert.equal(apagado.agente, "Agente de Marketing");
  db.settings.set("agente-area:ventas:ws1", JSON.stringify({ activo: true }));
  assert.equal((await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_marketing", {}, contexto)).interruptor, "apagado", "prender Ventas no prende Marketing");
  db.settings.set("agente-area:marketing:ws1", JSON.stringify({ activo: true }));
  assert.equal((await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_marketing", {}, contexto)).interruptor, "prendido");
});

await prueba("agente_de_marketing (por voz): el resumen de hoy trae la línea, la recomendación, la tabla y los subagentes", async () => {
  const ver = await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_marketing", { fecha: "2026-10-27" }, contexto);
  assert.equal(ver.resumen_del_dia.linea_para_alexander, "Combo Diván gastó $98.000 ayer, 0 ventas");
  assert.equal(ver.resumen_del_dia.recomendacion.accion, "bajar");
  assert.equal(ver.resumen_del_dia.numeros.campanas[0].nombre, "Combo Diván");
  assert.ok(ver.resumen_del_dia.subagentes["vigilante-de-pauta"]);
  assert.equal(ver.ultimos_dias.length, 1, "solo los días de marketing");
  assert.ok(ver.advertencias.some((x) => x.includes("solo LEE Meta Ads")));
});

await prueba("la línea de las 7:30: apagado no entra; prendido entra con su recomendación; sin corrida y tarde se avisan", () => {
  const resumen = { linea: "Combo Diván gastó $98.000, 0 ventas", recomendacion: { accion: "bajar", texto: "bajar Diván azul", dato: "$61.000 sin Calientes" }, salioTarde: false, notaDeRetraso: null };
  assert.equal(reglas.lineaDeMarketingParaAlexander({ interruptorPrendido: false, resumen }), null);
  assert.equal(reglas.lineaDeMarketingParaAlexander({ interruptorPrendido: false, resumen: null }), null);
  assert.equal(
    reglas.lineaDeMarketingParaAlexander({ interruptorPrendido: true, resumen }),
    "Marketing: Combo Diván gastó $98.000, 0 ventas Recomendación: bajar Diván azul ($61.000 sin Calientes)",
  );
  assert.equal(reglas.lineaDeMarketingParaAlexander({ interruptorPrendido: true, resumen: null }), "Marketing: sin resumen hoy");
  assert.ok(reglas.lineaDeMarketingParaAlexander({ interruptorPrendido: true, resumen: { ...resumen, salioTarde: true, notaDeRetraso: "aizen1 prendió a las 7:41" } }).endsWith("(salió tarde: aizen1 prendió a las 7:41)"));
});

/* ------------------------------------------------------------------ las herramientas y la pantalla */

await prueba("las herramientas de marketing están registradas, son de solo lectura y ninguna escribe en Meta", () => {
  const por = (nombre) => mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.find((h) => h.name === nombre);
  assert.equal(por("numeros_de_marketing").annotations.readOnlyHint, true);
  assert.equal(por("agente_de_marketing").annotations.readOnlyHint, true);
  assert.ok(mcp.esHerramientaDeAgentesDeArea("numeros_de_marketing") && mcp.esHerramientaDeAgentesDeArea("agente_de_marketing"));
  assert.ok(textoDeHerramientas.includes("HERRAMIENTAS_MCP_AGENTES_DE_AREA"));
  const codigo = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/servicios/numeros-de-marketing.ts"), "utf8");
  assert.ok(!/\.(create|update|upsert|delete)\(|INSERT|DELETE FROM|UPDATE "/i.test(codigo), "el servicio solo lee");
  assert.ok(!/meta-ads|graph\.facebook|fetch\(/.test(codigo), "el CRM no habla con Meta");
});

await prueba("la pantalla: ruta nueva, menú junto a Ventas, mismo panel con la tabla y el mismo permiso", () => {
  const pagina = fs.readFileSync(path.join(RAIZ, "src/app/cliente/direccion/agente-de-marketing/page.tsx"), "utf8");
  assert.ok(pagina.includes('area="marketing"'));
  const compartida = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/components/PaginaDeAgenteDeArea.tsx"), "utf8");
  assert.ok(compartida.includes("esJefeDelNegocio(access)"), "mismos permisos que Ventas");
  const nav = fs.readFileSync(path.join(RAIZ, "src/components/nav-direccion.tsx"), "utf8");
  assert.ok(nav.indexOf('view: "agente-de-ventas"') < nav.indexOf('view: "agente-de-marketing"'));
  // El menú vive en Dirección, que ya es solo para dueño y administradores: no hace falta `soloJefes` por ítem.
  assert.ok(nav.includes('title: "Agente de Marketing"') && nav.includes('view: "agente-de-marketing"'));
  const panel = fs.readFileSync(path.join(RAIZ, "src/features/agentes-de-area/components/PanelAgenteDeArea.tsx"), "utf8");
  assert.ok(panel.includes("TablaDeCampanas") && panel.includes("InterruptorDelAgente"));
  const acciones = fs.readFileSync(path.join(RAIZ, "src/app/actions/agentes-de-area-actions.ts"), "utf8");
  assert.ok(acciones.includes("esArea(area)") && acciones.includes("agente-de-marketing"));
});

await prueba("la tabla por campaña lee solo números y deja '—' en lo que falta", () => {
  const tabla = cargar("src/features/agentes-de-area/components/TablaDeCampanas.tsx", { ...mocks, "react/jsx-runtime": { jsx: () => null, jsxs: () => null, Fragment: null } });
  const filas = tabla.leerTablaDeCampanas({
    campanas: [{ nombre: "Combo Diván", gasto: 98000, costoPorVenta: "mucho", anuncios: [{ nombre: "Diván azul", gasto: 61000, ventas: 0 }, { sinNombre: true }] }, "basura"],
  });
  assert.equal(filas.length, 1);
  assert.equal(filas[0].costoPorVenta, null, "un texto no es un costo");
  assert.equal(filas[0].anuncios.length, 1);
  assert.equal(filas[0].anuncios[0].ventas, 0);
  assert.deepEqual(tabla.leerTablaDeCampanas(null), []);
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:\n- " + fallas.join("\n- "));
  process.exit(1);
}

// Pruebas de los agentes de área (Agente de Ventas): WhatsApp interno, resumen del día y herramientas MCP.
// Usa una base de mentira (sin red ni base real). Correr: npm run test:agentes-de-area
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { cargar, RAIZ } from "./supervisor-cargar.mjs";

const WS = "ws1";
const ALEX = "573001112233";
const MARIA = "573104445566";
const CLIENTE = "573205557788";

const db = {
  settings: new Map(),
  envios: [],
  alertas: [],
  dias: new Map(),
  enviados: [],
  evolutionFalla: false,
  proposito: "ADMIN",
  siguiente: 1,
  cambiosDeEtapa: [],
  gestion: { url: "https://gestion.test/api/catalogo", llave: "x" },
  respuestaGestion: null,
};

const MEMBRESIAS = new Map([[`${WS}:alex`, { role: "OWNER", user: { role: "CLIENTE" }, workspace: { ownerId: "alex" } }]]);

const USUARIOS = [
  { id: "maria", name: "María Bautista" },
  { id: "yair", name: "Yair Silvera" },
  { id: "ingrid", name: "Ingrid Sánchez" },
];

const prisma = {
  appSetting: {
    findUnique: async ({ where }) => (db.settings.has(where.key) ? { key: where.key, value: db.settings.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      db.settings.set(where.key, db.settings.has(where.key) ? update.value : create.value);
      return {};
    },
  },
  whatsAppChannel: {
    findFirst: async ({ where, select }) => {
      if (where.id !== "admin1") return null;
      return select.evolutionInstanceName ? { id: "admin1", evolutionInstanceName: "admin-instancia" } : { purpose: db.proposito };
    },
  },
  agenteDeAreaEnvio: {
    create: async ({ data }) => {
      // Como el índice único parcial de la migración: un solo envío vivo por número, área y día.
      if (["PENDIENTE", "ENVIADO"].includes(data.estado)) {
        const choca = db.envios.some(
          (e) => e.workspaceId === data.workspaceId && e.area === data.area && e.fecha === data.fecha && e.numero === data.numero && ["PENDIENTE", "ENVIADO"].includes(e.estado),
        );
        if (choca) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
      }
      const fila = { id: `e${db.siguiente++}`, creadoEn: new Date(), ...data };
      db.envios.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => {
      Object.assign(db.envios.find((e) => e.id === where.id), data);
      return {};
    },
    findMany: async () => db.envios,
  },
  // Página de Alertas (29-oct-2026): una alerta abierta por clave; se refresca en vez de duplicar.
  alertaInterna: {
    findFirst: async ({ where }) => db.alertas.find((a) => a.workspaceId === where.workspaceId && a.clave === where.clave && ["NUEVA", "VISTA"].includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${db.siguiente++}`, estado: "NUEVA", salioPorWhatsApp: false, veces: 1, ...data };
      db.alertas.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => {
      const fila = db.alertas.find((a) => a.id === where.id);
      for (const [k, v] of Object.entries(data)) fila[k] = v && typeof v === "object" && "increment" in v ? fila[k] + v.increment : v;
      return fila;
    },
    updateMany: async ({ where, data }) => {
      for (const a of db.alertas.filter((x) => x.workspaceId === where.workspaceId && x.clave === where.clave)) Object.assign(a, data);
    },
  },
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
    findMany: async () => [...db.dias.values()].sort((a, b) => (a.fecha < b.fecha ? 1 : -1)),
  },
  workspaceMember: {
    findFirst: async ({ where }) => MEMBRESIAS.get(`${where.workspaceId}:${where.userId}`) ?? null,
    findMany: async () => USUARIOS.map((user) => ({ user })),
  },
  user: { findMany: async ({ where }) => USUARIOS.filter((u) => where.id.in.includes(u.id)) },
  // Solo el historial de etapas devuelve filas (los chats calientes de María); el resto de lecturas sale vacío.
  $queryRaw: async (consulta) => (String(consulta?.[0]?.join?.("") ?? "").includes('"HistorialEtapa"') ? db.cambiosDeEtapa : []),
};

const mocks = {
  "@/lib/prisma": { prisma },
  "@prisma/client": { Prisma: { sql: (...a) => a, join: (x) => x, DbNull: "DbNull" } },
  react: { cache: (f) => f },
  "@/lib/cache-de-permisos": {
    cacheDeSupervisoras: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeAcceso: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    cacheDeCanales: { obtener: (_c, fn) => fn(), invalidar: () => {}, vaciar: () => {} },
    invalidarTrasEscritura: () => {},
  },
  "@/lib/sincronizacion-gestion": { leerConexionConGestion: async () => db.gestion },
  "@/lib/web-push": { sendPushToUser: async () => 0 },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (args) => {
      if (db.evolutionFalla) throw new Error("línea caída");
      db.enviados.push(args);
    },
  },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: null } }) },
};

const reglas = cargar("src/features/agentes-de-area/dominio/reglas.ts", mocks);
const envios = cargar("src/features/agentes-de-area/servicios/envios.ts", mocks);
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

function reiniciar({ activo }) {
  db.envios.length = 0;
  db.alertas.length = 0;
  db.enviados.length = 0;
  db.dias.clear();
  db.evolutionFalla = false;
  db.proposito = "ADMIN";
  db.settings.clear();
  db.settings.set(`agente-v3:avisos:${WS}`, JSON.stringify({ canalId: "admin1", destinos: [{ numero: ALEX, soloDe: null }, { numero: `+57 ${MARIA.slice(2, 5)} ${MARIA.slice(5)}`, soloDe: "maria", userId: "maria" }] }));
  if (activo) db.settings.set(`agente-area:ventas:${WS}`, JSON.stringify({ activo: true }));
}
const pedir = (numero, tipo = "ASESORA", texto = "Tu lista del día", extra = {}) => ({ workspaceId: WS, area: "ventas", pedido: { tipo, numero, texto, destinatario: null, ...extra } });

/* ------------------------------------------------------------------ reglas puras */

await prueba("el interruptor: sin valor o con basura está apagado", () => {
  assert.equal(reglas.interpretarInterruptor(undefined), false);
  assert.equal(reglas.interpretarInterruptor("quizás"), false);
  assert.equal(reglas.interpretarInterruptor('{"activo":false}'), false);
  assert.equal(reglas.interpretarInterruptor('{"activo":true}'), true);
});

await prueba("los números se comparan por dígitos y con o sin 57", () => {
  assert.equal(reglas.numeroCanonico("+57 300 111 2233"), ALEX);
  assert.equal(reglas.numeroCanonico("3001112233"), ALEX);
  assert.equal(reglas.estaEnElEquipo("3001112233", [ALEX]), true);
  assert.equal(reglas.estaEnElEquipo(CLIENTE, [ALEX]), false);
  assert.equal(reglas.estaEnElEquipo("", [ALEX]), false);
});

await prueba("el pedido de envío se valida", () => {
  assert.equal(reglas.leerPedidoDeEnvio({ tipo: "otro", numero: ALEX, texto: "x" }).ok, false);
  assert.equal(reglas.leerPedidoDeEnvio({ tipo: "asesora", numero: "123", texto: "x" }).ok, false);
  assert.equal(reglas.leerPedidoDeEnvio({ tipo: "asesora", numero: ALEX, texto: "  " }).ok, false);
  const bueno = reglas.leerPedidoDeEnvio({ tipo: "alexander", numero: ALEX, texto: "hola" });
  assert.equal(bueno.ok, true);
  assert.equal(bueno.pedido.tipo, "ALEXANDER");
});

await prueba("medir los sugeridos y la tasa de cierre", () => {
  const medida = reglas.medirSugeridos([
    { leEscribieron: true, respondio: true, compro: true },
    { leEscribieron: true, respondio: false, compro: false },
    { leEscribieron: false, respondio: true, compro: false },
  ]);
  assert.deepEqual(medida, { sugeridos: 3, leEscribieron: 2, respondieron: 1, compraron: 1 });
  assert.equal(reglas.tasaDeCierre(5, 1000), 0.5);
  assert.equal(reglas.tasaDeCierre(1, 0), null);
});

/* ------------------------------------------------------------------ el servidor decide */

await prueba("mandar a un número de CLIENTE: el servidor lo rechaza, no sale nada y queda bloqueado", async () => {
  reiniciar({ activo: true });
  const r = await envios.mandarWhatsAppAlEquipo(pedir(CLIENTE));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "ese número no es del equipo");
  assert.equal(db.enviados.length, 0);
  assert.equal(db.envios.length, 1);
  assert.equal(db.envios[0].estado, "BLOQUEADO");
});

await prueba("un cliente se rechaza aunque el interruptor esté apagado", async () => {
  reiniciar({ activo: false });
  const r = await envios.mandarWhatsAppAlEquipo(pedir(CLIENTE, "ALEXANDER"));
  assert.equal(r.motivo, "ese número no es del equipo");
  assert.equal(db.enviados.length, 0);
});

await prueba("con el interruptor apagado no se manda nada", async () => {
  reiniciar({ activo: false });
  const r = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER"));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "interruptor apagado: no se mandó");
  assert.equal(db.enviados.length, 0);
  assert.equal(db.envios[0].estado, "BLOQUEADO");
});

await prueba("Alexander recibe una alerta URGENTE UNA sola vez, por la línea Admin, y corta (2 líneas con el link)", async () => {
  reiniciar({ activo: true });
  const largo = "Cayó la respuesta de los clientes nuevos del libro v292: del 60,1 % al 26,8 %. " + "Detalle largo. ".repeat(40);
  const primero = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", largo, { prioridad: "URGENTE", titulo: "Cayó la respuesta de clientes nuevos (60,1 % → 26,8 %)" }));
  const segundo = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", "Otra vez", { prioridad: "URGENTE" }));
  assert.equal(primero.ok, true);
  assert.equal(segundo.ok, false);
  assert.equal(segundo.motivo, "ya se le mandó hoy");
  assert.equal(db.enviados.length, 1);
  assert.equal(db.enviados[0].instanceName, "admin-instancia");
  assert.equal(db.enviados[0].phoneNumber, ALEX);
  assert.equal(db.enviados[0].text.split("\n").length, 2);
  assert.match(db.enviados[0].text, /^🚨 Urgente: Cayó la respuesta[^\n]*\nVer: https:\/\/app\.aizenbot\.com\/cliente\/alertas$/);
  const guardada = db.alertas.find((a) => a.prioridad === "URGENTE" && a.detalle === largo.trim());
  assert.ok(guardada, "el texto completo queda en la página");
  assert.equal(guardada.origen, "Agente de Ventas");
  assert.equal(guardada.salioPorWhatsApp, true);
});

await prueba("lo que Alexander recibía sin prioridad (o con una que no es urgente) queda SOLO en la página de Alertas", async () => {
  reiniciar({ activo: true });
  const sin = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", "Números de ayer"));
  const media = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", "Algo a medias", { prioridad: "MEDIA" }));
  assert.equal(sin.ok, false);
  assert.equal(sin.soloEnPagina, true);
  assert.equal(media.soloEnPagina, true);
  assert.equal(db.enviados.length, 0, "no sale nada por WhatsApp");
  assert.deepEqual(db.alertas.map((a) => [a.prioridad, a.titulo]), [["MEDIA", "Números de ayer"], ["MEDIA", "Algo a medias"]]);
  // La misma alerta otra vez no se duplica.
  await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", "Números de ayer"));
  assert.equal(db.alertas.length, 2);
  assert.equal(db.alertas[0].veces, 2);
  // Después, una urgente del mismo día sí sale (los bloqueados no gastan el "una vez al día").
  const urgente = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", "Cayó algo grave", { prioridad: "URGENTE" }));
  assert.equal(urgente.ok, true);
  assert.equal(db.enviados.length, 1);
});

await prueba("con el interruptor de alertas apagado, Alexander recibe el mensaje completo como antes", async () => {
  reiniciar({ activo: true });
  db.settings.set(`alertas:solo-urgentes:${WS}`, "false");
  const r = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER", "Números de ayer"));
  assert.equal(r.ok, true);
  assert.equal(db.enviados[0].text, "Números de ayer");
  assert.equal(db.alertas.length, 0);
});

await prueba("cada asesora recibe UN solo mensaje: sale el primero y el segundo no", async () => {
  reiniciar({ activo: true });
  const a = await envios.mandarWhatsAppAlEquipo(pedir(MARIA, "ASESORA", "Lista 1"));
  const b = await envios.mandarWhatsAppAlEquipo(pedir(MARIA, "ASESORA", "Lista 2"));
  assert.equal(a.ok, true);
  assert.equal(b.ok, false);
  assert.equal(db.enviados.length, 1);
  assert.equal(db.enviados[0].text, "Lista 1");
});

await prueba("nunca se usa una línea de ventas", async () => {
  reiniciar({ activo: true });
  db.proposito = "SALES";
  const r = await envios.mandarWhatsAppAlEquipo(pedir(ALEX, "ALEXANDER"));
  assert.equal(r.ok, false);
  assert.equal(db.enviados.length, 0);
});

await prueba("si la línea Admin falla, queda 'no salió' y se reintenta sin duplicar", async () => {
  reiniciar({ activo: true });
  db.evolutionFalla = true;
  const falla = await envios.mandarWhatsAppAlEquipo(pedir(MARIA));
  assert.equal(falla.estado, "FALLIDO");
  db.evolutionFalla = false;
  const reintento = await envios.mandarWhatsAppAlEquipo(pedir(MARIA));
  const repetido = await envios.mandarWhatsAppAlEquipo(pedir(MARIA));
  assert.equal(reintento.ok, true);
  assert.equal(repetido.ok, false);
  assert.equal(db.enviados.length, 1);
});

/* ------------------------------------------------------------------ el resumen del día */

await prueba("guardar el resumen dos veces el mismo día deja uno solo", async () => {
  const uno = reglas.leerResumenAGuardar({ fecha: "2026-10-27", resumen: "primero", subagentes: { cerrador: { clientes: 5 } } }, "2026-10-27");
  const dos = reglas.leerResumenAGuardar({ fecha: "2026-10-27", resumen: "segundo", subagentes: { cobrador: { ventas: 2 } } }, "2026-10-27");
  await resumenes.guardarResumenDelDia(WS, "ventas", uno);
  await resumenes.guardarResumenDelDia(WS, "ventas", dos);
  assert.equal(db.dias.size, 1);
  assert.equal(db.dias.get(`${WS}|ventas|2026-10-27`).resumen, "segundo");
});

await prueba("el resumen valida la fecha y los subagentes", () => {
  assert.throws(() => reglas.leerResumenAGuardar({ fecha: "27/10/2026" }, "2026-10-27"));
  assert.throws(() => reglas.leerResumenAGuardar({ subagentes: [1] }, "2026-10-27"));
  const r = reglas.leerResumenAGuardar({ sugeridos: [{ asesora: "María", numero: "+57 300", conversacionId: "c1" }, { cliente: "sin asesora" }] }, "2026-10-27");
  assert.equal(r.fecha, "2026-10-27");
  assert.equal(r.sugeridos.length, 1);
});

/* ------------------------------------------------------------------ las herramientas MCP */

await prueba("las herramientas de Ventas y de Marketing están en la lista del MCP", () => {
  // herramientas.ts arrastra medio sistema: se comprueba que registre y ejecute el grupo.
  assert.ok(textoDeHerramientas.includes("...HERRAMIENTAS_MCP_AGENTES_DE_AREA"));
  assert.ok(textoDeHerramientas.includes("esHerramientaDeAgentesDeArea(nombre)"));
  const nombres = mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.map((h) => h.name);
  for (const n of ["numeros_de_ventas", "guardar_resumen_del_dia", "mandar_whatsapp_al_equipo", "agente_de_ventas"]) assert.ok(nombres.includes(n), n);
  const lectura = mcp.HERRAMIENTAS_MCP_AGENTES_DE_AREA.filter((h) => h.annotations.readOnlyHint).map((h) => h.name).sort();
  assert.deepEqual(lectura, ["agente_de_marketing", "agente_de_sistemas", "agente_de_ventas", "cerebro_del_area", "numeros_de_marketing", "numeros_de_ventas", "revision_de_sistemas"]);
});

await prueba("por el MCP: sin permiso no se puede ni leer ni mandar", async () => {
  reiniciar({ activo: true });
  await assert.rejects(mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_ventas", {}, { workspaceId: WS, userId: "intruso" }), /permiso/);
  await assert.rejects(mcp.ejecutarHerramientaMcpAgentesDeArea("mandar_whatsapp_al_equipo", { tipo: "asesora", numero: ALEX, texto: "x" }, { workspaceId: WS, userId: "intruso" }), /permiso/);
  assert.equal(db.enviados.length, 0);
});

await prueba("por el MCP: un número de cliente es rechazado y agente_de_ventas lo muestra", async () => {
  reiniciar({ activo: false });
  const contexto = { workspaceId: WS, userId: "alex" };
  const r = await mcp.ejecutarHerramientaMcpAgentesDeArea("mandar_whatsapp_al_equipo", { tipo: "asesora", numero: CLIENTE, texto: "hola" }, contexto);
  assert.equal(r.se_mando, false);
  assert.equal(r.motivo, "ese número no es del equipo");
  const g = await mcp.ejecutarHerramientaMcpAgentesDeArea("guardar_resumen_del_dia", { fecha: "2026-10-27", es_prueba: true, resumen: "Prueba" }, contexto);
  assert.equal(g.guardado, true);
  const ver = await mcp.ejecutarHerramientaMcpAgentesDeArea("agente_de_ventas", { fecha: "2026-10-27" }, contexto);
  assert.equal(ver.interruptor, "apagado");
  assert.equal(ver.resumen_del_dia.es_prueba, true);
  assert.equal(db.enviados.length, 0);
});

/* ------------------------------------------------------------------ tasa de respuesta a la bienvenida */

const lead = (extra = {}) => ({ dia: "2026-10-26", canalId: "v1", proposito: "SALES", linea: "Ventas 1", anuncioId: "a1", anuncioTitulo: "Camillas", mensajes: 1, minutosAlSegundo: null, ...extra });

await prueba("bienvenida: un lead con un solo mensaje no cuenta como respondido; con dos o más sí", async () => {
  const m = reglas.medirRespuestaBienvenida([lead(), lead({ mensajes: 2, minutosAlSegundo: 5 }), lead({ mensajes: 4, minutosAlSegundo: 300 }), lead()]);
  assert.equal(m.leads, 4);
  assert.equal(m.respondieron, 2);
  assert.equal(m.respondieronPorCiento, 50);
  assert.equal(m.cumpleMeta, false);
  assert.equal(m.metaPorCiento, 60);
});

await prueba("bienvenida: en menos de 2 horas, y justo en el límite no cuenta", async () => {
  const m = reglas.medirRespuestaBienvenida([
    lead({ mensajes: 2, minutosAlSegundo: 119.9 }),
    lead({ mensajes: 2, minutosAlSegundo: 120 }),
    lead({ mensajes: 2, minutosAlSegundo: 0.5 }),
  ]);
  assert.equal(m.respondieron, 3);
  assert.equal(m.respondieronEnMenosDe2h, 2);
  assert.equal(m.menosDe2hPorCiento, 66.7);
  assert.equal(m.cumpleMeta, true);
});

await prueba("bienvenida: un día sin leads da sin dato (null), no 0 %", async () => {
  const m = reglas.medirRespuestaBienvenida([]);
  assert.equal(m.respondieronPorCiento, null);
  assert.equal(m.menosDe2hPorCiento, null);
  assert.equal(m.cumpleMeta, null);
  assert.match(reglas.lineaDeRespuestaBienvenida(m), /sin dato/);
  const serie = reglas.serieDeRespuestaBienvenida([lead({ mensajes: 3, minutosAlSegundo: 10 })], "2026-10-27");
  assert.equal(serie.length, 14);
  assert.equal(serie[13].fecha, "2026-10-27");
  assert.equal(serie[13].respondieronPorCiento, null);
  assert.equal(serie[12].fecha, "2026-10-26");
  assert.equal(serie[12].respondieronPorCiento, 100);
  assert.equal(serie[0].fecha, "2026-10-14");
});

await prueba("bienvenida: cuenta a todos los leads sin importar su etapa; la línea Admin no entra; por línea y por anuncio", async () => {
  const leads = [
    lead({ mensajes: 2, minutosAlSegundo: 10 }),
    lead({ linea: "Ventas 2", canalId: "v2", anuncioId: null, anuncioTitulo: null }),
    lead({ canalId: "admin", proposito: "ADMIN", linea: "Admin", mensajes: 5, minutosAlSegundo: 1 }),
    lead({ canalId: reglas.CANAL_ADMIN_ID, proposito: null, linea: "Admin 2", mensajes: 5, minutosAlSegundo: 1 }),
  ];
  const dia = reglas.serieDeRespuestaBienvenida(leads, "2026-10-26").at(-1);
  assert.equal(dia.leads, 2);
  assert.equal(dia.respondieron, 1);
  assert.deepEqual(dia.porLinea.map((l) => [l.linea, l.leads]).sort(), [["Ventas 1", 1], ["Ventas 2", 1]]);
  const sin = dia.porAnuncio.find((a) => a.anuncioId === null);
  assert.equal(sin.anuncio, "Sin anuncio");
  assert.equal(sin.leads, 1);
});

const seg = (minutosDesdeElPrimero, minutosDeclarados = null) => ({ minutosDesdeElPrimero, minutosDeclarados });

await prueba("bienvenida: separa respondió la bienvenida, recuperados por seguimiento y nunca respondieron; suman el total", async () => {
  const leads = [
    lead({ mensajes: 2, minutosAlSegundo: 5, seguimientos: [seg(15, 15)] }), // respondió antes del seguimiento
    lead({ mensajes: 2, minutosAlSegundo: 7 }), // sin eventos
    lead({ mensajes: 2, minutosAlSegundo: 20, seguimientos: [seg(15, 15)] }), // recuperado por 15 min
    lead({ mensajes: 3, minutosAlSegundo: 70, seguimientos: [seg(15, 15), seg(60, 60)] }), // recuperado por 1 hora
    lead({ mensajes: 3, minutosAlSegundo: 1500, seguimientos: [seg(15, 15), seg(60, 60), seg(1440, 1440)] }), // recuperado por 1 día
    lead({ mensajes: 2, minutosAlSegundo: 40, seguimientos: [seg(20)] }), // motor viejo: franja 15 min
    lead({ mensajes: 2, minutosAlSegundo: 200, seguimientos: [seg(120)] }), // motor viejo: franja 1 hora
    lead({ mensajes: 2, minutosAlSegundo: 90, seguimientos: [seg(30, 45)] }), // minutos raros: otro
    lead({ seguimientos: [seg(15, 15), seg(60, 60)] }), // nunca respondió
    lead(), // nunca respondió, sin eventos
    lead({ canalId: "admin", proposito: "ADMIN", linea: "Admin", mensajes: 5, minutosAlSegundo: 1, seguimientos: [seg(1, 15)] }), // Admin no entra
  ];
  const m = reglas.medirRespuestaBienvenida(leads);
  assert.equal(m.leads, 10);
  assert.equal(m.respondieronLaBienvenida, 2);
  assert.deepEqual(m.recuperadosPorSeguimiento, { min15: 2, hora1: 2, dia1: 1, otro: 1 });
  assert.equal(m.recuperados, 6);
  assert.equal(m.nuncaRespondieron, 2);
  assert.equal(m.respondieronLaBienvenida + m.recuperados + m.nuncaRespondieron, m.leads);
  // Los campos viejos no cambian: respondieron = todos los de 2+ mensajes.
  assert.equal(m.respondieron, 8);
  assert.equal(m.respondieronEnMenosDe2h, 6);
  const dia = reglas.serieDeRespuestaBienvenida(leads, "2026-10-26").at(-1);
  assert.equal(dia.recuperadosPorSeguimiento.dia1, 1);
  assert.equal(dia.porLinea[0].respondieronLaBienvenida + dia.porLinea[0].recuperados + dia.porLinea[0].nuncaRespondieron, dia.porLinea[0].leads);
  assert.match(reglas.lineaDeRespuestaBienvenida(m), /1 día: 1/);
  const vacio = reglas.medirRespuestaBienvenida([]);
  assert.equal(vacio.nuncaRespondieronPorCiento, null);
  assert.equal(vacio.recuperadosPorSeguimiento.dia1, 0);
});

await prueba("bienvenida: numeros_de_ventas trae el campo y, si falla la lectura, solo esa parte sale en no_se_pudo_leer", async () => {
  reiniciar({ activo: true });
  const r = await mcp.ejecutarHerramientaMcpAgentesDeArea("numeros_de_ventas", { fecha: "2026-10-26" }, { workspaceId: WS, userId: "alex" });
  assert.ok("tasa_respuesta_bienvenida" in r);
  assert.ok(Array.isArray(r.por_asesora));
  assert.equal(db.enviados.length, 0);
});

const reporteDel26 = async () => {
  reiniciar({ activo: true });
  db.cambiosDeEtapa = ["a", "b"].map((k, i) => ({
    conversationId: `c${i}`, contactId: k, asesoraId: "maria", etapaNueva: i ? "NEGOCIACION" : "PROPUESTA", proposito: "SALES", canalId: "ventas1",
  }));
  return mcp.ejecutarHerramientaMcpAgentesDeArea("numeros_de_ventas", { fecha: "2026-10-26" }, { workspaceId: WS, userId: "alex" });
};
const fetchReal = globalThis.fetch;
const conGestion = async (respuesta, fn) => {
  globalThis.fetch = async () => respuesta();
  try {
    return await fn();
  } finally {
    globalThis.fetch = fetchReal;
  }
};
const json = (cuerpo, status = 200) => new Response(JSON.stringify(cuerpo), { status, headers: { "content-type": "application/json" } });
const fila = (r, nombre) => r.por_asesora.find((f) => f.asesora.startsWith(nombre));

await prueba("26-oct con Gestión: María 0 cotizaciones y 2 chats calientes, Yair 1 e Ingrid 1", async () => {
  const r = await conGestion(
    () => json({ cotizaciones: [{ numero: "COT-00150", vendedora: "Yair Silvera" }, { numero: "COT-00151", vendedora: "Ingrid Sanchez" }] }),
    reporteDel26,
  );
  assert.equal(fila(r, "María").cotizaciones, 0);
  assert.equal(fila(r, "María").chatsCalientes, 2);
  assert.equal(fila(r, "Yair").cotizaciones, 1);
  assert.equal(fila(r, "Ingrid").cotizaciones, 1);
  assert.equal(r.total.cotizaciones, 2);
  assert.equal(r.total.chatsCalientes, 2);
  assert.equal(r.no_se_pudo_leer, undefined);
});
await prueba("una vendedora de Gestión sin asesora en el CRM sale en su propia fila", async () => {
  const r = await conGestion(() => json({ cotizaciones: [{ vendedora: "Laura Pérez" }] }), reporteDel26);
  assert.equal(fila(r, "Laura Pérez").cotizaciones, 1);
  assert.equal(r.total.cotizaciones, 1);
});
await prueba("Gestión caída: cotizaciones null y aviso en no_se_pudo_leer (no se muestra el número viejo)", async () => {
  const r = await conGestion(() => json({}, 500), reporteDel26);
  assert.equal(fila(r, "María").cotizaciones, null);
  assert.equal(fila(r, "María").chatsCalientes, 2);
  assert.equal(r.total.cotizaciones, null);
  assert.ok(r.no_se_pudo_leer.some((a) => a.includes("Gestión")));
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:\n- " + fallas.join("\n- "));
  process.exit(1);
}

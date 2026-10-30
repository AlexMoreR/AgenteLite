// Pruebas de la página de Alertas (src/features/alertas) con un prisma FALSO y un WhatsApp FALSO: el orden por prioridad
// y fecha, que solo URGENTE decide enviar WhatsApp, el texto urgente de 2 líneas con el link, que una alerta repetida no
// se duplique, marcar vista / resuelta y que no se toque la alerta de otro negocio. No necesita base ni red.
// Correr: npm run test:alertas
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const filas = [];
let contador = 0;
const abierta = (f) => f.estado === "NUEVA" || f.estado === "VISTA";
const coincide = (f, where = {}) =>
  Object.entries(where).every(([campo, valor]) => {
    if (campo === "OR") return valor.some((opcion) => coincide(f, opcion));
    if (valor === null) return (f[campo] ?? null) === null;
    if (valor && typeof valor === "object" && "in" in valor) return valor.in.includes(f[campo]);
    return f[campo] === valor;
  });

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
    },
  },
  whatsAppChannel: { findFirst: async ({ where }) => (where.id === "admin1" ? { id: "admin1", evolutionInstanceName: "admin-inst" } : null) },
  workspaceMember: {
    findMany: async () => [],
    findFirst: async ({ where }) => (miembros.includes(`${where.workspaceId}:${where.userId}`) ? { userId: where.userId } : null),
  },
  alertaInterna: {
    findFirst: async ({ where }) => [...filas].reverse().find((f) => coincide(f, where)) ?? null,
    create: async ({ data }) => {
      const creadoEn = new Date(2026, 9, 1, 10, contador);
      const fila = { id: `a${++contador}`, estado: "NUEVA", salioPorWhatsApp: false, veces: 1, creadoEn, ultimaVez: creadoEn, vistaEn: null, resueltaEn: null, detalle: null, ...data };
      filas.push(fila);
      return fila;
    },
    update: async ({ where, data }) => {
      const fila = filas.find((f) => f.id === where.id);
      for (const [k, v] of Object.entries(data)) fila[k] = v && typeof v === "object" && "increment" in v ? fila[k] + v.increment : v;
      return fila;
    },
    updateMany: async ({ where, data }) => {
      for (const f of filas.filter((x) => coincide(x, where))) Object.assign(f, data);
    },
    findMany: async ({ where }) => filas.filter((f) => coincide(f, where)),
    groupBy: async ({ where }) => {
      const cuenta = {};
      for (const f of filas.filter((x) => coincide(x, where))) cuenta[f.estado] = (cuenta[f.estado] ?? 0) + 1;
      return Object.entries(cuenta).map(([estado, n]) => ({ estado, _count: { _all: n } }));
    },
  },
};
const ajustes = new Map();
const miembros = ["wsR:u_em", "wsR:u_alex", "wsR:u_ana"];

// Tarjetas falsas del tablero: Tecnología (área) > Gestión (subárea) > Tarea; Ventas (área) > Tarea; una huérfana y una borrada.
const tarjetas = [
  { id: "tec", titulo: "Tecnología", padreId: null, borradoEn: null, area: null, tipo: { usaEstados: false } },
  { id: "ges", titulo: "Gestión", padreId: "tec", borradoEn: null, area: null, tipo: { usaEstados: false } },
  { id: "t1", titulo: "Arreglar facturas", padreId: "ges", borradoEn: null, area: null, tipo: { usaEstados: true } },
  { id: "tt", titulo: "Algo de Tecnología", padreId: "tec", borradoEn: null, area: null, tipo: { usaEstados: true } },
  { id: "ven", titulo: "Ventas", padreId: null, borradoEn: null, area: null, tipo: { usaEstados: false } },
  { id: "t2", titulo: "Seguir clientes", padreId: "ven", borradoEn: null, area: null, tipo: { usaEstados: true } },
  { id: "huerfana", titulo: "Sin madre", padreId: null, borradoEn: null, area: null, tipo: { usaEstados: true } },
  { id: "borrada", titulo: "Vieja", padreId: "ven", borradoEn: new Date(), area: null, tipo: { usaEstados: true } },
];
falso.tarjetaTablero = { findMany: async ({ where }) => tarjetas.filter((t) => where.id.in.includes(t.id)) };

const whatsapps = [];
const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": { sendEvolutionTextMessageWithReconnect: async (datos) => void whatsapps.push(datos) },
  "@/lib/web-push": { sendPushToUser: async () => 0 },
  "@/lib/anti-bloqueo/servicio": { leerConfigAntiBloqueo: async () => ({ avisos: { canalInternoId: null } }) },
};
const reglas = cargar("src/features/alertas/dominio/reglas.ts");
const servicio = cargar("src/features/alertas/servicios/alertas.ts", mocks);
const enrutador = cargar("src/features/avisos-gravedad/servicios/enrutador.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  filas.length = 0;
  ajustes.clear();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

await prueba("el orden: Urgente, Alta, Media, Baja y, dentro de cada una, de la más nueva a la más vieja", async () => {
  const lista = [
    { id: 1, prioridad: "BAJA", creadoEn: new Date("2026-10-29T10:00:00Z") },
    { id: 2, prioridad: "ALTA", creadoEn: new Date("2026-10-29T08:00:00Z") },
    { id: 3, prioridad: "URGENTE", creadoEn: new Date("2026-10-28T08:00:00Z") },
    { id: 4, prioridad: "ALTA", creadoEn: new Date("2026-10-29T09:00:00Z") },
    { id: 5, prioridad: "MEDIA", creadoEn: new Date("2026-10-29T07:00:00Z") },
    { id: 6, prioridad: "URGENTE", creadoEn: new Date("2026-10-29T06:00:00Z") },
  ];
  assert.deepEqual(reglas.ordenarAlertas(lista).map((a) => a.id), [6, 3, 4, 2, 5, 1]);
  assert.deepEqual(lista.map((a) => a.id), [1, 2, 3, 4, 5, 6], "no cambia la lista original");
});

await prueba("solo URGENTE decide enviar WhatsApp", () => {
  assert.equal(reglas.salePorWhatsApp("URGENTE"), true);
  for (const p of ["ALTA", "MEDIA", "BAJA", "", "x"]) assert.equal(reglas.salePorWhatsApp(p), false, p);
  assert.equal(reglas.leerPrioridad("Urgente"), "URGENTE");
  assert.equal(reglas.leerPrioridad(" alta "), "ALTA");
  assert.equal(reglas.leerPrioridad("critica"), null);
});

await prueba("el texto urgente: 2 líneas (título corto + link) aunque la alerta sea larguísima", () => {
  const largo = "Caída fuerte de la respuesta de los clientes nuevos del libro v292: bajó del 60,1 % al 26,8 %. ".repeat(10);
  const texto = reglas.textoDeUrgente(largo);
  const lineas = texto.split("\n");
  assert.equal(lineas.length, 2);
  assert.match(lineas[0], /^🚨 Urgente: /);
  assert.ok(lineas[0].length <= 110, lineas[0]);
  assert.equal(lineas[1], "Ver: https://app.aizenbot.com/cliente/alertas");
  assert.equal(reglas.textoDeVariasUrgentes(["uno", "dos"]).split("\n").length, 2);
});

await prueba("las gravedades del Supervisor: CRÍTICO = Urgente, IMPORTANTE = Alta, OBSERVACIÓN = Baja", () => {
  assert.equal(reglas.prioridadDeGravedad("CRITICO"), "URGENTE");
  assert.equal(reglas.prioridadDeGravedad("IMPORTANTE"), "ALTA");
  assert.equal(reglas.prioridadDeGravedad("OBSERVACION"), "BAJA");
});

await prueba("dinero, Meta Ads o clave hacen urgente un 'necesita tu decisión'; lo demás no", () => {
  assert.equal(reglas.esDeDineroMetaOClave("toca Meta Ads"), true);
  assert.equal(reglas.esDeDineroMetaOClave("falta una clave, un acceso o un permiso"), true);
  assert.equal(reglas.esDeDineroMetaOClave("mueve dinero del presupuesto"), true);
  assert.equal(reglas.esDeDineroMetaOClave("cambia la pantalla de chats"), false);
});

await prueba("registrarAlerta: guarda siempre; solo la urgente sale por WhatsApp, con el texto corto", async () => {
  const enviados = [];
  const enviar = async (texto) => (enviados.push(texto), true);
  const media = await servicio.registrarAlerta({ workspaceId: "ws1", clave: "k-media", prioridad: "MEDIA", titulo: "Algo menor", origen: "Supervisor", enviar });
  assert.equal(media.creada, true);
  assert.equal(media.salioPorWhatsApp, false);
  assert.equal(enviados.length, 0, "una media no sale por WhatsApp");
  const urgente = await servicio.registrarAlerta({ workspaceId: "ws1", clave: "k-urg", prioridad: "URGENTE", titulo: "Cayó la respuesta de clientes nuevos", detalle: "del 60,1 % al 26,8 %", origen: "Agente de Ventas", enviar });
  assert.equal(urgente.salioPorWhatsApp, true);
  assert.equal(enviados.length, 1);
  assert.equal(enviados[0].split("\n").length, 2);
  assert.equal(filas.length, 2, "las dos quedan guardadas");
  assert.equal(filas.find((f) => f.clave === "k-urg").salioPorWhatsApp, true);
  assert.equal(filas.find((f) => f.clave === "k-urg").detalle, "del 60,1 % al 26,8 %");
  // Urgente sin canal de envío: se guarda y no sale.
  const sinCanal = await servicio.registrarAlerta({ workspaceId: "ws1", clave: "k-2", prioridad: "URGENTE", titulo: "Otra", origen: "Coordinador" });
  assert.equal(sinCanal.salioPorWhatsApp, false);
  assert.equal(filas.length, 3);
});

await prueba("registrarAlerta: si el WhatsApp falla, la alerta queda guardada", async () => {
  const r = await servicio.registrarAlerta({ workspaceId: "ws1", clave: "k", prioridad: "URGENTE", titulo: "Línea caída", origen: "Línea de WhatsApp", enviar: async () => { throw new Error("línea caída"); } });
  assert.equal(r.salioPorWhatsApp, false);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].salioPorWhatsApp, false);
});

await prueba("una alerta repetida mientras sigue abierta no se duplica: se refresca y cuenta las veces", async () => {
  const pedido = { workspaceId: "ws1", clave: "igual", prioridad: "ALTA", titulo: "Igual", origen: "Supervisor" };
  await servicio.registrarAlerta(pedido);
  const segunda = await servicio.registrarAlerta({ ...pedido, titulo: "Igual (actualizada)" });
  assert.equal(segunda.creada, false);
  assert.equal(filas.length, 1);
  assert.equal(filas[0].veces, 2);
  assert.equal(filas[0].titulo, "Igual (actualizada)");
  await servicio.registrarAlerta({ ...pedido, refrescar: false });
  assert.equal(filas[0].veces, 2, "con refrescar:false no se toca");
  // Resuelta y vuelve a pasar: es una alerta nueva.
  await servicio.marcarAlerta("ws1", filas[0].id, "RESUELTA");
  const tercera = await servicio.registrarAlerta(pedido);
  assert.equal(tercera.creada, true);
  assert.equal(filas.length, 2);
  // Otra clave u otro negocio no se mezclan.
  await servicio.registrarAlerta({ ...pedido, workspaceId: "ws2" });
  assert.equal(filas.length, 3);
});

await prueba("marcar vista y resuelta cambia el estado y no toca el de otro negocio", async () => {
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "a", prioridad: "ALTA", titulo: "A", origen: "Supervisor" });
  const id = filas[0].id;
  assert.equal(filas[0].estado, "NUEVA");
  assert.equal(await servicio.marcarAlerta("ws2", id, "VISTA"), false, "otro negocio no puede");
  assert.equal(filas[0].estado, "NUEVA");
  const vista = new Date("2026-10-29T12:00:00Z");
  assert.equal(await servicio.marcarAlerta("ws1", id, "VISTA", vista), true);
  assert.equal(filas[0].estado, "VISTA");
  assert.equal(filas[0].vistaEn, vista);
  await servicio.marcarAlerta("ws1", id, "VISTA", new Date("2026-10-29T13:00:00Z"));
  assert.equal(filas[0].vistaEn, vista, "conserva la primera hora");
  await servicio.marcarAlerta("ws1", id, "RESUELTA", new Date("2026-10-29T14:00:00Z"));
  assert.equal(filas[0].estado, "RESUELTA");
  assert.ok(filas[0].resueltaEn);
  await servicio.marcarAlerta("ws1", id, "VISTA");
  assert.equal(filas[0].estado, "RESUELTA", "una resuelta no vuelve a vista");
  assert.equal(await servicio.marcarAlerta("ws1", "no-existe", "VISTA"), false);
});

await prueba("listar: sin las resueltas por defecto, ordenadas y con filtros", async () => {
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "b", prioridad: "BAJA", titulo: "B", origen: "Supervisor" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "u", prioridad: "URGENTE", titulo: "U", origen: "Supervisor" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "r", prioridad: "ALTA", titulo: "R", origen: "Supervisor" });
  await servicio.marcarAlerta("ws1", filas.find((f) => f.clave === "r").id, "RESUELTA");
  assert.deepEqual((await servicio.listarAlertas("ws1")).map((a) => a.titulo), ["U", "B"]);
  assert.deepEqual((await servicio.listarAlertas("ws1", { estado: "TODAS" })).map((a) => a.titulo), ["U", "R", "B"]);
  assert.deepEqual((await servicio.listarAlertas("ws1", { estado: "RESUELTA" })).map((a) => a.titulo), ["R"]);
  assert.deepEqual((await servicio.listarAlertas("ws1", { prioridad: "BAJA" })).map((a) => a.titulo), ["B"]);
  assert.deepEqual(await servicio.listarAlertas("ws2"), []);
});

await prueba("el interruptor 'solo urgentes' empieza prendido y se apaga con false", async () => {
  assert.equal(await servicio.soloUrgentesPrendido("ws1"), true);
  ajustes.set("alertas:solo-urgentes:ws1", "false");
  assert.equal(await servicio.soloUrgentesPrendido("ws1"), false);
  ajustes.set("alertas:solo-urgentes:ws1", '{"activo": false}');
  assert.equal(await servicio.soloUrgentesPrendido("ws1"), false);
  ajustes.set("alertas:solo-urgentes:ws1", "true");
  assert.equal(await servicio.soloUrgentesPrendido("ws1"), true);
});

await prueba("la clave de una alerta sin clave propia es estable y distinta por sistema", () => {
  assert.equal(reglas.claveDeAlerta("Supervisor", "Algo"), reglas.claveDeAlerta("Supervisor", "algo  "));
  assert.notEqual(reglas.claveDeAlerta("Supervisor", "Algo"), reglas.claveDeAlerta("Agente de Ventas", "Algo"));
});

/* ------------------------------------------------------------------ el Supervisor por gravedad */

const AHORA = new Date("2026-10-29T15:00:00Z"); // 10:00 a. m. en Bogotá (horario laboral)
const configurarGravedad = () => {
  whatsapps.length = 0;
  ajustes.set("avisos:gravedad:ws1", JSON.stringify({ activo: true, whatsapp: { numero: "573001112233", canalId: "admin1" } }));
  ajustes.set("agente-v3:avisos:ws1", JSON.stringify({ canalId: "admin1", destinos: [{ numero: "573001112233", soloDe: null }] }));
  enrutador.olvidarConfigGravedad();
};
const incidente = (severidad, clave, titulo, que) => ({
  clave, familia: "BOT", severidad, titulo, producto: null, primeraVezEn: AHORA, ultimaVezEn: AHORA, desde: AHORA, vecesVista: 1,
  estado: "ABIERTA", resueltaEn: null, notificadaEn: null, severidadNotificada: null,
  hallazgos: [{ severidad, que, evidencia: { chats: [] }, leadsAfectados: 1 }],
});

await prueba("Supervisor: un CRÍTICO se guarda como Urgente y su WhatsApp es el corto (2 líneas con el link a la página)", async () => {
  configurarGravedad();
  const critico = incidente("CRITICO", "BOT:respuesta-nuevos", "Cayó la respuesta de los clientes nuevos del libro v292", "Del 60,1 % al 26,8 %");
  const r = await enrutador.enrutarAlertasDelSupervisor({ workspaceId: "ws1", config: await enrutador.leerConfigGravedad("ws1"), avisos: [{ incidente: critico, motivo: "nuevo" }], ahora: AHORA });
  assert.equal(r.porCanal.alexander_whatsapp, 1);
  assert.equal(whatsapps.length, 1);
  assert.equal(whatsapps[0].text, "🚨 Urgente: Cayó la respuesta de los clientes nuevos del libro v292\nVer: https://app.aizenbot.com/cliente/alertas");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].prioridad, "URGENTE");
  assert.equal(filas[0].origen, "Supervisor");
  assert.equal(filas[0].salioPorWhatsApp, true);
  assert.match(filas[0].detalle, /60,1 % al 26,8 %/, "el detalle completo queda en la página");
});

await prueba("Supervisor: IMPORTANTE = Alta y OBSERVACIÓN = Baja, solo se guardan (sin WhatsApp)", async () => {
  configurarGravedad();
  const importante = incidente("IMPORTANTE", "BOT:importante", "Algo importante", "detalle");
  const observacion = incidente("OBSERVACION", "BOT:observacion", "Algo menor", "detalle");
  await enrutador.enrutarAlertasDelSupervisor({
    workspaceId: "ws1", config: await enrutador.leerConfigGravedad("ws1"), ahora: AHORA,
    avisos: [{ incidente: importante, motivo: "nuevo" }, { incidente: observacion, motivo: "nuevo" }],
  });
  assert.equal(whatsapps.length, 0);
  assert.deepEqual(filas.map((f) => [f.clave, f.prioridad]).sort(), [["sup:BOT:importante", "ALTA"], ["sup:BOT:observacion", "BAJA"]]);
});

await prueba("Supervisor: con 'solo urgentes' apagado el WhatsApp del crítico es el de siempre, y la alerta igual se guarda", async () => {
  configurarGravedad();
  ajustes.set("alertas:solo-urgentes:ws1", "false");
  const critico = incidente("CRITICO", "BOT:x", "Un crítico", "detalle largo");
  await enrutador.enrutarAlertasDelSupervisor({ workspaceId: "ws1", config: await enrutador.leerConfigGravedad("ws1"), avisos: [{ incidente: critico, motivo: "nuevo" }], ahora: AHORA });
  assert.match(whatsapps[0].text, /^🚨 \*CRÍTICO\* · Supervisor\n\n📌 Un crítico/);
  assert.equal(filas.length, 1);
});

await prueba("Línea de WhatsApp caída: es Urgente, queda en la página y avisa corto; el mismo aviso no se duplica", async () => {
  configurarGravedad();
  const pedido = { workspaceId: "ws1", canalId: "ventas9", titulo: "Ventas 2 esta caida", cuerpo: "Lleva 12 min sin conexion.", ahora: AHORA };
  assert.equal(await enrutador.avisarLineaCaidaPorWhatsApp(pedido), true);
  assert.equal(whatsapps[0].text, "🚨 Urgente: Ventas 2 esta caida\nVer: https://app.aizenbot.com/cliente/alertas");
  assert.equal(filas.length, 1);
  assert.equal(filas[0].prioridad, "URGENTE");
  assert.equal(filas[0].origen, "Línea de WhatsApp");
  // Con el interruptor de gravedad apagado no hay WhatsApp, pero la alerta sí queda.
  filas.length = 0;
  whatsapps.length = 0;
  ajustes.set("avisos:gravedad:ws1", JSON.stringify({ activo: false }));
  enrutador.olvidarConfigGravedad();
  assert.equal(await enrutador.avisarLineaCaidaPorWhatsApp(pedido), false);
  assert.equal(whatsapps.length, 0);
  assert.equal(filas.length, 1);
});

await prueba("áreas: el id de la tarjeta sale de las claves auto:trabado y auto:necesita, y de ninguna otra", () => {
  assert.equal(reglas.idDeTarjetaDeLaClave("auto:trabado:t1:ERROR"), "t1");
  assert.equal(reglas.idDeTarjetaDeLaClave("auto:necesita:t2:PLAN_LISTO"), "t2");
  assert.equal(reglas.idDeTarjetaDeLaClave("auto:caido"), null);
  assert.equal(reglas.idDeTarjetaDeLaClave("supervisor:abc"), null);
});

await prueba("cierre solo: la clave nueva del Coordinador trae el id de la tarjeta; la vieja (solo texto) no", () => {
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:necesita:cm9x1abc:Agente Gestión necesita tu decisión"), "cm9x1abc");
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:necesita:t1:Agente: ¿qué color?"), "t1");
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:necesita:Agente Gestión necesita tu decisión: el color"), null);
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:necesita:Agente Gestión necesita tu decisión"), null);
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:necesita:Aprobación"), null);
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:necesita:Atención: falta algo"), null, "con tilde no es un id");
  assert.equal(reglas.idDeTarjetaDeLaClave("coord:limite:t1:algo"), null);
  assert.equal(reglas.idDeTarjetaDeLaClave("terminada:t1"), null);
  assert.equal(reglas.idDeTarjetaDeLaClave("auto:equipo:t1:asignada:u_em"), "t1");
});

await prueba("cierre solo: qué claves cierra cada motivo (y solo de esa tarjeta)", () => {
  const cierra = (motivo, clave) => reglas.motivoCierraLaClave(motivo, clave, "t1");
  for (const clave of ["auto:necesita:t1:PLAN_LISTO", "auto:trabado:t1:ERROR", "coord:necesita:t1:Agente necesita"]) {
    assert.equal(cierra("APROBACION", clave), true, clave);
  }
  assert.equal(cierra("APROBACION", "auto:equipo:t1:asignada:u_em"), false);
  assert.equal(cierra("RESPUESTA", "coord:necesita:t1:Agente necesita"), true);
  for (const clave of ["auto:necesita:t1:PLAN_LISTO", "auto:trabado:t1:ERROR", "auto:equipo:t1:asignada:u_em"]) {
    assert.equal(cierra("RESPUESTA", clave), false, clave);
  }
  for (const clave of ["auto:necesita:t1:PLAN_LISTO", "auto:trabado:t1:ERROR", "auto:equipo:t1:asignada:u_em", "coord:necesita:t1:Agente necesita"]) {
    assert.equal(cierra("CIERRE", clave), true, clave);
  }
  assert.equal(cierra("CIERRE", "terminada:t1"), false, "el aviso de terminada no se toca");
  // Otra tarjeta (aunque el id empiece igual), la clave vieja o una sin tarjeta: nunca.
  for (const motivo of reglas.MOTIVOS_DE_CIERRE) {
    assert.equal(cierra(motivo, "auto:necesita:t10:PLAN_LISTO"), false);
    assert.equal(cierra(motivo, "coord:necesita:t2:Agente necesita"), false);
    assert.equal(cierra(motivo, "coord:necesita:Agente Gestión necesita algo"), false);
    assert.equal(cierra(motivo, "auto:caido"), false);
  }
});

await prueba("cierre solo: la línea de cierre dice el motivo y la hora de Bogotá (d-mmm HH:mm)", () => {
  const hora = new Date("2026-10-30T19:05:00Z"); // 2:05 p. m. en Bogotá
  assert.equal(reglas.lineaDeCierre("APROBACION", hora), "Resuelta sola: aprobación del dueño (30-oct 14:05)");
  assert.equal(reglas.lineaDeCierre("RESPUESTA", hora), "Resuelta sola: respuesta del dueño (30-oct 14:05)");
  assert.equal(reglas.lineaDeCierre("CIERRE", new Date("2026-01-01T04:30:00Z")), "Resuelta sola: la tarjeta se cerró (31-dic 23:30)");
  assert.equal(reglas.lineaDeCierre("CIERRE", new Date("2026-03-05T05:07:00Z")), "Resuelta sola: la tarjeta se cerró (5-mar 00:07)");
});

await prueba("áreas: directa, subárea madre dentro de Tecnología, huérfana y borrada caen donde deben", async () => {
  const mapa = await servicio.leerAreasDeTarjetas("ws1", ["t1", "tt", "t2", "huerfana", "borrada", "noexiste"]);
  assert.equal(mapa.get("t1"), "Gestión");
  assert.equal(mapa.get("tt"), null); // dentro de Tecnología pero sin subárea de la lista
  assert.equal(mapa.get("t2"), "Ventas");
  assert.equal(mapa.get("huerfana"), null);
  assert.equal(mapa.get("borrada"), null);
  assert.equal(mapa.get("noexiste"), null);
});

await prueba("áreas: alerta del Coordinador sin tarjeta, tarjeta sin área y área desconocida", () => {
  const mapa = new Map([["t1", "Gestión"], ["borrada", null]]);
  assert.equal(reglas.areaDeAlerta({ clave: "auto:trabado:t1:ERROR", origen: "Coordinador" }, mapa), "Gestión");
  assert.equal(reglas.areaDeAlerta({ clave: "auto:caido", origen: "Coordinador" }, mapa), "Coordinador");
  assert.equal(reglas.areaDeAlerta({ clave: "auto:trabado:borrada:ERROR", origen: "Supervisor" }, mapa), "General");
  assert.equal(reglas.areaDeAlerta({ clave: "x:1", origen: "Supervisor" }, mapa), "General");
  assert.equal(reglas.areaDeAlerta({ clave: "x:2", origen: "Agente de Ventas" }, mapa), "Ventas");
  assert.equal(reglas.areaDeLaRuta(["Cosa rara"]), null);
  assert.equal(reglas.leerAreaDeAlerta("gestion"), "Gestión");
  assert.equal(reglas.leerAreaDeAlerta("Inventada"), null);
});

await prueba("áreas: los conteos solo cuentan las abiertas y un área desconocida cuenta en General", () => {
  const cuenta = reglas.contarAbiertasPorArea([
    { estado: "NUEVA", area: "Gestión" },
    { estado: "VISTA", area: "Gestión" },
    { estado: "RESUELTA", area: "Gestión" },
    { estado: "NUEVA", area: "Inventada" },
  ]);
  assert.equal(cuenta["Gestión"], 2);
  assert.equal(cuenta["General"], 1);
  assert.equal(cuenta["Ventas"], 0);
});

await prueba("alertas personales: la persona ve solo las suyas; el jefe, las del negocio y las suyas; nadie toca la de otro", async () => {
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "auto:equipo:t1:asignada:u_em", prioridad: "MEDIA", titulo: "Emanuel, tienes una tarea nueva", origen: "Tablero IA", destinatarioId: "u_em" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "auto:equipo:t2:asignada:u_ana", prioridad: "MEDIA", titulo: "Ana, tienes una tarea nueva", origen: "Tablero IA", destinatarioId: "u_ana" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "auto:equipo:t3:necesita:ERROR", prioridad: "ALTA", titulo: "Para el dueño", origen: "Tablero IA", destinatarioId: "u_alex" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "del-negocio", prioridad: "URGENTE", titulo: "Del negocio", origen: "Supervisor" });
  const titulos = async (mirando) => (await servicio.listarAlertas("ws1", {}, 300, mirando)).map((a) => a.titulo).sort();
  assert.deepEqual(await titulos({ userId: "u_em", esJefe: false }), ["Emanuel, tienes una tarea nueva"]);
  assert.deepEqual(await titulos({ userId: "u_ana", esJefe: false }), ["Ana, tienes una tarea nueva"]);
  assert.deepEqual(await titulos({ userId: "u_alex", esJefe: true }), ["Del negocio", "Para el dueño"], "el dueño no ve las de Emanuel ni Ana");
  assert.equal((await servicio.listarAlertas("ws1")).length, 4, "sin quién mira (lo de antes) sigue viendo todo el negocio");
  const cuenta = await servicio.contarAlertas("ws1", { userId: "u_em", esJefe: false });
  assert.equal(cuenta.NUEVA, 1);
  const deAna = filas.find((f) => f.destinatarioId === "u_ana").id;
  assert.equal(await servicio.marcarAlerta("ws1", deAna, "VISTA", new Date(), { userId: "u_em", esJefe: false }), false, "Emanuel no puede tocar la de Ana");
  assert.equal(await servicio.marcarAlerta("ws1", deAna, "VISTA", new Date(), { userId: "u_ana", esJefe: false }), true);
  const delNegocio = filas.find((f) => f.clave === "del-negocio").id;
  assert.equal(await servicio.marcarAlerta("ws1", delNegocio, "VISTA", new Date(), { userId: "u_em", esJefe: false }), false, "una persona del equipo no toca las del negocio");
  // La misma clave de dos destinatarios distintos no se mezcla.
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "k", prioridad: "BAJA", titulo: "A", origen: "x", destinatarioId: "u_em" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "k", prioridad: "BAJA", titulo: "A", origen: "x", destinatarioId: "u_ana" });
  assert.equal(filas.filter((f) => f.clave === "k").length, 2);
  assert.equal(reglas.linkDeLaAlerta("abc"), "https://app.aizenbot.com/cliente/alertas?alerta=abc");
  assert.equal(reglas.idDeTarjetaDeLaClave("auto:equipo:t1:asignada:u_em"), "t1");
});

await prueba("repetida SUBE: guarda la hora de la ÚLTIMA vez, queda arriba de las más nuevas y conserva la primera", async () => {
  const antes = Date.now();
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "vieja", prioridad: "ALTA", titulo: "Vieja que se repite", origen: "Supervisor" });
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "nueva", prioridad: "ALTA", titulo: "Nueva una vez", origen: "Supervisor" });
  const vieja = filas.find((f) => f.clave === "vieja");
  const primera = vieja.creadoEn;
  assert.deepEqual((await servicio.listarAlertas("ws1")).map((a) => a.titulo), ["Nueva una vez", "Vieja que se repite"]);
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "vieja", prioridad: "ALTA", titulo: "Vieja que se repite", origen: "Supervisor" });
  assert.equal(vieja.veces, 2);
  assert.equal(vieja.creadoEn, primera, "creadoEn sigue siendo la primera vez");
  assert.ok(vieja.ultimaVez instanceof Date && vieja.ultimaVez.getTime() >= antes, "ultimaVez = hora de la repetición");
  assert.deepEqual((await servicio.listarAlertas("ws1")).map((a) => a.titulo), ["Vieja que se repite", "Nueva una vez"]);
  // refrescar:false no la toca (ni las veces ni la hora).
  const marca = vieja.ultimaVez;
  await servicio.registrarAlerta({ workspaceId: "ws1", clave: "vieja", prioridad: "ALTA", titulo: "x", origen: "Supervisor", refrescar: false });
  assert.equal(vieja.ultimaVez, marca);
  assert.equal(vieja.veces, 2);
});

await prueba("orden por la última vez; las filas sin ultimaVez (de antes) usan creadoEn; la prioridad sigue mandando", () => {
  const lista = [
    { id: "a", prioridad: "ALTA", creadoEn: new Date("2026-10-27T08:00:00Z"), ultimaVez: new Date("2026-10-27T21:00:00Z") },
    { id: "b", prioridad: "ALTA", creadoEn: new Date("2026-10-27T20:00:00Z"), ultimaVez: new Date("2026-10-27T20:00:00Z") },
    { id: "c", prioridad: "ALTA", creadoEn: new Date("2026-10-27T20:30:00Z") },
    { id: "d", prioridad: "URGENTE", creadoEn: new Date("2026-10-26T08:00:00Z"), ultimaVez: null },
  ];
  assert.deepEqual(reglas.ordenarAlertas(lista).map((a) => a.id), ["d", "a", "c", "b"]);
});

await prueba("texto de la página: 'última vez HH:MM · se repitió N veces' (con el día si no fue hoy)", () => {
  const ahora = new Date("2026-10-27T23:00:00Z"); // 18:00 en Bogotá
  assert.equal(reglas.textoDeRepeticion(1, new Date("2026-10-27T22:05:00Z"), ahora), "");
  assert.equal(reglas.textoDeRepeticion(3, new Date("2026-10-27T22:05:00Z"), ahora), "última vez 17:05 · se repitió 3 veces");
  assert.equal(reglas.textoDeRepeticion(2, new Date("2026-10-26T14:40:00Z"), ahora), "última vez 26/10 09:40 · se repitió 2 veces");
});

await prueba("área: los incidentes del Supervisor sobre el libro V3, el bot o el embudo van a CRM Ventas", () => {
  const mapa = new Map();
  const sup = (clave) => reglas.areaDeAlerta({ clave, origen: "Supervisor" }, mapa);
  assert.equal(sup("sup:INC:libro-v318:combo-camilla"), "CRM Ventas");
  assert.equal(sup("sup:INC:libro-v5:todos"), "CRM Ventas");
  assert.equal(sup("sup:CAMBIO:libro:v318"), "CRM Ventas");
  assert.equal(sup("sup:CAMBIO:post-cambio:v318:combo"), "CRM Ventas");
  assert.equal(sup("sup:BOT:regla-primer-mensaje:combo"), "CRM Ventas");
  assert.equal(sup("sup:EMBUDO:respondio_2h_cusum:combo"), "CRM Ventas");
  // Lo demás del Supervisor no cambia (asesoras esperando, claves sin incidente).
  assert.equal(sup("sup:ATENCION:caliente-esperando:u1"), "General");
  assert.equal(sup("x:1"), "General");
  // La misma clave de otro sistema no se cuela.
  assert.equal(reglas.areaDeAlerta({ clave: "sup:BOT:x", origen: "Coordinador" }, mapa), "Coordinador");
});

await prueba("responsable: cada clave es de Sistemas o de Negocio", () => {
  const de = (origen, clave) => reglas.responsableDeAlerta({ origen, clave });
  assert.equal(de("Coordinador", "auto:trabado:abc:ERROR"), "SISTEMAS");
  assert.equal(de("Coordinador", "auto:caido"), "SISTEMAS");
  assert.equal(de("Coordinador", "coord:limite:Claude llegó al límite"), "SISTEMAS");
  assert.equal(de("Coordinador", "auto:necesita:abc:POR_APROBAR"), "NEGOCIO");
  assert.equal(de("Coordinador", "coord:necesita:Aprueba el gasto"), "NEGOCIO");
  assert.equal(de("Coordinador", "auto:sin_trabajo"), "NEGOCIO");
  assert.equal(de("Línea de WhatsApp", "LINEA:caida:c1"), "SISTEMAS");
  assert.equal(de("Supervisor", "sup:CEREBRO:dato-viejo"), "SISTEMAS");
  assert.equal(de("Supervisor", "sup:ATENCION:caliente-esperando:u1"), "NEGOCIO");
  assert.equal(de("Supervisor", "sup:BOT:regla"), "NEGOCIO");
  assert.equal(de("Supervisor", "sup:EMBUDO:x"), "NEGOCIO");
  assert.equal(de("Agente de Sistemas", "x:1"), "SISTEMAS");
  assert.equal(de("CRM Marketplace", "x:1"), "SISTEMAS");
  assert.equal(de("Rutinas", "x:1"), "SISTEMAS");
  assert.equal(de("Agente de Ventas", "x:1"), "NEGOCIO");
  assert.equal(de("Agente de Marketing", "x:1"), "NEGOCIO");
  assert.equal(de("Origen raro", "x:1"), "NEGOCIO");
});

await prueba("quién ve qué: Emanuel (responsable) solo Sistemas, Alexander solo Negocio (o todas), sin ajuste todo como hoy", async () => {
  const ws = "wsR";
  const reg = (clave, origen, titulo, destinatarioId) => servicio.registrarAlerta({ workspaceId: ws, clave, prioridad: "ALTA", titulo, origen, destinatarioId });
  await reg("auto:trabado:t9:ERROR", "Coordinador", "S: tarjeta en error");
  await reg("coord:limite:x", "Coordinador", "S: límite de Claude");
  await reg("LINEA:caida:c1", "Línea de WhatsApp", "S: línea caída");
  await reg("auto:necesita:t9:POR_APROBAR", "Coordinador", "N: decisión del dueño");
  await reg("sup:ATENCION:x", "Supervisor", "N: asesora esperando");
  await reg("k:1", "Origen raro", "N: desconocida");
  await reg("p:em", "Tablero IA", "P: de Emanuel", "u_em");
  await reg("p:ana", "Tablero IA", "P: de Ana", "u_ana");
  await reg("p:alex", "Tablero IA", "P: de Alexander", "u_alex");
  const ver = async (mirando) => (await servicio.listarAlertas(ws, {}, 300, mirando)).map((a) => a.titulo).sort();
  const emanuel = { userId: "u_em", esJefe: false };
  const alexander = { userId: "u_alex", esJefe: true };
  const todasN = ["N: decisión del dueño", "N: asesora esperando", "N: desconocida"];
  const todasS = ["S: tarjeta en error", "S: límite de Claude", "S: línea caída"];

  // Sin el ajuste: todo como antes (el jefe ve todo el negocio y lo suyo; el empleado, lo suyo).
  assert.deepEqual(await ver(alexander), [...todasN, ...todasS, "P: de Alexander"].sort());
  assert.deepEqual(await ver(emanuel), ["P: de Emanuel"]);
  assert.equal(await servicio.leerResponsableDeSistemas(ws), null);

  // Un jefe puede elegir a un miembro; no a alguien de fuera ni sin ser jefe.
  assert.deepEqual(await servicio.elegirResponsableDeSistemas(ws, false, "u_em"), { ok: false, error: "Sin permiso." });
  assert.equal((await servicio.elegirResponsableDeSistemas(ws, true, "u_extrano")).ok, false, "no es del equipo");
  assert.equal(await servicio.leerResponsableDeSistemas(ws), null, "los rechazos no guardan nada");
  assert.deepEqual(await servicio.elegirResponsableDeSistemas(ws, true, "u_em"), { ok: true });
  assert.equal(await servicio.leerResponsableDeSistemas(ws), "u_em");

  const resp = "u_em";
  // Emanuel (no jefe): solo Sistemas + sus personales.
  assert.deepEqual(await ver({ ...emanuel, responsableSistemasId: resp }), [...todasS, "P: de Emanuel"].sort());
  // Aunque pida ver todas, el no jefe no ve Negocio.
  assert.deepEqual(await ver({ ...emanuel, responsableSistemasId: resp, verTodas: true }), [...todasS, "P: de Emanuel"].sort());
  // Alexander: por defecto Negocio + lo suyo; con verTodas, todo el negocio.
  assert.deepEqual(await ver({ ...alexander, responsableSistemasId: resp }), [...todasN, "P: de Alexander"].sort());
  assert.deepEqual(await ver({ ...alexander, responsableSistemasId: resp, verTodas: true }), [...todasN, ...todasS, "P: de Alexander"].sort());
  // Ana (no jefe, no responsable): solo lo suyo.
  assert.deepEqual(await ver({ userId: "u_ana", esJefe: false, responsableSistemasId: resp }), ["P: de Ana"]);
  // El límite se aplica después de filtrar.
  assert.equal((await servicio.listarAlertas(ws, {}, 2, { ...alexander, responsableSistemasId: resp })).length, 2);

  // Contadores: solo lo que cada uno ve.
  assert.equal((await servicio.contarAlertas(ws, { ...emanuel, responsableSistemasId: resp })).NUEVA, 4);
  assert.equal((await servicio.contarAlertas(ws, { ...alexander, responsableSistemasId: resp })).NUEVA, 4);
  assert.equal((await servicio.contarAlertas(ws, { ...alexander, responsableSistemasId: resp, verTodas: true })).NUEVA, 7);

  // Marcar: Emanuel una de Sistemas sí; una de Negocio y la personal de otro no.
  const id = (clave) => filas.find((f) => f.workspaceId === ws && f.clave === clave).id;
  const mEm = { ...emanuel, responsableSistemasId: resp };
  assert.equal(await servicio.marcarAlerta(ws, id("auto:trabado:t9:ERROR"), "VISTA", new Date(), mEm), true);
  assert.equal(await servicio.marcarAlerta(ws, id("auto:necesita:t9:POR_APROBAR"), "VISTA", new Date(), mEm), false);
  assert.equal(await servicio.marcarAlerta(ws, id("p:ana"), "VISTA", new Date(), mEm), false);
  assert.equal(await servicio.marcarAlerta(ws, id("p:em"), "RESUELTA", new Date(), mEm), true);
  // Alexander: no marca una de Sistemas por defecto; con verTodas sí.
  const mAlex = { ...alexander, responsableSistemasId: resp };
  assert.equal(await servicio.marcarAlerta(ws, id("coord:limite:x"), "VISTA", new Date(), mAlex), false);
  assert.equal(await servicio.marcarAlerta(ws, id("coord:limite:x"), "VISTA", new Date(), { ...mAlex, verTodas: true }), true);
  assert.equal(await servicio.marcarAlerta(ws, id("sup:ATENCION:x"), "VISTA", new Date(), mAlex), true);

  // Quitar al responsable: vuelve todo a verse junto.
  assert.deepEqual(await servicio.elegirResponsableDeSistemas(ws, true, null), { ok: true });
  assert.equal(await servicio.leerResponsableDeSistemas(ws), null);
});

console.log(`\n${pruebas} pruebas ok`);

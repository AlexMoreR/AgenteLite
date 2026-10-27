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
  workspaceMember: { findMany: async () => [] },
  alertaInterna: {
    findFirst: async ({ where }) => [...filas].reverse().find((f) => coincide(f, where)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `a${++contador}`, estado: "NUEVA", salioPorWhatsApp: false, veces: 1, creadoEn: new Date(2026, 9, 29, 10, contador), vistaEn: null, resueltaEn: null, detalle: null, ...data };
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
  },
};
const ajustes = new Map();

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

console.log(`\n${pruebas} pruebas ok`);

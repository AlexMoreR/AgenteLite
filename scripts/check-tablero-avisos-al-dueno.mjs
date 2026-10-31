// Pruebas de los avisos de WhatsApp al dueño del Tablero IA (avisos-al-dueno.ts y aviso-del-trabajador.ts) con un
// prisma, una línea de WhatsApp y un "Te toca a ti" FALSOS. Comprueba los 5 casos (mensaje de máximo 3 líneas con
// link), que NO avisa por empezar, terminar ni avanzar, el "uno por problema cada 3 horas", el silencio de
// 9:00 p. m. a 7:00 a. m. (salvo Coordinador caído), el interruptor, la validación del número, la línea Admin
// fija y que sin número no hay error 412. No necesita base ni red.
// Correr: npm run test:tablero-avisos-al-dueno
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const LINEA_ADMIN = "cmt06kiob00lw2hk2mgllstsb";
const estado = {};
const reiniciar = () => {
  Object.assign(estado, {
    ajustes: new Map(),
    lineas: [
      { id: LINEA_ADMIN, workspaceId: "ws1", name: "Admin", purpose: "ADMIN", phoneNumber: "573009990000", isActive: true, evolutionInstanceName: "admin-inst" },
      { id: "ventas1", workspaceId: "ws1", name: "Ventas", purpose: "SALES", phoneNumber: "573008880000", isActive: true, evolutionInstanceName: "ventas-inst" },
    ],
    miembros: [{ role: "AGENT", user: { name: "Marcela", phone: "3017776666" } }],
    latido: new Date("2026-10-26T15:00:00Z").toISOString(),
    enCurso: [],
    enFila: 0,
    esperando: [],
    fueraPorLaVia: [],
    historial: new Map(),
    enviados: [],
    alertas: [],
    fallaElEnvio: false,
    // Un solo sí (30-oct-2026): las tarjetas cuya tarea aprobó el dueño (pantalla o voz, cuenta dueña).
    tareasDelDueno: new Set(),
    // Las tarjetas que comprueba el aviso del Coordinador con tarjetaId.
    tarjetas: [
      { id: "tarj1", workspaceId: "ws1", titulo: "Tarjeta uno", estado: "POR_APROBAR", borradoEn: null },
      { id: "borrada1", workspaceId: "ws1", borradoEn: new Date("2026-10-29T00:00:00Z") },
      { id: "ajena1", workspaceId: "ws2", borradoEn: null },
    ],
  });
};
reiniciar();

const coincideLinea = (l, where) =>
  l.workspaceId === where.workspaceId &&
  (where.id === undefined || l.id === where.id) &&
  (where.isActive === undefined || l.isActive === where.isActive) &&
  (!where.evolutionInstanceName || l.evolutionInstanceName) &&
  (!where.name || l.name.toLowerCase() === where.name.equals.toLowerCase());

// Las tarjetas que existen en la base: las de la lista y las que el falso devuelve en curso, esperando o aprobadas.
const todasLasTarjetas = () => [
  ...estado.tarjetas,
  ...[...estado.enCurso, ...estado.esperando, ...estado.fueraPorLaVia].map((t) => ({ workspaceId: "ws1", borradoEn: null, ...t })),
];

const falso = {
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  whatsAppChannel: {
    findMany: async ({ where }) => estado.lineas.filter((l) => l.workspaceId === where.workspaceId),
    findFirst: async ({ where }) => estado.lineas.find((l) => coincideLinea(l, where)) ?? null,
  },
  workspaceMember: { findMany: async () => estado.miembros },
  tarjetaTablero: {
    // Como Prisma: con `repo: { not: null }` quedan fuera las tarjetas sin repo (tareas humanas). Sin decir repo, es de aizencrm.
    // El barrido y la limpieza única (31-oct-2026) buscan por id o por título, incluidas las borradas.
    findMany: async ({ where } = {}) =>
      where?.id?.in || where?.titulo?.in
        ? todasLasTarjetas().filter((t) => t.workspaceId === where.tablero?.workspaceId && (where.id?.in ?? [t.id]).includes(t.id) && (where.titulo?.in ?? [t.titulo]).includes(t.titulo))
        : estado.enCurso
        .map((t) => ({ repo: "aizencrm", ...t, trabajoIniciadoEn: null, creadoEn: new Date("2026-10-26T00:00:00Z") }))
        .filter((t) => !(where?.repo && "not" in where.repo && where.repo.not === null) || t.repo !== null),
    count: async () => estado.enFila,
    // El aviso con tarjetaId (30-oct-2026): solo cuenta la tarjeta del mismo negocio y no borrada.
    findFirst: async ({ where }) =>
      estado.tarjetas.find((t) => t.id === where.id && (where.borradoEn !== null || !t.borradoEn) && t.workspaceId === where.tablero?.workspaceId) ?? null,
  },
  historialTarjeta: {
    groupBy: async () => [...estado.historial].map(([tarjetaId, creadoEn]) => ({ tarjetaId, _max: { creadoEn } })),
  },
  // Página de Alertas (29-oct-2026): una alerta abierta por clave.
  alertaInterna: {
    findFirst: async ({ where }) => estado.alertas.find((a) => a.workspaceId === where.workspaceId && a.clave === where.clave && ["NUEVA", "VISTA"].includes(a.estado)) ?? null,
    create: async ({ data }) => {
      const fila = { id: `al${estado.alertas.length + 1}`, estado: "NUEVA", salioPorWhatsApp: false, veces: 1, ...data };
      estado.alertas.push(fila);
      return { id: fila.id };
    },
    update: async ({ where, data }) => {
      const fila = estado.alertas.find((a) => a.id === where.id);
      for (const [k, v] of Object.entries(data)) fila[k] = v && typeof v === "object" && "increment" in v ? fila[k] + v.increment : v;
      return fila;
    },
    // Por id (cierre, condicionado a que siga abierta) o por clave (la marca del WhatsApp).
    updateMany: async ({ where, data }) => {
      const filas = where.id
        ? estado.alertas.filter((x) => x.id === where.id && where.estado.in.includes(x.estado))
        : estado.alertas.filter((x) => x.workspaceId === where.workspaceId && x.clave === where.clave);
      for (const a of filas) Object.assign(a, data);
      return { count: filas.length };
    },
    findMany: async ({ where }) => {
      const prefijos = where.OR ? where.OR.map((o) => o.clave.startsWith) : [where.clave.startsWith];
      return estado.alertas.filter((a) => a.workspaceId === where.workspaceId && where.estado.in.includes(a.estado) && prefijos.some((p) => a.clave.startsWith(p)));
    },
  },
  tableroInteligente: { findMany: async () => [{ workspaceId: "ws1" }] },
  // SQL_FUERA_POR_LA_VIA (28-oct-2026): las aprobadas que esperan la pantalla.
  $queryRawUnsafe: async () => estado.fueraPorLaVia,
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: {} },
  "@/lib/evolution": {
    sendEvolutionTextMessageWithReconnect: async (datos) => {
      if (estado.fallaElEnvio) throw new Error("línea caída");
      estado.enviados.push(datos);
    },
  },
  "./aprobacion-automatica": { tareaAprobadaPorElDueno: async (id) => estado.tareasDelDueno.has(id) },
  "./coordinador-en-vivo": { ultimoLatido: async () => (estado.latido ? { recibidoEn: estado.latido } : null) },
  "./tableros": {
    pendientesDelDueno: async () => estado.esperando,
    todoElNegocio: (workspaceId) => ({ workspaceId, soloDe: null }),
    linkDeHoy: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=hoy",
    linkDelCoordinador: () => "https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador",
    linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}`,
  },
};

const avisos = cargar("src/features/tableros-inteligentes/services/avisos-al-dueno.ts", mocks);
const servicioDeAlertas = cargar("src/features/alertas/servicios/alertas.ts", mocks);
const reglasDeAlertas = cargar("src/features/alertas/dominio/reglas.ts", mocks);
const deltrabajador = cargar("src/features/tableros-inteligentes/services/aviso-del-trabajador.ts", {
  ...mocks,
  "./trabajador": { ErrorDelTrabajador: class extends Error { constructor(m, status) { super(m); this.status = status; } } },
});

let pruebas = 0;
async function prueba(nombre, fn) {
  reiniciar();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

// 10:00 a. m. de Bogotá (15:00Z) y 11:00 p. m. (04:00Z del día siguiente).
const DIA = new Date("2026-10-26T15:00:00Z");
const NOCHE = new Date("2026-10-27T04:00:00Z");
const hace = (ms, desde = DIA) => new Date(desde.getTime() - ms);
const HORA = 3_600_000;
const guardarNumero = () => estado.ajustes.set("tablero:avisos-dueno:telefono:ws1", "573001112233");
const esperando = (extra = {}) => ({ id: "e1", titulo: "Mejorar la pantalla de chats", detalle: "", estado: "PLAN_LISTO", plan: null, zonaProtegida: [], resultado: null, ...extra });
const lineas = (texto) => texto.split("\n");

/* ------------------------------------------------------------------ el número */

await prueba("el número: solo dígitos con indicativo; 10 dígitos de Colombia llevan el 57", async () => {
  assert.equal(avisos.normalizarTelefono("300 123 4567"), "573001234567");
  assert.equal(avisos.normalizarTelefono("+57 (300) 123-4567"), "573001234567");
  assert.equal(avisos.normalizarTelefono("12345"), null);
  assert.equal(avisos.normalizarTelefono(""), null);
});

await prueba("el número: se rechaza el de una asesora, el de una línea del negocio y los que no sirven", async () => {
  assert.equal((await avisos.validarTelefonoDelDueno("ws1", "301 777 6666")).ok, false, "una asesora");
  assert.equal((await avisos.validarTelefonoDelDueno("ws1", "573009990000")).ok, false, "la línea Admin");
  assert.equal((await avisos.validarTelefonoDelDueno("ws1", "573008880000")).ok, false, "una línea de ventas");
  assert.equal((await avisos.validarTelefonoDelDueno("ws1", "abc")).ok, false);
  assert.deepEqual(await avisos.validarTelefonoDelDueno("ws1", "3001112233"), { ok: true, numero: "573001112233" });
  const guardado = await avisos.guardarConfigDeAvisos("ws1", { telefono: "3017776666" });
  assert.equal(guardado.ok, false);
  assert.equal(estado.ajustes.has("tablero:avisos-dueno:telefono:ws1"), false, "no guardó el número rechazado");
  assert.deepEqual(await avisos.guardarConfigDeAvisos("ws1", { telefono: "300 111 2233" }), { ok: true });
  assert.equal(estado.ajustes.get("tablero:avisos-dueno:telefono:ws1"), "573001112233");
});

/* ------------------------------------------------------------------ los 5 casos */

await prueba("1. Coordinador caído: más de 10 minutos sin señales avisa; 10 minutos o menos, no; nunca ha dado señales, no", async () => {
  const situacion = (latidoEn) => ({ latidoEn, enCurso: [], enFila: 0, esperando: [] });
  const caido = avisos.calcularAvisos(situacion(hace(11 * 60_000).toISOString()), DIA);
  assert.deepEqual(caido.map((a) => a.tipo), ["caido"]);
  const mensaje = avisos.armarMensaje(caido);
  assert.ok(lineas(mensaje).length <= 3, mensaje);
  assert.match(mensaje, /no da señales hace 11 min/);
  assert.match(mensaje, /Ver: https:\/\/app\.aizenbot\.com\/cliente\/tablero-ia\?vista=coordinador$/);
  assert.deepEqual(avisos.calcularAvisos(situacion(hace(10 * 60_000).toISOString()), DIA), []);
  assert.deepEqual(avisos.calcularAvisos(situacion(null), DIA), []);
});

await prueba("4. Un resultado POR_REVISAR solo avisa por un envío nuevo o gasto en Meta Ads; si solo faltaba la prueba extra, no (27-oct)", async () => {
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 1 };
  const porRevisar = (esperaPor) => esperando({ id: "r1", titulo: "Buscador de la bandeja", estado: "POR_REVISAR", zonaProtegida: ["CHATS"], esperaPor });
  assert.equal(avisos.porQueNecesitaAlDueno(porRevisar("falta la prueba de que los chats no mandan mensajes nuevos a clientes")), null);
  assert.equal(avisos.porQueNecesitaAlDueno(porRevisar(null)), null);
  assert.match(avisos.porQueNecesitaAlDueno(porRevisar("el cambio agrega un envío de mensaje en chats")), /envío de mensaje/);
  assert.equal(avisos.calcularAvisos({ ...base, esperando: [porRevisar("falta la prueba de que los chats no mandan mensajes nuevos a clientes")] }, DIA).length, 0);
  assert.equal(avisos.calcularAvisos({ ...base, esperando: [porRevisar("el cambio agrega un envío de mensaje en chats")] }, DIA).filter((a) => a.tipo === "necesita").length, 1);
});

await prueba("2. Sin trabajo: nada en curso ni en fila y hay tarjetas esperando; dice cuáles y qué necesitan", async () => {
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 0 };
  const dos = [esperando({ id: "a", titulo: "Mejorar chats", estado: "PLAN_LISTO", plan: "RIESGO: ALTO\nGASTO EN META ADS: sube el presupuesto diario" }), esperando({ id: "b", titulo: "Arreglar el envío", estado: "ERROR", resultado: null, error: "falta la clave de acceso" })];
  const sinTrabajo = avisos.calcularAvisos({ ...base, esperando: dos }, DIA).filter((a) => a.tipo === "sin_trabajo");
  assert.equal(sinTrabajo.length, 1);
  const mensaje = avisos.armarMensaje(sinTrabajo);
  assert.ok(lineas(mensaje).length <= 3, mensaje);
  assert.match(mensaje, /sin trabajo/);
  assert.match(mensaje, /"Mejorar chats" \(aprobar el plan\), "Arreglar el envío" \(ver el error\)/);
  assert.match(mensaje, /Ver: https:\/\/app\.aizenbot\.com\/cliente\/tablero-ia\?vista=hoy$/);
  // Con algo en curso, algo en fila o sin tarjetas esperando, no avisa.
  const activa = [{ id: "x", titulo: "X", estado: "EN_CURSO", desde: hace(10 * 60_000) }];
  assert.equal(avisos.calcularAvisos({ ...base, enCurso: activa, esperando: dos }, DIA).some((a) => a.tipo === "sin_trabajo"), false);
  assert.equal(avisos.calcularAvisos({ ...base, enFila: 1, esperando: dos }, DIA).some((a) => a.tipo === "sin_trabajo"), false);
  assert.equal(avisos.calcularAvisos({ ...base, esperando: [] }, DIA).length, 0);
});

await prueba("3. Trabado: más de 2 horas en el mismo estado, o ERROR con la causa en una línea", async () => {
  const base = { latidoEn: DIA.toISOString(), enFila: 0, esperando: [] };
  const trabada = (horas) => [{ id: "t1", titulo: "Construir el panel", estado: "EN_CURSO", desde: hace(horas * HORA) }];
  assert.deepEqual(avisos.calcularAvisos({ ...base, enCurso: trabada(1.9) }, DIA), []);
  const dos = avisos.calcularAvisos({ ...base, enCurso: trabada(2.1) }, DIA);
  assert.deepEqual(dos.map((a) => a.tipo), ["trabado"]);
  const mensaje = avisos.armarMensaje(dos);
  assert.ok(lineas(mensaje).length <= 3, mensaje);
  assert.match(mensaje, /"Construir el panel" lleva 2 h construyendo sin avanzar/);
  assert.match(mensaje, /Ver: https:\/\/app\.aizenbot\.com\/cliente\/tablero-ia\?tarjeta=t1$/);
  // ERROR: dice la causa, aunque el CRM tenga otras tarjetas en curso.
  const error = avisos.calcularAvisos(
    { ...base, enCurso: [{ id: "z", titulo: "Z", estado: "EN_CURSO", desde: hace(HORA) }], esperando: [esperando({ id: "e9", titulo: "Pagos", estado: "ERROR", error: "Falló el build:\n  tipos rotos en  tableros.ts" })] },
    DIA,
  );
  assert.deepEqual(error.map((a) => a.tipo), ["trabado"]);
  assert.match(avisos.armarMensaje(error), /quedó en error[^\n]*\nCausa: Falló el build: tipos rotos en tableros\.ts\nVer: /);
});

await prueba("4. Necesita al dueño: Meta Ads, dinero o presupuesto, o un error que pide clave o permiso", async () => {
  const base = { latidoEn: DIA.toISOString(), enCurso: [{ id: "x", titulo: "X", estado: "EN_CURSO", desde: hace(HORA) }], enFila: 0 };
  const necesita = (tarjeta) => avisos.calcularAvisos({ ...base, esperando: [esperando(tarjeta)] }, DIA).filter((a) => a.tipo === "necesita");
  const meta = necesita({ estado: "POR_REVISAR", zonaProtegida: ["META_ADS"] });
  assert.equal(meta.length, 1);
  assert.match(avisos.armarMensaje(meta), /necesita tu decisión \(revisar el resultado\)\.\nMotivo: toca Meta Ads\nVer: /);
  assert.equal(necesita({ estado: "PLAN_LISTO", plan: "Subir el presupuesto de la campaña de Meta Ads." }).length, 1);
  assert.equal(necesita({ estado: "POR_APROBAR", titulo: "Calcular las comisiones y el nómina", detalle: "pagos del mes" }).length, 1);
  const clave = necesita({ estado: "ERROR", error: "Falta la clave de la API de Meta: 403 sin permiso" });
  assert.equal(clave.length, 1);
  assert.match(avisos.armarMensaje(clave), /falta una clave, un acceso o un permiso/);
  // Una tarjeta común que espera su sí no es "necesita" (eso se ve en el tablero).
  assert.equal(necesita({ estado: "PLAN_LISTO", plan: "Cambiar el color del botón.\n\nCRITERIOS DE ACEPTACIÓN\n- El botón se ve azul en el celular." }).length, 0);
  assert.equal(necesita({ estado: "ERROR", error: "falló una prueba" }).length, 0);
});

await prueba("5. Límite de Claude: lo manda el Coordinador con tipo 'limite' o 'necesita'; sin tipo o con otro se descarta sin error", async () => {
  guardarNumero();
  const contexto = { workspaceId: "ws1" };
  const texto = "⛔ Claude llegó a su límite de uso: Sistemas quedó en pausa.\nVuelve a trabajar solo a las 3:20 p. m.\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=coordinador";
  assert.deepEqual(await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto }, DIA), { descartado: true });
  assert.deepEqual(await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto, tipo: "umbral" }, DIA), { descartado: true });
  assert.equal(estado.enviados.length, 0, "el aviso del umbral o sin tipo no sale");
  const salio = await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto, tipo: "limite" }, DIA);
  assert.equal(salio.salio, true);
  assert.equal(estado.enviados.length, 1);
  // Alertas (29-oct-2026): el límite es Urgente y sale corto: 2 líneas (título + link a la página de alertas).
  assert.equal(estado.enviados[0].text, "🚨 Urgente: Claude llegó a su límite de uso: Sistemas quedó en pausa.\nVer: https://app.aizenbot.com/cliente/alertas");
  assert.equal(estado.enviados[0].phoneNumber, "573001112233");
  assert.equal(estado.alertas.length, 1, "queda en la página");
  assert.equal(estado.alertas[0].prioridad, "URGENTE");
  assert.equal(estado.alertas[0].origen, "Coordinador");
  assert.equal(estado.alertas[0].detalle, texto, "el texto completo, en la página");
  // El mismo aviso otra vez (pasado el minuto) no se repite antes de 3 horas; después sí.
  const luego = new Date(DIA.getTime() + 5 * 60_000);
  assert.deepEqual(await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto, tipo: "limite" }, luego), { repetido: true });
  const mas = new Date(DIA.getTime() + 3 * HORA + 60_000);
  assert.equal((await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto, tipo: "limite" }, mas)).salio, true);
  assert.equal(estado.enviados.length, 2);
});

await prueba("cupos sin usar (31-oct): el tipo 'cupos' pasa, clave fija, ALTA, sale SOLO a Emanuel aunque esté 'solo urgentes'; sin su WhatsApp no va al dueño", async () => {
  guardarNumero();
  const texto = '⚠️ Cupos sin usar: 3 en fila y 1 de 4 corriendo hace 12 min.\n"Arreglar X" espera un puesto en la nube.';
  assert.equal(avisos.TIPOS_DEL_COORDINADOR.includes("cupos"), true);
  assert.equal(avisos.esAvisoTecnico("cupos"), true);
  assert.equal(avisos.prioridadDelAviso("cupos"), "ALTA");
  assert.equal(avisos.claveDelAvisoDelCoordinador("cupos", texto), "coord:cupos");
  assert.equal(avisos.claveDelAvisoDelCoordinador("cupos", "otro texto", "tarj1"), "coord:cupos", "el texto cambia cada minuto: la clave no");
  // Sin el WhatsApp de Sistemas: queda solo en la página y no sale al dueño.
  const sinEmanuel = await avisos.registrarAvisoDelCoordinador("ws1", "cupos", texto, DIA);
  assert.equal(sinEmanuel.salio, false);
  assert.match(sinEmanuel.motivo, /Emanuel no tiene el WhatsApp de Sistemas/);
  assert.equal(estado.enviados.length, 0, "nunca al dueño");
  assert.equal(estado.alertas.length, 1);
  assert.equal(estado.alertas[0].clave, "coord:cupos");
  assert.equal(estado.alertas[0].prioridad, "ALTA");
  // Con el WhatsApp de Emanuel ("solo urgentes" prendido por defecto): sale a él, con el texto completo.
  reiniciar();
  guardarNumero();
  assert.deepEqual(await avisos.guardarConfigDeSistemas("ws1", { telefono: "573114445566" }), { ok: true });
  const contexto = { workspaceId: "ws1" };
  const tarde = new Date(DIA.getTime() + 6 * HORA + 17 * 60_000);
  const salio = await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto, tipo: "cupos" }, tarde);
  assert.equal(salio.salio, true);
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].phoneNumber, "573114445566", "a Emanuel, no al dueño");
  assert.equal(estado.enviados[0].text, texto);
  // Otro texto ("hace 13 min") no es otro aviso: no se repite antes de 3 horas.
  const otro = texto.replace("12 min", "13 min");
  assert.deepEqual(await avisos.registrarAvisoDelCoordinador("ws1", "cupos", otro, new Date(tarde.getTime() + 60_000)), { repetido: true });
  // De noche, silencio.
  assert.deepEqual(await avisos.registrarAvisoDelCoordinador("ws1", "cupos", texto, NOCHE), { silenciado: true });
  // Con el interruptor de Sistemas apagado: tampoco va al dueño.
  reiniciar();
  guardarNumero();
  await avisos.guardarConfigDeSistemas("ws1", { telefono: "573114445566", activo: false });
  assert.equal((await avisos.registrarAvisoDelCoordinador("ws1", "cupos", texto, DIA)).salio, false);
  assert.equal(estado.enviados.length, 0);
  // Y con el interruptor general apagado, nada.
  await avisos.guardarConfigDeAvisos("ws1", { activo: false });
  assert.deepEqual(await avisos.registrarAvisoDelCoordinador("ws1", "cupos", texto, DIA), { apagado: true });
});

/* ------------------------------------------------------------------ las alertas: prioridad y página */

await prueba("alertas: caído y límite son Urgente; trabado y sin trabajo, Alta; necesita es Urgente por dinero, Meta Ads, una clave o una duda de negocio", async () => {
  assert.equal(avisos.prioridadDelAviso("caido"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("limite"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("trabado"), "ALTA");
  assert.equal(avisos.prioridadDelAviso("sin_trabajo"), "ALTA");
  assert.equal(avisos.prioridadDelAviso("necesita", "toca Meta Ads"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "falta una clave, un acceso o un permiso"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "mueve dinero del presupuesto"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "el cambio agrega un envío de mensaje en chats"), "ALTA");
  // Un solo sí (30-oct-2026): las dudas de negocio también son Urgente, para que lleguen por WhatsApp.
  assert.equal(avisos.prioridadDelAviso("necesita", "el plan tiene preguntas abiertas: ¿los abonos se muestran con IVA?"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "el trabajador dice que espera tu sí: el agente necesita decisión: elegir el color"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "el agente necesita algo del dueño: decisión sobre el texto del botón"), "URGENTE");
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 1 }; // con fila no es "sin trabajo"
  const meta = avisos.calcularAvisos({ ...base, esperando: [esperando({ estado: "POR_REVISAR", zonaProtegida: ["META_ADS"] })] }, DIA).find((a) => a.tipo === "necesita");
  assert.equal(meta.prioridad, "URGENTE");
  const chats = avisos.calcularAvisos({ ...base, esperando: [esperando({ estado: "POR_REVISAR", resultado: null, esperaPor: "el cambio agrega un envío de mensaje en chats" })] }, DIA).find((a) => a.tipo === "necesita");
  assert.equal(chats.prioridad, "ALTA");
});

await prueba("alertas: de lo que se calcula, todo queda en la página y por WhatsApp sale solo lo urgente, en 2 líneas con el link", async () => {
  guardarNumero();
  // Coordinador caído (urgente) + una tarjeta trabada (alta) en la misma vuelta.
  estado.latido = hace(30 * 60_000).toISOString();
  estado.enCurso = [{ id: "c9", titulo: "Una trabada", estado: "EN_CURSO" }];
  estado.historial.set("c9", hace(5 * HORA));
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].text, "🚨 Urgente: Sistemas detenido: el Coordinador no da señales hace 30 min\nVer: https://app.aizenbot.com/cliente/alertas");
  assert.deepEqual(estado.alertas.map((a) => a.prioridad).sort(), ["URGENTE"], "con el Coordinador caído la trabada no se avisa");
  // Ya vuelto el Coordinador, la trabada se guarda (Alta) y no sale; y no se repite cada minuto.
  estado.latido = DIA.toISOString();
  const luego = new Date(DIA.getTime() + 60_000);
  estado.latido = luego.toISOString();
  assert.deepEqual(await avisos.revisarAvisosAlDueno(luego), { enviados: 0 });
  assert.deepEqual(await avisos.revisarAvisosAlDueno(new Date(luego.getTime() + 60_000)), { enviados: 0 });
  assert.deepEqual(estado.alertas.map((a) => a.prioridad).sort(), ["ALTA", "URGENTE"]);
  assert.equal(estado.alertas.find((a) => a.prioridad === "ALTA").veces, 1, "no suma una vez por minuto");
  assert.equal(estado.alertas.find((a) => a.prioridad === "URGENTE").salioPorWhatsApp, true);
});

await prueba("aprobada por voz con LIBRO_V3 / META_ADS (28-oct): una alerta Alta del Coordinador por tarjeta, con el link; CHATS por voz no", async () => {
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 2, esperando: [] };
  const fuera = [
    { id: "t1", titulo: "Arreglar el libro", estado: "APROBADO", zonaProtegida: ["LIBRO_V3"], via: "voz" },
    { id: "t2", titulo: "Campaña nueva", estado: "PLAN_APROBADO", zonaProtegida: ["CHATS", "META_ADS"], via: "voz" },
    // Ya no espera (voz + CHATS): no avisa aunque llegara.
    { id: "t3", titulo: "Chats", estado: "APROBADO", zonaProtegida: ["CHATS"], via: "voz" },
  ];
  const calculados = avisos.calcularAvisos({ ...base, fueraPorLaVia: fuera }, DIA).filter((a) => a.tipo === "aprobar_en_pantalla");
  assert.deepEqual(calculados.map((a) => [a.clave, a.prioridad, a.link]), [
    ["auto:necesita:t1:VIA_PANTALLA", "ALTA", "https://app.aizenbot.com/cliente/tablero-ia?tarjeta=t1"],
    ["auto:necesita:t2:VIA_PANTALLA", "ALTA", "https://app.aizenbot.com/cliente/tablero-ia?tarjeta=t2"],
  ]);
  assert.equal(calculados[0].titulo, "«Arreglar el libro» está aprobada por voz pero toca Libro V3: apruébala en pantalla para que arranque");
  assert.match(calculados[1].titulo, /toca Meta Ads: apruébala en pantalla/);
  assert.deepEqual(avisos.calcularAvisos(base, DIA), [], "sin la lista, nada");

  // De punta a punta: queda en la página (origen Coordinador), una sola por tarjeta aunque pasen vueltas, y no sale por WhatsApp.
  reiniciar();
  guardarNumero();
  estado.enFila = 1;
  estado.fueraPorLaVia = [fuera[0]];
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.deepEqual(await avisos.revisarAvisosAlDueno(new Date(DIA.getTime() + 60_000)), { enviados: 0 });
  const delLibro = estado.alertas.filter((a) => a.clave === "auto:necesita:t1:VIA_PANTALLA");
  assert.equal(delLibro.length, 1);
  assert.equal(delLibro[0].prioridad, "ALTA");
  assert.equal(delLibro[0].origen, "Coordinador");
  assert.equal(delLibro[0].veces, 1);
  assert.equal(estado.enviados.length, 0);
  reiniciar();
});

await prueba("SUBIENDO pendiente por voz con LIBRO_V3 (31-oct): UN aviso aprobar_en_pantalla con su link; la misma clave que en PLAN_APROBADO", async () => {
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 0, esperando: [] };
  const sube = { id: "s1", titulo: "Seguimientos que escuchan al cliente", estado: "SUBIENDO", zonaProtegida: ["LIBRO_V3"], via: "voz" };
  const calculados = avisos.calcularAvisos({ ...base, fueraPorLaVia: [sube] }, DIA).filter((a) => a.tipo === "aprobar_en_pantalla");
  assert.equal(calculados.length, 1, "un solo aviso");
  assert.deepEqual(
    [calculados[0].clave, calculados[0].prioridad, calculados[0].link],
    ["auto:necesita:s1:VIA_PANTALLA", "ALTA", "https://app.aizenbot.com/cliente/tablero-ia?tarjeta=s1"],
  );
  assert.match(calculados[0].titulo, /toca Libro V3: apruébala en pantalla para que arranque/);
  const antes = avisos.calcularAvisos({ ...base, fueraPorLaVia: [{ ...sube, estado: "PLAN_APROBADO" }] }, DIA).filter((a) => a.tipo === "aprobar_en_pantalla");
  assert.deepEqual(antes.map((a) => a.clave), [calculados[0].clave], "al pasar de PLAN_APROBADO a SUBIENDO no avisa dos veces");
});

/* ------------------------------------------------------------------ las reglas de todos los avisos */

await prueba("revisión: un solo aviso por problema; vuelve a avisar solo si sigue igual después de 3 horas", async () => {
  guardarNumero();
  estado.latido = hace(20 * 60_000).toISOString();
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
  assert.equal(estado.enviados.length, 1);
  assert.ok(lineas(estado.enviados[0].text).length <= 3);
  assert.deepEqual(await avisos.revisarAvisosAlDueno(new Date(DIA.getTime() + 60_000)), { enviados: 0 });
  assert.deepEqual(await avisos.revisarAvisosAlDueno(new Date(DIA.getTime() + 2.9 * HORA)), { enviados: 0 });
  assert.equal(estado.enviados.length, 1, "no repite antes de 3 horas");
  // 3 horas después sigue igual (aunque el latido se quede viejo): avisa otra vez.
  assert.deepEqual(await avisos.revisarAvisosAlDueno(new Date(DIA.getTime() + 3.1 * HORA)), { enviados: 1 });
  assert.equal(estado.enviados.length, 2);
});

await prueba("revisión: si el problema se arregla y vuelve, avisa de nuevo sin esperar las 3 horas", async () => {
  guardarNumero();
  estado.latido = hace(20 * 60_000).toISOString();
  await avisos.revisarAvisosAlDueno(DIA);
  const despues = new Date(DIA.getTime() + 10 * 60_000);
  estado.latido = despues.toISOString();
  await avisos.revisarAvisosAlDueno(despues);
  const otraVez = new Date(DIA.getTime() + 40 * 60_000);
  assert.deepEqual(await avisos.revisarAvisosAlDueno(otraVez), { enviados: 1 });
  assert.equal(estado.enviados.length, 2);
});

await prueba("revisión: nada de avisos por empezar, terminar o avanzar (todo normal = silencio)", async () => {
  guardarNumero();
  estado.enCurso = [{ id: "c1", titulo: "Una tarea que avanza", estado: "EN_CURSO" }];
  estado.historial.set("c1", hace(20 * 60_000));
  estado.enFila = 2;
  estado.esperando = [esperando({ estado: "PLAN_LISTO", plan: "Cambiar el color del botón." })];
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
});

await prueba("revisión: el latido no cuenta como avance (se mide con el historial del estado)", async () => {
  guardarNumero();
  estado.enCurso = [{ id: "c1", titulo: "Una tarea vieja", estado: "SUBIENDO" }];
  estado.historial.set("c1", hace(2.5 * HORA));
  // Alertas (29-oct-2026): "trabado" es Alta: queda en la página y ya no sale por WhatsApp.
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.alertas.length, 1);
  assert.equal(estado.alertas[0].prioridad, "ALTA");
  assert.match(estado.alertas[0].titulo, /"Una tarea vieja" lleva 2 h sin avanzar/);
  assert.match(estado.alertas[0].detalle, /lleva 2 h subiendo sin avanzar/);
  // Con el interruptor de alertas apagado vuelve lo de antes: sale por WhatsApp, completo.
  estado.ajustes.set("alertas:solo-urgentes:ws1", "false");
  estado.ajustes.delete("tablero:avisos-dueno:estado:ws1");
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
  assert.match(estado.enviados[0].text, /"Una tarea vieja" lleva 2 h subiendo sin avanzar/);
  assert.equal(estado.alertas.length, 1, "la misma alerta abierta no se duplica");
});

await prueba("revisión: una tarjeta SIN repo (tarea humana) en EN_CURSO hace 3 h no avisa 'trabado'", async () => {
  guardarNumero();
  estado.enCurso = [{ id: "h1", titulo: "Revisar mejoras del Agente SEO", estado: "EN_CURSO", repo: null }];
  estado.historial.set("h1", hace(3 * HORA));
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
  // La misma tarjeta con repo (la ejecuta el Coordinador) sí avisa.
  estado.enCurso = [{ id: "h1", titulo: "Revisar mejoras del Agente SEO", estado: "EN_CURSO", repo: "aizencrm" }];
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 }, "trabado es Alta: solo en la página");
  assert.equal(estado.alertas.length, 1);
  estado.ajustes.set("alertas:solo-urgentes:ws1", "false");
  estado.ajustes.delete("tablero:avisos-dueno:estado:ws1");
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
  assert.match(estado.enviados[0].text, /lleva 3 h construyendo sin avanzar/);
});

await prueba("silencio: de 9:00 p. m. a 7:00 a. m. no sale nada, salvo Coordinador caído; a las 7 a. m. sale lo que siga igual", async () => {
  guardarNumero();
  estado.ajustes.set("alertas:solo-urgentes:ws1", "false"); // el silencio es el mismo con o sin "solo urgentes"; "trabado" solo sale por WhatsApp apagado
  estado.enCurso = [{ id: "c1", titulo: "Trabada", estado: "EN_CURSO" }];
  estado.historial.set("c1", hace(5 * HORA, NOCHE));
  estado.latido = NOCHE.toISOString();
  assert.deepEqual(await avisos.revisarAvisosAlDueno(NOCHE), { enviados: 0 }, "de noche una tarjeta trabada espera");
  assert.equal(estado.enviados.length, 0);
  // Caído de noche: sí avisa (y solo ese).
  estado.latido = hace(30 * 60_000, NOCHE).toISOString();
  assert.deepEqual(await avisos.revisarAvisosAlDueno(NOCHE), { enviados: 1 });
  assert.match(estado.enviados[0].text, /no da señales/);
  assert.doesNotMatch(estado.enviados[0].text, /Trabada/);
  // A las 7:00 a. m. (12:00Z) sale lo trabado, que sigue igual.
  const manana = new Date("2026-10-27T12:00:00Z");
  estado.latido = manana.toISOString();
  estado.historial.set("c1", hace(5 * HORA, NOCHE));
  assert.deepEqual(await avisos.revisarAvisosAlDueno(manana), { enviados: 1 });
  assert.match(estado.enviados.at(-1).text, /"Trabada" lleva \d+ h construyendo sin avanzar/);
  assert.equal(avisos.enSilencioDeAvisos(new Date("2026-10-27T01:59:00Z")), false, "8:59 p. m.");
  assert.equal(avisos.enSilencioDeAvisos(new Date("2026-10-27T02:00:00Z")), true, "9:00 p. m.");
  assert.equal(avisos.enSilencioDeAvisos(new Date("2026-10-27T11:59:00Z")), true, "6:59 a. m.");
  assert.equal(avisos.enSilencioDeAvisos(new Date("2026-10-27T12:00:00Z")), false, "7:00 a. m.");
});

await prueba("del Coordinador: de noche contesta silenciado y no manda; con el interruptor apagado tampoco", async () => {
  guardarNumero();
  const contexto = { workspaceId: "ws1" };
  assert.deepEqual(await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto: "a\nb\nc\nd", tipo: "limite" }, NOCHE), { silenciado: true });
  assert.equal(estado.enviados.length, 0);
  await avisos.guardarConfigDeAvisos("ws1", { activo: false });
  assert.deepEqual(await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto: "x", tipo: "limite" }, new Date("2026-10-28T15:00:00Z")), { apagado: true });
  assert.equal(estado.enviados.length, 0);
  assert.equal(deltrabajador.textoDeAvisoDeEntrada("1\n2\n3\n4\n5"), "1\n2\n3", "máximo 3 líneas");
});

await prueba("interruptor: empieza prendido; apagado no sale nada ni de la revisión; la prueba sí sale", async () => {
  guardarNumero();
  assert.equal(await avisos.avisosPrendidos("ws1"), true, "sin ajuste: prendido");
  estado.latido = hace(60 * 60_000).toISOString();
  await avisos.guardarConfigDeAvisos("ws1", { activo: false });
  assert.equal(await avisos.avisosPrendidos("ws1"), false);
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
  const prueba = await avisos.mandarPruebaAlDueno("ws1", DIA);
  assert.equal(prueba.salio, true, "el botón Mandar prueba sale aunque esté apagado");
  assert.equal(estado.enviados.length, 1);
  await avisos.guardarConfigDeAvisos("ws1", { activo: true });
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
});

/* ------------------------------------------------------------------ el envío */

await prueba("sale por la línea Admin fija y SOLO al número guardado, nunca por una línea de ventas", async () => {
  guardarNumero();
  await avisos.enviarAlDueno("ws1", "hola");
  assert.equal(estado.enviados[0].instanceName, "admin-inst");
  assert.equal(estado.enviados[0].phoneNumber, "573001112233");
  // Si la línea fija no existe, usa la llamada "Admin"; si tampoco hay, no sale (nunca una de ventas).
  estado.lineas = [
    { id: "otra", workspaceId: "ws1", name: "admin", purpose: "ADMIN", phoneNumber: null, isActive: true, evolutionInstanceName: "admin-por-nombre" },
    estado.lineas[1],
  ];
  await avisos.enviarAlDueno("ws1", "hola");
  assert.equal(estado.enviados[1].instanceName, "admin-por-nombre");
  estado.lineas = [estado.lineas[1]];
  const sinAdmin = await avisos.enviarAlDueno("ws1", "hola");
  assert.equal(sinAdmin.salio, false);
  assert.equal(estado.enviados.length, 2, "no usó la línea de ventas");
});

await prueba("sin número no hay error 412: queda anotado 'falta su número' y se ve en la caja", async () => {
  estado.latido = hace(60 * 60_000).toISOString();
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.equal(estado.enviados.length, 0);
  const desdeCaja = await avisos.avisosParaLaPantalla("ws1");
  assert.equal(desdeCaja.telefono, null);
  assert.equal(desdeCaja.ultimos[0].salio, false);
  assert.match(desdeCaja.ultimos[0].motivo, /falta su número en Mi empresa → Claude/);
  // Un fallo seguido no llena la lista: se anota una vez.
  await avisos.revisarAvisosAlDueno(new Date(DIA.getTime() + 60_000));
  assert.equal((await avisos.avisosParaLaPantalla("ws1")).ultimos.length, 1);
  // El aviso del Coordinador tampoco lanza 412: contesta con el motivo.
  const respuesta = await deltrabajador.enviarAvisoDelTrabajador({ workspaceId: "ws1" }, { texto: "x", tipo: "limite" }, new Date("2026-10-29T15:00:00Z"));
  assert.equal(respuesta.salio, false);
  assert.match(respuesta.motivo, /falta su número/);
  // El ajuste viejo (llenado a mano) sirve de respaldo.
  estado.ajustes.set("trabajador:aviso-telefono:ws1", "573001112244");
  assert.equal(await avisos.telefonoGuardado("ws1"), "573001112244");
});

await prueba("si la línea Admin falla, no se da por avisado y se reintenta en la siguiente vuelta", async () => {
  guardarNumero();
  estado.latido = hace(60 * 60_000).toISOString();
  estado.fallaElEnvio = true;
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  estado.fallaElEnvio = false;
  assert.deepEqual(await avisos.revisarAvisosAlDueno(new Date(DIA.getTime() + 60_000)), { enviados: 1 });
  const caja = await avisos.avisosParaLaPantalla("ws1");
  assert.equal(caja.ultimos[0].salio, true);
  assert.match(caja.ultimos[1].motivo, /no salió: la línea Admin no pudo enviar/);
});

await prueba("varios problemas en una vuelta se juntan en UN mensaje de máximo 3 líneas", async () => {
  const dosAvisos = [
    { clave: "a", tipo: "trabado", lineas: ["⚠️ uno", "detalle"], link: "https://x/1" },
    { clave: "b", tipo: "trabado", lineas: ["⚠️ dos", "detalle"], link: "https://x/2" },
    { clave: "c", tipo: "trabado", lineas: ["⚠️ tres", "detalle"], link: "https://x/3" },
  ];
  const dos = avisos.armarMensaje(dosAvisos.slice(0, 2));
  assert.equal(dos, "⚠️ uno\n⚠️ dos\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy");
  const tres = avisos.armarMensaje(dosAvisos);
  assert.equal(lineas(tres).length, 3);
  assert.match(tres, /y 2 avisos más de Sistemas/);
});

await prueba("alertas: un 'necesita' del Coordinador sin dinero, Meta Ads ni clave queda en la página y no sale", async () => {
  guardarNumero();
  const contexto = { workspaceId: "ws1" };
  const resultado = await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto: "Necesito que elijas el color del botón.", tipo: "necesita" }, new Date("2026-11-02T15:00:00Z"));
  assert.equal(resultado.salio, false);
  assert.equal(estado.enviados.length, 0);
  assert.equal(estado.alertas[0].prioridad, "ALTA");
  const dinero = await deltrabajador.enviarAvisoDelTrabajador(contexto, { texto: "Necesito tu sí para subir el presupuesto de Meta Ads.", tipo: "necesita" }, new Date("2026-11-02T15:05:00Z"));
  assert.equal(dinero.salio, true);
  assert.equal(estado.enviados.length, 1);
  assert.equal(estado.enviados[0].text.split("\n").length, 2);
});

/* ------------------------------------------------------------------ un solo sí del dueño (30-oct-2026) */

const PLAN_DE_ABONOS = [
  "APROBAR PLAN: ESPERA TU SÍ — toca los abonos de Gestión",
  "Mostrar los abonos en la ficha del cliente.",
  "",
  "CRITERIOS DE ACEPTACIÓN:",
  "- Los abonos se ven en la ficha del cliente en el celular.",
].join("\n");
const PLAN_DE_ABONOS_CON_PREGUNTAS = `${PLAN_DE_ABONOS}\n\nPREGUNTAS ABIERTAS:\n- ¿Los abonos se muestran con IVA o sin IVA?`;

await prueba("un solo sí: un plan de abonos con el sí del dueño a la tarea no avisa; sin ese sí, sí avisa", async () => {
  const plan = (extra = {}) => esperando({ id: "g1", titulo: "Abonos en la ficha", estado: "PLAN_LISTO", plan: PLAN_DE_ABONOS, error: null, ...extra });
  assert.equal(avisos.porQueNecesitaAlDueno(plan({ tareaAprobadaPorElDueno: true })), null);
  assert.match(avisos.porQueNecesitaAlDueno(plan()), /abonos/);
  assert.match(avisos.porQueNecesitaAlDueno(plan({ tareaAprobadaPorElDueno: false })), /abonos/);
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 1 };
  assert.equal(avisos.calcularAvisos({ ...base, esperando: [plan({ tareaAprobadaPorElDueno: true })] }, DIA).length, 0);
  assert.equal(avisos.calcularAvisos({ ...base, esperando: [plan()] }, DIA).filter((a) => a.tipo === "necesita").length, 1);
});

await prueba("un solo sí: un plan de Gestión con preguntas abiertas y el sí del dueño sigue avisando, Urgente y con la pregunta en el Motivo", async () => {
  const tarjeta = esperando({ id: "g2", titulo: "Abonos en la ficha", estado: "PLAN_LISTO", plan: PLAN_DE_ABONOS_CON_PREGUNTAS, error: null, tareaAprobadaPorElDueno: true });
  assert.match(avisos.porQueNecesitaAlDueno(tarjeta), /preguntas abiertas: ¿Los abonos se muestran con IVA/);
  const necesita = avisos.calcularAvisos({ latidoEn: DIA.toISOString(), enCurso: [], enFila: 1, esperando: [tarjeta] }, DIA).filter((a) => a.tipo === "necesita");
  assert.equal(necesita.length, 1);
  assert.equal(necesita[0].prioridad, "URGENTE");
  // La misma clave anti-repetición del aviso "necesita": un aviso por tarjeta.
  assert.equal(necesita[0].clave, "auto:necesita:g2:PLAN_LISTO");
  assert.match(necesita[0].lineas[1], /^Motivo: el plan tiene preguntas abiertas: ¿Los abonos/);
});

await prueba("un solo sí: leerSituacion marca el sí del dueño en los planes listos y la revisión no avisa del plan de Gestión que ya no espera", async () => {
  estado.esperando = [
    esperando({ id: "g1", titulo: "Abonos en la ficha", estado: "PLAN_LISTO", plan: PLAN_DE_ABONOS }),
    esperando({ id: "g3", titulo: "Saldos en la ficha", estado: "PLAN_LISTO", plan: PLAN_DE_ABONOS }),
  ];
  estado.tareasDelDueno = new Set(["g1"]);
  const situacion = await avisos.leerSituacion("ws1");
  assert.deepEqual(situacion.esperando.map((t) => [t.id, t.tareaAprobadaPorElDueno]), [["g1", true], ["g3", false]]);
  const necesita = avisos.calcularAvisos({ ...situacion, enFila: 1 }, DIA).filter((a) => a.tipo === "necesita");
  assert.deepEqual(necesita.map((a) => a.clave), ["auto:necesita:g3:PLAN_LISTO"]);
});

await prueba("un solo sí: con 'solo urgentes', la pregunta abierta de un plan llega por WhatsApp una sola vez", async () => {
  guardarNumero();
  estado.esperando = [esperando({ id: "g2", titulo: "Abonos en la ficha", estado: "PLAN_LISTO", plan: PLAN_DE_ABONOS_CON_PREGUNTAS })];
  estado.tareasDelDueno = new Set(["g2"]);
  estado.enFila = 1;
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
  assert.deepEqual(estado.alertas.map((a) => a.prioridad), ["URGENTE"]);
  assert.equal(estado.alertas[0].salioPorWhatsApp, true);
  assert.equal(estado.enviados.length, 1);
  const luego = new Date(DIA.getTime() + 10 * 60_000);
  estado.latido = luego.toISOString();
  assert.deepEqual(await avisos.revisarAvisosAlDueno(luego), { enviados: 0 });
  assert.equal(estado.enviados.length, 1, "no se repite");
});

/* ------------------------------------------------------------------ el aviso habla de una tarjeta (30-oct-2026) */

const PREGUNTA = "Necesito tu sí para subir el presupuesto de Meta Ads.";
const ALERTA_LISTA = "https://app.aizenbot.com/cliente/alertas";
// Días nuevos: el "uno por minuto" del aviso del Coordinador vive en memoria entre pruebas.
const DIA_TARJETA = new Date("2026-11-03T15:00:00Z");
const DIA_SIN_TARJETA = new Date("2026-11-04T15:00:00Z");

await prueba("tarjetaId: con una tarjeta del negocio, el 'necesita' queda con la clave coord:necesita:<id>:<texto> y el urgente lleva a la tarjeta", async () => {
  guardarNumero();
  const resultado = await deltrabajador.enviarAvisoDelTrabajador({ workspaceId: "ws1" }, { texto: PREGUNTA, tipo: "necesita", tarjetaId: "tarj1" }, DIA_TARJETA);
  assert.equal(resultado.salio, true);
  assert.equal(estado.alertas.length, 1);
  assert.equal(estado.alertas[0].clave, `coord:necesita:tarj1:${PREGUNTA}`);
  assert.equal(estado.alertas[0].prioridad, "URGENTE");
  assert.equal(estado.alertas[0].salioPorWhatsApp, true);
  const texto = estado.enviados[0].text;
  assert.equal(texto.split("\n").length, 2);
  assert.match(texto, /\nVer: https:\/\/app\.aizenbot\.com\/cliente\/tablero-ia\?tarjeta=tarj1$/);
  assert.ok(!texto.includes(ALERTA_LISTA), "no lleva a la lista de alertas");
  // El mismo aviso otra vez no se repite antes de 3 horas (la clave nueva también cuenta como avisada).
  assert.deepEqual(await deltrabajador.enviarAvisoDelTrabajador({ workspaceId: "ws1" }, { texto: PREGUNTA, tipo: "necesita", tarjetaId: "tarj1" }, new Date(DIA_TARJETA.getTime() + 5 * 60_000)), { repetido: true });
});

await prueba("tarjetaId: de otro negocio, borrada, inexistente, mal escrita o sin id, se guarda coord:necesita:<texto> como antes", async () => {
  guardarNumero();
  const casos = [{ tarjetaId: "ajena1" }, { tarjetaId: "borrada1" }, { tarjetaId: "no-existe" }, { tarjetaId: 123 }, { tarjetaId: "  " }, {}];
  for (const [i, extra] of casos.entries()) {
    reiniciar();
    guardarNumero();
    const resultado = await deltrabajador.enviarAvisoDelTrabajador({ workspaceId: "ws1" }, { texto: PREGUNTA, tipo: "necesita", ...extra }, new Date(DIA_SIN_TARJETA.getTime() + i * 2 * 60_000));
    assert.equal(resultado.salio, true, JSON.stringify(extra));
    assert.equal(estado.alertas[0].clave, `coord:necesita:${PREGUNTA}`, JSON.stringify(extra));
    assert.equal(estado.enviados[0].text, `🚨 Urgente: ${PREGUNTA}\nVer: ${ALERTA_LISTA}`, "el WhatsApp sale como hoy");
  }
});

await prueba("tarjetaId: registrarAvisoDelCoordinador sin el parámetro guarda como antes; sin 'solo urgentes' cambia solo la línea Ver; uno no urgente no sale", async () => {
  guardarNumero();
  assert.equal(avisos.claveDelAvisoDelCoordinador("necesita", "hola"), "coord:necesita:hola");
  assert.equal(avisos.claveDelAvisoDelCoordinador("necesita", "hola", "tarj1"), "coord:necesita:tarj1:hola");
  assert.equal(avisos.claveDelAvisoDelCoordinador("necesita", "hola", "mal:id"), "coord:necesita:hola", "un id con ':' no rompe la clave");
  assert.equal(avisos.claveDelAvisoDelCoordinador("limite", "hola", "tarj1"), "coord:limite:hola", "el límite no cambia de clave");
  // Sin "solo urgentes": el texto del Coordinador, con la línea Ver: cambiada por la de la tarjeta (máximo 3 líneas).
  estado.ajustes.set("alertas:solo-urgentes:ws1", "false");
  const texto = "Necesito tu sí para el presupuesto de Meta Ads.\nSon 50.000 pesos.\nVer: https://app.aizenbot.com/cliente/tablero-ia?vista=hoy";
  assert.equal((await avisos.registrarAvisoDelCoordinador("ws1", "necesita", texto, DIA, "tarj1")).salio, true);
  assert.equal(estado.enviados[0].text, "Necesito tu sí para el presupuesto de Meta Ads.\nSon 50.000 pesos.\nVer: https://app.aizenbot.com/cliente/tablero-ia?tarjeta=tarj1");
  assert.equal(estado.alertas[0].detalle, texto, "la página guarda el texto completo");
  // Uno no urgente queda en la página con su clave de tarjeta y no sale (con "solo urgentes", como hoy).
  estado.ajustes.delete("alertas:solo-urgentes:ws1");
  const comun = await avisos.registrarAvisoDelCoordinador("ws1", "necesita", "Elige el color del botón.", DIA, "tarj1");
  assert.equal(comun.salio, false);
  assert.equal(estado.alertas[1].clave, "coord:necesita:tarj1:Elige el color del botón.");
  assert.equal(estado.alertas[1].prioridad, "ALTA");
  assert.equal(estado.enviados.length, 1);
  // De noche: queda en la página con la clave de la tarjeta y no sale nada.
  assert.deepEqual(await avisos.registrarAvisoDelCoordinador("ws1", "necesita", PREGUNTA, NOCHE, "tarj1"), { silenciado: true });
  assert.equal(estado.alertas.at(-1).clave, `coord:necesita:tarj1:${PREGUNTA}`);
  assert.equal(estado.enviados.length, 1);
});

/* ------------------------------------------------------------------ el barrido y la limpieza única (31-oct-2026) */

const abierta = (clave, extra = {}) => {
  const fila = { id: `al${estado.alertas.length + 1}`, workspaceId: "ws1", clave, prioridad: "ALTA", titulo: clave, detalle: "texto", origen: "Coordinador", estado: "NUEVA", veces: 1, destinatarioId: null, ...extra };
  estado.alertas.push(fila);
  return fila;
};
const tarjeta = (id, estadoDeTarjeta, extra = {}) => estado.tarjetas.push({ id, workspaceId: "ws1", titulo: `Tarjeta ${id}`, estado: estadoDeTarjeta, borradoEn: null, ...extra });

await prueba("alertaYaNoAplica: HECHO, FALLIDO, borrada o inexistente cierra; otro estado en la clave auto cierra; coord:necesita cierra si ya está aprobada; terminada nunca", async () => {
  const { alertaYaNoAplica } = reglasDeAlertas;
  assert.equal(alertaYaNoAplica("auto:necesita:t1:POR_APROBAR", null), true);
  assert.equal(alertaYaNoAplica("auto:necesita:t1:POR_APROBAR", { estado: "POR_APROBAR", borradoEn: new Date() }), true);
  assert.equal(alertaYaNoAplica("auto:trabado:t1:ERROR", { estado: "HECHO", borradoEn: null }), true);
  assert.equal(alertaYaNoAplica("auto:equipo:t1:necesita:POR_APROBAR", { estado: "FALLIDO", borradoEn: null }), true);
  assert.equal(alertaYaNoAplica("auto:necesita:t1:POR_APROBAR", { estado: "APROBADO", borradoEn: null }), true);
  assert.equal(alertaYaNoAplica("auto:necesita:t1:POR_APROBAR", { estado: "POR_APROBAR", borradoEn: null }), false);
  assert.equal(alertaYaNoAplica("auto:trabado:t1:ERROR", { estado: "ERROR", borradoEn: null }), false, "el 'quedó en error' sigue");
  assert.equal(alertaYaNoAplica("auto:necesita:t1:VIA_PANTALLA", { estado: "APROBADO", borradoEn: null }), false, "VIA_PANTALLA no es un estado");
  assert.equal(alertaYaNoAplica("auto:equipo:t1:asignada:u1", { estado: "EN_CURSO", borradoEn: null }), false);
  for (const ya of ["APROBADO", "PLAN_APROBADO", "PLANEANDO", "EN_CURSO", "SUBIENDO"]) assert.equal(alertaYaNoAplica("coord:necesita:t1:¿Qué color?", { estado: ya, borradoEn: null }), true, ya);
  for (const espera of ["POR_APROBAR", "PLAN_LISTO", "POR_REVISAR", "ERROR"]) assert.equal(alertaYaNoAplica("coord:necesita:t1:¿Qué color?", { estado: espera, borradoEn: null }), false, espera);
  assert.equal(alertaYaNoAplica("terminada:t1", null), false);
  assert.equal(alertaYaNoAplica("auto:caido", null), false);
  assert.equal(alertaYaNoAplica("coord:necesita:texto viejo sin id", null), false);
});

await prueba("tituloEntreComillasDelAviso: saca el título de para \"…\" o «…»; si no está, null", async () => {
  const { tituloEntreComillasDelAviso } = reglasDeAlertas;
  assert.equal(tituloEntreComillasDelAviso('Necesito tu sí para "Título X": toca Meta Ads'), "Título X");
  assert.equal(tituloEntreComillasDelAviso("La tarea «Abonos en la ficha» tiene preguntas abiertas"), "Abonos en la ficha");
  assert.equal(tituloEntreComillasDelAviso("Necesito que elijas el color del botón."), null);
  assert.equal(tituloEntreComillasDelAviso('para ""'), null);
});

await prueba("barrido: cierra las de una tarjeta HECHO, borrada o FALLIDO y una auto:necesita POR_APROBAR ya APROBADO; deja la que sigue POR_APROBAR", async () => {
  tarjeta("h1", "HECHO");
  tarjeta("b1", "POR_APROBAR", { borradoEn: new Date("2026-10-30T00:00:00Z") });
  tarjeta("f1", "FALLIDO");
  tarjeta("a1", "APROBADO");
  tarjeta("p1", "POR_APROBAR");
  const deHecho = abierta("auto:trabado:h1:EN_CURSO");
  const deBorrada = abierta("coord:necesita:b1:¿Lo subo?", { estado: "VISTA" });
  const deFallido = abierta("auto:trabado:f1:FALLIDO");
  const yaAprobada = abierta("auto:necesita:a1:POR_APROBAR");
  const sigue = abierta("auto:necesita:p1:POR_APROBAR");
  const terminada = abierta("terminada:h1");
  const viejaConForma = abierta("coord:necesita:Necesito: tu sí");
  assert.equal(await servicioDeAlertas.barrerAlertasDeTarjetas("ws1", DIA), 4);
  for (const cerrada of [deHecho, deBorrada, deFallido, yaAprobada]) {
    assert.equal(cerrada.estado, "RESUELTA", cerrada.clave);
    assert.equal(cerrada.resueltaEn, DIA);
    assert.match(cerrada.detalle, /^texto\n\nResuelta sola: la tarjeta ya avanzó o se cerró \(26-oct 10:00\)$/);
  }
  assert.equal(sigue.estado, "NUEVA", "la tarjeta sigue esperando");
  assert.equal(terminada.estado, "NUEVA", "terminada nunca se cierra");
  assert.equal(viejaConForma.estado, "NUEVA", "un texto viejo que parece id no se cierra por 'no existe'");
  // Una segunda vuelta no toca nada más.
  assert.equal(await servicioDeAlertas.barrerAlertasDeTarjetas("ws1", DIA), 0);
});

await prueba("barrido: si la base falla, no lanza y devuelve 0; revisarNegocio sigue con los avisos", async () => {
  const original = falso.alertaInterna.findMany;
  falso.alertaInterna.findMany = async () => {
    throw new Error("base caída");
  };
  try {
    assert.equal(await servicioDeAlertas.barrerAlertasDeTarjetas("ws1", DIA), 0);
    assert.deepEqual(await servicioDeAlertas.limpiezaUnicaDelCoordinador("ws1", DIA), { corrio: false, cerradas: 0, dejadas: 0 });
    assert.equal(estado.ajustes.has("alertas:limpieza-coordinador-v1:ws1"), false, "sin marca: se reintenta");
    guardarNumero();
    estado.latido = hace(20 * 60_000).toISOString();
    assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 1 });
  } finally {
    falso.alertaInterna.findMany = original;
  }
});

await prueba("FALLIDO: calcularAvisos no devuelve avisos para tarjetas FALLIDO (ni con un error que pide clave); ERROR sigue igual", async () => {
  const base = { latidoEn: DIA.toISOString(), enCurso: [], enFila: 0 };
  const fallido = esperando({ id: "f9", titulo: "Pagos", estado: "FALLIDO", error: "Falta la clave de la API: 403" });
  assert.deepEqual(avisos.calcularAvisos({ ...base, esperando: [fallido] }, DIA), []);
  assert.deepEqual(avisos.calcularAvisos({ ...base, enFila: 1, esperando: [{ ...fallido, error: "falló una prueba" }] }, DIA), []);
  const error = avisos.calcularAvisos({ ...base, enFila: 1, esperando: [{ ...fallido, estado: "ERROR", error: "falló una prueba" }] }, DIA);
  assert.deepEqual(error.map((a) => a.clave), ["auto:trabado:f9:ERROR"]);
  // leerSituacion tampoco las trae.
  estado.esperando = [fallido, esperando({ id: "e2", estado: "ERROR", error: "x" })];
  assert.deepEqual((await avisos.leerSituacion("ws1")).esperando.map((t) => t.id), ["e2"]);
});

await prueba("limpieza única: cierra el aviso viejo cuya única tarjeta está HECHO; deja el sin tarjeta y el de una que sigue esperando; no vuelve a correr", async () => {
  estado.tarjetas.push(
    { id: "x1", workspaceId: "ws1", titulo: "Título X", estado: "HECHO", borradoEn: null },
    { id: "y1", workspaceId: "ws1", titulo: "Título Y", estado: "HECHO", borradoEn: null },
    { id: "y2", workspaceId: "ws1", titulo: "Título Y", estado: "PLAN_LISTO", borradoEn: null },
    { id: "z1", workspaceId: "ws2", titulo: "Título Z", estado: "HECHO", borradoEn: null },
  );
  const deX = abierta('coord:necesita:Necesito tu sí para "Título X": toca Meta Ads');
  const deY = abierta("coord:necesita:La tarea «Título Y» tiene preguntas abiertas");
  const sinTarjeta = abierta('coord:necesita:Necesito tu sí para "Nadie se llama así"');
  const deOtroNegocio = abierta('coord:necesita:Necesito tu sí para "Título Z"');
  const sinTitulo = abierta("coord:necesita:Necesito que elijas el color del botón.");
  const conId = abierta("coord:necesita:x1:¿Lo subo?");
  const resultado = await servicioDeAlertas.limpiezaUnicaDelCoordinador("ws1", DIA);
  assert.deepEqual(resultado, { corrio: true, cerradas: 1, dejadas: 4 });
  assert.equal(deX.estado, "RESUELTA");
  assert.match(deX.detalle, /Resuelta sola: la tarjeta ya avanzó o se cerró \(26-oct 10:00\)$/);
  for (const queda of [deY, sinTarjeta, deOtroNegocio, sinTitulo]) assert.equal(queda.estado, "NUEVA", queda.clave);
  assert.equal(conId.estado, "NUEVA", "la de id es del barrido, no de la limpieza");
  assert.deepEqual(JSON.parse(estado.ajustes.get("alertas:limpieza-coordinador-v1:ws1")), { cuando: DIA.toISOString(), cerradas: 1, dejadas: 4 });
  // Segunda pasada: ya está la marca, no corre (aunque ahora la de Y sí se podría cerrar).
  estado.tarjetas.find((t) => t.id === "y2").estado = "HECHO";
  assert.deepEqual(await servicioDeAlertas.limpiezaUnicaDelCoordinador("ws1", new Date(DIA.getTime() + 60_000)), { corrio: false, cerradas: 0, dejadas: 0 });
  assert.equal(deY.estado, "NUEVA");
});

await prueba("revisarNegocio: corre la limpieza única y el barrido en cada vuelta, aunque los avisos estén apagados", async () => {
  tarjeta("h2", "HECHO");
  estado.tarjetas.push({ id: "x2", workspaceId: "ws1", titulo: "Título W", estado: "FALLIDO", borradoEn: null });
  const delBarrido = abierta("auto:trabado:h2:SUBIENDO");
  const vieja = abierta('coord:necesita:Necesito tu sí para "Título W"');
  await avisos.guardarConfigDeAvisos("ws1", { activo: false });
  assert.deepEqual(await avisos.revisarAvisosAlDueno(DIA), { enviados: 0 });
  assert.equal(delBarrido.estado, "RESUELTA");
  assert.equal(vieja.estado, "RESUELTA");
  assert.ok(estado.ajustes.has("alertas:limpieza-coordinador-v1:ws1"));
});

console.log(`\n${pruebas} pruebas, todas bien`);

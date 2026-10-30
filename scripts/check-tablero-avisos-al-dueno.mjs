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
  });
};
reiniciar();

const coincideLinea = (l, where) =>
  l.workspaceId === where.workspaceId &&
  (where.id === undefined || l.id === where.id) &&
  (where.isActive === undefined || l.isActive === where.isActive) &&
  (!where.evolutionInstanceName || l.evolutionInstanceName) &&
  (!where.name || l.name.toLowerCase() === where.name.equals.toLowerCase());

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
    findMany: async ({ where } = {}) =>
      estado.enCurso
        .map((t) => ({ repo: "aizencrm", ...t, trabajoIniciadoEn: null, creadoEn: new Date("2026-10-26T00:00:00Z") }))
        .filter((t) => !(where?.repo && "not" in where.repo && where.repo.not === null) || t.repo !== null),
    count: async () => estado.enFila,
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
    updateMany: async ({ where, data }) => {
      for (const a of estado.alertas.filter((x) => x.workspaceId === where.workspaceId && x.clave === where.clave)) Object.assign(a, data);
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
  assert.equal(necesita({ estado: "PLAN_LISTO", plan: "Cambiar el color del botón.\n\nCRITERIOS DE ACEPTACIÓN:\n1. El botón se ve del color nuevo." }).length, 0);
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

/* ------------------------------------------------------------------ las alertas: prioridad y página */

await prueba("alertas: caído y límite son Urgente; trabado y sin trabajo, Alta; necesita es Urgente solo por dinero, Meta Ads o una clave", async () => {
  assert.equal(avisos.prioridadDelAviso("caido"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("limite"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("trabado"), "ALTA");
  assert.equal(avisos.prioridadDelAviso("sin_trabajo"), "ALTA");
  assert.equal(avisos.prioridadDelAviso("necesita", "toca Meta Ads"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "falta una clave, un acceso o un permiso"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "mueve dinero del presupuesto"), "URGENTE");
  assert.equal(avisos.prioridadDelAviso("necesita", "el cambio agrega un envío de mensaje en chats"), "ALTA");
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

console.log(`\n${pruebas} pruebas, todas bien`);

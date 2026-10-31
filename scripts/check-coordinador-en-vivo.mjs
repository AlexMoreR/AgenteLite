// Pruebas del panel "Coordinador en vivo" del Tablero IA (reglas-coordinador-en-vivo.ts, coordinador-en-vivo.ts y
// la ruta POST /api/trabajador/latido): un latido con datos basura se recorta y los links raros se descartan, el
// semáforo en sus límites, "apagado" a los 2 minutos, lo de HOY (terminadas, falladas, reparadas y cuánto tomó
// cada una), la fila con lo bloqueado, que una clave de otro negocio no vea nada y que sin clave el CRM rechace.
// Usa un prisma FALSO: no necesita base ni red.
// Correr: npm run test:coordinador-en-vivo
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const estado = { ajustes: new Map(), tarjetas: [], historial: [], intentos: [], claves: new Map() };

const coincide = (valor, filtro) => {
  if (filtro && typeof filtro === "object" && !(filtro instanceof Date)) {
    if ("in" in filtro) return filtro.in.includes(valor);
    if ("not" in filtro) return valor !== filtro.not && !(filtro.not === null && valor === null);
    if ("gt" in filtro) return valor !== null && valor > filtro.gt;
    if ("lte" in filtro) return valor !== null && valor <= filtro.lte;
  }
  return valor === filtro;
};

const prismaFalso = {
  appSetting: {
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    findMany: async ({ where }) =>
      [...estado.ajustes.entries()].filter(([key]) => key.startsWith(where.key.startsWith)).map(([key, value]) => ({ key, value })),
  },
  tarjetaTablero: {
    findMany: async ({ where }) => {
      const delNegocio = estado.tarjetas.filter((t) => t.workspaceId === where.tablero.workspaceId && t.borradoEn === null);
      if (where.estado?.in && where.trabajoVenceEn) {
        // En marcha: PLANEANDO / EN_CURSO / SUBIENDO con el candado vigente.
        return delNegocio.filter((t) => where.estado.in.includes(t.estado) && coincide(t.trabajoVenceEn, where.trabajoVenceEn));
      }
      if (where.OR) {
        // Para tomar: APROBADO / PLAN_APROBADO, o SUBIENDO sin candado.
        return delNegocio
          .filter((t) => t.repo && (t.estado === "APROBADO" || t.estado === "PLAN_APROBADO" || (t.estado === "SUBIENDO" && (!t.trabajoVenceEn || t.trabajoVenceEn <= estado.ahora))))
          .map((t) => ({ ...t, entrantes: t.entrantes ?? [] }));
      }
      // Esperando al dueño.
      return delNegocio.filter((t) => t.repo && where.estado.in.includes(t.estado));
    },
  },
  historialTarjeta: {
    findMany: async ({ where }) =>
      estado.historial
        .filter((f) => f.workspaceId === where.tarjeta.tablero.workspaceId && f.origen === where.origen && f.accion === where.accion)
        .filter((f) => f.creadoEn >= where.creadoEn.gte && f.creadoEn < where.creadoEn.lt)
        .sort((a, b) => a.creadoEn - b.creadoEn)
        .map((f) => ({ tarjetaId: f.tarjetaId, creadoEn: f.creadoEn, despues: f.despues, tarjeta: { titulo: f.titulo } })),
  },
  intentoTarjeta: {
    findMany: async ({ where }) =>
      estado.intentos
        .filter((i) => i.workspaceId === where.tarjeta.tablero.workspaceId && i.accion === where.accion)
        .filter((i) => i.creadoEn >= where.creadoEn.gte && i.creadoEn < where.creadoEn.lt)
        .map((i) => ({ tarjetaId: i.tarjetaId, creadoEn: i.creadoEn })),
  },
};

class ErrorDelTrabajador extends Error {
  constructor(message, status) {
    super(message);
    this.status = status;
  }
}

const trabajadorFalso = {
  ErrorDelTrabajador,
  validarClaveTrabajador: async (clave) => estado.claves.get(clave) ?? null,
};

const respuestasFalsas = {
  NextResponse: class {
    constructor(cuerpo, init) {
      this.cuerpo = cuerpo;
      this.status = init?.status ?? 200;
    }
    static json(cuerpo, init) {
      const r = new this(cuerpo, init);
      r.json = async () => cuerpo;
      return r;
    }
  },
};

const mocks = {
  "@/lib/prisma": { prisma: prismaFalso },
  "@prisma/client": { Prisma: {} },
  "next/server": respuestasFalsas,
  "./trabajador": trabajadorFalso,
  "@/features/tableros-inteligentes/services/trabajador": trabajadorFalso,
  "./tableros": { linkDeLaTarjeta: (id) => `https://app.aizenbot.com/cliente/tablero-ia?tarjeta=${id}` },
};

const reglas = cargar("src/features/tableros-inteligentes/services/reglas-coordinador-en-vivo.ts", mocks);
const servicio = cargar("src/features/tableros-inteligentes/services/coordinador-en-vivo.ts", mocks);
const pausaServicio = cargar("src/features/tableros-inteligentes/services/pausa-por-uso-de-claude.ts", mocks);
const rutaLatido = cargar("src/app/api/trabajador/latido/route.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.ajustes.clear();
  estado.tarjetas.length = 0;
  estado.historial.length = 0;
  estado.intentos.length = 0;
  estado.claves.clear();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const AHORA = new Date("2026-10-24T18:00:00Z"); // 1:00 p. m. en Bogotá
const hace = (minutos) => new Date(AHORA.getTime() - minutos * 60_000);
const contexto = { claveId: "k1", workspaceId: "ws1", nombre: "aizen1" };
const tarjeta = (extra) => ({
  id: "t1",
  workspaceId: "ws1",
  titulo: "Una tarea",
  estado: "EN_CURSO",
  repo: "aizencrm",
  borradoEn: null,
  intentos: 1,
  reparaciones: 0,
  trabajoIniciadoEn: hace(10),
  trabajoVenceEn: new Date(AHORA.getTime() + 600_000),
  actualizadoEn: hace(10),
  entrantes: [],
  ...extra,
});
estado.ahora = AHORA;

/* ------------------------------------------------------------------ validar lo que llega */

await prueba("un latido con datos basura se recorta: tareas, textos, porcentajes y etapas raras", () => {
  const tareas = Array.from({ length: 25 }, (_, i) => ({ tarjetaId: `t${i}`, titulo: "x".repeat(500), etapa: "construyendo", lugar: "marte", modelo: "claude-sonnet-4-5" }));
  tareas.push({ tarjetaId: "mala", titulo: "sin etapa buena", etapa: "volando" }, "no soy un objeto", null);
  const latido = reglas.latidoDeEntrada(
    { nombre: "p".repeat(200), tareas, carga: { cpu: 250, memoriaPorciento: -5, memoriaUsadaGb: "22.46", discoLibreGb: "mucho", esperandoPc: "sí" }, uso: { limiteAlcanzado: true, reiniciaEn: "no es fecha", motor: "otro" } },
    AHORA,
  );
  assert.equal(latido.recibidoEn, AHORA.toISOString());
  assert.equal(latido.tareas.length, 10, "máximo 10 tareas");
  assert.ok(latido.tareas[0].titulo.length <= 140);
  assert.equal(latido.tareas[0].lugar, "aizen1", "un lugar raro cae en aizen1");
  assert.equal(latido.tareas[0].modelo, "sonnet");
  assert.ok(latido.nombre.length <= 40);
  assert.equal(latido.carga.cpu, 100);
  assert.equal(latido.carga.memoriaPorciento, 0);
  assert.equal(latido.carga.memoriaUsadaGb, 22.5);
  assert.equal(latido.carga.discoLibreGb, null);
  assert.equal(latido.carga.esperandoPc, false, "solo true de verdad cuenta");
  assert.deepEqual(latido.uso, { limiteAlcanzado: true, reiniciaEn: null, motor: null });
  assert.equal(reglas.latidoDeEntrada("texto", AHORA), null);
  assert.equal(reglas.latidoDeEntrada([], AHORA), null);
  assert.deepEqual(reglas.latidoDeEntrada({}, AHORA).tareas, []);
});

await prueba("los links: solo https de claude.ai, github.com o del propio CRM; el resto se descarta", () => {
  const propio = "app.aizenbot.com";
  assert.ok(reglas.linkPermitido("https://claude.ai/code/session_1", propio));
  assert.ok(reglas.linkPermitido("https://github.com/o/r/actions/runs/1", propio));
  assert.ok(reglas.linkPermitido("https://app.aizenbot.com/cliente/tablero-ia", propio));
  assert.equal(reglas.linkPermitido("http://github.com/o/r", propio), null, "http no");
  assert.equal(reglas.linkPermitido("https://github.com.malo.com/x", propio), null);
  assert.equal(reglas.linkPermitido("https://evilgithub.com/x", propio), null);
  assert.equal(reglas.linkPermitido("https://user:pass@github.com/x", propio), null);
  assert.equal(reglas.linkPermitido("javascript:alert(1)", propio), null);
  assert.equal(reglas.linkPermitido("https://otro.com/x", propio), null);
  assert.equal(reglas.linkPermitido("https://app.aizenbot.com/x", null), null, "sin host propio no hay excepción");
  const latido = reglas.latidoDeEntrada(
    { tareas: [{ tarjetaId: "t1", etapa: "subiendo", linkSesion: "https://evil.com/s", linkWorkflow: "https://github.com/o/r/actions/runs/9" }] },
    AHORA,
    propio,
  );
  assert.equal(latido.tareas[0].linkSesion, null);
  assert.equal(latido.tareas[0].linkWorkflow, "https://github.com/o/r/actions/runs/9");
});

await prueba("el agente de cada tarea se conserva, se recorta y es opcional (un latido viejo no lo trae)", async () => {
  const propio = "app.aizenbot.com";
  const latido = reglas.latidoDeEntrada(
    { tareas: [{ tarjetaId: "t1", etapa: "planeando", agente: "Agente Gestión" }, { tarjetaId: "t2", etapa: "planeando" }, { tarjetaId: "t3", etapa: "planeando", agente: "x".repeat(200) }, { tarjetaId: "t4", etapa: "planeando", agente: 7 }] },
    AHORA,
    propio,
  );
  assert.equal(latido.tareas[0].agente, "Agente Gestión");
  assert.equal(latido.tareas[1].agente, null, "sin el campo no se muestra y no pasa nada más");
  assert.equal(latido.tareas[2].agente.length, 60);
  assert.equal(latido.tareas[3].agente, null);
});

/* ------------------------------------------------------------------ semáforo y apagado */

await prueba("semáforo: verde bajo 70 %, amarillo de 70 a 85 %, rojo sobre 85 % o con poco disco", () => {
  const carga = (cpu, memoriaPorciento, extra = {}) => ({ cpu, memoriaPorciento, memoriaUsadaGb: null, memoriaTotalGb: null, discoLibreGb: 200, discoTotalGb: 500, esperandoPc: false, motivoEspera: null, ...extra });
  assert.equal(reglas.semaforoDeLaCarga(carga(69, 69)), "verde");
  assert.equal(reglas.semaforoDeLaCarga(carga(70, 10)), "amarillo");
  assert.equal(reglas.semaforoDeLaCarga(carga(10, 85)), "amarillo", "85 todavía es amarillo");
  assert.equal(reglas.semaforoDeLaCarga(carga(86, 10)), "rojo");
  assert.equal(reglas.semaforoDeLaCarga(carga(10, 99)), "rojo");
  assert.equal(reglas.semaforoDeLaCarga(carga(10, 10, { discoLibreGb: 9 })), "rojo", "poco disco");
  assert.equal(reglas.semaforoDeLaCarga(carga(10, 10, { discoLibreGb: 15 })), "amarillo");
  assert.equal(reglas.semaforoDeLaCarga(carga(10, 10, { esperandoPc: true })), "amarillo", "esperando al PC");
  assert.equal(reglas.semaforoDeLaCarga(carga(null, null, { discoLibreGb: null })), null);
  assert.equal(reglas.semaforoDeLaCarga(null), null);
});

await prueba("apagado: un latido de hace 3 minutos sí, uno de hace 1 minuto no, y sin latido sí", () => {
  assert.equal(reglas.estaApagado(hace(3).toISOString(), AHORA), true);
  assert.equal(reglas.estaApagado(hace(1).toISOString(), AHORA), false);
  assert.equal(reglas.estaApagado(hace(2).toISOString(), AHORA), false, "justo 2 minutos todavía no");
  assert.equal(reglas.estaApagado(null, AHORA), true);
  assert.equal(reglas.estaApagado("basura", AHORA), true);
});

await prueba("palabras: hace cuánto, duración, en qué va y el uso de Claude", () => {
  assert.equal(reglas.haceTexto(14 * 60_000), "hace 14 min");
  assert.equal(reglas.haceTexto(125 * 60_000), "hace 2 h 5 min");
  assert.equal(reglas.haceTexto(10_000), "hace un momento");
  assert.equal(reglas.duracionTexto(65), "1 h 5 min");
  assert.equal(reglas.duracionTexto(0.4), "menos de 1 min");
  assert.equal(reglas.duracionTexto(null), "—");
  assert.equal(reglas.enQueVa({ intento: 2, reparacion: 0, reparacionDe: 3 }), "intento 2");
  assert.equal(reglas.enQueVa({ intento: 3, reparacion: 1, reparacionDe: 3 }), "reparación 1 de 3");
  assert.equal(reglas.textoDelUso({ limiteAlcanzado: false, reiniciaEn: null, motor: null }, AHORA), "Sin límite");
  const reinicio = new Date("2026-10-24T20:00:00Z").toISOString(); // 3:00 p. m. en Bogotá
  const texto = reglas.textoDelUso({ limiteAlcanzado: true, reiniciaEn: reinicio, motor: "claude" }, AHORA);
  assert.match(texto, /Límite de Claude alcanzado, se reinicia a las 3:00/);
  assert.equal(reglas.textoDelUso({ limiteAlcanzado: true, reiniciaEn: hace(5).toISOString(), motor: "claude" }, AHORA), "Límite de Claude alcanzado", "un reinicio que ya pasó no se muestra");
});

await prueba("el día de Bogotá: desde las 5:00 UTC hasta las 5:00 UTC del día siguiente", () => {
  const { desde, hasta } = reglas.rangoDeHoyEnBogota(new Date("2026-10-24T02:00:00Z")); // 9 p. m. del 23 en Bogotá
  assert.equal(desde.toISOString(), "2026-10-23T05:00:00.000Z");
  assert.equal(hasta.toISOString(), "2026-10-24T05:00:00.000Z");
  assert.equal(reglas.rangoDeHoyEnBogota(AHORA).desde.toISOString(), "2026-10-24T05:00:00.000Z");
});

/* ------------------------------------------------------------------ guardar y leer */

await prueba("guardarLatido guarda solo el último por clave; un cuerpo que no es objeto es un 400", async () => {
  await servicio.guardarLatido(contexto, { tareas: [{ tarjetaId: "a", etapa: "planeando" }] }, hace(1));
  await servicio.guardarLatido(contexto, { tareas: [{ tarjetaId: "b", etapa: "construyendo" }] }, AHORA);
  assert.equal(estado.ajustes.size, 1, "una sola fila por clave");
  assert.ok(estado.ajustes.has("trabajador:latido:ws1:k1"));
  const guardado = JSON.parse(estado.ajustes.get("trabajador:latido:ws1:k1"));
  assert.equal(guardado.tareas[0].tarjetaId, "b");
  assert.equal(guardado.recibidoEn, AHORA.toISOString(), "la hora es la de recibido, no la del PC");
  await assert.rejects(() => servicio.guardarLatido(contexto, "hola", AHORA), (error) => error.status === 400);
  await assert.rejects(() => servicio.guardarLatido(contexto, null, AHORA), (error) => error.status === 400);
});

await prueba("máximos del día (31-oct): maximosDelDia sube solo, vuelve a cero al cambiar de día e ignora lo que no es número", async () => {
  const { maximosDelDia } = servicio;
  const primero = maximosDelDia(null, { corriendo: 2, enFila: 3, cupos: 5 }, "2026-10-31");
  assert.deepEqual(primero, { dia: "2026-10-31", corriendoMax: 2, enFilaMax: 3, cupos: 5 });
  assert.equal(maximosDelDia(primero, { corriendo: 1, enFila: 0, cupos: 5 }, "2026-10-31"), null, "nada sube: no se escribe");
  assert.deepEqual(maximosDelDia(primero, { corriendo: 4, enFila: 1, cupos: 5 }, "2026-10-31"), { dia: "2026-10-31", corriendoMax: 4, enFilaMax: 3, cupos: 5 });
  assert.deepEqual(maximosDelDia(primero, { corriendo: 1, enFila: 0, cupos: 6 }, "2026-10-31").cupos, 6, "cambian los cupos: se escribe");
  assert.deepEqual(maximosDelDia(primero, { corriendo: 1, enFila: 0, cupos: 5 }, "2026-11-01"), { dia: "2026-11-01", corriendoMax: 1, enFilaMax: 0, cupos: 5 }, "día nuevo: desde cero");
  assert.equal(maximosDelDia(primero, { corriendo: "9", enFila: -1, cupos: 101 }, "2026-10-31"), null, "lo que no es un entero de 0 a 100 no cuenta");
  assert.equal(maximosDelDia(null, {}, "2026-10-31"), null, "un Coordinador viejo sin las cuentas no escribe nada");
});

await prueba("máximos del día: guardarLatido los guarda por día de Bogotá, ultimoLatido no los confunde y leerCuposDelDia los lee", async () => {
  await servicio.guardarLatido(contexto, { tareas: [], corriendo: 2, enFila: 4, cupos: 5 }, hace(10));
  await servicio.guardarLatido(contexto, { tareas: [], corriendo: 3, enFila: 1, cupos: 5 }, AHORA);
  assert.deepEqual(JSON.parse(estado.ajustes.get("trabajador:cupos-del-dia:ws1")), { dia: "2026-10-24", corriendoMax: 3, enFilaMax: 4, cupos: 5 });
  assert.equal((await servicio.ultimoLatido("ws1")).recibidoEn, AHORA.toISOString());
  assert.deepEqual(await servicio.leerCuposDelDia("ws1", "2026-10-24"), { dia: "2026-10-24", corriendoMax: 3, enFilaMax: 4, cupos: 5 });
  assert.equal(await servicio.leerCuposDelDia("ws1", "2026-10-25"), null, "de otro día no hay");
  // Si guardar los máximos falla, el latido sigue.
  const original = prismaFalso.appSetting.findUnique;
  prismaFalso.appSetting.findUnique = async () => {
    throw new Error("base caída");
  };
  try {
    const respuesta = await servicio.guardarLatido(contexto, { tareas: [], corriendo: 9 }, AHORA);
    assert.equal(respuesta.recibidoEn, AHORA.toISOString());
  } finally {
    prismaFalso.appSetting.findUnique = original;
  }
});

await prueba("la vista junta el latido con las tarjetas en marcha: lugar, modelo, en qué va y los links", async () => {
  estado.tarjetas.push(tarjeta({ id: "t1", titulo: "Panel en vivo", estado: "EN_CURSO", intentos: 2 }));
  await servicio.guardarLatido(
    contexto,
    {
      tareas: [{ tarjetaId: "t1", titulo: "Panel en vivo", etapa: "probando", lugar: "github", modelo: "sonnet", inicioEn: hace(14).toISOString(), intento: 2, reparacion: 1, reparacionDe: 3, linkWorkflow: "https://github.com/o/r/actions/runs/7" }],
      carga: { cpu: 40, memoriaPorciento: 50, memoriaUsadaGb: 20, memoriaTotalGb: 40, discoLibreGb: 120, discoTotalGb: 500 },
    },
    hace(0.2),
  );
  const vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.enLinea, true);
  assert.equal(vista.tareas.length, 1);
  const [tarea] = vista.tareas;
  assert.deepEqual([tarea.etapaTexto, tarea.lugarTexto, tarea.modeloTexto, tarea.enQueVa], ["Probando", "GitHub Actions", "Sonnet", "reparación 1 de 3"]);
  assert.equal(tarea.linkWorkflow, "https://github.com/o/r/actions/runs/7");
  assert.equal(tarea.agente, null, "un latido sin agente no inventa uno");
  assert.match(tarea.link, /tarjeta=t1/);
  assert.equal(vista.carga.semaforo, "verde");
  const texto = servicio.textoDelCoordinador(vista);
  assert.match(texto, /Coordinador en línea/);
  assert.match(texto, /«Panel en vivo»: probando en GitHub Actions con Sonnet/);
  assert.match(texto, /Uso de Claude: sin dato/);
  assert.match(texto, /Límite de uso: Sin límite/);
});

await prueba("sin latido (o con uno viejo) el panel dice apagado, pero las tarjetas se siguen viendo", async () => {
  estado.tarjetas.push(tarjeta({ id: "t1", titulo: "En marcha", estado: "PLANEANDO" }));
  let vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.enLinea, false);
  assert.equal(vista.nunca, true);
  assert.equal(vista.tareas.length, 1, "la base dice qué hay en marcha");
  assert.equal(vista.tareas[0].etapa, "planeando", "sin latido, la etapa sale del estado");
  assert.match(servicio.textoDelCoordinador(vista), /apagado o sin conexión/);
  await servicio.guardarLatido(contexto, { carga: { cpu: 10 } }, hace(3));
  vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.enLinea, false);
  assert.equal(vista.nunca, false);
  assert.equal(vista.ultimoLatidoEn, hace(3).toISOString());
  assert.match(servicio.textoDelCoordinador(vista), /el último latido fue hace 3 min/);
});

await prueba("una clave de otro negocio no ve nada: ni el latido, ni las tarjetas, ni lo de hoy", async () => {
  estado.tarjetas.push(tarjeta({ id: "t1", workspaceId: "ws1" }), tarjeta({ id: "t9", workspaceId: "ws2", titulo: "Ajena" }));
  estado.historial.push({ workspaceId: "ws2", tarjetaId: "t9", titulo: "Ajena", origen: "TRABAJADOR", accion: "estado", creadoEn: hace(30), despues: { subida: { commit: "abc" }, estado: "HECHO" } });
  await servicio.guardarLatido({ claveId: "k9", workspaceId: "ws2", nombre: "otro" }, { tareas: [{ tarjetaId: "t9", etapa: "construyendo" }] }, hace(0.1));
  const vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.nunca, true, "el latido de ws2 no es de ws1");
  assert.deepEqual(vista.tareas.map((t) => t.tarjetaId), ["t1"]);
  assert.equal(vista.hoy.terminadas, 0);
  const de2 = await servicio.vistaDelCoordinador("ws2", AHORA);
  assert.equal(de2.nunca, false);
});

await prueba("con dos claves se muestra el latido más reciente", async () => {
  await servicio.guardarLatido({ claveId: "vieja", workspaceId: "ws1", nombre: "viejo" }, { nombre: "viejo" }, hace(60));
  await servicio.guardarLatido({ claveId: "nueva", workspaceId: "ws1", nombre: "nuevo" }, { nombre: "nuevo" }, hace(0.1));
  const vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.nombre, "nuevo");
  assert.equal(vista.enLinea, true);
});

/* ------------------------------------------------------------------ la fila */

await prueba("la fila: lo que sigue en orden y lo bloqueado con su motivo (otra tarjeta, el dueño, un choque)", async () => {
  estado.tarjetas.push(
    tarjeta({ id: "f1", titulo: "Primera", estado: "APROBADO", trabajoVenceEn: null }),
    tarjeta({ id: "f2", titulo: "Segunda", estado: "PLAN_APROBADO", trabajoVenceEn: null }),
    tarjeta({ id: "f3", titulo: "Depende", estado: "APROBADO", trabajoVenceEn: null, entrantes: [{ origen: { titulo: "La base" } }] }),
    tarjeta({ id: "f4", titulo: "Choca", estado: "APROBADO", trabajoVenceEn: null }),
    tarjeta({ id: "f5", titulo: "Espera tu sí", estado: "PLAN_LISTO", trabajoVenceEn: null }),
    tarjeta({ id: "f6", titulo: "Sin repo", estado: "APROBADO", repo: null, trabajoVenceEn: null }),
  );
  await servicio.guardarLatido(contexto, { esperas: [{ tarjetaId: "f4", motivo: "toca la misma zona que otra tarea" }] }, hace(0.1));
  const { fila } = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.deepEqual(fila.siguientes.map((i) => i.tarjetaId), ["f1", "f2"]);
  const bloqueadas = Object.fromEntries(fila.bloqueadas.map((i) => [i.tarjetaId, i.motivo]));
  assert.equal(bloqueadas.f3, "Espera a la tarjeta «La base»");
  assert.equal(bloqueadas.f4, "toca la misma zona que otra tarea");
  assert.equal(bloqueadas.f5, "Espera tu aprobación del plan");
  assert.ok(!("f6" in bloqueadas) && !fila.siguientes.some((i) => i.tarjetaId === "f6"), "sin repo no es del Coordinador");
});

await prueba("en error y esperando a otra: los números y la lista (con la línea para el dueño y «que está en error»)", async () => {
  estado.tarjetas.push(
    tarjeta({ id: "e1", titulo: "Rota", estado: "ERROR", trabajoVenceEn: null, resultado: { recogida: { veces: 1, linea: "Falta que decidas A o B" } } }),
    tarjeta({ id: "e2", titulo: "Otra rota", estado: "ERROR", trabajoVenceEn: null }),
    tarjeta({ id: "e3", titulo: "Sin repo en error", estado: "ERROR", repo: null, trabajoVenceEn: null }),
    tarjeta({ id: "w1", titulo: "Espera al molde", estado: "APROBADO", trabajoVenceEn: null, entrantes: [{ origen: { titulo: "El molde", estado: "ERROR" } }] }),
    tarjeta({ id: "w2", titulo: "Espera en curso", estado: "APROBADO", trabajoVenceEn: null, entrantes: [{ origen: { titulo: "La base", estado: "EN_CURSO" } }] }),
  );
  const vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.errores.cantidad, 2);
  assert.deepEqual(vista.errores.tarjetas.map((i) => [i.tarjetaId, i.motivo]), [["e1", "Falta que decidas A o B"], ["e2", null]]);
  assert.equal(vista.esperandoAOtra.cantidad, 2);
  const motivos = Object.fromEntries(vista.esperandoAOtra.tarjetas.map((i) => [i.tarjetaId, i.motivo]));
  assert.equal(motivos.w1, "Esperando a «El molde», que está en error");
  assert.equal(motivos.w2, "Esperando a «La base»");
  const texto = servicio.textoDelCoordinador(vista);
  assert.match(texto, /En error: 2 — «Rota» \(Falta que decidas A o B\); «Otra rota»\./);
  assert.match(texto, /Esperando a otra: 2 — /);
});

/* ------------------------------------------------------------------ lo de hoy */

await prueba("hoy: cuenta terminadas, falladas y reparadas, con cuánto tomó cada una; lo de ayer no cuenta", async () => {
  const paso = (tarjetaId, titulo, minutos, despues = { estado: "EN_CURSO" }) => ({ workspaceId: "ws1", tarjetaId, titulo, origen: "TRABAJADOR", accion: "estado", creadoEn: hace(minutos), despues });
  const subida = { estado: "HECHO", subida: { commit: "abc" } };
  const error = { estado: "ERROR", motivo: "no pasó" };
  estado.historial.push(
    paso("a", "Terminada", 70, { estado: "PLANEANDO" }),
    paso("a", "Terminada", 40),
    paso("a", "Terminada", 25, subida),
    paso("b", "Fallida", 50, { estado: "PLANEANDO" }),
    paso("b", "Fallida", 20, error),
    // Falló, se reparó y al final subió: cuenta como terminada (su último resultado).
    paso("c", "Reparada", 100, { estado: "PLANEANDO" }),
    paso("c", "Reparada", 90, error),
    paso("c", "Reparada", 10, subida),
    // De ayer (antes de las 5:00 UTC de hoy): no cuenta.
    { ...paso("d", "De ayer", 0, subida), creadoEn: new Date("2026-10-23T20:00:00Z") },
  );
  estado.intentos.push(
    { workspaceId: "ws1", tarjetaId: "c", accion: "reparar", creadoEn: hace(85) },
    { workspaceId: "ws1", tarjetaId: "c", accion: "reparar", creadoEn: hace(60) },
    { workspaceId: "ws1", tarjetaId: "x", accion: "reparar", creadoEn: new Date("2026-10-23T20:00:00Z") },
    { workspaceId: "ws2", tarjetaId: "y", accion: "reparar", creadoEn: hace(5) },
  );
  const { hoy } = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(hoy.terminadas, 2);
  assert.equal(hoy.falladas, 1);
  assert.equal(hoy.reparadas, 2, "solo las reparaciones de hoy y de este negocio");
  const porId = Object.fromEntries(hoy.trabajos.map((t) => [t.tarjetaId, t]));
  assert.equal(porId.a.duracionMinutos, 45, "de 70 a 25 minutos atrás");
  assert.equal(porId.b.resultado, "fallo");
  assert.equal(porId.b.duracionMinutos, 30);
  assert.equal(porId.c.resultado, "terminada");
  assert.equal(porId.c.reparaciones, 2);
  assert.equal(porId.c.duracionMinutos, 90);
  assert.ok(!porId.d);
  assert.deepEqual(hoy.trabajos.map((t) => t.tarjetaId), ["c", "b", "a"], "lo más nuevo primero");
});

/* ------------------------------------------------------------------ pausa por uso de Claude (26-oct-2026) */

const reinicioDePausa = "2026-10-26T20:20:00.000Z"; // lun 26 oct, 3:20 p. m. en Bogotá
const pausaDelLatido = (cambios = {}) => ({
  activa: true,
  umbral: 80,
  sesion: { porcentaje: 42, reinicio: "Oct 26, 3:20pm (America/Bogota)" },
  semana: { porcentaje: 63.4, reinicio: "Oct 30, 7am (America/Bogota)" },
  leidoEn: AHORA.toISOString(),
  pausado: false,
  reiniciaEn: null,
  sinLeerDesde: null,
  ...cambios,
});

await prueba("pausa por uso: el latido la trae recortada y validada; uno viejo (sin pausaUso) da null", () => {
  const latido = reglas.latidoDeEntrada({ pausaUso: { ...pausaDelLatido(), umbral: 10, sesion: { porcentaje: 250, reinicio: "x".repeat(300) }, semana: "no", reiniciaEn: "no es fecha" } }, AHORA);
  assert.equal(latido.pausaUso.umbral, 80, "un umbral fuera de 50 a 95 cae en 80");
  assert.equal(latido.pausaUso.sesion.porcentaje, 100);
  assert.ok(latido.pausaUso.sesion.reinicio.length <= 80);
  assert.equal(latido.pausaUso.semana, null);
  assert.equal(latido.pausaUso.reiniciaEn, null);
  assert.equal(reglas.latidoDeEntrada({ tareas: [] }, AHORA).pausaUso, null);
});

await prueba("pausa por uso: el umbral va de 50 a 95 y el ajuste dañado vuelve a prendida al 80 %", () => {
  assert.deepEqual([49, 50, 80, 95, 96, "70", "abc", null].map(reglas.umbralDePausaValido), [null, 50, 80, 95, null, 70, null, null]);
  assert.deepEqual(reglas.ajusteDePausaUsoDeValor(undefined), { activa: true, umbral: 80 });
  assert.deepEqual(reglas.ajusteDePausaUsoDeValor("{no es json"), { activa: true, umbral: 80 });
  assert.deepEqual(reglas.ajusteDePausaUsoDeValor(JSON.stringify({ activa: false, umbral: 60 })), { activa: false, umbral: 60 });
  assert.deepEqual(reglas.ajusteDePausaUsoDeValor(JSON.stringify({ umbral: 20 })), { activa: true, umbral: 80 });
});

await prueba("pausa por uso: el texto del panel (normal, pausado, sin poder leer, apagado)", () => {
  const prendida = { activa: true, umbral: 80 };
  assert.deepEqual(reglas.textoDelUsoDeClaude(pausaDelLatido(), prendida), { estado: "normal", texto: "Uso de Claude: sesión 42 % · semana 63 %" });
  const pausado = reglas.textoDelUsoDeClaude(pausaDelLatido({ pausado: true, reiniciaEn: reinicioDePausa, sesion: { porcentaje: 82, reinicio: "x" } }), prendida);
  assert.equal(pausado.estado, "pausado");
  assert.match(pausado.texto, /^Pausado por uso de Claude hasta lun 26 (de )?oct,? 3:20 p\. m\. \(sesión 82 % · semana 63 %\)$/);
  const sinLeer = reglas.textoDelUsoDeClaude(pausaDelLatido({ sinLeerDesde: reinicioDePausa }), prendida);
  assert.equal(sinLeer.estado, "sin_lectura");
  assert.equal(sinLeer.texto, "No pude leer el uso de Claude desde las 3:20 p. m.");
  const apagado = reglas.textoDelUsoDeClaude(pausaDelLatido({ pausado: true }), { activa: false, umbral: 80 });
  assert.equal(apagado.estado, "apagado", "con el interruptor apagado ya no dice pausado");
  assert.match(apagado.texto, /la pausa está apagada/);
  assert.equal(reglas.textoDelUsoDeClaude(null, prendida).estado, "sin_dato");
});

await prueba("pausa por uso: la respuesta del latido devuelve el interruptor; la vista lo muestra y cambiarlo se guarda", async () => {
  estado.ajustes.clear();
  const sinFila = await servicio.guardarLatido(contexto, { pausaUso: pausaDelLatido() }, AHORA);
  assert.deepEqual(sinFila.pausaUso, { activa: true, umbral: 80 }, "sin fila: prendida al 80 %");
  const nuevo = await pausaServicio.guardarPausaPorUso("ws1", { umbral: 60 });
  assert.deepEqual(nuevo, { activa: true, umbral: 60 });
  await assert.rejects(() => pausaServicio.guardarPausaPorUso("ws1", { umbral: 99 }), /entre 50 y 95/);
  await assert.rejects(() => pausaServicio.guardarPausaPorUso("ws1", { umbral: 40 }), /entre 50 y 95/);
  assert.deepEqual(await pausaServicio.guardarPausaPorUso("ws1", { activa: false }), { activa: false, umbral: 60 }, "lo que no se manda queda como estaba");
  assert.deepEqual((await servicio.guardarLatido(contexto, { pausaUso: pausaDelLatido() }, AHORA)).pausaUso, { activa: false, umbral: 60 });
  const vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(vista.usoDeClaude.activa, false);
  assert.equal(vista.usoDeClaude.umbral, 60);
  assert.equal(vista.usoDeClaude.estado, "apagado");
  await pausaServicio.guardarPausaPorUso("ws1", { activa: true, umbral: 80 });
  await servicio.guardarLatido(contexto, { pausaUso: pausaDelLatido({ pausado: true, reiniciaEn: reinicioDePausa }) }, AHORA);
  const pausada = await servicio.vistaDelCoordinador("ws1", AHORA);
  assert.equal(pausada.usoDeClaude.estado, "pausado");
  assert.match(pausada.usoDeClaude.texto, /^Pausado por uso de Claude hasta /);
  assert.match(servicio.textoDelCoordinador(pausada), /Pausado por uso de Claude hasta .*\(la pausa se activa al 80 %\)/, "la voz y el MCP también lo dicen");
  estado.ajustes.clear();
});

/* ------------------------------------------------------------------ la ruta */

await prueba("POST /api/trabajador/latido: sin clave o con clave mala, 401; con clave buena guarda; GET no existe", async () => {
  estado.claves.set("aizen_trab_buena", contexto);
  const pedido = (cabeceras, cuerpo) =>
    new Request("https://crm.test/api/trabajador/latido", { method: "POST", headers: { "content-type": "application/json", ...cabeceras }, body: JSON.stringify(cuerpo) });
  const sin = await rutaLatido.POST(pedido({}, { tareas: [] }));
  assert.equal(sin.status, 401);
  const mala = await rutaLatido.POST(pedido({ authorization: "Bearer aizen_trab_mala" }, { tareas: [] }));
  assert.equal(mala.status, 401);
  assert.equal(estado.ajustes.size, 0, "no se guardó nada");
  const buena = await rutaLatido.POST(pedido({ authorization: "Bearer aizen_trab_buena" }, { tareas: [{ tarjetaId: "t1", etapa: "planeando" }] }));
  assert.equal(buena.status, 200);
  assert.equal(estado.ajustes.size, 1);
  const noObjeto = await rutaLatido.POST(pedido({ authorization: "Bearer aizen_trab_buena" }, "hola"));
  assert.equal(noObjeto.status, 400);
  assert.equal(rutaLatido.GET().status, 405);
});

/* ------------------------------------------------------------------ 29-oct-2026: pasos y revisores */

const resumenDePasos = (pasos) => [pasos.actual, pasos.necesitaHumano, pasos.pasos.map((paso) => paso.estado).join(",")];

await prueba("pasos: el mapeo de estados a Plan → Construir → Revisar → Aprobar → Subido, con «Necesita humano» donde se para", () => {
  const p = (estado, extra = {}) => resumenDePasos(reglas.pasosDeLaTarjeta({ estado, ...extra }));
  assert.deepEqual(p("APROBADO"), ["plan", false, "actual,pendiente,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("PLANEANDO"), ["plan", false, "actual,pendiente,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("POR_APROBAR"), ["plan", true, "necesita_humano,pendiente,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("PLAN_LISTO"), ["construir", true, "hecho,necesita_humano,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("PLAN_APROBADO"), ["construir", false, "hecho,actual,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("EN_CURSO", { etapa: "construyendo" }), ["construir", false, "hecho,actual,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("EN_CURSO", { etapa: "probando" }), ["construir", false, "hecho,actual,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("EN_CURSO", { etapa: "revisando" }), ["revisar", false, "hecho,hecho,actual,pendiente,pendiente"]);
  assert.deepEqual(p("POR_REVISAR"), ["aprobar", true, "hecho,hecho,hecho,necesita_humano,pendiente"]);
  assert.deepEqual(p("SUBIENDO", { etapa: "subiendo" }), ["aprobar", false, "hecho,hecho,hecho,actual,pendiente"]);
  assert.deepEqual(p("SUBIENDO", { etapa: "vigilando" }), ["subido", false, "hecho,hecho,hecho,hecho,actual"]);
  assert.deepEqual(p("HECHO"), ["subido", false, "hecho,hecho,hecho,hecho,hecho"]);
  assert.deepEqual(p("ERROR"), ["construir", true, "hecho,necesita_humano,pendiente,pendiente,pendiente"]);
  assert.deepEqual(p("ERROR", { pasoDelError: "revisar" }), ["revisar", true, "hecho,hecho,necesita_humano,pendiente,pendiente"]);
  // Dónde se paró una en ERROR.
  assert.equal(reglas.pasoDelError({ resultado: { error: { categoria: "revision_no_paso" } }, plan: "p" }), "revisar");
  assert.equal(reglas.pasoDelError({ resultado: { paso: true, commit: "abc" }, plan: "p" }), "aprobar");
  assert.equal(reglas.pasoDelError({ resultado: null, plan: "p" }), "construir");
  assert.equal(reglas.pasoDelError({ resultado: null, plan: null }), "plan");
  assert.deepEqual(reglas.pasosDeLaTarjeta({ estado: "EN_CURSO" }).pasos.map((paso) => paso.nombre), ["Plan", "Construir", "Revisar", "Aprobar", "Subido"]);
});

await prueba("revisores: el latido trae la vuelta y el estado de cada uno (validado); solo en la etapa «revisando»; uno viejo no los trae", () => {
  const latido = reglas.latidoDeEntrada(
    {
      tareas: [
        { tarjetaId: "t1", etapa: "revisando", revision: { vuelta: 2, revisores: { seguridad: "aprobado", experiencia: "no_aplica", diseno: "inventado", codigo: "cambios" } } },
        { tarjetaId: "t2", etapa: "construyendo", revision: { vuelta: 1, revisores: {} } },
        { tarjetaId: "t3", etapa: "revisando", revision: "basura" },
        { tarjetaId: "t4", etapa: "vigilando" },
      ],
    },
    AHORA,
  );
  assert.deepEqual(latido.tareas[0].revision, { vuelta: 2, revisores: { seguridad: "aprobado", experiencia: "no_aplica", diseno: "revisando", codigo: "cambios" } });
  assert.equal(latido.tareas[1].revision, null, "fuera de Revisar no hay cuadritos");
  assert.equal(latido.tareas[2].revision, null);
  assert.equal(latido.tareas[3].etapa, "vigilando", "la vigilancia de 30 min ya no se descarta");
  assert.equal(reglas.latidoDeEntrada({ tareas: [{ tarjetaId: "t", etapa: "construyendo" }] }, AHORA).tareas[0].revision, null, "un Coordinador viejo no manda revisión");
});

await prueba("la vista y ver_coordinador: pasos y revisores en «Ahora mismo»; «Necesita humano» en las de error y las que esperan tu sí", async () => {
  estado.tarjetas.push(
    tarjeta({ id: "t1", titulo: "Con revisores", estado: "EN_CURSO" }),
    tarjeta({ id: "t2", titulo: "Construyendo", estado: "EN_CURSO" }),
    tarjeta({
      id: "e1",
      titulo: "No pasó la revisión",
      estado: "ERROR",
      trabajoVenceEn: null,
      plan: "p",
      resultado: { error: { categoria: "revision_no_paso", motivo: "Se paró porque el revisor de seguridad no aprobó: pide validar quién llama.\n¿Lo subo así, lo corrijo con tu indicación o lo cierro?" } },
    }),
    tarjeta({ id: "r1", titulo: "Espera tu sí", estado: "POR_REVISAR", trabajoVenceEn: null }),
  );
  await servicio.guardarLatido(
    contexto,
    {
      tareas: [
        { tarjetaId: "t1", titulo: "Con revisores", etapa: "revisando", lugar: "nube", revision: { vuelta: 1, revisores: { seguridad: "revisando", experiencia: "no_aplica", diseno: "no_aplica", codigo: "cambios" } } },
        { tarjetaId: "t2", titulo: "Construyendo", etapa: "construyendo", lugar: "nube" },
      ],
    },
    hace(0.2),
  );
  const vista = await servicio.vistaDelCoordinador("ws1", AHORA);
  const [revisando, construyendo] = vista.tareas;
  assert.deepEqual(resumenDePasos(revisando.pasos), ["revisar", false, "hecho,hecho,actual,pendiente,pendiente"]);
  assert.equal(revisando.etapaTexto, "Revisando");
  assert.deepEqual(revisando.revision, {
    vuelta: 1,
    revisores: [
      { clave: "seguridad", nombre: "Seguridad", estado: "revisando" },
      { clave: "experiencia", nombre: "Experiencia del usuario", estado: "no_aplica" },
      { clave: "diseno", nombre: "Diseño", estado: "no_aplica" },
      { clave: "codigo", nombre: "Código", estado: "cambios" },
    ],
  });
  assert.equal(construyendo.revision, null);
  assert.equal(construyendo.pasos.actual, "construir");
  assert.deepEqual(resumenDePasos(vista.errores.tarjetas[0].pasos), ["revisar", true, "hecho,hecho,necesita_humano,pendiente,pendiente"]);
  // La línea para el dueño (linea_para_el_dueno de ver_coordinador): las 2 líneas de la revisión que no pasó.
  assert.deepEqual(vista.errores.tarjetas[0].motivo.split("\n"), [
    "Se paró porque el revisor de seguridad no aprobó: pide validar quién llama.",
    "¿Lo subo así, lo corrijo con tu indicación o lo cierro?",
  ]);
  const espera = vista.fila.bloqueadas.find((item) => item.tarjetaId === "r1");
  assert.deepEqual(resumenDePasos(espera.pasos), ["aprobar", true, "hecho,hecho,hecho,necesita_humano,pendiente"]);
  const texto = servicio.textoDelCoordinador(vista);
  assert.match(texto, /«Con revisores»: revisando en Nube de Claude[^\n]*Paso: Revisar\./);
  assert.match(texto, /Revisión R1: Seguridad revisando, Experiencia del usuario no aplica, Diseño no aplica, Código pidió cambios\./);
});

await prueba("render: la línea de pasos resalta el actual, marca los hechos y corta en «Necesita humano»; los 4 cuadritos con R1/R2", async () => {
  const { renderToStaticMarkup } = await import("react-dom/server");
  const React = await import("react");
  const componentes = cargar("src/features/tableros-inteligentes/components/PasosDelCoordinador.tsx", mocks);
  const html = (elemento, props) => renderToStaticMarkup(React.createElement(elemento, props));
  const enRevision = html(componentes.LineaDePasos, { pasos: reglas.pasosDeLaTarjeta({ estado: "EN_CURSO", etapa: "revisando" }) });
  assert.equal((enRevision.match(/data-paso="hecho"/g) ?? []).length, 2);
  assert.match(enRevision, /aria-current="step" data-paso="actual">Revisar</);
  assert.equal((enRevision.match(/data-paso="pendiente"/g) ?? []).length, 2, "Aprobar y Subido pendientes");
  assert.ok(!enRevision.includes("Necesita humano"));
  const parada = html(componentes.LineaDePasos, { pasos: reglas.pasosDeLaTarjeta({ estado: "POR_REVISAR" }) });
  assert.match(parada, /Necesita humano/);
  assert.ok(!/>Aprobar<|>Subido</.test(parada), "en lugar del paso siguiente sale «Necesita humano»");
  const revision = {
    vuelta: 2,
    revisores: [
      { clave: "seguridad", nombre: "Seguridad", estado: "aprobado" },
      { clave: "experiencia", nombre: "Experiencia del usuario", estado: "revisando" },
      { clave: "diseno", nombre: "Diseño", estado: "no_aplica" },
      { clave: "codigo", nombre: "Código", estado: "cambios" },
    ],
  };
  const cuadritos = html(componentes.CuadritosDeRevision, { revision });
  assert.match(cuadritos, />R2</);
  assert.match(cuadritos, /data-revisor="seguridad" data-estado="aprobado"[^>]*>.*Seguridad.*aprobó/);
  assert.match(cuadritos, /class="[^"]*bg-muted[^"]*" data-revisor="experiencia"/, "revisando = gris");
  assert.match(cuadritos, /class="[^"]*bg-emerald-500\/15[^"]*" data-revisor="seguridad"/, "aprobó = verde");
  assert.match(cuadritos, /class="[^"]*bg-red-500\/15[^"]*" data-revisor="codigo"/, "pidió cambios = rojo");
  assert.match(cuadritos, /grid-cols-2 gap-1\.5 sm:grid-cols-4/, "2 por fila en el celular");
});

console.log(`\n${pruebas} pruebas, todas bien`);

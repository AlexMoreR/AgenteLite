// Pruebas de la aprobación automática del Tablero IA con un prisma FALSO en memoria: aprobarSolaLaTarea,
// aprobarSolasLasPendientes y las acciones plan / resultado del trabajador (riesgo BAJO / ALTO).
// Usa las funciones reales de aprobacion-automatica.ts y trabajador.ts. No necesita base ni red.
// Nota: tableros.ts (crearTarjeta / editarTarjeta) es pesado y no se carga acá; el rechazo de BAJO con riesgo
// alto en el MCP lo cubre problemaDelRiesgo en `npm run test:tableros`.
// Correr: npm run test:tablero-aprobacion-automatica
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ prisma falso */

const DbNull = Symbol("DbNull");
const estado = { tarjetas: new Map(), historial: [], ajustes: new Map(), tableros: [] };

const coincide = (fila, where) =>
  Object.entries(where).every(([campo, esperado]) => {
    if (campo === "tablero") return !esperado.workspaceId || fila.tablero.workspaceId === esperado.workspaceId;
    const valor = fila[campo];
    if (esperado instanceof Date) return valor instanceof Date && valor.getTime() === esperado.getTime();
    if (esperado && typeof esperado === "object" && "isEmpty" in esperado) return (valor ?? []).length === 0 === esperado.isEmpty;
    if (esperado && typeof esperado === "object" && "equals" in esperado) return JSON.stringify(valor ?? []) === JSON.stringify(esperado.equals);
    if (esperado && typeof esperado === "object" && "not" in esperado) return valor !== esperado.not;
    return valor === esperado;
  });

const falso = {
  tarjetaTablero: {
    findFirst: async ({ where }) => [...estado.tarjetas.values()].find((t) => coincide(t, where)) ?? null,
    findUnique: async ({ where }) => estado.tarjetas.get(where.id) ?? null,
    findUniqueOrThrow: async ({ where }) => estado.tarjetas.get(where.id),
    findMany: async ({ where, take }) => [...estado.tarjetas.values()].filter((t) => coincide(t, where)).slice(0, take ?? 1000),
    updateMany: async ({ where, data }) => {
      const dentro = [...estado.tarjetas.values()].filter((t) => coincide(t, where));
      for (const t of dentro) {
        for (const [campo, valor] of Object.entries(data)) t[campo] = valor === DbNull ? null : valor;
      }
      return { count: dentro.length };
    },
  },
  historialTarjeta: {
    create: async ({ data }) => {
      estado.historial.push(data);
      return data;
    },
    findMany: async ({ where, take }) => estado.historial.filter((fila) => fila.tarjetaId === where.tarjetaId && (!where.accion || fila.accion === where.accion)).slice(0, take ?? 1000),
  },
  // Un solo sí (30-oct): la cuenta dueña de ws1 es "dueno" (CLIENTE y OWNER del negocio); "admin" es ADMIN de la plataforma.
  workspace: { findUnique: async ({ where }) => (where.id === "ws1" ? { ownerId: "dueno" } : { ownerId: null }) },
  user: { findUnique: async ({ where }) => ({ dueno: { role: "CLIENTE" }, admin: { role: "ADMIN" }, emanuel: { role: "EMPLEADO" } })[where.id] ?? null },
  workspaceMember: {
    findFirst: async ({ where }) => (where.workspaceId === "ws1" ? ({ dueno: { role: "OWNER" }, admin: { role: "ADMIN" }, emanuel: { role: "MEMBER" } })[where.userId] ?? null : null),
  },
  appSetting: {
    findUnique: async ({ where }) => (estado.ajustes.has(where.key) ? { value: estado.ajustes.get(where.key) } : null),
    upsert: async ({ where, create, update }) => {
      estado.ajustes.set(where.key, estado.ajustes.has(where.key) ? update.value : create.value);
    },
  },
  tableroInteligente: {
    update: async ({ where }) => void estado.tableros.push(where.id),
    updateMany: async () => ({ count: 1 }),
  },
  $transaction: async (fn) => fn(falso),
};

const mocks = {
  "@/lib/prisma": { prisma: falso },
  "@prisma/client": { Prisma: { DbNull } },
  "./tableros": { QUIEN_TRABAJADOR: "trabajador:", linkDeLaTarjeta: (id) => `https://crm.test/tablero/${id}` },
};

const auto = cargar("src/features/tableros-inteligentes/services/aprobacion-automatica.ts", mocks);
const trabajador = cargar("src/features/tableros-inteligentes/services/trabajador.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  estado.tarjetas.clear();
  estado.historial.length = 0;
  estado.ajustes.clear();
  estado.tableros.length = 0;
  // Las pruebas de antes de la regla del 25-oct esperan que una tarea ALTO quede quieta: corren con "Aprobar tareas solo" apagado.
  // Las pruebas de la regla nueva lo prenden a propósito (prenderTareas).
  estado.ajustes.set("tablero:tareas-solas:ws1", "false");
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T0 = new Date("2026-10-22T15:00:00Z");
function tarjeta(extra = {}) {
  const t = {
    id: "t1",
    tableroId: "tb1",
    titulo: "Reporte de ventas por mes",
    detalle: "Agregar un reporte nuevo de ventas por mes en una pantalla",
    estado: "POR_APROBAR",
    repo: "aizen-crm",
    zonaProtegida: [],
    riesgo: "BAJO",
    riesgoMotivo: "solo agrega una pantalla",
    riesgoPor: "CLAUDE",
    plan: null,
    resultado: null,
    intentos: 0,
    trabajoIniciadoEn: null,
    trabajoVenceEn: null,
    actualizadoEn: T0,
    borradoEn: null,
    tipoId: "tipo-tarea",
    tipo: { requiereAprobacion: true, usaEstados: true },
    tablero: { workspaceId: "ws1", nombre: "Mi tablero" },
    ...extra,
  };
  estado.tarjetas.set(t.id, t);
  return t;
}

const contexto = { claveId: "k1", workspaceId: "ws1", nombre: "Coordinador" };
const apagar = (ws = "ws1") => estado.ajustes.set(`tablero:aprobacion-automatica:${ws}`, "false");
const prenderTareas = (ws = "ws1") => estado.ajustes.delete(`tablero:tareas-solas:${ws}`);
const apagarPlanes = (ws = "ws1") => estado.ajustes.set(`tablero:planes-solos:${ws}`, "false");

/* ------------------------------------------------------------------ aprobarSolaLaTarea */

await prueba("aprobarSolaLaTarea: BAJO con repo pasa a APROBADO y deja la fila de historial", async () => {
  tarjeta();
  const r = await auto.aprobarSolaLaTarea("t1");
  assert.equal(r.aprobada, true);
  assert.equal(r.motivo, "solo agrega una pantalla");
  assert.equal(estado.tarjetas.get("t1").estado, "APROBADO");
  assert.equal(estado.historial.length, 1);
  const fila = estado.historial[0];
  assert.equal(fila.accion, "aprobar");
  assert.equal(fila.quien, auto.QUIEN_AUTOMATICO);
  assert.deepEqual(fila.antes, { estado: "POR_APROBAR" });
  assert.equal(fila.despues.automatica, true);
  assert.equal(fila.despues.momento, "tarea");
  assert.equal(fila.despues.motivo, "solo agrega una pantalla");
  assert.equal(fila.despues.estado, "APROBADO");
  assert.ok(fila.despues.textoConfirmacion.includes("aprobado automáticamente por regla de bajo riesgo"));
  assert.deepEqual(estado.tableros, ["tb1"]);
});

await prueba("aprobarSolaLaTarea: sin motivo de riesgo usa uno general", async () => {
  tarjeta({ riesgoMotivo: null });
  const r = await auto.aprobarSolaLaTarea("t1");
  assert.equal(r.aprobada, true);
  assert.ok(r.motivo.includes("sin zona protegida"));
});

await prueba("aprobarSolaLaTarea: nunca se aprueba sola si es ALTO, sin riesgo, con zona, con texto de riesgo o sin repo", async () => {
  const casos = {
    ALTO: { riesgo: "ALTO" },
    "sin riesgo": { riesgo: null },
    "zona protegida": { zonaProtegida: ["CHATS"] },
    dinero: { detalle: "Cambiar el cálculo de las comisiones" },
    permisos: { detalle: "Agregar un permiso nuevo a los usuarios" },
    "mensajes a clientes": { detalle: "Enviar mensajes a clientes por WhatsApp" },
    trabajador: { detalle: "Cambiar las reglas de aprobación del trabajador" },
    "sin repo": { repo: null },
    "migración destructiva": { detalle: 'Migración: DROP TABLE "Reporte";' },
    "ya aprobada": { estado: "APROBADO" },
  };
  for (const [nombre, extra] of Object.entries(casos)) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    const t = tarjeta(extra);
    const r = await auto.aprobarSolaLaTarea("t1");
    assert.equal(r.aprobada, false, nombre);
    assert.equal(t.estado, extra.estado ?? "POR_APROBAR", nombre);
    assert.equal(estado.historial.length, 0, nombre);
  }
});

await prueba("aprobarSolaLaTarea: con el interruptor apagado no aprueba; sin fila está prendido", async () => {
  tarjeta();
  apagar();
  const r = await auto.aprobarSolaLaTarea("t1");
  assert.equal(r.aprobada, false);
  assert.ok(r.porQue.includes("apagada"));
  assert.equal(estado.tarjetas.get("t1").estado, "POR_APROBAR");
  await auto.ponerAprobacionAutomatica("ws1", true);
  assert.equal(await auto.aprobacionAutomaticaPrendida("ws1"), true);
  assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, true);
  assert.equal(await auto.aprobacionAutomaticaPrendida("otro-negocio"), true);
});

await prueba("aprobarSolaLaTarea: tarjeta inexistente o de un tipo sin aprobación no se aprueba", async () => {
  assert.equal((await auto.aprobarSolaLaTarea("nada")).aprobada, false);
  tarjeta({ tipo: { requiereAprobacion: false, usaEstados: true } });
  assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, false);
});

/* ------------------------------------------------------------------ aprobarSolasLasPendientes */

await prueba("aprobarSolasLasPendientes: recorre solo las BAJO", async () => {
  tarjeta({ id: "a" });
  tarjeta({ id: "b", riesgo: "ALTO" });
  tarjeta({ id: "c", riesgo: null });
  tarjeta({ id: "d" });
  tarjeta({ id: "e", estado: "IDEA" });
  assert.equal(await auto.aprobarSolasLasPendientes(), 2);
  assert.equal(estado.tarjetas.get("a").estado, "APROBADO");
  assert.equal(estado.tarjetas.get("d").estado, "APROBADO");
  assert.equal(estado.tarjetas.get("b").estado, "POR_APROBAR");
  assert.equal(estado.tarjetas.get("c").estado, "POR_APROBAR");
  assert.equal(estado.tarjetas.get("e").estado, "IDEA");
});

await prueba("aprobarSolasLasPendientes: con el interruptor apagado no hace nada (por negocio)", async () => {
  tarjeta({ id: "a" });
  tarjeta({ id: "b", tablero: { workspaceId: "ws2", nombre: "Otro" } });
  apagar("ws1");
  assert.equal(await auto.aprobarSolasLasPendientes(), 1);
  assert.equal(estado.tarjetas.get("a").estado, "POR_APROBAR");
  assert.equal(estado.tarjetas.get("b").estado, "APROBADO");
});

/* ------------------------------------------------------------------ trabajador: plan */

const planDe = (extra = {}) => {
  const p = {
    riesgo: "RIESGO: BAJO — solo agrega un reporte nuevo",
    migracion: "No hay migración.",
    archivos: "- src/features/reportes/Reporte.tsx",
    zonas: "Zonas: ninguna. (No toca las rutas de chats, ni del bot de ventas.)",
    // 29-oct-2026: los planes nuevos traen criterios de aceptación (sin ellos no se aprueban solos).
    finales:
      "CRITERIOS DE ACEPTACIÓN:\n1. `npm run test:reportes` pasa.\n2. La página /cliente/reportes muestra la tabla de ventas por mes.\n\nFUERA DE ALCANCE:\n- Exportar a Excel.\n\nSUPUESTOS:\n- El mes se cuenta en hora de Bogotá, como el resto de reportes.",
    ...extra,
  };
  return `${p.riesgo}\n\n1. Contexto\nUn reporte de ventas por mes.\n\n2. Qué se cambia\nUn componente nuevo.\n\n3. Zonas protegidas\n${p.zonas}\n\n4. Migración\n${p.migracion}\n\n5. Archivos que se tocan\n${p.archivos}\n\n6. Pruebas\nCorrer todo.${p.finales ? `\n\n${p.finales}` : ""}`;
};
const planeando = (extra = {}) => tarjeta({ estado: "PLANEANDO", ...extra });

await prueba("plan: BAJO con RIESGO: BAJO limpio pasa a PLAN_APROBADO con las DOS filas de historial", async () => {
  planeando();
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe() });
  assert.equal(r.estado, "PLAN_APROBADO");
  const t = estado.tarjetas.get("t1");
  assert.equal(t.estado, "PLAN_APROBADO");
  assert.equal(t.riesgo, "BAJO");
  assert.equal(t.riesgoMotivo, "solo agrega un reporte nuevo");
  assert.equal(estado.historial.length, 2);
  const [delTrabajador, automatica] = estado.historial;
  assert.equal(delTrabajador.quien, "trabajador:k1");
  assert.equal(delTrabajador.origen, "TRABAJADOR");
  assert.equal(delTrabajador.accion, "estado");
  assert.equal(delTrabajador.despues.estado, "PLAN_LISTO");
  assert.equal(automatica.accion, "aprobar");
  assert.equal(automatica.quien, auto.QUIEN_AUTOMATICO);
  assert.equal(automatica.despues.momento, "plan");
  assert.equal(automatica.despues.estado, "PLAN_APROBADO");
  assert.equal(automatica.despues.automatica, true);
});

await prueba("plan: BAJO con un plan que muestra riesgo alto queda PLAN_LISTO y sube a ALTO por el trabajador", async () => {
  const planes = {
    "sin la línea RIESGO": planDe({ riesgo: "" }),
    "RIESGO: ALTO": planDe({ riesgo: "RIESGO: ALTO — toca dinero" }),
    "TOCA ZONA PROTEGIDA": planDe({ zonas: "TOCA ZONA PROTEGIDA: CHATS" }),
    "migración destructiva": planDe({ migracion: 'DROP TABLE "Reporte";' }),
    "archivos del trabajador": planDe({ archivos: "- trabajador-tablero/lib/crm.mjs" }),
  };
  apagarPlanes(); // sin la regla del dueño 24-oct, un plan con riesgo alto espera el sí
  for (const [nombre, plan] of Object.entries(planes)) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    planeando();
    const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan });
    const t = estado.tarjetas.get("t1");
    assert.equal(r.estado, "PLAN_LISTO", nombre);
    assert.equal(t.estado, "PLAN_LISTO", nombre);
    assert.equal(t.riesgo, "ALTO", nombre);
    assert.equal(t.riesgoPor, "TRABAJADOR", nombre);
    assert.ok(t.riesgoMotivo, nombre);
    assert.equal(estado.historial.length, 1, nombre);
  }
});

await prueba("plan: tarjeta ALTO queda PLAN_LISTO sin cambios con la regla del dueño apagada; con el interruptor apagado también", async () => {
  apagarPlanes();
  planeando({ riesgo: "ALTO", riesgoPor: "DUENO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe() });
  const t = estado.tarjetas.get("t1");
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(t.riesgo, "ALTO");
  assert.equal(t.riesgoPor, "DUENO");
  assert.equal(t.riesgoMotivo, "solo agrega una pantalla");
  assert.equal(estado.historial.length, 1);

  estado.tarjetas.clear();
  estado.historial.length = 0;
  planeando({ riesgo: null });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe() })).estado, "PLAN_LISTO");

  estado.tarjetas.clear();
  estado.historial.length = 0;
  apagar();
  planeando();
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe() })).estado, "PLAN_LISTO");
  assert.equal(estado.tarjetas.get("t1").riesgo, "BAJO");
  assert.equal(estado.historial.length, 1);
});

await prueba("plan: BAJO con zona protegida ya puesta no se aprueba solo (regla del dueño apagada)", async () => {
  apagarPlanes();
  planeando({ zonaProtegida: ["CHATS"] });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe() })).estado, "PLAN_LISTO");
});

await prueba("plan (29-oct): un plan con preguntas abiertas no se aprueba solo, ni BAJO ni con la regla del dueño 24-oct", async () => {
  const conDudas = `${planDe()}\nAPROBAR PLAN: SOLO\n\nLo que no revisé y queda pendiente:\n- El contrato exacto de envío de WhatsApp del CRM.`;
  // Con la regla del dueño prendida (cualquier riesgo).
  planeando({ riesgo: "ALTO" });
  let r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: conDudas });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.match(estado.tarjetas.get("t1").riesgoMotivo, /preguntas abiertas: Lo que no revisé y queda pendiente: El contrato exacto/);
  assert.ok(!estado.historial.some((fila) => fila.accion === "aprobar"), "no hay aprobación automática");
  // BAJO con la regla del dueño apagada (la aprobación por bajo riesgo).
  estado.tarjetas.clear();
  estado.historial.length = 0;
  apagarPlanes();
  planeando();
  r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: `${planDe()}\n\nPREGUNTAS ABIERTAS:\n- ¿Qué línea manda el aviso?` });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.ok(!estado.historial.some((fila) => fila.accion === "aprobar"));
  // La vuelta del reloj tampoco lo pasa a construir.
  estado.tarjetas.clear();
  estado.historial.length = 0;
  tarjeta({ estado: "PLAN_LISTO", plan: conDudas });
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 0);
  // "PREGUNTAS ABIERTAS: ninguna" sí pasa.
  estado.tarjetas.clear();
  estado.historial.length = 0;
  planeando();
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: `${planDe()}\n\nPREGUNTAS ABIERTAS: ninguna` })).estado, "PLAN_APROBADO");
});

await prueba("plan (29-oct, criterios de aceptación): con criterios pasa; sin criterios o con un supuesto de negocio espera tu sí; uno viejo ya aprobado sigue", async () => {
  const riesgo = cargar("src/features/tableros-inteligentes/services/reglas-riesgo.ts", mocks);
  // Con criterios (planDe los trae): pasa solo, BAJO y con la regla del dueño.
  planeando();
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: `${planDe()}\n\nPREGUNTAS ABIERTAS: ninguna` })).estado, "PLAN_APROBADO");
  assert.deepEqual(riesgo.seccionFinalDelPlan(planDe(), "criterios de aceptacion"), ["`npm run test:reportes` pasa.", "La página /cliente/reportes muestra la tabla de ventas por mes."]);
  assert.deepEqual(riesgo.seccionFinalDelPlan(planDe(), "fuera de alcance"), ["Exportar a Excel."]);
  // Sin criterios: espera tu sí con el motivo claro (BAJO con la regla apagada, y cualquier riesgo con la regla prendida).
  const sinCriterios = planDe({ finales: "FUERA DE ALCANCE: ninguno\n\nSUPUESTOS: ninguno" });
  for (const [prender, extra] of [[true, { riesgo: "ALTO" }], [false, {}]]) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    if (!prender) apagarPlanes();
    planeando(extra);
    const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: `${sinCriterios}\n\nPREGUNTAS ABIERTAS: ninguna` });
    assert.equal(r.estado, "PLAN_LISTO", `sin criterios (regla del dueño ${prender ? "prendida" : "apagada"})`);
    assert.ok(!estado.historial.some((fila) => fila.accion === "aprobar"), "no hay aprobación automática");
  }
  assert.match(riesgo.porQueElPlanNuevoEsperaTuSi(sinCriterios), /no trae CRITERIOS DE ACEPTACIÓN/);
  // Un supuesto que es una decisión de negocio (precio, gratis o pagado, texto público…) espera tu sí.
  const conSupuesto = planDe({
    finales: "CRITERIOS DE ACEPTACIÓN:\n1. La página /cliente/reportes muestra el total.\n\nSUPUESTOS:\n- El envío a Bogotá queda gratis porque el pedido no dice el precio.",
  });
  estado.tarjetas.clear();
  estado.historial.length = 0;
  estado.ajustes.clear();
  planeando({ riesgo: "ALTO" });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: conSupuesto })).estado, "PLAN_LISTO");
  assert.match(estado.tarjetas.get("t1").riesgoMotivo, /supone una decisión de negocio: El envío a Bogotá queda gratis/);
  // La vuelta del reloj tampoco pasa a construir un plan nuevo sin criterios que espera en PLAN_LISTO.
  estado.tarjetas.clear();
  estado.historial.length = 0;
  tarjeta({ estado: "PLAN_LISTO", plan: sinCriterios });
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 0);
  // Un plan VIEJO ya aprobado (sin las secciones): heredar la aprobación y subir siguen igual (porQueElPlanEsperaTuSi no mira criterios).
  const viejo = planDe({ finales: "" });
  assert.equal(riesgo.porQueElPlanEsperaTuSi(viejo), null);
  assert.equal(riesgo.porQueFaltanCriterios(viejo), "el plan no trae CRITERIOS DE ACEPTACIÓN (cómo se comprueba que quedó bien)");
});

/* ------------------------------------------------------------------ trabajador: resultado */

const enCurso = (extra = {}) => tarjeta({ estado: "EN_CURSO", ...extra });
const resultadoLimpio = (extra = {}) => ({
  resumen: "Listo",
  pruebas: "todo bien",
  paso: true,
  subeSolo: true,
  archivos: ["src/features/reportes/Reporte.tsx", "src/features/reportes/Reporte.test.ts"],
  migracionDestructiva: [],
  ...extra,
});

await prueba("resultado: BAJO con archivos limpios y subeSolo sube solo (SUBIENDO)", async () => {
  enCurso();
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio());
  assert.equal(r.estado, "SUBIENDO");
  const t = estado.tarjetas.get("t1");
  assert.equal(t.riesgo, "BAJO");
  assert.equal(t.resultado.subeSolo, true);
});

await prueba("resultado: BAJO que toca algo de riesgo alto, migración destructiva o sin archivos pasa a ALTO y POR_REVISAR", async () => {
  const resultados = {
    "archivos del trabajador": resultadoLimpio({ archivos: ["trabajador-tablero/lib/crm.mjs"] }),
    "archivos de dinero": resultadoLimpio({ archivos: ["src/features/comisiones/tabla.tsx"] }),
    "migración destructiva": resultadoLimpio({ migracionDestructiva: ["DROP"] }),
    "migración destructiva true": resultadoLimpio({ migracionDestructiva: true }),
    "sin archivos": (() => {
      const { archivos: _a, ...resto } = resultadoLimpio();
      return resto;
    })(),
    "zona protegida marcada": resultadoLimpio({ zonaProtegida: ["CHATS"] }),
  };
  for (const [nombre, cuerpo] of Object.entries(resultados)) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    enCurso();
    const r = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", cuerpo);
    const t = estado.tarjetas.get("t1");
    // CHATS que no sube sola ya no espera el sí: ERROR (30-oct-2026).
    assert.equal(r.estado, nombre === "zona protegida marcada" ? "ERROR" : "POR_REVISAR", nombre);
    assert.equal(t.riesgo, "ALTO", nombre);
    assert.equal(t.riesgoPor, "TRABAJADOR", nombre);
    assert.ok(t.riesgoMotivo, nombre);
    assert.equal(t.resultado.subeSolo, false, nombre);
  }
});

await prueba("resultado: tarjeta ALTO normal, sin zona, sigue subiendo sola como hoy", async () => {
  enCurso({ riesgo: "ALTO", riesgoPor: "DUENO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio({ archivos: ["trabajador-tablero/lib/crm.mjs"] }));
  assert.equal(r.estado, "SUBIENDO");
  assert.equal(estado.tarjetas.get("t1").riesgo, "ALTO");
  assert.equal(estado.tarjetas.get("t1").riesgoPor, "DUENO");

  estado.tarjetas.clear();
  enCurso({ riesgo: null });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio())).estado, "SUBIENDO");
});

await prueba("resultado: ALTO con zona CHATS (26-oct-2026) sube sola como el bot; con META_ADS marcada por gasto (subeSolo false) espera", async () => {
  enCurso({ riesgo: "ALTO" });
  const chats = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio({ zonaProtegida: ["CHATS"] }));
  assert.equal(chats.estado, "SUBIENDO");
  estado.tarjetas.clear();
  enCurso({ riesgo: "ALTO" });
  const gasto = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio({ zonaProtegida: ["META_ADS"], subeSolo: false }));
  assert.equal(gasto.estado, "POR_REVISAR");
});

await prueba("resultado: el sí del dueño ya dado se hereda aunque la tarea se reconstruya (27-oct); dinero, gasto en Meta Ads o un envío nuevo piden de nuevo", async () => {
  const sinSi = { subeSolo: false, zonaProtegida: ["CHATS"], esperaPor: "falta la prueba de que los chats no mandan mensajes nuevos a clientes" };
  const conSiDelDueno = () => estado.historial.push({ tarjetaId: "t1", accion: "aprobar", despues: { via: "voz", momento: "tarea" } });
  // Sin sí del dueño en el historial, espera como antes.
  estado.historial.length = 0;
  enCurso({ riesgo: "ALTO" });
  // (CHATS ya no espera el sí final: sin sí del dueño que se herede, va a ERROR con su motivo; 30-oct-2026.)
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio(sinSi))).estado, "ERROR");
  // Un sí automático no cuenta.
  estado.tarjetas.clear();
  estado.historial.push({ tarjetaId: "t1", accion: "aprobar", despues: { via: "automatica" } });
  enCurso({ riesgo: "ALTO" });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio(sinSi))).estado, "ERROR");
  assert.match(estado.tarjetas.get("t1").resultado.error.motivo, /^construido, no sube: falta la prueba/);
  // Con el sí del dueño sube sola, con la nota de la herencia, y el motivo viejo se borra.
  estado.tarjetas.clear();
  conSiDelDueno();
  enCurso({ riesgo: "ALTO" });
  const heredada = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio(sinSi));
  assert.equal(heredada.estado, "SUBIENDO");
  assert.equal(estado.tarjetas.get("t1").resultado.subeSolo, true);
  assert.equal(estado.tarjetas.get("t1").resultado.esperaPor, undefined);
  assert.match(estado.historial.at(-1).despues.nota, /el dueño ya la había aprobado/);
  // Un envío nuevo en chats, el gasto en Meta Ads o un plan de dinero se piden de nuevo aunque ya hubiera un sí.
  for (const [etiqueta, extra, tarjetaExtra] of [
    ["envío nuevo en chats", { esperaPor: "el cambio agrega un envío de mensaje en chats (espera el sí del dueño aunque el plan lo mencione)" }, {}],
    ["gasto en Meta Ads", { zonaProtegida: ["META_ADS"], esperaPor: "gasto en Meta Ads (daily_budget)" }, {}],
    ["plan con gasto en Meta Ads", {}, { plan: "RIESGO: ALTO\nGASTO EN META ADS: sube el presupuesto" }],
    ["migración destructiva", { migracionDestructiva: ["DROP"] }, {}],
  ]) {
    estado.tarjetas.clear();
    enCurso({ riesgo: "ALTO", ...tarjetaExtra });
    const r = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio({ ...sinSi, esperaPor: undefined, ...extra }));
    // Solo el gasto en Meta Ads sigue esperando el sí; lo demás en CHATS ya no se queda esperando: ERROR.
    assert.equal(r.estado, extra.zonaProtegida?.includes("META_ADS") ? "POR_REVISAR" : "ERROR", etiqueta);
  }
  estado.historial.length = 0;
});

/* ------------------------------------------------------------------ regla del dueño 24-oct */

const FRASE_PLAN_SOLO = "plan aprobado automáticamente (regla del dueño 24-oct)";
const planAlto = (extra = {}) => planDe({ riesgo: "RIESGO: ALTO — toca el bot de ventas", ...extra });

await prueba("regla 24-oct: plan normal con riesgo ALTO e interruptor prendido pasa a PLAN_APROBADO con 2 filas de historial", async () => {
  planeando({ riesgo: "ALTO", riesgoPor: "DUENO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planAlto() });
  assert.equal(r.estado, "PLAN_APROBADO");
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_APROBADO");
  assert.equal(estado.historial.length, 2);
  assert.equal(estado.historial[0].despues.estado, "PLAN_LISTO");
  const segunda = estado.historial[1];
  assert.equal(segunda.accion, "aprobar");
  assert.equal(segunda.quien, auto.QUIEN_AUTOMATICO);
  assert.equal(segunda.despues.estado, "PLAN_APROBADO");
  assert.equal(segunda.despues.regla, "dueno-24-oct");
  assert.ok(segunda.despues.textoConfirmacion.includes(FRASE_PLAN_SOLO));
});

await prueba("regla 24-oct: con la línea APROBAR PLAN: SOLO pasa; tarjeta sin riesgo también", async () => {
  planeando({ riesgo: null });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: `${planAlto()}\nAPROBAR PLAN: SOLO` });
  assert.equal(r.estado, "PLAN_APROBADO");
  assert.equal(estado.historial.length, 2);
});

await prueba("regla 24-oct: plan que toca abonos queda PLAN_LISTO con el motivo", async () => {
  planeando({ riesgo: "BAJO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe({ archivos: "- src/features/abonos/tabla.tsx" }) });
  const t = estado.tarjetas.get("t1");
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(t.estado, "PLAN_LISTO");
  assert.equal(t.riesgo, "ALTO");
  assert.equal(t.riesgoPor, "TRABAJADOR");
  assert.match(t.riesgoMotivo, /dinero/);
  assert.equal(estado.historial.length, 1);
  assert.match(estado.historial[0].despues.nota, /espera tu sí/);
});

await prueba("regla 24-oct: plan de presupuesto o campañas de Meta queda PLAN_LISTO", async () => {
  const planes = {
    presupuesto: planAlto({ archivos: "- src/features/meta/ajuste.ts\nSube el presupuesto diario de la campaña." }),
    "activar campañas": planAlto({ archivos: "- src/features/meta/ajuste.ts\nActivar las campañas nuevas." }),
    "línea ESPERA TU SÍ": `${planAlto()}\nAPROBAR PLAN: ESPERA TU SÍ — crea gasto en Meta Ads`,
  };
  for (const [nombre, plan] of Object.entries(planes)) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    planeando({ riesgo: "ALTO", riesgoPor: "CLAUDE" });
    const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan });
    assert.equal(r.estado, "PLAN_LISTO", nombre);
    assert.equal(estado.tarjetas.get("t1").estado, "PLAN_LISTO", nombre);
    assert.equal(estado.historial.length, 1, nombre);
  }
});

await prueba("regla 24-oct: con el interruptor tablero:planes-solos apagado el plan queda PLAN_LISTO", async () => {
  apagarPlanes();
  planeando({ riesgo: "ALTO", riesgoPor: "DUENO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planAlto() });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(estado.historial.length, 1);
  assert.equal(await auto.aprobarPlanesSoloPrendido("ws1"), false);
  await auto.ponerAprobarPlanesSolo("ws1", true);
  assert.equal(await auto.aprobarPlanesSoloPrendido("ws1"), true);
  assert.equal(await auto.aprobarPlanesSoloPrendido("otro"), true);
});

await prueba("regla 24-oct: tarjeta con zona protegida que no arranca sola (META_ADS): el plan espera su sí en la pantalla (/tomar lo exige)", async () => {
  planeando({ riesgo: "ALTO", zonaProtegida: ["META_ADS"] });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planAlto() });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(estado.historial.length, 1);
  assert.ok(estado.historial[0].despues.nota.includes("zona protegida"));
});

await prueba("regla 24-oct: tarjeta BAJO con la línea ESPERA TU SÍ o gasto en Meta Ads no se aprueba por la vía de bajo riesgo", async () => {
  planeando();
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", {
    plan: `${planDe()}\nAPROBAR PLAN: ESPERA TU SÍ — sube el gasto en Meta Ads`,
  });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(estado.historial.length, 1);
  assert.equal(estado.tarjetas.get("t1").riesgo, "ALTO");
  estado.historial.length = 0;
  planeando({ id: "t2" });
  const r2 = await trabajador.accionDelTrabajador(contexto, "t2", "plan", { plan: `${planDe()}\nSe va a activar las campañas nuevas.` });
  assert.equal(r2.estado, "PLAN_LISTO");
});

await prueba("aprobarPlanesListosQueEsperan: no toca las tarjetas con una zona que no arranca sola", async () => {
  tarjeta({ id: "zona", estado: "PLAN_LISTO", plan: planAlto(), zonaProtegida: ["META_ADS"] });
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 0);
  assert.equal(estado.tarjetas.get("zona").estado, "PLAN_LISTO");
});

await prueba("aprobarPlanesListosQueEsperan: pasa la normal, deja la de abonos, no toca ERROR", async () => {
  const sano = planAlto();
  tarjeta({ id: "normal", estado: "PLAN_LISTO", plan: sano, riesgo: "ALTO" });
  tarjeta({ id: "abonos", estado: "PLAN_LISTO", plan: planDe({ archivos: "- src/features/abonos/tabla.tsx" }) });
  tarjeta({ id: "error", estado: "ERROR", plan: sano });
  tarjeta({ id: "sinplan", estado: "PLAN_LISTO", plan: null });
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 1);
  assert.equal(estado.tarjetas.get("normal").estado, "PLAN_APROBADO");
  assert.equal(estado.tarjetas.get("abonos").estado, "PLAN_LISTO");
  assert.equal(estado.tarjetas.get("error").estado, "ERROR");
  assert.equal(estado.tarjetas.get("sinplan").estado, "PLAN_LISTO");
  assert.equal(estado.historial.length, 1);
  assert.equal(estado.historial[0].despues.regla, "dueno-24-oct");
  assert.ok(estado.historial[0].despues.textoConfirmacion.includes(FRASE_PLAN_SOLO));
  assert.deepEqual(estado.historial[0].antes, { estado: "PLAN_LISTO" });
});

await prueba("aprobarPlanesListosQueEsperan: con el interruptor apagado no hace nada (por negocio)", async () => {
  tarjeta({ id: "a", estado: "PLAN_LISTO", plan: planAlto() });
  tarjeta({ id: "b", estado: "PLAN_LISTO", plan: planAlto(), tablero: { workspaceId: "ws2", nombre: "Otro" } });
  apagarPlanes("ws1");
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 1);
  assert.equal(estado.tarjetas.get("a").estado, "PLAN_LISTO");
  assert.equal(estado.tarjetas.get("b").estado, "PLAN_APROBADO");
});

/* ------------------------------------------------------------------ un solo sí del dueño (30-oct) */

const MOTIVO_UN_SOLO_SI = "la tarea ya la aprobó el dueño (un solo sí, 30-oct)";
const planDeAbonos = () => planDe({ archivos: "- src/features/abonos/tabla.tsx" });
// La fila que deja el sí del dueño a la tarea (registroDeAprobacion): momento "tarea" y via "pantalla" o "voz".
const siDeLaTarea = (tarjetaId, via = "voz", userId = "dueno") =>
  estado.historial.push({ tarjetaId, accion: "aprobar", quien: userId, despues: { estado: "APROBADO", momento: "tarea", via, userId } });
// La fila que deja una parte al heredar la aprobación de su madre (partirTarjeta en trabajador.ts, con zona protegida).
const siHeredado = (tarjetaId, madre) =>
  estado.historial.push({
    tarjetaId,
    accion: "aprobar",
    quien: "trabajador:k1",
    despues: { estado: "APROBADO", momento: "tarea", via: "pantalla", userId: "trabajador:k1", como: "heredada", heredadaDe: madre },
  });

await prueba("un solo sí: con la tarea aprobada por voz, un plan de abonos pasa a PLAN_APROBADO con la regla 24-oct y el motivo del sí único", async () => {
  planeando({ riesgo: "BAJO" });
  siDeLaTarea("t1", "voz");
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDeAbonos() });
  assert.equal(r.estado, "PLAN_APROBADO");
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_APROBADO");
  const ultima = estado.historial.at(-1);
  assert.equal(ultima.accion, "aprobar");
  assert.equal(ultima.quien, auto.QUIEN_AUTOMATICO);
  assert.equal(ultima.despues.estado, "PLAN_APROBADO");
  assert.equal(ultima.despues.momento, "plan");
  assert.equal(ultima.despues.via, "automatica");
  assert.equal(ultima.despues.regla, "dueno-24-oct");
  assert.equal(ultima.despues.motivo, MOTIVO_UN_SOLO_SI);
  assert.equal(auto.MOTIVO_UN_SOLO_SI, MOTIVO_UN_SOLO_SI);
});

await prueba("un solo sí: si la tarea se aprobó sola (via automatica), el plan de abonos queda PLAN_LISTO", async () => {
  planeando({ riesgo: "BAJO" });
  siDeLaTarea("t1", "automatica");
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDeAbonos() });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_LISTO");
  assert.equal(estado.historial.filter((fila) => fila.despues?.momento === "plan").length, 0);
  assert.match(estado.historial.at(-1).despues.nota, /espera tu sí/);
});

await prueba("un solo sí: un plan normal con la tarea aprobada conserva el motivo de siempre", async () => {
  planeando({ riesgo: "ALTO", riesgoPor: "DUENO" });
  siDeLaTarea("t1", "pantalla");
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planAlto() });
  assert.equal(r.estado, "PLAN_APROBADO");
  assert.equal(estado.historial.at(-1).despues.motivo, "el plan no toca dinero de Gestión ni gasto en Meta Ads");
});

await prueba("un solo sí: un plan de Meta Ads con la tarea aprobada por el dueño sigue en PLAN_LISTO", async () => {
  planeando({ riesgo: "ALTO", riesgoPor: "CLAUDE" });
  siDeLaTarea("t1", "pantalla");
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", {
    plan: planAlto({ archivos: "- src/features/meta/ajuste.ts\nSube el presupuesto diario de la campaña." }),
  });
  assert.equal(r.estado, "PLAN_LISTO");
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_LISTO");
  assert.equal(estado.historial.filter((fila) => fila.despues?.momento === "plan").length, 0);
  // La vuelta del reloj tampoco lo pasa.
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 0);
  assert.equal(estado.tarjetas.get("t1").estado, "PLAN_LISTO");
});

await prueba("un solo sí: aprobarPlanesListosQueEsperan pasa la PLAN_LISTO de abonos con el sí del dueño y deja la que no lo tiene", async () => {
  tarjeta({ id: "consi", estado: "PLAN_LISTO", plan: planDeAbonos(), riesgo: "ALTO" });
  tarjeta({ id: "sinsi", estado: "PLAN_LISTO", plan: planDeAbonos(), riesgo: "ALTO" });
  tarjeta({ id: "automatica", estado: "PLAN_LISTO", plan: planDeAbonos(), riesgo: "ALTO" });
  tarjeta({ id: "meta", estado: "PLAN_LISTO", plan: planAlto({ archivos: "- src/features/meta/ajuste.ts\nActivar las campañas nuevas." }), riesgo: "ALTO" });
  siDeLaTarea("consi", "pantalla");
  siDeLaTarea("automatica", "automatica");
  siDeLaTarea("meta", "voz");
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 1);
  assert.equal(estado.tarjetas.get("consi").estado, "PLAN_APROBADO");
  for (const id of ["sinsi", "automatica", "meta"]) assert.equal(estado.tarjetas.get(id).estado, "PLAN_LISTO", id);
  const nueva = estado.historial.at(-1);
  assert.equal(nueva.tarjetaId, "consi");
  assert.equal(nueva.despues.regla, "dueno-24-oct");
  assert.equal(nueva.despues.motivo, MOTIVO_UN_SOLO_SI);
  assert.deepEqual(nueva.antes, { estado: "PLAN_LISTO" });
});

await prueba("un solo sí: el sí en pantalla de quien no es la cuenta dueña (ADMIN, aprobador) no cuenta: el plan de abonos queda PLAN_LISTO", async () => {
  for (const quien of ["admin", "emanuel", "nadie"]) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    planeando({ riesgo: "BAJO" });
    siDeLaTarea("t1", "pantalla", quien);
    const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDeAbonos() });
    assert.equal(r.estado, "PLAN_LISTO", quien);
  }
});

await prueba("un solo sí: una parte con la aprobación heredada vale solo si el dueño aprobó la tarea madre", async () => {
  // Madre aprobada sola (regla 25-oct): la parte hereda una fila con via "pantalla", pero no hay sí del dueño.
  estado.historial.push({ tarjetaId: "madre-sola", accion: "aprobar", quien: auto.QUIEN_AUTOMATICO, despues: { estado: "APROBADO", momento: "tarea", via: "automatica", userId: auto.QUIEN_AUTOMATICO } });
  planeando({ riesgo: "BAJO" });
  siHeredado("t1", "madre-sola");
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDeAbonos() });
  assert.equal(r.estado, "PLAN_LISTO");
  // Madre aprobada por el dueño: la parte sí pasa.
  siDeLaTarea("madre-dueno", "pantalla");
  planeando({ id: "t2", riesgo: "BAJO" });
  siHeredado("t2", "madre-dueno");
  const r2 = await trabajador.accionDelTrabajador(contexto, "t2", "plan", { plan: planDeAbonos() });
  assert.equal(r2.estado, "PLAN_APROBADO");
  assert.equal(estado.historial.at(-1).despues.motivo, MOTIVO_UN_SOLO_SI);
});

/* ------------------------------------------------------------------ regla del dueño 25-oct: las tareas arrancan solas */

const FRASE_TAREA_SOLA = "aprobada automáticamente (regla del dueño 25-oct)";

await prueba("regla 25-oct: una tarea nueva de riesgo ALTO arranca sola y deja la frase del 25-oct en el historial", async () => {
  prenderTareas();
  tarjeta({ riesgo: "ALTO", riesgoMotivo: "habla de chats", titulo: "Mejorar la pantalla de reportes", detalle: "Ordenar las columnas" });
  const r = await auto.aprobarSolaLaTarea("t1");
  assert.equal(r.aprobada, true);
  assert.equal(estado.tarjetas.get("t1").estado, "APROBADO");
  assert.equal(estado.historial.length, 1);
  const h = estado.historial[0];
  assert.equal(h.accion, "aprobar");
  assert.equal(h.despues.via, "automatica");
  assert.equal(h.despues.regla, "dueno-25-oct");
  assert.equal(h.despues.textoConfirmacion, FRASE_TAREA_SOLA);
  assert.deepEqual(h.antes, { estado: "POR_APROBAR" });
});

await prueba("regla 25-oct: una tarea sin riesgo puesto también arranca sola", async () => {
  prenderTareas();
  tarjeta({ riesgo: null, riesgoMotivo: null, titulo: "Ajustar un color", detalle: "Cambiar el azul" });
  assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, true);
});

await prueba("regla 25-oct: la tarea que habla de abonos, de presupuesto en Meta o de campañas se queda esperándote con su motivo", async () => {
  prenderTareas();
  const casos = [
    ["Corregir los abonos de la tabla", "habla de dinero de Gestión"],
    ["Revisar la nómina", "habla de dinero de Gestión"],
    ["Subir el presupuesto diario", "presupuesto"],
    ["Activar las campañas nuevas", "presupuesto"],
    ["Facturación", "habla de dinero de Gestión"],
  ];
  for (const [titulo, motivo] of casos) {
    estado.tarjetas.clear();
    estado.historial.length = 0;
    tarjeta({ riesgo: "ALTO", titulo, detalle: "" });
    const r = await auto.aprobarSolaLaTarea("t1");
    assert.equal(r.aprobada, false, titulo);
    assert.ok(r.porQue.includes(motivo), `${titulo}: ${r.porQue}`);
    assert.equal(estado.tarjetas.get("t1").estado, "POR_APROBAR");
    assert.equal(estado.historial.length, 0);
  }
  // El detalle también cuenta, no solo el título.
  estado.tarjetas.clear();
  tarjeta({ riesgo: "ALTO", titulo: "Pantalla nueva", detalle: "Muestra los saldos de cada cliente" });
  assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, false);
});

await prueba("regla 25-oct: una tarea sin repo no se toca", async () => {
  prenderTareas();
  tarjeta({ repo: null, riesgo: "ALTO", titulo: "Algo", detalle: "" });
  const r = await auto.aprobarSolaLaTarea("t1");
  assert.equal(r.aprobada, false);
  assert.equal(estado.tarjetas.get("t1").estado, "POR_APROBAR");
  assert.equal(await auto.aprobarSolasLasPendientes(), 0);
  assert.equal(estado.tarjetas.get("t1").estado, "POR_APROBAR");
});

await prueba("regla 25-oct: zonas CHATS y BOT_VENTAS arrancan solas; META_ADS y LIBRO_V3 esperan", async () => {
  prenderTareas();
  for (const zona of [["CHATS"], ["BOT_VENTAS"], ["CHATS", "BOT_VENTAS"]]) {
    estado.tarjetas.clear();
    tarjeta({ riesgo: "ALTO", zonaProtegida: zona, titulo: "Mejorar la bandeja", detalle: "" });
    assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, true, zona.join());
    assert.equal(estado.tarjetas.get("t1").estado, "APROBADO");
  }
  for (const zona of [["META_ADS"], ["LIBRO_V3"], ["CHATS", "META_ADS"]]) {
    estado.tarjetas.clear();
    tarjeta({ riesgo: "ALTO", zonaProtegida: zona, titulo: "Mejorar la bandeja", detalle: "" });
    const r = await auto.aprobarSolaLaTarea("t1");
    assert.equal(r.aprobada, false, zona.join());
    assert.ok(r.porQue.includes("zona protegida"));
    assert.equal(estado.tarjetas.get("t1").estado, "POR_APROBAR");
  }
});

await prueba("regla 25-oct: con 'Aprobar tareas solo' apagado una tarea ALTO vuelve a pedir tu aprobación", async () => {
  tarjeta({ riesgo: "ALTO", titulo: "Mejorar la pantalla de reportes", detalle: "" });
  assert.equal(await auto.aprobarTareasSoloPrendido("ws1"), false);
  assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, false);
  assert.equal(estado.tarjetas.get("t1").estado, "POR_APROBAR");
  // Una BAJO limpia sí sigue aprobándose sola (regla de antes).
  tarjeta({ id: "t2", riesgo: "BAJO" });
  assert.equal((await auto.aprobarSolaLaTarea("t2")).aprobada, true);
  assert.equal(estado.historial[0].despues.textoConfirmacion.includes("bajo riesgo"), true);
  // Se prende con la función y sin fila está prendido.
  await auto.ponerAprobarTareasSolo("ws1", true);
  assert.equal(await auto.aprobarTareasSoloPrendido("ws1"), true);
  assert.equal(await auto.aprobarTareasSoloPrendido("otro-negocio"), true);
  assert.equal((await auto.aprobarSolaLaTarea("t1")).aprobada, true);
});

await prueba("regla 25-oct: la vuelta del reloj aprueba las pendientes y deja las de dinero", async () => {
  prenderTareas();
  tarjeta({ id: "a", riesgo: "ALTO", titulo: "Pantalla de reportes", detalle: "" });
  tarjeta({ id: "b", riesgo: null, titulo: "Mejorar la lista", detalle: "" });
  tarjeta({ id: "chats", riesgo: "ALTO", zonaProtegida: ["CHATS"], titulo: "Mejorar la bandeja", detalle: "" });
  tarjeta({ id: "abonos", riesgo: "ALTO", titulo: "Arreglar los abonos", detalle: "" });
  tarjeta({ id: "meta", riesgo: "ALTO", titulo: "Pantalla", detalle: "Crear gasto en Meta Ads", zonaProtegida: ["META_ADS"] });
  tarjeta({ id: "sinrepo", repo: null, riesgo: "ALTO", titulo: "Algo", detalle: "" });
  tarjeta({ id: "otro", riesgo: "ALTO", titulo: "Pantalla de otro negocio", detalle: "", tablero: { workspaceId: "ws2", nombre: "Otro" } });
  estado.ajustes.set("tablero:tareas-solas:ws2", "false");
  assert.equal(await auto.aprobarSolasLasPendientes(), 3);
  for (const id of ["a", "b", "chats"]) assert.equal(estado.tarjetas.get(id).estado, "APROBADO", id);
  for (const id of ["abonos", "meta", "sinrepo", "otro"]) assert.equal(estado.tarjetas.get(id).estado, "POR_APROBAR", id);
});

await prueba("regla 25-oct: el plan de una tarjeta CHATS pasa solo a construir; el de META_ADS espera", async () => {
  planeando({ riesgo: "ALTO", zonaProtegida: ["CHATS"] });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planAlto() });
  assert.equal(r.estado, "PLAN_APROBADO");
  assert.equal(estado.historial.at(-1).despues.via, "automatica");
  planeando({ id: "t2", riesgo: "ALTO", zonaProtegida: ["META_ADS"] });
  const r2 = await trabajador.accionDelTrabajador(contexto, "t2", "plan", { plan: planAlto() });
  assert.equal(r2.estado, "PLAN_LISTO");
});

await prueba("regla 25-oct: la vuelta del reloj de planes pasa a construir los de CHATS y BOT_VENTAS", async () => {
  tarjeta({ id: "c", estado: "PLAN_LISTO", plan: planAlto(), zonaProtegida: ["CHATS"] });
  tarjeta({ id: "m", estado: "PLAN_LISTO", plan: planAlto(), zonaProtegida: ["LIBRO_V3"] });
  assert.equal(await auto.aprobarPlanesListosQueEsperan(), 1);
  assert.equal(estado.tarjetas.get("c").estado, "PLAN_APROBADO");
  assert.equal(estado.tarjetas.get("m").estado, "PLAN_LISTO");
});


console.log(`\n${pruebas} pruebas, todas bien`);

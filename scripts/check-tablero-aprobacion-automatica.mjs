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
    ...extra,
  };
  return `${p.riesgo}\n\n1. Contexto\nUn reporte de ventas por mes.\n\n2. Qué se cambia\nUn componente nuevo.\n\n3. Zonas protegidas\n${p.zonas}\n\n4. Migración\n${p.migracion}\n\n5. Archivos que se tocan\n${p.archivos}\n\n6. Pruebas\nCorrer todo.`;
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

await prueba("plan: tarjeta ALTO queda PLAN_LISTO sin cambios; con el interruptor apagado también", async () => {
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

await prueba("plan: BAJO con zona protegida ya puesta no se aprueba solo", async () => {
  planeando({ zonaProtegida: ["CHATS"] });
  assert.equal((await trabajador.accionDelTrabajador(contexto, "t1", "plan", { plan: planDe() })).estado, "PLAN_LISTO");
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
    assert.equal(r.estado, "POR_REVISAR", nombre);
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

await prueba("resultado: ALTO con zona protegida marcada espera el sí del dueño", async () => {
  enCurso({ riesgo: "ALTO" });
  const r = await trabajador.accionDelTrabajador(contexto, "t1", "resultado", resultadoLimpio({ zonaProtegida: ["CHATS"] }));
  assert.equal(r.estado, "POR_REVISAR");
});

console.log(`\n${pruebas} pruebas, todas bien`);

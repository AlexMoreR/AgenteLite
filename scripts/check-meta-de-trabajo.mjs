// Pruebas de la meta de tareas trabajando a la vez del Tablero IA (meta-de-trabajo.ts, 27-nov-2026, parte 1 de 3): cuántas
// cuentan como trabajando (planear no), el motivo en UNA línea cuando hay menos que la meta (en su orden: pausa, sesión,
// apagado, cupos o nube, aizen1, choque, esperas, errores, fila vacía) y la meta guardada por negocio (1 a 20, 10 sin nada).
// Usa un prisma FALSO: no necesita base ni red.
// Correr: npm run test:meta-de-trabajo
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

/* ------------------------------------------------------------------ falsos */

const ajustes = new Map();
const prismaFalso = {
  appSetting: {
    upsert: async ({ where, create, update }) => {
      ajustes.set(where.key, ajustes.has(where.key) ? update.value : create.value);
    },
    findUnique: async ({ where }) => (ajustes.has(where.key) ? { value: ajustes.get(where.key) } : null),
  },
};

const mocks = { "@/lib/prisma": { prisma: prismaFalso }, "@prisma/client": { Prisma: {} } };
const meta = cargar("src/features/tableros-inteligentes/services/meta-de-trabajo.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  ajustes.clear();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Una entrada del motivo sin ninguna causa: cada prueba prende solo la suya. */
const base = (cambios = {}) => ({
  trabajando: 4,
  meta: 10,
  pausaUso: null,
  sesionVencida: false,
  apagado: false,
  cupos: { cupos: 10, enFila: 3, corriendo: 4 },
  nubeLlena: null,
  aizen1Ocupado: false,
  esperas: [],
  dependencias: [],
  esperanTuSi: 0,
  errores: 0,
  candidatas: 0,
  ...cambios,
});
const pausada = { activa: true, pausado: true, umbral: 95, sesion: { porcentaje: 96, reinicio: "" }, semana: { porcentaje: 40, reinicio: "" } };
const choque = { tarjetaId: "a", titulo: "Panel de ventas", motivo: "tocan el mismo archivo", tipo: "choque", contra: "b", tituloContra: "Bandeja de chats" };

/* ------------------------------------------------------------------ contar */

await prueba("contar: 4 construyendo o vigilando más 1 planeando da «4 de 10» (planear no cuenta)", () => {
  const tareas = [{ etapa: "construyendo" }, { etapa: "vigilando" }, { etapa: "construyendo" }, { etapa: "vigilando" }, { etapa: "planeando" }];
  const trabajando = meta.contarTrabajando(tareas);
  assert.equal(trabajando, 4);
  assert.equal(meta.trabajandoDeLaMeta(trabajando, meta.META_TRABAJANDO_POR_DEFECTO), "4 de 10");
  assert.equal(meta.contarTrabajando([{ etapa: "probando" }, { etapa: "revisando" }, { etapa: "subiendo" }, { etapa: "planeando" }, { etapa: "otra" }]), 3);
  assert.equal(meta.contarTrabajando([]), 0);
});

/* ------------------------------------------------------------------ el motivo, en su orden */

await prueba("motivo: con la meta alcanzada no hay frase", () => {
  assert.equal(meta.motivoBajoMeta(base({ trabajando: 10 })), null);
  assert.equal(meta.motivoBajoMeta(base({ trabajando: 12, pausaUso: pausada })), null, "aunque haya causas, si se llega a la meta no se dice nada");
});

await prueba("motivo 1: con la pausa activa empieza por «pausado por el uso de Claude» y manda sobre todo lo demás", () => {
  const texto = meta.motivoBajoMeta(base({ pausaUso: pausada, sesionVencida: true, apagado: true, cupos: { cupos: 7, enFila: 0, corriendo: 4 }, errores: 3 }));
  assert.ok(texto.startsWith("pausado por el uso de Claude"), texto);
  assert.equal(texto, "pausado por el uso de Claude (96 % de 95 %)", "el mayor entre la sesión y la semana, frente al umbral");
  assert.notEqual(meta.motivoBajoMeta(base({ pausaUso: { ...pausada, activa: false } })).slice(0, 7), "pausado", "con la pausa apagada no cuenta");
  assert.notEqual(meta.motivoBajoMeta(base({ pausaUso: { ...pausada, pausado: false } })).slice(0, 7), "pausado");
});

await prueba("motivo 2 y 3: sesión de Claude vencida, después Coordinador apagado", () => {
  assert.match(meta.motivoBajoMeta(base({ sesionVencida: true, apagado: true })), /sesión de Claude en aizen1 está vencida/);
  assert.equal(meta.motivoBajoMeta(base({ apagado: true, errores: 2 })), "el Coordinador está apagado o sin conexión");
});

await prueba("motivo 4: con cupos 7 dice «los cupos configurados dan 7»; la nube llena dice sus puestos", () => {
  const texto = meta.motivoBajoMeta(base({ cupos: { cupos: 7, enFila: 5, corriendo: 4 }, aizen1Ocupado: true, esperas: [choque] }));
  assert.equal(texto, "los cupos configurados dan 7, la meta es 10");
  assert.equal(meta.motivoBajoMeta(base({ nubeLlena: { puestos: 3 }, aizen1Ocupado: true })), "la nube ya usa sus 3 puestos");
  assert.match(meta.motivoBajoMeta(base({ esperas: [{ ...choque, tipo: "nube" }] })), /^la nube está llena: 1 espera un puesto$/);
  assert.notEqual(meta.motivoBajoMeta(base({ cupos: null, errores: 1 })), null, "sin cupos (Coordinador viejo) sigue con lo demás");
});

await prueba("motivo 5: aizen1 ocupado (CPU o memoria en rojo, o esperando al PC)", () => {
  assert.match(meta.motivoBajoMeta(base({ aizen1Ocupado: true, esperas: [choque] })), /^aizen1 está ocupado/);
  assert.match(meta.motivoBajoMeta(base({ esperas: [{ ...choque, tipo: "aizen1" }] })), /^aizen1 está ocupado/);
  assert.equal(meta.aizen1EstaOcupado({ cpu: 90, memoriaPorciento: 10, esperandoPc: false }), true);
  assert.equal(meta.aizen1EstaOcupado({ cpu: 10, memoriaPorciento: 86, esperandoPc: false }), true);
  assert.equal(meta.aizen1EstaOcupado({ cpu: 10, memoriaPorciento: 10, esperandoPc: true }), true);
  assert.equal(meta.aizen1EstaOcupado({ cpu: 85, memoriaPorciento: null, esperandoPc: false }), false, "85 todavía no es rojo");
  assert.equal(meta.aizen1EstaOcupado(null), false);
});

await prueba("motivo 6: una espera tipo choque nombra las dos tarjetas; una sin tipo sale como «en fila: …»", () => {
  const texto = meta.motivoBajoMeta(base({ esperas: [choque], dependencias: [{ tarjetaId: "x", esperaA: "La base" }], errores: 1 }));
  assert.equal(texto, "«Panel de ventas» choca con «Bandeja de chats» (tocan el mismo archivo)");
  assert.match(meta.motivoBajoMeta(base({ esperas: [choque, { ...choque, tarjetaId: "c" }] })), /\(y 1 más\)$/);
  assert.match(meta.motivoBajoMeta(base({ esperas: [{ ...choque, tituloContra: null }] })), /choca con «b»/, "sin el título, el id");
  const viejo = { tarjetaId: "v", titulo: "Vieja", motivo: "toca la misma zona que otra tarea", tipo: null, contra: null, tituloContra: null };
  assert.equal(meta.motivoBajoMeta(base({ esperas: [viejo] })), "en fila: toca la misma zona que otra tarea");
});

await prueba("motivo 7: «N esperan a «X»», las que esperan a su agente, versión o motor, y las que esperan tu sí", () => {
  const dependencias = [
    { tarjetaId: "p2", esperaA: "La parte 1" },
    { tarjetaId: "p3", esperaA: "La parte 1" },
    { tarjetaId: "z", esperaA: "Otra" },
  ];
  assert.equal(meta.motivoBajoMeta(base({ dependencias, errores: 4 })), "2 esperan a «La parte 1» y 1 a otras");
  assert.equal(meta.motivoBajoMeta(base({ esperanTuSi: 2, errores: 1 })), "2 esperan tu sí al plan");
  assert.equal(meta.motivoBajoMeta(base({ esperas: [{ ...choque, tipo: "agente" }], esperanTuSi: 1 })), "1 espera a su agente; 1 espera tu sí al plan");
});

await prueba("motivo 8 y 9: «N tarjetas en error»; sin candidatas, errores ni dependencias dice «fila vacía»", () => {
  assert.equal(meta.motivoBajoMeta(base({ errores: 3, candidatas: 2 })), "3 tarjetas en error");
  assert.equal(meta.motivoBajoMeta(base({ errores: 1 })), "1 tarjeta en error");
  assert.equal(meta.motivoBajoMeta(base()), "fila vacía");
  assert.equal(meta.motivoBajoMeta(base({ cupos: null })), "fila vacía");
  assert.equal(meta.motivoBajoMeta(base({ candidatas: 2 })), "2 en fila, todavía sin tomar");
});

/* ------------------------------------------------------------------ la meta guardada */

await prueba("la meta: sin nada guardado vale 10; se guarda con la clave tablero:meta-trabajando:<negocio>", async () => {
  assert.equal(await meta.leerMetaTrabajando("ws1"), 10);
  assert.equal(await meta.guardarMetaTrabajando("ws1", 12), 12);
  assert.equal(ajustes.get("tablero:meta-trabajando:ws1"), "12");
  assert.equal(await meta.leerMetaTrabajando("ws1"), 12);
  assert.equal(await meta.leerMetaTrabajando("ws2"), 10, "cada negocio la suya");
  ajustes.set("tablero:meta-trabajando:ws3", "basura");
  assert.equal(await meta.leerMetaTrabajando("ws3"), 10, "lo dañado vale 10");
  ajustes.set("tablero:meta-trabajando:ws4", "50");
  assert.equal(await meta.leerMetaTrabajando("ws4"), 10, "fuera de rango guardado a mano vale 10");
});

await prueba("la meta: fuera de 1 a 20 (0, 21, decimales, texto) se rechaza y no se guarda", async () => {
  for (const mala of [0, 21, -1, 2.5, Number.NaN, "10"]) {
    await assert.rejects(() => meta.guardarMetaTrabajando("ws1", mala), /entre 1 y 20/, String(mala));
  }
  assert.equal(ajustes.size, 0, "no se guardó nada");
  assert.equal(await meta.guardarMetaTrabajando("ws1", 1), 1);
  assert.equal(await meta.guardarMetaTrabajando("ws1", 20), 20);
  assert.deepEqual([0, 1, 20, 21, "7", null].map(meta.metaTrabajandoValida), [null, 1, 20, null, 7, null]);
});

console.log(`\n${pruebas} pruebas, todas bien`);

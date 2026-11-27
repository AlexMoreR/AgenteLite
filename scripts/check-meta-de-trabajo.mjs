// Pruebas de la meta de tareas trabajando a la vez del Tablero IA (meta-de-trabajo.ts, parte 1): cuántas cuentan como
// trabajando (planear no), el motivo en una línea en su orden (pausa por uso, sesión, apagado, cupos o nube, aizen1, choque,
// esperas, errores, fila vacía) y la meta guardada por negocio en AppSetting (10 por defecto, solo de 1 a 20).
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

const mocks = { "@/lib/prisma": { prisma: prismaFalso } };
const meta = cargar("src/features/tableros-inteligentes/services/meta-de-trabajo.ts", mocks);

let pruebas = 0;
async function prueba(nombre, fn) {
  ajustes.clear();
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Todo en calma: sin pausa, con sesión, prendido, sin esperas, con candidatas. Cada prueba cambia lo suyo. */
const entrada = (cambios = {}) => ({
  trabajando: 4,
  meta: 10,
  pausaUso: { activa: true, pausado: false, umbral: 95, sesion: { porcentaje: 40, reinicio: "" }, semana: { porcentaje: 60, reinicio: "" } },
  sesionVencida: false,
  apagado: false,
  cupos: { cupos: 10, enFila: 3, corriendo: 4 },
  nubeLlena: null,
  aizen1Ocupado: false,
  esperas: [],
  dependencias: [],
  esperanAprobacion: [],
  errores: 0,
  candidatas: 3,
  ...cambios,
});

const espera = (extra) => ({ tarjetaId: "a1", motivo: "", tipo: null, contra: null, ...extra });

/* ------------------------------------------------------------------ contar */

await prueba("4 construyendo o vigilando más 1 planeando: cuentan 4 y el motivo dice «4 de 10»", () => {
  const tareas = ["construyendo", "probando", "revisando", "vigilando", "planeando"].map((etapa) => ({ etapa }));
  const trabajando = meta.contarTrabajando(tareas);
  assert.equal(trabajando, 4, "planear no cuenta");
  assert.equal(meta.contarTrabajando([{ etapa: "subiendo" }, { etapa: "planeando" }]), 1, "subir sí cuenta");
  assert.equal(meta.contarTrabajando([]), 0);
  const motivo = meta.motivoBajoMeta(entrada({ trabajando, candidatas: 0 }));
  assert.match(motivo, /4 de 10/);
});

await prueba("con la meta cumplida no hay motivo", () => {
  assert.equal(meta.motivoBajoMeta(entrada({ trabajando: 10 })), null);
  assert.equal(meta.motivoBajoMeta(entrada({ trabajando: 12 })), null);
  assert.equal(meta.motivoBajoMeta(entrada({ trabajando: 5, meta: 5, apagado: true })), null);
});

/* ------------------------------------------------------------------ el orden del motivo */

await prueba("con la pausa activa el motivo empieza por «pausado por el uso de Claude», con el mayor de sesión y semana", () => {
  const pausa = { activa: true, pausado: true, umbral: 95, sesion: { porcentaje: 96, reinicio: "" }, semana: { porcentaje: 70, reinicio: "" } };
  // Manda sobre todo lo demás.
  const motivo = meta.motivoBajoMeta(entrada({ pausaUso: pausa, sesionVencida: true, apagado: true, cupos: { cupos: 7, enFila: 0, corriendo: 0 }, errores: 3 }));
  assert.ok(motivo.startsWith("pausado por el uso de Claude"), motivo);
  assert.ok(motivo.startsWith("pausado por el uso de Claude (96 % de 95 %)"), motivo);
  // Con la pausa apagada en el CRM, no cuenta aunque el último latido diga pausado.
  const apagada = meta.motivoBajoMeta(entrada({ pausaUso: { ...pausa, activa: false }, candidatas: 0 }));
  assert.ok(!apagada.startsWith("pausado"), apagada);
});

await prueba("la sesión vencida va antes que el Coordinador apagado, y apagado antes que los cupos", () => {
  assert.match(meta.motivoBajoMeta(entrada({ sesionVencida: true, apagado: true })), /^la sesión de Claude en aizen1 está vencida/);
  assert.match(meta.motivoBajoMeta(entrada({ apagado: true, cupos: { cupos: 7, enFila: 0, corriendo: 0 } })), /^el Coordinador está apagado/);
});

await prueba("con cupos 7 el motivo dice «los cupos configurados dan 7»; con la nube llena, sus puestos", () => {
  const motivo = meta.motivoBajoMeta(entrada({ cupos: { cupos: 7, enFila: 2, corriendo: 4 }, aizen1Ocupado: true }));
  assert.ok(motivo.startsWith("los cupos configurados dan 7, la meta es 10"), motivo);
  assert.match(meta.motivoBajoMeta(entrada({ nubeLlena: 3, aizen1Ocupado: true })), /^la nube ya usa sus 3 puestos/);
  // Sin cupos en el latido (Coordinador viejo) no se inventa nada.
  assert.ok(!meta.motivoBajoMeta(entrada({ cupos: null, candidatas: 0 })).includes("cupos"));
});

await prueba("aizen1 ocupado va antes que un choque", () => {
  const choque = espera({ tipo: "choque", contra: "b1", titulo: "A", tituloContra: "B" });
  assert.match(meta.motivoBajoMeta(entrada({ aizen1Ocupado: true, esperas: [choque] })), /^aizen1 está ocupado/);
  assert.match(meta.motivoBajoMeta(entrada({ esperas: [espera({ tipo: "aizen1" }), choque] })), /^aizen1 está ocupado/);
});

await prueba("una espera de tipo choque nombra las dos tarjetas", () => {
  const motivo = meta.motivoBajoMeta(
    entrada({
      esperas: [
        espera({ tarjetaId: "a1", tipo: "choque", contra: "b1", titulo: "Arreglar chats", tituloContra: "Nueva lista de chats", motivo: "tocan el mismo archivo" }),
        espera({ tarjetaId: "c1", tipo: "choque", contra: "b1", titulo: "Otra", tituloContra: "Nueva lista de chats" }),
      ],
      errores: 2,
    }),
  );
  assert.ok(motivo.startsWith("«Arreglar chats» choca con «Nueva lista de chats» (tocan el mismo archivo) y 1 más"), motivo);
  // Sin el título de la otra, sale su id.
  assert.match(meta.motivoBajoMeta(entrada({ esperas: [espera({ tipo: "choque", contra: "b1", titulo: "A" })] })), /^«A» choca con «b1»/);
});

await prueba("esperando a otra parte: «N esperan a «X»» y luego las que esperan tu sí", () => {
  const dependencias = [
    { tarjetaId: "d1", titulo: "Parte 2", esperaA: "Parte 1" },
    { tarjetaId: "d2", titulo: "Parte 3", esperaA: "Parte 1" },
  ];
  assert.ok(meta.motivoBajoMeta(entrada({ dependencias, errores: 1 })).startsWith("2 esperan a «Parte 1»"));
  const porAgente = meta.motivoBajoMeta(entrada({ esperas: [espera({ tipo: "agente", contra: "x1", tituloContra: "Agente Ads" })] }));
  assert.ok(porAgente.startsWith("1 espera a «Agente Ads»"), porAgente);
  assert.ok(meta.motivoBajoMeta(entrada({ esperas: [espera({ tipo: "version" })] })).startsWith("1 espera otra versión"));
  const aprobacion = [{ tarjetaId: "p1", titulo: "Plan nuevo" }];
  assert.ok(meta.motivoBajoMeta(entrada({ esperanAprobacion: aprobacion, errores: 1 })).startsWith("«Plan nuevo» espera tu sí"));
  assert.ok(meta.motivoBajoMeta(entrada({ esperanAprobacion: [...aprobacion, { tarjetaId: "p2", titulo: "Otro" }] })).startsWith("2 esperan tu sí"));
});

await prueba("una espera sin tipo (Coordinador viejo) sale como «en fila: <texto>»", () => {
  const motivo = meta.motivoBajoMeta(entrada({ esperas: [espera({ motivo: "toca la misma zona que otra tarea" })], errores: 1 }));
  assert.ok(motivo.startsWith("en fila: toca la misma zona que otra tarea"), motivo);
});

await prueba("tarjetas en error, y sin candidatas, errores ni dependencias: «fila vacía»", () => {
  assert.ok(meta.motivoBajoMeta(entrada({ errores: 3, candidatas: 0 })).startsWith("3 tarjetas en error"));
  assert.ok(meta.motivoBajoMeta(entrada({ errores: 1 })).startsWith("1 tarjeta en error"));
  const vacia = meta.motivoBajoMeta(entrada({ candidatas: 0, errores: 0, dependencias: [] }));
  assert.ok(vacia.startsWith("fila vacía"), vacia);
  assert.equal(vacia.split("\n").length, 1, "una sola línea");
  assert.ok(!meta.motivoBajoMeta(entrada({ candidatas: 2 })).includes("fila vacía"), "con candidatas no es fila vacía");
});

/* ------------------------------------------------------------------ la meta guardada */

await prueba("sin nada guardado la meta vale 10; se guarda con la clave del negocio", async () => {
  assert.equal(await meta.leerMetaTrabajando("ws1"), 10);
  assert.equal(await meta.guardarMetaTrabajando("ws1", 12), 12);
  assert.equal(ajustes.get("tablero:meta-trabajando:ws1"), "12");
  assert.equal(await meta.leerMetaTrabajando("ws1"), 12);
  assert.equal(await meta.leerMetaTrabajando("ws2"), 10, "otro negocio no la ve");
  ajustes.set("tablero:meta-trabajando:ws3", "basura");
  assert.equal(await meta.leerMetaTrabajando("ws3"), 10, "lo dañado vale 10");
});

await prueba("una meta fuera de 1 a 20 se rechaza y no se guarda", async () => {
  for (const mala of [0, 21, -1, 2.5, Number.NaN, "10"]) {
    await assert.rejects(() => meta.guardarMetaTrabajando("ws1", mala), /entre 1 y 20/, `rechaza ${String(mala)}`);
  }
  assert.ok(!ajustes.has("tablero:meta-trabajando:ws1"));
  assert.equal(await meta.guardarMetaTrabajando("ws1", 1), 1);
  assert.equal(await meta.guardarMetaTrabajando("ws1", 20), 20);
});

console.log(`\n${pruebas} pruebas, todas bien`);

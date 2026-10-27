// Pruebas del descarte tras seguimientos (src/features/crm/domain/descarte-tras-seguimientos.ts):
// la regla de 24 h despues del seguimiento de 3 dias, las excepciones (LLAMAR, cotizacion, asesora),
// la vuelta con una base de mentira (interruptor, tope de 50, idempotencia). No necesita base ni red.
// Correr: npm run test:descarte-tras-seguimientos
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);

/** Carga un .ts transpilado, resolviendo sus imports relativos a otros .ts. */
const cache = new Map();
function cargar(archivo) {
  const absoluto = path.resolve(archivo);
  if (cache.has(absoluto)) return cache.get(absoluto).exports;
  const salida = ts.transpileModule(fs.readFileSync(absoluto, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: absoluto,
  });
  const mod = { exports: {} };
  cache.set(absoluto, mod);
  const requerir = (pedido) => {
    if (pedido.startsWith(".")) {
      const base = path.resolve(path.dirname(absoluto), pedido);
      for (const candidato of [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(
    mod.exports,
    requerir,
    mod,
    absoluto,
    path.dirname(absoluto),
  );
  return mod.exports;
}

const { decidir, correrVuelta, tieneSenalDeCompra, TOPE_POR_VUELTA } = cargar("src/features/crm/domain/descarte-tras-seguimientos.ts");

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const HORA = 3_600_000;
const ahora = new Date("2026-10-27T15:00:00.000Z");
const hace = (horas) => new Date(ahora.getTime() - horas * HORA);
const mensaje = (texto, minutosDespuesDelPrimero = 0) => ({
  texto,
  creadoEn: new Date(hace(100).getTime() + minutosDespuesDelPrimero * 60_000),
});
const base = (extra = {}) => ({
  etapa: "NUEVO",
  enviadoEn: hace(25),
  ahora,
  escribioDespues: false,
  asesoraEscribioDespues: false,
  mensajesDelCliente: [mensaje("Hola, quiero informacion")],
  conCotizacionOAnticipo: false,
  ...extra,
});

await prueba("25 horas, no contesto, sin senales: se descarta", () => assert.equal(decidir(base()), "descartar"));
await prueba("pregunto precio (despues de los 2 minutos): va a LLAMAR", () =>
  assert.equal(decidir(base({ mensajesDelCliente: [mensaje("Hola"), mensaje("cuanto vale la camilla?", 30)] })), "llamar"));
await prueba("pregunto por el envio: va a LLAMAR", () =>
  assert.equal(decidir(base({ mensajesDelCliente: [mensaje("Hola"), mensaje("hacen envios a Cali?", 30)] })), "llamar"));
await prueba("pregunto la forma de pago: va a LLAMAR", () =>
  assert.equal(decidir(base({ mensajesDelCliente: [mensaje("Hola"), mensaje("cuales son los metodos de pago", 30)] })), "llamar"));
await prueba("dio su ciudad: va a LLAMAR", () =>
  assert.equal(decidir(base({ mensajesDelCliente: [mensaje("Hola"), mensaje("soy de Medellin", 30)] })), "llamar"));
await prueba("solo el texto del anuncio (primeros 2 minutos) no es senal", () => {
  const msgs = [mensaje("Hola, cuanto cuesta? vi su anuncio"), mensaje("hacen envios", 1)];
  assert.equal(tieneSenalDeCompra(msgs), false);
  assert.equal(decidir(base({ mensajesDelCliente: msgs })), "descartar");
});
await prueba("20 horas: no pasa nada", () => assert.equal(decidir(base({ enviadoEn: hace(20) })), "nada"));
await prueba("el cliente escribio despues: no pasa nada", () => assert.equal(decidir(base({ escribioDespues: true })), "nada"));
await prueba("una asesora le escribio a mano: no pasa nada", () => assert.equal(decidir(base({ asesoraEscribioDespues: true })), "nada"));
await prueba("con cotizacion o anticipo: no se descarta (LLAMAR)", () => assert.equal(decidir(base({ conCotizacionOAnticipo: true })), "llamar"));
await prueba("en Caliente: no se descarta solo (LLAMAR)", () => assert.equal(decidir(base({ etapa: "NEGOCIACION" })), "llamar"));
await prueba("ya estaba en Ganado o Descartado: no pasa nada", () => {
  assert.equal(decidir(base({ etapa: "GANADO" })), "nada");
  assert.equal(decidir(base({ etapa: "PERDIDO" })), "nada");
});

// Base de mentira: guarda lo que se hizo para contarlo.
function mundo({ leads, encendido = true, hechos = {} }) {
  const estado = { descartados: [], llamar: [], reabrirLlamado: 0 };
  const puerto = {
    encendido: async () => encendido,
    buscarCandidatos: async (limite) =>
      leads
        .filter((l) => !estado.descartados.includes(l.contactId) && !estado.llamar.includes(l.contactId))
        .slice(0, limite),
    hechos: async (c) => base({ etapa: c.etapa, ...(hechos[c.contactId] ?? {}) }),
    descartar: async (c) => (estado.descartados.push(c.contactId), true),
    ponerLlamar: async (c) => (estado.llamar.push(c.contactId), true),
    reabrir: async () => (estado.reabrirLlamado += 1, 2),
  };
  return { estado, puerto };
}
const lead = (n) => ({ contactId: `c${n}`, etapa: "NUEVO", enviadoEn: hace(30) });

await prueba("interruptor en off: no hace nada (ni reabre)", async () => {
  const { estado, puerto } = mundo({ leads: [lead(1)], encendido: false });
  const r = await correrVuelta(puerto);
  assert.deepEqual(r, { descartados: 0, aLlamar: 0, reabiertos: 0, revisados: 0 });
  assert.equal(estado.reabrirLlamado, 0);
});
await prueba("la vuelta descarta, manda a LLAMAR y reabre", async () => {
  const { estado, puerto } = mundo({
    leads: [lead(1), lead(2), lead(3)],
    hechos: { c2: { conCotizacionOAnticipo: true }, c3: { escribioDespues: true } },
  });
  const r = await correrVuelta(puerto);
  assert.deepEqual(r, { descartados: 1, aLlamar: 1, reabiertos: 2, revisados: 3 });
  assert.deepEqual(estado.descartados, ["c1"]);
  assert.deepEqual(estado.llamar, ["c2"]);
});
await prueba("con mas de 50 leads respeta el tope de 50 por vuelta", async () => {
  const leads = Array.from({ length: 120 }, (_, i) => lead(i));
  const { estado, puerto } = mundo({ leads });
  const r = await correrVuelta(puerto);
  assert.equal(TOPE_POR_VUELTA, 50);
  assert.equal(r.descartados, 50);
  assert.equal(estado.descartados.length, 50);
});
await prueba("correr dos veces seguidas no duplica nada", async () => {
  const { estado, puerto } = mundo({ leads: [lead(1), lead(2)], hechos: { c2: { conCotizacionOAnticipo: true } } });
  await correrVuelta(puerto);
  const segunda = await correrVuelta(puerto);
  assert.equal(segunda.descartados + segunda.aLlamar, 0);
  assert.equal(estado.descartados.length, 1);
  assert.equal(estado.llamar.length, 1);
});

console.log(`\n${pruebas} pruebas pasaron.`);

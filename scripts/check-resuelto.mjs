// Pruebas de "chat RESUELTO = fuera del CRM de trabajo" (Alex, 16-10-2026): src/lib/chat-resuelto.ts,
// el motor del seguimiento inteligente con un chat resuelto (sin tarea ni Recuperación) y las
// exclusiones del Supervisor. Sin base ni red. Correr: npm run test:resuelto
import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import ts from "typescript";

const requireNativo = createRequire(import.meta.url);
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
      for (const candidato of [base, `${base}.ts`, path.join(base, "index.ts")]) {
        if (fs.existsSync(candidato) && fs.statSync(candidato).isFile()) return cargar(candidato);
      }
    }
    return requireNativo(pedido);
  };
  new Function("exports", "require", "module", "__filename", "__dirname", salida.outputText)(mod.exports, requerir, mod, absoluto, path.dirname(absoluto));
  return mod.exports;
}

const r = cargar("src/lib/chat-resuelto.ts");
const mo = cargar("src/features/seguimiento-inteligente/dominio/motor.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
const exc = cargar("src/features/supervisor/dominio/exclusiones.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------------------------------------
   1. Qué es resuelto y cuándo se reabre
------------------------------------------------------------------------------------------------ */

prueba("CLOSED y ARCHIVED son resueltos; OPEN, PENDING y sin estado no", () => {
  assert.equal(r.estaResuelto("CLOSED"), true);
  assert.equal(r.estaResuelto("ARCHIVED"), true);
  assert.equal(r.estaResuelto("closed"), true);
  for (const e of ["OPEN", "PENDING", null, undefined, ""]) assert.equal(r.estaResuelto(e), false, String(e));
});

prueba("se reabre SOLO con un mensaje nuevo del cliente", () => {
  assert.equal(r.reabreAlLlegar({ direccion: "INBOUND" }, "CLOSED"), true);
  assert.equal(r.reabreAlLlegar({ direccion: "INBOUND" }, "ARCHIVED"), true);
  // Lo nuestro (eco del CRM, celular, automático) no lo reabre.
  assert.equal(r.reabreAlLlegar({ direccion: "OUTBOUND" }, "CLOSED"), false);
  // Ediciones y borrados no son "volvió a escribir".
  assert.equal(r.reabreAlLlegar({ direccion: "INBOUND", editado: true }, "CLOSED"), false);
  assert.equal(r.reabreAlLlegar({ direccion: "INBOUND", borrado: true }, "CLOSED"), false);
  // Un chat abierto no cambia.
  assert.equal(r.reabreAlLlegar({ direccion: "INBOUND" }, "OPEN"), false);
  assert.equal(r.reabreAlLlegar({ direccion: "INBOUND" }, "PENDING"), false);
});

prueba("estadoAlLlegar: OPEN al reabrir, el mismo de antes si no", () => {
  assert.equal(r.estadoAlLlegar({ direccion: "INBOUND" }, "CLOSED"), "OPEN");
  assert.equal(r.estadoAlLlegar({ direccion: "OUTBOUND" }, "CLOSED"), "CLOSED");
  assert.equal(r.estadoAlLlegar({ direccion: "INBOUND" }, "PENDING"), "PENDING");
});

/* ------------------------------------------------------------------------------------------------
   2. Qué se hace al resolver / reabrir
------------------------------------------------------------------------------------------------ */

prueba("al resolver: cancelar automáticos y revisar el lead; al reabrir: solo revisar", () => {
  assert.deepEqual(r.efectosDelCambio("OPEN", "CLOSED"), { cancelarAutomaticos: true, revisarLead: true });
  assert.deepEqual(r.efectosDelCambio("PENDING", "ARCHIVED"), { cancelarAutomaticos: true, revisarLead: true });
  assert.deepEqual(r.efectosDelCambio("CLOSED", "OPEN"), { cancelarAutomaticos: false, revisarLead: true });
  // Sin cambio real (resolver uno ya resuelto, abrir uno abierto): nada.
  assert.deepEqual(r.efectosDelCambio("CLOSED", "CLOSED"), { cancelarAutomaticos: false, revisarLead: false });
  assert.deepEqual(r.efectosDelCambio("OPEN", "OPEN"), { cancelarAutomaticos: false, revisarLead: false });
});

prueba("solo se cancelan los automáticos PENDIENTES (no los de una asesora, campañas ni automatizaciones)", () => {
  assert.equal(r.esAutomaticoPendiente({ status: "PENDING", clase: "automatico" }), true);
  for (const clase of ["humano", "campana", "automatizacion", "reactivacion"]) {
    assert.equal(r.esAutomaticoPendiente({ status: "PENDING", clase }), false, clase);
  }
  assert.equal(r.esAutomaticoPendiente({ status: "EXECUTED", clase: "automatico" }), false);
  assert.equal(r.esAutomaticoPendiente({ status: "CANCELLED", clase: "automatico" }), false);
});

prueba("Kanban: el resuelto sale de las columnas de trabajo; Ganado y Descartado se quedan", () => {
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA", "NEGOCIACION", null]) {
    assert.equal(r.saleDelKanban({ etapa, estadoDelChat: "CLOSED" }), true, String(etapa));
    assert.equal(r.saleDelKanban({ etapa, estadoDelChat: "OPEN" }), false, String(etapa));
  }
  assert.equal(r.saleDelKanban({ etapa: "GANADO", estadoDelChat: "CLOSED" }), false);
  assert.equal(r.saleDelKanban({ etapa: "PERDIDO", estadoDelChat: "CLOSED" }), false);
  // Sin chat (contacto sin conversación del canal viejo): se queda.
  assert.equal(r.saleDelKanban({ etapa: "NUEVO", estadoDelChat: null }), false);
});

/* ------------------------------------------------------------------------------------------------
   3. El motor: un chat resuelto no tiene tarea ni Recuperación (y la etapa no se toca)
------------------------------------------------------------------------------------------------ */

const MIN = 60_000;
const H = 60 * MIN;
const T0 = new Date("2026-10-07T16:00:00Z");
const mas = (ms) => new Date(T0.getTime() + ms);
const IN = (minutos, texto) => ({ direccion: "IN", tipo: "TEXT", texto, en: mas(minutos * MIN), leidoEn: mas(minutos * MIN), origen: "webhook" });
const BOT = (minutos, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: mas(minutos * MIN), leidoEn: mas((minutos + 1) * MIN), estado: "READ", origen: null });
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";

function ficha(parcial = {}) {
  return {
    conversationId: "cvprueba0000000000000001",
    nombre: "Laura Gómez",
    etapaCrm: "NUEVO",
    pausado: false,
    asignadaA: null,
    pais: "CO",
    marcaExterior: false,
    inicioDeLaCharla: T0,
    familiaDelBot: "combo-camilla",
    flujosEnviados: [],
    cotizacion: { en: null, ref: null, total: null },
    mensajesUtiles: 0,
    mensajes: [],
    llamadas: [],
    historialCompleto: true,
    ...parcial,
  };
}

const CONFIG = cf.leerConfigDeTexto(
  JSON.stringify({
    calificacion: { activo: true },
    motor: { modo: "activo" },
    cadencia: { descarte: "activo" },
    exterior: { activo: true },
    recuperacion72h: { modo: "activo" },
  }),
);
const TIBIO = [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Pereira?"), BOT(5.2, "Sí, enviamos")];

prueba("motor: el mismo lead con tarea abierta, resuelto no tiene tarea (no insistir · chat_resuelto)", () => {
  const abierta = mo.evaluarLead(ficha({ mensajes: TIBIO }), CONFIG, mas(40 * MIN)).decision;
  assert.equal(abierta.accion, "tarea_asesora");
  const resuelta = mo.evaluarLead(ficha({ mensajes: TIBIO, resuelto: true }), CONFIG, mas(40 * MIN)).decision;
  assert.equal(resuelta.accion, "no_insistir");
  assert.equal(resuelta.motivo, mo.MOTIVO_CHAT_RESUELTO);
  assert.equal(resuelta.supresion, "siempre");
  assert.equal(resuelta.mensajeUtil, null);
});

prueba("motor: resuelto no entra a la Recuperación 72 h (ni descarta: la etapa no cambia)", () => {
  // Callado más de 72 h después de nuestra última respuesta: la Recuperación lo tomaría.
  const callado = [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "precio?"), BOT(6, "Vale $1.200.000")];
  const ahora = mas(80 * H);
  // Sin resolver, la Recuperación sí lo mira (si no, la prueba no probaría nada).
  assert.notEqual(mo.evaluarLead(ficha({ mensajes: callado }), CONFIG, ahora).recuperacion, null);
  const ev = mo.evaluarLead(ficha({ mensajes: callado, resuelto: true }), CONFIG, ahora);
  assert.equal(ev.recuperacion, null);
  assert.notEqual(ev.decision.accion, "descartar");
  assert.notEqual(ev.decision.accion, "tarea_asesora");
});

prueba("motor: Ganado/Perdido manda sobre resuelto (sigue siendo etapa_cerrada)", () => {
  const d = mo.evaluarLead(ficha({ etapaCrm: "GANADO", mensajes: TIBIO, resuelto: true }), CONFIG, mas(40 * MIN)).decision;
  assert.equal(d.motivo, "etapa_cerrada");
});

prueba("motor: sin el campo `resuelto`, todo como antes", () => {
  const d = mo.evaluarLead(ficha({ mensajes: TIBIO, resuelto: undefined }), CONFIG, mas(40 * MIN)).decision;
  assert.equal(d.accion, "tarea_asesora");
});

/* ------------------------------------------------------------------------------------------------
   4. Supervisor: un chat resuelto no es tarea (sale de las alertas abiertas)
------------------------------------------------------------------------------------------------ */

prueba("supervisor: un chat resuelto se excluye de las alertas de atención", () => {
  const ahora = mas(2 * H);
  const base = { etapa: "NUEVO", telefono: "573001234567", ultimoClienteEn: mas(H), ultimaRespuestaHumanaEn: null, textos: ["hola"] };
  assert.equal(exc.motivoDeExclusion(base, ahora), null);
  assert.equal(exc.motivoDeExclusion({ ...base, resuelto: true }, ahora), "resuelto");
  assert.equal(exc.motivoDeExclusion({ ...base, resuelto: false }, ahora), null);
  assert.equal(exc.motivoDeExclusion({ ...base, etapa: "PERDIDO", resuelto: true }, ahora), "etapa_cerrada");
});

console.log(`\n${pruebas} pruebas ok`);

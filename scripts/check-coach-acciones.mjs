// Pruebas de "Acciones de hoy" del Coach (src/features/coach/dominio/acciones-de-hoy.ts): cada
// asesora tiene tarjeta, los campos salen del informe guardado, lo operativo se separa al
// Supervisor, los enlaces de chat estan bien formados, nunca sale un telefono completo y, si falta
// un dato, la tarjeta lo dice en vez de inventarlo. No necesita base ni red.
// Correr: npm run test:coach-acciones
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

const a = cargar("src/features/coach/dominio/acciones-de-hoy.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/* ------------------------------------------------------------------------------------------------
   Informe de ejemplo (con la forma real de CoachInforme / CoachAsesora del 10-oct)
------------------------------------------------------------------------------------------------ */

const chat = (numero, ultimos4 = "…0204", nombre = "") => ({ ref: `#${numero}`, numero, ultimos4, nombre });
const metricas = (extra = {}) => ({
  chats: 10,
  chatsQuietos: 2,
  demoras: 4,
  sinRespuesta: 1,
  primeraRespuestaMedianaMin: 17,
  cotizaciones: 0,
  ganados: 0,
  atribucionIncierta: 1,
  ...extra,
});

function habilidad(clave, nombre, metrica, extra = {}) {
  return {
    version: "habilidad-v1",
    clave,
    nombre,
    impacto: 22.2,
    ranking: [
      { clave, impacto: 22.2 },
      { clave: "responder_a_tiempo", impacto: 21.4 },
    ],
    etapaCritica: "antes_del_precio",
    incluyeErrorDelEquipo: false,
    evidencia: [
      { ...chat(4032, "…9228"), texto: "Dio precio del carrito auxiliar por separado sin aclarar el total del combo." },
      { ...chat(4009, "…1909"), texto: "Dijo precio diferente para camilla sola que no corresponde al sistema." },
    ],
    queHacerDiferente: "Da un solo total claro con anticipo y envío antes de avanzar.",
    ejemplo: "Tu total es $989.000. Lo separas con $494.500. ¿En qué ciudad estás?",
    metrica,
    redactadoPor: "ia",
    ...extra,
  };
}

const ingrid = {
  userId: "u-ingrid",
  nombre: "Ingrid Sanchez",
  chats: 51,
  puntaje: 6.4,
  puntajes: { ejes: { V: 9.3, N: 5.9, A: 4.2, S: null, C: 6.3 }, ganados: 0, porChat: [] },
  aciertos: [{ ...chat(3931, "…1111", "Julieth"), texto: "Respondió rápido." }],
  errores: [
    { ...chat(4032, "…9228"), tipo: "sin_total_claro", detalle: "Dio precio del carrito auxiliar por separado sin aclarar el total del combo." },
    { ...chat(4009, "…1909"), tipo: "sin_total_claro", detalle: "Dijo precio diferente para camilla sola que no corresponde al sistema." },
    { ...chat(4007, "…3474"), tipo: "sin_total_claro", detalle: "No dio precio claro. El cliente dejó su número 300 123 4567 para llamarlo." },
    { ...chat(4011, "…8462"), tipo: "dato_errado", detalle: "Mencionó precio de $1.129.000 para camilla portátil sin confirmar que es producto distinto." },
    { ...chat(4015, "…1595"), tipo: "cobro_envio_gratis", detalle: "Confirmó envío gratis a Fusagasugá, que no está en la lista de ciudades con envío gratis." },
    { ...chat(3901, "…8891"), tipo: "demora", detalle: "El cliente esperó 300 min en horario.", minutos: 300 },
  ],
  pendientes: [
    { ...chat(4011, "…8462"), temperatura: "tibio", urgente: false, porque: "Cliente en ciudad sin regla clara de envío.", siguienteMensaje: "¿En qué ciudad estás?", etapa: "Propuesta" },
    { ...chat(4016, "…7777"), temperatura: "caliente", urgente: true, porque: "Falta que confirme la ciudad.", siguienteMensaje: "Hola", etapa: "Negociación" },
  ],
  resumen: {
    loQueHizoBien: "Tono cercano.",
    unaCosaAMejorar: "",
    ejemplo: "",
    metricas: metricas({ chats: 51, demoras: 6, sinRespuesta: 3, cotizaciones: 1 }),
    habilidad: habilidad("cerrar_total_claro", "Cerrar con un total claro", {
      nombre: "chats sin un total claro",
      hoy: 8,
      meta: 4,
      sentido: "bajar",
      texto: "chats sin un total claro: hoy 8 → meta ≤ 4",
    }),
  },
};

const maria = {
  userId: "u-maria",
  nombre: "Maria Bautista",
  chats: 10,
  puntaje: 6.4,
  puntajes: { ejes: { V: 8.6 }, ganados: 0, porChat: [] },
  aciertos: [],
  errores: [
    { ...chat(3954, "…3446"), tipo: "sin_respuesta", detalle: "Nadie le respondió (204 min en horario)." },
    { ...chat(3978, "…6211"), tipo: "sin_respuesta", detalle: "Nadie le respondió (17 min en horario)." },
    { ...chat(3936, "…9872"), tipo: "cobro_envio_gratis", detalle: "Cobró $80.000 de envío a Barrancabermeja, que no está en la lista de cobro adicional ni envío gratis." },
  ],
  pendientes: [{ ...chat(1419, "…5555"), temperatura: "caliente", urgente: false, porque: "No hay regla clara para envío a Santa Marta, falta confirmar costo.", siguienteMensaje: "", etapa: "Propuesta" }],
  resumen: {
    loQueHizoBien: "Fotos y videos con precios claros.",
    unaCosaAMejorar: "",
    ejemplo: "",
    metricas: metricas({ demoras: 1, sinRespuesta: 2 }),
    habilidad: {
      ...habilidad("no_dejar_sin_respuesta", "No dejar clientes sin respuesta", {
        nombre: "clientes sin respuesta al cierre",
        hoy: 2,
        meta: 0,
        sentido: "bajar",
        texto: "clientes sin respuesta al cierre: hoy 2 → meta 0",
      }),
      impacto: 16.5,
      ranking: [{ clave: "no_dejar_sin_respuesta", impacto: 16.5 }],
      evidencia: [{ ...chat(3954, "…3446"), texto: "Nadie le respondió (204 min en horario)." }],
    },
  },
};

const sinResumen = {
  userId: "u-nueva",
  nombre: "Asesora Nueva",
  chats: 0,
  puntaje: null,
  puntajes: null,
  aciertos: [],
  errores: [],
  pendientes: [],
  resumen: null,
};

const sinHabilidad = {
  userId: "u-genesis",
  nombre: "Genesis Moreno",
  chats: 3,
  puntaje: 8,
  puntajes: null,
  aciertos: [],
  errores: [],
  pendientes: [],
  resumen: { loQueHizoBien: "", unaCosaAMejorar: "", ejemplo: "", metricas: metricas(), habilidad: null },
};

const resumenEquipo = {
  dia: "2026-10-10",
  iaDisponible: true,
  resumen: "Día con actividad.",
  leads: 85,
  chatsConActividad: 115,
  sinAsesora: 40,
  calientes: 21,
  tibios: 71,
  cotizaciones: 1,
  ventas: 0,
  motivos: [
    { motivo: "en_curso", casos: 46 },
    { motivo: "sistema", casos: 5 },
  ],
  erroresDeAsesoras: [],
  fallasDelSistema: [
    { ref: "#3947 y similares", texto: "Chats sin asesora respondieron tarde o no respondieron en 20 ocasiones." },
    { ref: "#4011, #4015, #1419", texto: "Falta de reglas para envío gratis o cobro adicional en varias ciudades." },
  ],
  problemasDelEquipo: [
    { tipo: "contraentrega", nombre: "Contraentrega", total: 9, porAsesora: [{ nombre: "Ingrid Sanchez", casos: 5 }], porque: "Cambio de política.", queHacer: "Mismo mensaje." },
  ],
};

const informe = { dia: "2026-10-10", resumenEquipo, asesoras: [maria, sinHabilidad, ingrid, sinResumen] };
const mapa = { 4032: "cmconv4032", 4009: "cmconv4009", 3954: "cmconv3954" };

/* ------------------------------------------------------------------------------------------------
   Pruebas
------------------------------------------------------------------------------------------------ */

const r = a.armarAccionesDeHoy(informe, { conversacionPorNumero: mapa });
const tarjeta = (nombre) => r.tarjetas.find((t) => t.nombre === nombre);

prueba("cada asesora del informe tiene su tarjeta (y ninguna de mas)", () => {
  assert.equal(r.tarjetas.length, informe.asesoras.length);
  assert.deepEqual(new Set(r.tarjetas.map((t) => t.userId)), new Set(informe.asesoras.map((p) => p.userId)));
});

prueba("orden: primero las que tienen accion, por impacto", () => {
  assert.deepEqual(
    r.tarjetas.map((t) => t.nombre),
    ["Ingrid Sanchez", "Maria Bautista", "Asesora Nueva", "Genesis Moreno"],
  );
});

prueba("los campos salen del informe guardado (habilidad, cifra, meta, que hacer, mensaje, evidencia)", () => {
  const t = tarjeta("Ingrid Sanchez");
  const h = ingrid.resumen.habilidad;
  assert.equal(t.habilidad.nombre, h.nombre);
  assert.equal(t.situacion.valor, h.metrica.hoy);
  assert.equal(t.situacion.texto, h.metrica.nombre);
  assert.equal(t.meta.valor, h.metrica.meta);
  assert.equal(t.meta.texto, "máximo 4");
  assert.equal(t.queHacerHoy, h.queHacerDiferente);
  assert.equal(t.mensajeModelo, h.ejemplo);
  assert.deepEqual(t.evidencia.map((e) => e.ref), h.evidencia.map((e) => e.ref));
  assert.match(t.porQue, /8 casos, impacto 22,2; le sigue «Responder a tiempo» con 21,4/);
  assert.match(t.meta.deDonde, /la mitad/);
  // La regla fija de la habilidad (catalogo del Coach) + practicar con la evidencia.
  assert.match(t.accion, /Da UN solo total/);
  assert.match(t.accion, /los 2 chats de la evidencia/);
  assert.equal(tarjeta("Maria Bautista").meta.texto, "0 (ninguno)");
  assert.match(tarjeta("Maria Bautista").meta.deDonde, /cero/);
});

prueba("cadena completa: que ocurrio -> patron -> habilidad -> que hacer -> como se mide", () => {
  const t = tarjeta("Ingrid Sanchez");
  assert.deepEqual(t.cadena.map((p) => p.paso), ["ocurrio", "patron", "habilidad", "hacer", "medida"]);
  assert.match(t.cadena[0].texto, /^#4032: .* Y 7 casos más\.$/);
  assert.match(t.cadena[1].texto, /^3 de 6 errores del día son de este tipo y la venta se pierde antes de dar el precio\.$/);
  assert.match(t.cadena[4].texto, /11-oct.*chats sin un total claro.*máximo 4/);
});

prueba("lo operativo sale de la tarjeta y va al Supervisor, con la regla que lo movio", () => {
  const m = tarjeta("Maria Bautista");
  const barranca = m.errores.find((e) => e.ref === "#3936");
  assert.equal(barranca.operativo, true);
  assert.match(barranca.regla, /la tabla está incompleta/);
  assert.equal(m.pendientes.find((p) => p.ref === "#1419").operativo, true);
  // "no corresponde al sistema" es un precio mal dado por la asesora: NO es operativo.
  assert.equal(tarjeta("Ingrid Sanchez").errores.find((e) => e.ref === "#4009").operativo, false);
  // Cruce con la falla del sistema: envio + chat citado -> operativo, pero "dudoso".
  const fusa = tarjeta("Ingrid Sanchez").errores.find((e) => e.ref === "#4015");
  assert.equal(fusa.operativo, true);
  assert.equal(fusa.dudoso, true);
  // Citado en la falla pero el texto no es de envio (camilla portatil): sigue siendo de ella.
  assert.equal(tarjeta("Ingrid Sanchez").errores.find((e) => e.ref === "#4011").operativo, false);
  // El pendiente de #4011 si es operativo (ciudad sin regla).
  assert.equal(tarjeta("Ingrid Sanchez").pendientes.find((p) => p.ref === "#4011").operativo, true);
  // Pendiente en un chat citado, pero que es del cliente ("no respondio ciudad y color"): NO.
  assert.equal(
    a.clasificarItem({ texto: "Cliente no respondió para confirmar ciudad y color.", numero: 4011 }, new Set([4011])).operativo,
    false,
  );
  assert.equal(
    a.clasificarItem({ texto: "Error en monto adicional de envío para Cúcuta.", numero: 4011 }, new Set([4011])).dudoso,
    true,
  );

  const origenes = r.operativo.map((o) => o.origen);
  assert.ok(origenes.includes("sin_asesora"));
  assert.equal(origenes.filter((o) => o === "falla_del_sistema").length, 2);
  assert.ok(origenes.includes("motivo_sistema"));
  assert.deepEqual(
    r.reclasificados.map((x) => `${x.asesora}:${x.ref}:${x.tipo}`).sort(),
    ["Ingrid Sanchez:#4011:pendiente", "Ingrid Sanchez:#4015:cobro_envio_gratis", "Maria Bautista:#1419:pendiente", "Maria Bautista:#3936:cobro_envio_gratis"],
  );
  assert.equal(r.problemasDelEquipo.length, 1);
});

prueba("separar no cambia el analisis: la habilidad y sus cifras quedan iguales", () => {
  const t = tarjeta("Maria Bautista");
  assert.equal(t.habilidad.clave, "no_dejar_sin_respuesta");
  assert.equal(t.situacion.valor, 2);
  assert.equal(t.errores.length, maria.errores.length);
});

prueba("reglas operativas por palabra clave", () => {
  assert.equal(a.clasificarTexto("El bot no lista todas las ciudades.").operativo, true);
  assert.equal(a.clasificarTexto("No hay regla para envío a Santa Marta.").operativo, true);
  assert.equal(a.clasificarTexto("Chat sin asesora con el cliente esperando.").operativo, true);
  assert.equal(a.clasificarTexto("Dio precio que no corresponde al sistema.").operativo, false);
  assert.equal(a.clasificarTexto("Ofreció contraentrega cuando está suspendida.").operativo, false);
  assert.equal(a.clasificarTexto("El cliente esperó 85 min en horario.").operativo, false);
});

prueba("enlaces de chat: chat exacto de la bandeja, link corto si no se pudo traducir, nada si no hay numero", () => {
  const t = tarjeta("Ingrid Sanchez");
  assert.equal(t.evidencia[0].href, "/cliente/chats?chatKey=agent%3Acmconv4032&assigned=all");
  assert.equal(t.errores.find((e) => e.ref === "#4007").href, "/c/4007");
  assert.equal(a.hrefDeChat(null), null);
  assert.equal(a.hrefDeChat(0), null);
  for (const o of r.operativo.filter((x) => x.origen === "falla_del_sistema")) {
    for (const c of o.chats) assert.match(c.href, /^(\/c\/\d+|\/cliente\/chats\?chatKey=agent%3A[\w-]+&assigned=all)$/);
  }
  assert.deepEqual(
    r.operativo.find((o) => o.texto.startsWith("Falta de reglas")).chats.map((c) => c.ref),
    ["#4011", "#4015", "#1419"],
  );
});

prueba("nunca sale un telefono completo (ni en textos ni en etiquetas)", () => {
  const conTelefono = {
    ...informe,
    asesoras: [
      {
        ...ingrid,
        aciertos: [{ ...chat(1, "+57 300 123 4567", "Ana 3001234567"), texto: "Escríbele al 3001234567" }],
      },
    ],
  };
  const salida = JSON.stringify(a.armarAccionesDeHoy(conTelefono));
  assert.doesNotMatch(salida, /\d{7,}/);
  assert.doesNotMatch(salida, /300 123 4567/);
  assert.match(salida, /•••• 4567/);
  assert.equal(a.telefonoEnmascarado("…0204"), "•••• 0204");
  assert.equal(a.telefonoEnmascarado(""), "••••");
  assert.equal(tarjeta("Ingrid Sanchez").evidencia[0].etiqueta, "#4032 · •••• 9228");
});

prueba("si falta un dato, la tarjeta lo dice y no inventa", () => {
  const nueva = tarjeta("Asesora Nueva");
  assert.equal(nueva.habilidad, null);
  assert.equal(nueva.meta, null);
  assert.equal(nueva.situacion, null);
  assert.match(nueva.faltantes.join(" "), /no guardó el resumen/);
  const genesis = tarjeta("Genesis Moreno");
  assert.equal(genesis.meta, null);
  assert.match(genesis.faltantes.join(" "), /Sin habilidad prioritaria/);
  const sinEvidencia = a.armarAccionesDeHoy({
    ...informe,
    asesoras: [{ ...maria, resumen: { ...maria.resumen, habilidad: { ...maria.resumen.habilidad, evidencia: [] } } }],
  }).tarjetas[0];
  assert.match(sinEvidencia.faltantes.join(" "), /no guardó chats de evidencia/);
});

prueba("estado: sin marcar = pendiente; marcado a mano; cumplido automatico con el dia siguiente", () => {
  assert.equal(tarjeta("Ingrid Sanchez").estado.valor, "pendiente");
  assert.equal(tarjeta("Ingrid Sanchez").estado.origen, "sin_marcar");

  const manual = a.armarAccionesDeHoy(informe, { estados: { "u-ingrid": { estado: "en_progreso" } } });
  assert.equal(manual.tarjetas.find((t) => t.userId === "u-ingrid").estado.valor, "en_progreso");

  // Dia siguiente: Ingrid con 3 sin total claro (meta <= 4) -> cumplido. Maria con 1 sin respuesta (meta 0) -> no.
  const siguiente = {
    dia: "2026-10-11",
    resumenEquipo: null,
    asesoras: [
      {
        ...ingrid,
        errores: [1, 2, 3].map((n) => ({ ...chat(5000 + n), tipo: "sin_total_claro", detalle: "x" })),
      },
      { ...maria, resumen: { ...maria.resumen, metricas: metricas({ sinRespuesta: 1 }) } },
    ],
  };
  const conSiguiente = a.armarAccionesDeHoy(informe, { siguiente, estados: { "u-maria": { estado: "en_progreso" } } });
  const i = conSiguiente.tarjetas.find((t) => t.userId === "u-ingrid");
  assert.deepEqual(i.medidaSiguiente, { dia: "2026-10-11", valor: 3, cumple: true });
  assert.equal(i.estado.valor, "cumplido");
  assert.equal(i.estado.origen, "automatico");
  const m = conSiguiente.tarjetas.find((t) => t.userId === "u-maria");
  assert.equal(m.medidaSiguiente.cumple, false);
  assert.equal(m.estado.valor, "en_progreso");
  assert.match(m.estado.detalle, /no alcanzó la meta/);
  // Sin parte el dia siguiente: no se puede medir y no se inventa.
  const sinParte = a.armarAccionesDeHoy(informe, { siguiente: { ...siguiente, asesoras: [] } });
  assert.equal(sinParte.tarjetas.find((t) => t.userId === "u-ingrid").medidaSiguiente, null);
});

prueba("metrica que sube (cotizaciones): meta 'mínimo' y cumple con >=", () => {
  const met = { nombre: "chats con cotización enviada", hoy: 0, meta: 2, sentido: "subir", texto: "" };
  assert.equal(a.textoDeMeta(met), "mínimo 2");
  assert.equal(a.cumpleMeta(2, met), true);
  assert.equal(a.cumpleMeta(1, met), false);
});

prueba("diaCorto y refsCitadas", () => {
  assert.equal(a.diaCorto("2026-10-10"), "10-oct");
  assert.equal(a.moverDia("2026-10-31", 1), "2026-11-01");
  assert.deepEqual(a.refsCitadas("#3947 y similares, #3947, #12"), [3947, 12]);
});

console.log(`\n${pruebas} pruebas ok`);

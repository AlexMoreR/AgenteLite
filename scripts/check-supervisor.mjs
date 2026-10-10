// Pruebas del Supervisor (src/features/supervisor/dominio): estadística, ficha del lead, línea base,
// detectores del bot / embudo / atención, alertas (agrupación, deduplicación, enfriamiento, cierre),
// diff del libro y Change Guardian. No necesita base ni red.
// Correr: npm run test:supervisor
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const est = cargar("src/features/supervisor/dominio/estadistica.ts");
const lead = cargar("src/features/supervisor/dominio/lead.ts");
const bot = cargar("src/features/supervisor/dominio/detectores-bot.ts");
const embudo = cargar("src/features/supervisor/dominio/detectores-embudo.ts");
const atencion = cargar("src/features/supervisor/dominio/detectores-atencion.ts");
const alertas = cargar("src/features/supervisor/dominio/alertas.ts");
const analisis = cargar("src/features/supervisor/dominio/analisis.ts");
const { diffDelLibro } = cargar("src/features/supervisor/dominio/libro-diff.ts");
const guardian = cargar("src/features/supervisor/dominio/guardian.ts");
const { escenariosDelCombo } = cargar("src/features/supervisor/dominio/escenarios.ts");
const tipos = cargar("src/features/supervisor/dominio/tipos.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}
const cerca = (a, b, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const H = 3_600_000;
const M = 60_000;

/* ------------------------------------------------------------------ estadística */

prueba("Wilson: 50/100 ≈ [0,404, 0,596] y sin muestra = [0, 1]", () => {
  const w = est.wilson({ exitos: 50, total: 100 });
  cerca(w.bajo, 0.4038, 1e-3);
  cerca(w.alto, 0.5962, 1e-3);
  assert.deepEqual(est.wilson({ exitos: 0, total: 0 }), { centro: 0, bajo: 0, alto: 1 });
});

prueba("dos proporciones: 47/100 vs 70/100 da z ≈ −3,3 y es significativo", () => {
  const c = est.comparar({ exitos: 47, total: 100 }, { exitos: 70, total: 100 });
  cerca(c.z, -3.32, 0.02);
  assert.equal(c.significativo, true);
  assert.equal(c.direccion, "baja");
});

prueba("tamaño mínimo: con 10 leads observados NO opina aunque el salto sea enorme", () => {
  const c = est.comparar({ exitos: 0, total: 10 }, { exitos: 70, total: 100 });
  assert.equal(c.conMuestra, false);
  assert.equal(c.significativo, false);
});

prueba("efecto mínimo: 5 pts con muestra enorme no alarma", () => {
  const c = est.comparar({ exitos: 6500, total: 10000 }, { exitos: 7000, total: 10000 });
  assert.ok(Math.abs(c.z) > 3);
  assert.equal(c.significativo, false);
});

prueba("CUSUM: alarma con una caída de 70 % a 30 % y no con la tasa normal", () => {
  const malos = Array.from({ length: 30 }, (_, i) => (i % 10 < 3 ? 1 : 0));
  const normales = Array.from({ length: 30 }, (_, i) => (i % 10 < 7 ? 1 : 0));
  assert.notEqual(est.cusumBaja(malos, 0.7, 0.075, 4).alarmaEn, null);
  assert.equal(est.cusumBaja(normales, 0.7, 0.075, 4).alarmaEn, null);
});

prueba("Jensen-Shannon: iguales = 0, sin nada en común = 1; moda y mediana", () => {
  cerca(est.jensenShannon({ a: 5, b: 5 }, { a: 50, b: 50 }), 0);
  cerca(est.jensenShannon({ a: 10 }, { b: 10 }), 1);
  assert.deepEqual(est.moda({ a: 1, b: 3 }), { clave: "b", participacion: 0.75, total: 4 });
  assert.equal(est.mediana([5, 1, 3]), 3);
  assert.equal(est.mediana([]), null);
  const s = est.ewma([0, 10, 10], 0.5);
  assert.deepEqual(s, [0, 5, 7.5]);
});

/* ------------------------------------------------------------------ ficha del lead */

let n = 0;
function msg(t, direction, extra = {}) {
  n += 1;
  return { id: `m${n}`, direction, type: "TEXT", content: null, transcripcion: null, createdAt: new Date(t), source: null, kind: null, ...extra };
}
const T0 = Date.parse("2026-10-07T03:00:00Z");

function chatDelIncidente(t0) {
  return [
    msg(t0, "INBOUND", { content: lead.TEXTO_DEL_ANUNCIO_COMBO, source: "webhook" }),
    msg(t0 + 5000, "OUTBOUND", { content: "Bienvenid@ a Magilus" }),
    msg(t0 + 6000, "OUTBOUND", { type: "SYSTEM", source: "activity", kind: "note", content: 'Agente V3: Ganó "Nombra las piezas del combo" porque el cliente dijo "escalera".' }),
    msg(t0 + 7000, "OUTBOUND", { content: "Ya te comparto las fotos, el precio el *989.000* envio gratis" }),
    msg(t0 + 8000, "OUTBOUND", { type: "IMAGE" }),
    msg(t0 + 9000, "OUTBOUND", { type: "IMAGE" }),
    msg(t0 + 10000, "OUTBOUND", { type: "IMAGE" }),
    msg(t0 + 11000, "OUTBOUND", { type: "VIDEO" }),
    msg(t0 + 12000, "OUTBOUND", { content: "¿En qué color lo quieres?" }),
  ];
}

function chatSano(t0, responde = true) {
  const lista = [
    msg(t0, "INBOUND", { content: lead.TEXTO_DEL_ANUNCIO_COMBO, source: "webhook" }),
    msg(t0 + 5000, "OUTBOUND", { content: "Bienvenid@ a Magilus" }),
    msg(t0 + 6000, "OUTBOUND", { type: "SYSTEM", source: "activity", kind: "note", content: 'Agente V3: Ganó "Pide el combo de camillas" porque el cliente dijo "combo de estetica".' }),
    msg(t0 + 7000, "OUTBOUND", { content: "¿Qué servicios vas a ofrecer en tu espacio?" }),
  ];
  if (responde) lista.push(msg(t0 + 20 * M, "INBOUND", { content: "masajes", source: "webhook" }));
  return lista;
}

prueba("ficha del incidente: regla, ráfaga, precio/fotos antes de identificar, no respondió", () => {
  const f = lead.fichaDelLead("c1", chatDelIncidente(T0));
  assert.equal(f.reglaPrimerMensaje, "Nombra las piezas del combo");
  assert.equal(f.textoDelAnuncio, true);
  assert.equal(f.producto, "combo-camilla");
  assert.equal(f.botPrimeros5Min, 7);
  assert.equal(f.precioOFotosAntesDeIdentificar, true);
  assert.equal(f.minutosHastaRespuesta, null);
  assert.equal(lead.valorDelIndicador(f, "rafaga_inicial"), true);
  assert.equal(lead.valorDelIndicador(f, "respondio_2h"), false);
});

prueba("ficha sana: pregunta el servicio, sin ráfaga, respondió a los 20 min", () => {
  const f = lead.fichaDelLead("c2", chatSano(T0));
  assert.equal(f.reglaPrimerMensaje, "Pide el combo de camillas");
  assert.equal(f.botPrimeros5Min, 2);
  assert.equal(f.precioOFotosAntesDeIdentificar, false);
  cerca(f.minutosHastaRespuesta, 20, 0.01);
});

prueba("las fotos que se mandan DESPUÉS de que el cliente contesta no cuentan como ráfaga inicial", () => {
  const lista = [...chatSano(T0), msg(T0 + 21 * M, "OUTBOUND", { type: "IMAGE" }), msg(T0 + 21 * M + 1, "OUTBOUND", { type: "IMAGE" }), msg(T0 + 21 * M + 2, "OUTBOUND", { type: "IMAGE" }), msg(T0 + 21 * M + 3, "OUTBOUND", { type: "VIDEO" })];
  assert.equal(lead.fichaDelLead("c3", lista).botPrimeros5Min, 2);
});

prueba("no mira el futuro: con `hasta` antes de la respuesta, no respondió", () => {
  const f = lead.fichaDelLead("c2", chatSano(T0), {}, new Date(T0 + 10 * M));
  assert.equal(f.minutosHastaRespuesta, null);
  assert.equal(lead.disponible(f, "respondio_2h", new Date(T0 + 10 * M)), false);
  assert.equal(lead.disponible(f, "respondio_2h", new Date(T0 + 2 * H)), true);
});

prueba("pregunta repetida y ciudad repetida; 'te confirmo el envío a tu ciudad' no es preguntar", () => {
  const lista = [
    msg(T0, "INBOUND", { content: "Hola, quiero el combo", source: "webhook" }),
    msg(T0 + 1000, "OUTBOUND", { content: "¿En qué ciudad estás?" }),
    msg(T0 + 60_000, "INBOUND", { content: "soy de Pereira", source: "webhook" }),
    msg(T0 + 61_000, "OUTBOUND", { content: "Perfecto. ¿En qué ciudad estás?" }),
  ];
  const f = lead.fichaDelLead("c4", lista);
  assert.equal(f.preguntaRepetida, true);
  assert.equal(f.ciudadRepetida, true);
  assert.equal(lead.preguntaLaCiudad("¡Perfecto! Te confirmo el envío a tu ciudad en un momento. ¿De qué color lo quieres?"), false);
  assert.equal(lead.preguntaLaCiudad("¿Desde qué ciudad nos escribes?"), true);
});

prueba("señal sin asesora y asesora sin señal", () => {
  const lista = [
    msg(T0, "INBOUND", { content: "Hola", source: "webhook" }),
    msg(T0 + 60_000, "OUTBOUND", { type: "SYSTEM", kind: "assigned", source: "activity", content: "Ingrid auto-asignado" }),
    msg(T0 + 5 * M, "INBOUND", { content: "¿Cómo hago para separarlo?", source: "webhook" }),
    msg(T0 + 90 * M, "OUTBOUND", { source: "manual", content: "Hola, te cuento" }),
  ];
  const f = lead.fichaDelLead("c5", lista);
  assert.equal(f.senalFuerte, true);
  assert.equal(lead.valorDelIndicador(f, "asesora_sin_senal_24h"), true);
  assert.equal(lead.valorDelIndicador(f, "senal_sin_asesora_1h"), true);
});

/* ------------------------------------------------------------------ línea base y detectores del bot */

function poblacion({ dias = 14, porDia = 40, desde, armar }) {
  const fichas = [];
  for (let d = 0; d < dias; d++) {
    for (let i = 0; i < porDia; i++) {
      const t = desde + d * 24 * H + i * (24 * H / porDia);
      const f = lead.fichaDelLead(`b${d}-${i}`, armar(t, d, i));
      if (f) fichas.push(f);
    }
  }
  return fichas;
}
const INICIO = Date.parse("2026-09-21T05:00:00Z");
const CAMBIO = INICIO + 15 * 24 * H;
const sanos = poblacion({ desde: INICIO, dias: 15, armar: (t, d, i) => chatSano(t, i % 10 < 7) });
const despues = [];
for (let i = 0; i < 12; i++) despues.push(lead.fichaDelLead(`x${i}`, chatDelIncidente(CAMBIO + 10 * M + i * 15 * M)));
const cambios = [{ version: 182, anterior: 178, en: new Date(CAMBIO), autor: "Claude", resumen: "Regla borrada: Pide el combo" }];
const filtro = (f) => f.producto === "combo-camilla";

prueba("sin cambios: ningún detector del bot ni del embudo dispara (0 falsos positivos)", () => {
  const ahora = new Date(CAMBIO);
  const h = analisis.analizarHora({ fichas: sanos, ahora, cambios: [], productos: [{ clave: "combo-camilla" }] });
  assert.deepEqual(h.filter((x) => x.severidad !== "OBSERVACION").map((x) => x.clave), []);
});

prueba("cambio de regla ganadora tras el cambio del libro: lo detecta y culpa a la v182", () => {
  const ahora = new Date(CAMBIO + 3 * H);
  const h = bot.detectarCambioDeReglaGanadora({ fichas: [...sanos, ...despues], ahora, producto: "combo-camilla", filtro, cambios });
  assert.ok(h);
  assert.equal(h.evidencia.versiones[0], 182);
  assert.match(h.que, /Nombra las piezas/);
  assert.equal(h.tocaProduccion, true);
});

prueba("con solo 3 leads después del cambio todavía NO opina (tamaño mínimo)", () => {
  const ahora = new Date(CAMBIO + 50 * M);
  const h = bot.detectarCambioDeReglaGanadora({ fichas: [...sanos, ...despues.slice(0, 3)], ahora, producto: "combo-camilla", filtro, cambios });
  assert.equal(h, null);
});

prueba("ráfaga y precio/fotos antes de identificar: detectados desde el cambio", () => {
  const ahora = new Date(CAMBIO + 3 * H);
  for (const indicador of ["rafaga_inicial", "precio_o_fotos_antes_de_identificar"]) {
    const h = bot.detectarComportamiento({ fichas: [...sanos, ...despues], ahora, producto: "combo-camilla", filtro, indicador, cambios });
    assert.ok(h, indicador);
    assert.equal(h.severidad, "IMPORTANTE");
  }
});

prueba("caída de respuesta: el detector del embudo la ve con muestra suficiente", () => {
  const muchos = [];
  for (let i = 0; i < 60; i++) muchos.push(lead.fichaDelLead(`y${i}`, chatDelIncidente(CAMBIO + i * 10 * M)));
  const ahora = new Date(CAMBIO + 13 * H);
  const h = embudo.detectarIndicador({ fichas: [...sanos, ...muchos], ahora, producto: "combo-camilla", filtro, indicador: "respondio_2h", cambios });
  assert.ok(h);
  assert.ok(["CRITICO", "IMPORTANTE"].includes(h.severidad));
  assert.match(h.impacto, /ESTIMACIÓN/);
});

/* ------------------------------------------------------------------ atención */

const LUNES_10AM = Date.parse("2026-10-05T15:00:00Z"); // lunes 10:00 Bogotá

prueba("atención: caliente esperando 20 min = IMPORTANTE, 70 min = CRÍTICO, agrupado por asesora", () => {
  const ahora = new Date(LUNES_10AM);
  const chat = (id, min) => ({ conversationId: id, asesoraId: "u1", asesoraNombre: "Ingrid", etapa: "NEGOCIACION", ultimoClienteEn: new Date(LUNES_10AM - min * M), ultimaRespuestaHumanaEn: null, textosPendientes: ["Color negro"] });
  const a = atencion.detectarAtencion([chat("a", 20)], ahora);
  assert.equal(a.length, 1);
  assert.equal(a[0].severidad, "IMPORTANTE");
  const b = atencion.detectarAtencion([chat("a", 20), chat("b", 70)], ahora);
  assert.equal(b.length, 1);
  assert.equal(b[0].severidad, "CRITICO");
  assert.equal(b[0].leadsAfectados, 2);
  assert.equal(b[0].tocaProduccion, false);
});

prueba("atención: de madrugada no corre el reloj laboral; con respuesta humana no está esperando", () => {
  const domingo3am = Date.parse("2026-10-04T08:00:00Z");
  const chat = { conversationId: "a", asesoraId: "u1", etapa: "NEGOCIACION", ultimoClienteEn: new Date(domingo3am - 120 * M), ultimaRespuestaHumanaEn: null, textosPendientes: ["cómo hago para separarlo"] };
  assert.equal(atencion.detectarAtencion([chat], new Date(domingo3am)).length, 0);
  const respondido = { ...chat, ultimoClienteEn: new Date(LUNES_10AM - 60 * M), ultimaRespuestaHumanaEn: new Date(LUNES_10AM - 30 * M) };
  assert.equal(atencion.detectarAtencion([respondido], new Date(LUNES_10AM)).length, 0);
  assert.equal(atencion.minutosLaborales(new Date(LUNES_10AM - 60 * M), new Date(LUNES_10AM)), 60);
});

prueba("atención: señal sin dueña y oportunidad a retomar", () => {
  const ahora = new Date(LUNES_10AM);
  const sinDuena = { conversationId: "s", asesoraId: null, etapa: "NUEVO", ultimoClienteEn: new Date(LUNES_10AM - 12 * M), ultimaRespuestaHumanaEn: null, textosPendientes: ["cuánto vale el envío a Cali"] };
  const vieja = { conversationId: "v", asesoraId: "u2", etapa: "PROPUESTA", ultimoClienteEn: new Date(LUNES_10AM - 30 * H), ultimaRespuestaHumanaEn: null, textosPendientes: ["a qué cuenta consigno"] };
  const h = atencion.detectarAtencion([sinDuena, vieja], ahora);
  assert.ok(h.some((x) => x.clave === "ATENCION:senal-sin-duena"));
  assert.ok(h.some((x) => x.clave === "ATENCION:oportunidades-a-retomar" && x.severidad === "OBSERVACION"));
});

/* ------------------------------------------------------------------ alertas */

function hallazgo(clave, severidad, desde, extra = {}) {
  return {
    clave, familia: clave.split(":")[0], severidad, titulo: clave, que: clave, desde, producto: "combo-camilla", leadsAfectados: 1,
    evidencia: { chats: [], reglas: [], versiones: [] }, metrica: "", esperado: "", observado: "", hechos: [], hipotesis: [],
    causaPosible: "", impacto: "", recomendacion: "", queCambiar: "", riesgo: "", comoMedir: "", tocaProduccion: true, ...extra,
  };
}

prueba("alertas: nuevo avisa, repetido no (dedupe), sube avisa, se cierra cuando deja de verse", () => {
  const t = new Date(CAMBIO + H);
  let r = alertas.consolidar({ abiertos: [], hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 10 * M))], ahora: t, cambios, familiasEvaluadas: ["BOT"] });
  assert.equal(r.avisar.length, 1);
  assert.equal(r.avisar[0].motivo, "nuevo");
  assert.equal(r.incidentes[0].clave, "INC:libro-v182:combo-camilla");
  const t2 = new Date(t.getTime() + H);
  r = alertas.consolidar({ abiertos: r.incidentes, hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 10 * M))], ahora: t2, cambios, familiasEvaluadas: ["BOT"] });
  assert.equal(r.avisar.length, 0);
  assert.equal(r.incidentes[0].vecesVista, 2);
  // Junto con un cambio de regla: CRÍTICO por combinación → "sube".
  const t3 = new Date(t2.getTime() + H);
  r = alertas.consolidar({
    abiertos: r.incidentes,
    hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 10 * M)), hallazgo("BOT:regla-primer-mensaje:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 10 * M))],
    ahora: t3, cambios, familiasEvaluadas: ["BOT"],
  });
  assert.equal(r.incidentes[0].severidad, "CRITICO");
  assert.equal(r.avisar[0].motivo, "sube");
  // Deja de verse 3 h → RESUELTA.
  const t4 = new Date(t3.getTime() + 3 * H);
  r = alertas.consolidar({ abiertos: r.incidentes, hallazgos: [], ahora: t4, cambios, familiasEvaluadas: ["BOT"] });
  assert.equal(r.incidentes[0].estado, "RESUELTA");
});

prueba("alertas: lo del embudo sin cambio del bot solo avisa si es CRÍTICO; el texto trae la frase de autorización", () => {
  const t = new Date(INICIO + 5 * 24 * H);
  const r = alertas.consolidar({ abiertos: [], hallazgos: [hallazgo("EMBUDO:a_asesora_24h:combo-camilla", "IMPORTANTE", t)], ahora: t, cambios: [], familiasEvaluadas: ["EMBUDO"] });
  assert.equal(r.avisar.length, 0);
  assert.ok(alertas.textoDeLaAlerta(r.incidentes[0]).includes(tipos.ESPERANDO_AUTORIZACION));
});

prueba("alertas: pertenencia pegajosa (un problema abierto no salta al incidente de otro cambio)", () => {
  const t = new Date(CAMBIO + H);
  let r = alertas.consolidar({ abiertos: [], hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 10 * M))], ahora: t, cambios, familiasEvaluadas: ["BOT"] });
  const otro = [...cambios, { version: 188, anterior: 187, en: new Date(CAMBIO + 30 * H), autor: null, resumen: null }];
  r = alertas.consolidar({ abiertos: r.incidentes, hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 31 * H))], ahora: new Date(CAMBIO + 32 * H), cambios: otro, familiasEvaluadas: ["BOT"] });
  assert.deepEqual(r.incidentes.map((i) => i.clave), ["INC:libro-v182:combo-camilla"]);
});

/* ------------------------------------------------------------------ libro: diff y Guardian */

const P = "prod-combo";
const FOTOS = "flujo-fotos";
const reglaCombo = { id: "r-combo", nombre: "Pide el combo de camillas", activa: true, cuando: { tipo: "frase", frases: ["combo de estetica"] }, entonces: [{ tipo: "activar_producto", productoId: P }, { tipo: "ir_al_paso", paso: "PRESENTACION" }] };
const reglaPaso1 = { id: "r-paso1", nombre: "Paso 1: preguntar servicios", activa: true, cuando: { tipo: "paso", producto: P, paso: "PRESENTACION" }, entonces: [{ tipo: "mensaje", texto: "¿Qué servicios vas a ofrecer en tu espacio?" }] };
const reglaPiezas = { id: "r-piezas", nombre: "Nombra las piezas del combo", activa: true, cuando: { tipo: "frase", frases: ["escalera"] }, entonces: [{ tipo: "activar_producto", productoId: P }, { tipo: "flujo", flujoId: FOTOS, titulo: "Foto de combo de camilla" }, { tipo: "ir_al_paso", paso: "OBJECIONES" }] };
const reglaAnuncio = { id: "r-anuncio", nombre: "Llega del anuncio (texto exacto)", activa: true, cuando: { tipo: "frase", exacta: true, frases: [lead.TEXTO_DEL_ANUNCIO_COMBO] }, entonces: [{ tipo: "activar_producto", productoId: P }, { tipo: "ir_al_paso", paso: "PRESENTACION" }] };
const libroBueno = { version: 178, actualizadoEl: "", comoHablamos: "", reglas: [reglaCombo, reglaPaso1, reglaPiezas] };
const libroMalo = { version: 182, actualizadoEl: "", comoHablamos: "", reglas: [reglaPaso1, reglaPiezas, { ...reglaCombo, id: "r-combo-2" }] };
const libroArreglado = { version: 191, actualizadoEl: "", comoHablamos: "", reglas: [...libroMalo.reglas, reglaAnuncio] };
const flujos = { [FOTOS]: { pasos: 6, fotosOVideos: 4, textos: ["Ya te comparto las fotos, el precio el 989.000 envio gratis a ciudades principales", "¿En qué color lo quieres?"] } };
const escenarios = escenariosDelCombo({ productoComboId: P, flujoFotosCombo: FOTOS }).filter((e) => e.id.startsWith("anuncio"));

prueba("diff: detecta la regla RECREADA que pierde su lugar en el desempate", () => {
  const d = diffDelLibro(libroBueno, libroMalo);
  assert.equal(d.recreadas.length, 1);
  assert.equal(d.recreadas[0].nombre, "Pide el combo de camillas");
  assert.match(d.resumen, /RECREADA/);
  const reorden = diffDelLibro(libroBueno, { ...libroBueno, version: 179, reglas: [reglaPaso1, reglaPiezas, reglaCombo] });
  assert.equal(reorden.reordenadas[0].id, "r-combo");
  assert.equal(reorden.reordenadasConEmpate.length, 1);
});

prueba("Guardian: v178 PASA, v182 FALLA (regresión del anuncio), v191 lo arregla", () => {
  const malo = guardian.correrGuardian({ candidato: libroMalo, anterior: libroBueno, escenarios, flujos });
  assert.equal(malo.veredicto, "FALLA");
  assert.ok(malo.regresiones.some((r) => r.id === "anuncio-exacto"));
  const fallas = malo.resultados.find((r) => r.id === "anuncio-exacto").fallas.join(" ");
  assert.match(fallas, /flujo/);
  assert.match(fallas, /env\[ií\]o gratis/);
  const arreglado = guardian.correrGuardian({ candidato: libroArreglado, anterior: libroMalo, escenarios, flujos });
  assert.notEqual(arreglado.veredicto, "FALLA");
  assert.ok(arreglado.arreglados.some((r) => r.id === "anuncio-exacto"));
  const bueno = guardian.correrGuardian({ candidato: libroBueno, escenarios, flujos });
  assert.equal(bueno.resultados.find((r) => r.id === "anuncio-exacto").pasa, true);
});

prueba("cambio del libro que FALLA el Guardian = hallazgo CRÍTICO; el arreglo lo baja a OBSERVACIÓN", () => {
  const cambio = { version: 182, anterior: 178, en: new Date(CAMBIO), autor: "Claude", resumen: "Regla borrada" };
  const informe = guardian.correrGuardian({ candidato: libroMalo, anterior: libroBueno, escenarios, flujos });
  const h = analisis.hallazgoDelCambioDelLibro({ cambio, diff: diffDelLibro(libroBueno, libroMalo), informe, producto: "combo-camilla" });
  assert.equal(h.severidad, "CRITICO");
  const r = alertas.consolidar({ abiertos: [], hallazgos: [h], ahora: new Date(CAMBIO + 5 * M), cambios: [cambio], familiasEvaluadas: [] });
  assert.equal(r.avisar[0].motivo, "nuevo");
  const informe2 = guardian.correrGuardian({ candidato: libroArreglado, anterior: libroMalo, escenarios, flujos });
  const arreglo = analisis.hallazgosDeArreglo({ abiertos: r.incidentes, cambio: { version: 191, anterior: 182, en: new Date(CAMBIO + 70 * H), autor: null, resumen: null }, informe: informe2 });
  assert.equal(arreglo.length, 1);
  assert.equal(arreglo[0].severidad, "OBSERVACION");
});

prueba("agruparCambios: tres versiones en 30 s se ven como un solo cambio", () => {
  const t = Date.parse("2026-10-07T02:36:24Z");
  const g = analisis.agruparCambios([
    { version: 179, anterior: 178, en: new Date(t), autor: null, resumen: "a" },
    { version: 180, anterior: 179, en: new Date(t + 24_000), autor: null, resumen: "b" },
    { version: 181, anterior: 180, en: new Date(t + 28_000), autor: null, resumen: "c" },
    { version: 182, anterior: 181, en: new Date(t + 3 * H), autor: null, resumen: "d" },
  ]);
  assert.equal(g.length, 2);
  assert.equal(g[0].version, 181);
  assert.equal(g[0].anterior, 178);
});

/* ------------------------------------------------------------------ chats de la alerta (pantalla) */

const chatsAlerta = cargar("src/features/supervisor/dominio/chats-de-la-alerta.ts");

prueba("chats de la alerta: nombre, teléfono tapado, frase, espera, asesora y enlace a la conversación", () => {
  const ahora = new Date("2026-10-10T15:00:00Z");
  const hallazgos = atencion.detectarAtencion(
    [
      { conversationId: "cvAAA111", asesoraId: "u1", asesoraNombre: "Ingrid", etapa: "NEGOCIACION", ultimoClienteEn: new Date(ahora.getTime() - 40 * M), ultimaRespuestaHumanaEn: null, textosPendientes: ["¿Cómo hago para separarlo?"] },
      { conversationId: "cmBBB222", asesoraId: "u1", asesoraNombre: "Ingrid", etapa: "NEGOCIACION", ultimoClienteEn: new Date(ahora.getTime() - 20 * M), ultimaRespuestaHumanaEn: null, textosPendientes: ["hola"] },
    ],
    ahora,
  );
  const datosPorChat = new Map([
    ["cvAAA111", { conversationId: "cvAAA111", nombre: "Marta Gómez", telefono: "+57 300 123 4567", asesoraNombre: "Ingrid", ultimoClienteEn: new Date(ahora.getTime() - 40 * M), ultimaRespuestaHumanaEn: null, ultimoTextoCliente: "¿Cómo hago para separarlo?" }],
    ["cmBBB222", { conversationId: "cmBBB222", nombre: "573009998877", telefono: "573009998877", asesoraNombre: null, ultimoClienteEn: new Date(ahora.getTime() - 20 * M), ultimaRespuestaHumanaEn: null, ultimoTextoCliente: "hola" }],
  ]);
  const filas = chatsAlerta.filasDeLaAlerta({ hallazgos, datosPorChat, ahora });
  assert.equal(filas.length, 2);
  const [a, b] = filas;
  assert.equal(a.conversationId, "cvAAA111");
  assert.equal(a.nombre, "Marta Gómez");
  assert.equal(a.telefono, "•••• 4567");
  assert.equal(a.asesora, "Ingrid");
  assert.match(a.frase, /separarlo/);
  assert.match(a.esperando, /min laborales$/);
  assert.equal(a.href, "/cliente/chats?chatKey=agent%3AcvAAA111&assigned=all");
  // Sin nombre (o con el número como nombre) = "Cliente sin nombre"; sin frase en la alerta = su último mensaje.
  assert.equal(b.nombre, "Cliente sin nombre");
  assert.equal(b.telefono, "•••• 8877");
  assert.equal(b.asesora, null);
  assert.ok(!JSON.stringify(filas).includes("1234567") && !JSON.stringify(filas).includes("9998877"), "el teléfono completo no sale");
  // El texto largo de la alerta ya no muestra el id como dato principal.
  const texto = alertas.textoDeLaAlerta(alertas.consolidar({ abiertos: [], hallazgos, ahora, cambios: [], familiasEvaluadas: [] }).incidentes[0], ahora);
  assert.ok(texto.includes("cvAAA111"));
  const limpio = chatsAlerta.textoSinIds(texto, filas);
  assert.ok(!limpio.includes("cvAAA111") && !limpio.includes("cmBBB222"));
  assert.ok(limpio.includes("Marta Gómez (•••• 4567)"));
});

prueba("chats de la alerta: chat no encontrado no rompe y no da enlace; espera calculada si la alerta no la trae", () => {
  const ahora = new Date("2026-10-10T15:00:00Z");
  const hallazgo = { clave: "EMBUDO:x", familia: "EMBUDO", severidad: "IMPORTANTE", titulo: "t", que: "q", desde: ahora, producto: null, leadsAfectados: 2, evidencia: { chats: ["cvBorrado", "cvVivo", "cvVivo"], reglas: [], versiones: [] }, metrica: "", esperado: "", observado: "", hechos: [], hipotesis: [], causaPosible: "", impacto: "", recomendacion: "", queCambiar: "", riesgo: "", comoMedir: "", tocaProduccion: false };
  const datosPorChat = new Map([
    ["cvVivo", { conversationId: "cvVivo", nombre: "  ", telefono: "12", asesoraNombre: "María", ultimoClienteEn: new Date(ahora.getTime() - 3 * H), ultimaRespuestaHumanaEn: new Date(ahora.getTime() - 4 * H), ultimoTextoCliente: "x".repeat(300) }],
  ]);
  const filas = chatsAlerta.filasDeLaAlerta({ hallazgos: [hallazgo], datosPorChat, ahora });
  assert.equal(filas.length, 2, "sin repetir");
  assert.deepEqual(
    { nombre: filas[0].nombre, encontrado: filas[0].encontrado, href: filas[0].href, telefono: filas[0].telefono },
    { nombre: "Chat no encontrado", encontrado: false, href: null, telefono: "" },
  );
  assert.equal(filas[1].nombre, "Cliente sin nombre");
  assert.equal(filas[1].telefono, "", "con menos de 4 dígitos no se muestra nada");
  assert.equal(filas[1].esperando, "3 h");
  assert.ok(filas[1].frase.length <= 120 && filas[1].frase.endsWith("…"));
  assert.equal(chatsAlerta.textoSinIds("chats cvBorrado, cvVivo", filas), "chats (chat no encontrado), Cliente sin nombre");
  // Ya respondió una persona después del último mensaje del cliente: no está esperando.
  const respondido = chatsAlerta.filaDelChat({ conversationId: "cvVivo", hallazgos: [hallazgo], ahora, datos: { ...datosPorChat.get("cvVivo"), ultimaRespuestaHumanaEn: new Date(ahora.getTime() - H) } });
  assert.equal(respondido.esperando, null);
  assert.equal(chatsAlerta.idsDeChatsDeLaAlerta([{ ...hallazgo, evidencia: { chats: Array.from({ length: 30 }, (_, i) => `c${i}`), reglas: [], versiones: [] } }]).length, chatsAlerta.MAX_CHATS_POR_ALERTA);
});

/* ------------------------------------------------------------------ exclusiones (10-oct) */

const exclusiones = cargar("src/features/supervisor/dominio/exclusiones.ts");
const tareasSinDuena = cargar("src/features/supervisor/dominio/tareas-sin-duena.ts");

prueba("exclusiones: un chat PERDIDO y uno +55 (cv9b8466) no generan alertas de atención", () => {
  const ahora = new Date(LUNES_10AM);
  const base = { asesoraId: null, ultimoClienteEn: new Date(LUNES_10AM - 40 * M), ultimaRespuestaHumanaEn: null, textosPendientes: ["Valor da cadeira de manicure?"] };
  const perdido = { ...base, conversationId: "cvPerdido", etapa: "PERDIDO", telefono: "573001234567" };
  const brasil = { ...base, conversationId: "cv9b8466b04a55168797bdd5d9", etapa: "NUEVO", telefono: "554599887766" };
  const marcado = { ...base, conversationId: "cvMarcado", etapa: "NUEVO", telefono: "248211554433221", metadata: { fueraDeColombia: { en: "2026-10-10" } } };
  assert.equal(atencion.detectarAtencion([perdido, brasil, marcado], ahora).length, 0);
  // Un LID sin teléfono real no se decide: SÍ alerta (puede ser de Colombia).
  const lid = { ...base, conversationId: "cvLid", etapa: "NUEVO", telefono: "248211554433221", esLid: true };
  const colombia = { ...base, conversationId: "cvCo", etapa: "NUEVO", telefono: "573001234567" };
  const h = atencion.detectarAtencion([lid, colombia, perdido, brasil], ahora);
  const sinDuena = h.find((x) => x.clave === "ATENCION:senal-sin-duena");
  assert.deepEqual([...sinDuena.evidencia.chats].sort(), ["cvCo", "cvLid"]);
  // Número extranjero de un cliente EN Colombia ("+1 … Pereira risaralda"): sí es tarea.
  const venezolano = { ...base, conversationId: "cvVe", etapa: "NUEVO", telefono: "584141234567", textosPendientes: ["cuánto vale el envío"], textosDelCliente: ["Estoy en Cúcuta"] };
  assert.ok(atencion.detectarAtencion([venezolano], ahora).some((x) => x.evidencia.chats.includes("cvVe")));
  // Caliente esperando y oportunidad a retomar tampoco cuentan a un PERDIDO ni a un +55.
  const caliente = { ...brasil, asesoraId: "u1", etapa: "NEGOCIACION", textosPendientes: ["cómo hago para separar"] };
  const viejo = { ...perdido, asesoraId: "u1", ultimoClienteEn: new Date(LUNES_10AM - 30 * H), textosPendientes: ["a qué cuenta consigno"] };
  assert.equal(atencion.detectarAtencion([caliente, viejo], ahora).length, 0);
});

prueba("exclusiones: dormido por fecha futura y 'ya respondió' no son tarea; despierta si vuelve a escribir", () => {
  const ahora = new Date(LUNES_10AM);
  const dormido = { etapa: "NUEVO", telefono: "573001234567", dormidoHasta: new Date(LUNES_10AM + 30 * 24 * H), ultimoClienteEn: new Date(LUNES_10AM - 3 * 24 * H), ultimaRespuestaHumanaEn: new Date(LUNES_10AM - 3 * 24 * H + 4 * M) };
  assert.equal(exclusiones.motivoDeExclusion(dormido, ahora), "dormido");
  // Al volver a escribir, el motor le borra `dormidoHasta`: vuelve a ser tarea.
  assert.equal(exclusiones.motivoDeExclusion({ ...dormido, dormidoHasta: null, ultimoClienteEn: new Date(LUNES_10AM - 20 * M) }, ahora), null);
  assert.equal(exclusiones.motivoDeExclusion({ ...dormido, dormidoHasta: new Date(LUNES_10AM - H) }, ahora), "ya_respondio");
  assert.equal(exclusiones.motivoDeExclusion({ etapa: "NUEVO", telefono: "573001234567", ultimoClienteEn: new Date(LUNES_10AM - 2 * H), ultimaRespuestaHumanaEn: new Date(LUNES_10AM - H) }, ahora), "ya_respondio");
  assert.equal(exclusiones.motivoDeExclusion({ etapa: "GANADO" }, ahora), "etapa_cerrada");
  const chatDormido = { conversationId: "cvDormido", asesoraId: "u1", ...dormido, ultimaRespuestaHumanaEn: null, textosPendientes: ["Finales de noviembre tal vez, cómo separo"] };
  assert.equal(atencion.detectarAtencion([chatDormido], ahora).length, 0);
});

prueba("exclusiones: al recalcular, los chats excluidos salen de la alerta abierta y la vacía se cierra", () => {
  const ahora = new Date(LUNES_10AM);
  const h1 = hallazgo("ATENCION:senal-sin-duena", "IMPORTANTE", new Date(LUNES_10AM - H), {
    familia: "ATENCION",
    evidencia: { chats: ["cv9b8466b04a55168797bdd5d9", "cvCo"], reglas: [], versiones: [] },
    hechos: ['Chat cv9b8466b04a55168797bdd5d9: 40 min, "Valor da cadeira".', 'Chat cvCo: 30 min, "envío".'],
    leadsAfectados: 2,
  });
  const inc = (clave, hallazgos) => ({ clave, familia: "ATENCION", severidad: "IMPORTANTE", titulo: clave, producto: null, primeraVezEn: ahora, ultimaVezEn: ahora, desde: ahora, vecesVista: 1, estado: "ABIERTA", resueltaEn: null, notificadaEn: null, severidadNotificada: null, hallazgos });
  const soloBrasil = hallazgo("ATENCION:oportunidades-a-retomar", "OBSERVACION", ahora, { familia: "ATENCION", evidencia: { chats: ["cv9b8466b04a55168797bdd5d9"], reglas: [], versiones: [] } });
  const bot = { ...inc("INC:libro-v182:combo-camilla", [hallazgo("BOT:rafaga_inicial:combo-camilla", "CRITICO", ahora, { evidencia: { chats: ["cv9b8466b04a55168797bdd5d9"], reglas: [], versiones: [] } })]), familia: "BOT" };
  const r = exclusiones.purgarChatsExcluidos([inc("ATENCION:senal-sin-duena", [h1]), inc("ATENCION:oportunidades-a-retomar", [soloBrasil]), bot], new Set(["cv9b8466b04a55168797bdd5d9"]), ahora);
  assert.equal(r.cambiados, 2);
  const [quedan, cerrada, incidente] = r.incidentes;
  assert.deepEqual(quedan.hallazgos[0].evidencia.chats, ["cvCo"]);
  assert.equal(quedan.hallazgos[0].leadsAfectados, 1);
  assert.equal(quedan.hallazgos[0].hechos.length, 1);
  assert.equal(quedan.estado, "ABIERTA");
  assert.equal(cerrada.estado, "RESUELTA");
  assert.equal(cerrada.hallazgos[0].evidencia.chats.length, 0);
  // Los incidentes del bot o del embudo no se tocan: sus chats son ejemplos.
  assert.equal(incidente, bot);
  // Y consolidar no la reabre si el detector ya no la produce.
  const c = alertas.consolidar({ abiertos: r.incidentes, hallazgos: [], ahora, cambios: [], familiasEvaluadas: ["ATENCION"] });
  assert.equal(c.incidentes.find((i) => i.clave === "ATENCION:oportunidades-a-retomar").estado, "RESUELTA");
});

prueba("tareas del seguimiento sin dueña: un hallazgo de atención con las A primero (no reasigna)", () => {
  const ahora = new Date(LUNES_10AM);
  const h = tareasSinDuena.hallazgosDeTareasSinDuena(
    [
      { conversationId: "b1", prioridad: "B", vence: new Date(LUNES_10AM - H), motivo: "tibio_sin_asesora", nombre: "x" },
      { conversationId: "a1", prioridad: "A", vence: new Date(LUNES_10AM - 10 * M), motivo: "caliente_sin_asesora", nombre: "y" },
    ],
    ahora,
  );
  assert.equal(h.length, 1);
  assert.equal(h[0].severidad, "IMPORTANTE");
  assert.deepEqual(h[0].evidencia.chats, ["a1", "b1"]);
  assert.equal(h[0].tocaProduccion, false);
  assert.equal(tareasSinDuena.hallazgosDeTareasSinDuena([], ahora).length, 0);
});

/* ------------------------------------------------------------------ incidente acotado a su versión (10-oct) */

const ver = cargar("src/features/supervisor/dominio/version-del-incidente.ts");

prueba("arreglo: el Guardian sobre el historial dice qué versión arregló la v182 (la primera que pasa los críticos)", () => {
  const libros = new Map([
    [182, libroMalo],
    [185, { ...libroMalo, version: 185 }],
    [191, libroArreglado],
    [195, { ...libroArreglado, version: 195 }],
  ]);
  const crudos = [
    { version: 185, anterior: 182, en: new Date(CAMBIO + 30 * H), autor: null, resumen: null },
    { version: 191, anterior: 185, en: new Date(CAMBIO + 70 * H), autor: null, resumen: null },
    { version: 195, anterior: 191, en: new Date(CAMBIO + 71 * H), autor: null, resumen: null },
  ];
  const a = ver.buscarArreglo({ version: 182, libros, cambios: crudos, escenarios, flujos });
  assert.equal(a.version, 191);
  assert.equal(a.en.getTime(), CAMBIO + 70 * H);
  assert.ok(a.escenarios.includes("anuncio-exacto"));
  // La v185 tiene el MISMO defecto: su arreglo también es la 191.
  assert.equal(ver.buscarArreglo({ version: 185, libros, cambios: crudos, escenarios, flujos }).version, 191);
  // Un libro que no fallaba nada no tiene "arreglo"; un libro fuera del historial, tampoco.
  assert.equal(ver.buscarArreglo({ version: 191, libros, cambios: crudos, escenarios, flujos }), null);
  assert.equal(ver.buscarArreglo({ version: 170, libros, cambios: crudos, escenarios, flujos }), null);
  // Lo que dejó el Guardian en vivo (arregladoPor) manda.
  assert.equal(ver.buscarArreglo({ version: 182, libros: new Map(), cambios: crudos, escenarios: [], arregladoPor: 191 }).version, 191);
  assert.equal(ver.versionDelIncidente("INC:libro-v182:combo-camilla"), 182);
  assert.equal(ver.versionDelIncidente("ATENCION:senal-sin-duena"), null);
});

const ARREGLO = { version: 191, en: new Date(CAMBIO + 70 * H), escenarios: ["anuncio-exacto"] };
const CLAVE_182 = "INC:libro-v182:combo-camilla";
/** El incidente real del 10-oct: CRÍTICO, con un ejemplo de después del arreglo y una regla pegada. */
function incidente182(ahora) {
  const rafaga = hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO), { evidencia: { chats: ["antes1", "antes2", "despues1"], reglas: [], versiones: [182] } });
  const regla = hallazgo("BOT:regla-primer-mensaje:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 80 * H), {
    evidencia: { chats: ["cv16c1a0", "despues1"], reglas: ["Llega del anuncio (texto exacto)", "Pide el combo de camillas"], versiones: [210] },
  });
  // Primero la regla del 7-oct; después (pegajosa) la versión del 10-oct con la regla de la v210.
  const primero = alertas.consolidar({ abiertos: [], hallazgos: [rafaga, { ...regla, desde: new Date(CAMBIO + 10 * M) }], ahora: new Date(CAMBIO + H), cambios, familiasEvaluadas: ["BOT"] }).incidentes;
  return alertas.consolidar({ abiertos: primero, hallazgos: [rafaga, regla], ahora, cambios, familiasEvaluadas: ["BOT"] }).incidentes;
}
const entradas = new Map([
  ["antes1", new Date(CAMBIO + 2 * H)],
  ["antes2", new Date(CAMBIO + 40 * H)],
  ["despues1", new Date(CAMBIO + 75 * H)],
  ["cv16c1a0", new Date(CAMBIO + 82 * H)],
  ["viejo", new Date(CAMBIO - 2 * H)],
]);
const entradaDe = (id) => entradas.get(id) ?? null;

prueba("incidente v182 arreglado: sin ejemplos de después del arreglo, OBSERVACIÓN, 'esperando confirmación', sin aviso", () => {
  const ahora = new Date(CAMBIO + 84 * H);
  const abiertos = incidente182(new Date(CAMBIO + 83 * H));
  assert.equal(abiertos[0].severidad, "CRITICO"); // así estaba en producción
  const r = alertas.consolidar({
    abiertos,
    hallazgos: [
      hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO), { evidencia: { chats: ["antes1", "despues1", "viejo"], reglas: [], versiones: [182] } }),
      hallazgo("BOT:regla-primer-mensaje:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 80 * H), { evidencia: { chats: ["cv16c1a0"], reglas: ["Llega del anuncio (texto exacto)"], versiones: [210] } }),
    ],
    ahora,
    cambios: [...cambios, { version: 210, anterior: 209, en: new Date(CAMBIO + 80 * H), autor: null, resumen: null }],
    familiasEvaluadas: ["BOT"],
    versiones: { arreglos: new Map([[CLAVE_182, ARREGLO]]), inicios: new Map([[CLAVE_182, new Date(CAMBIO)]]), entradaDe },
  });
  const inc = r.incidentes.find((i) => i.clave === CLAVE_182);
  assert.equal(inc.severidad, "OBSERVACION");
  assert.match(inc.titulo, /^Arreglado en la v191, esperando confirmación/);
  const chats = inc.hallazgos.flatMap((h) => h.evidencia.chats);
  assert.ok(chats.includes("antes1") && chats.includes("antes2"));
  assert.ok(!chats.includes("despues1"), "un lead de después del arreglo no es ejemplo");
  assert.ok(!chats.includes("cv16c1a0"), "el caso real del 10-oct no es ejemplo del incidente del 7-oct");
  assert.ok(!chats.includes("viejo"), "un lead de antes de la v182 tampoco");
  assert.ok(!inc.hallazgos.some((h) => h.clave.startsWith("BOT:regla-primer-mensaje")), "la regla de la v210 ya no se pega al incidente arreglado");
  assert.ok(inc.hallazgos.some((h) => h.clave === "CAMBIO:arreglo:v182"));
  assert.ok(!r.avisar.some((a) => a.incidente.clave === CLAVE_182));
  // La regla nueva quedó en su propio incidente (el de la v210), no en el de la v182.
  assert.ok(r.incidentes.some((i) => i.clave === "INC:libro-v210:combo-camilla"));
  assert.match(alertas.textoDeLaAlerta(inc, ahora), /esperando confirmación con datos/);
});

prueba("incidente v182 arreglado: con datos suficientes y recuperados se CIERRA; si siguen mal, IMPORTANTE (no CRÍTICO)", () => {
  const ahora = new Date(CAMBIO + 120 * H);
  const abiertos = incidente182(new Date(CAMBIO + 83 * H));
  const inicioDefecto = new Date(CAMBIO);
  // 40 leads sanos después del arreglo vs los 14 días sanos de antes del defecto.
  const sanosDespues = [];
  for (let i = 0; i < 40; i++) sanosDespues.push(lead.fichaDelLead(`ok${i}`, chatSano(ARREGLO.en.getTime() + 10 * M + i * 30 * M, i % 10 < 7)));
  const ok = ver.confirmarArreglo({ hallazgos: abiertos[0].hallazgos, arreglo: ARREGLO, inicioDelDefecto: inicioDefecto, fichas: [...sanos, ...sanosDespues], ahora, filtro });
  assert.equal(ok.estado, "recuperada");
  const r = alertas.consolidar({
    abiertos,
    hallazgos: [],
    ahora,
    cambios,
    familiasEvaluadas: ["BOT"],
    versiones: { arreglos: new Map([[CLAVE_182, ARREGLO]]), inicios: new Map([[CLAVE_182, inicioDefecto]]), confirmaciones: new Map([[CLAVE_182, ok]]), entradaDe },
  });
  const cerrado = r.incidentes.find((i) => i.clave === CLAVE_182);
  assert.equal(cerrado.estado, "RESUELTA");
  assert.match(cerrado.titulo, /^Resuelto, confirmado con datos/);
  assert.equal(r.avisar.length, 0);
  // Pocos leads después del arreglo: sin datos (queda esperando).
  const pocos = ver.confirmarArreglo({ hallazgos: abiertos[0].hallazgos, arreglo: ARREGLO, inicioDelDefecto: inicioDefecto, fichas: [...sanos, ...sanosDespues.slice(0, 4)], ahora, filtro });
  assert.equal(pocos.estado, "sin_datos");
  // Después del arreglo siguen las ráfagas: sigue mal → IMPORTANTE, no CRÍTICO.
  const malos = [];
  for (let i = 0; i < 20; i++) malos.push(lead.fichaDelLead(`mal${i}`, chatDelIncidente(ARREGLO.en.getTime() + 10 * M + i * 30 * M)));
  const mal = ver.confirmarArreglo({ hallazgos: abiertos[0].hallazgos, arreglo: ARREGLO, inicioDelDefecto: inicioDefecto, fichas: [...sanos, ...malos], ahora, filtro });
  assert.equal(mal.estado, "sigue_mal");
  const r2 = alertas.consolidar({
    abiertos,
    hallazgos: [],
    ahora,
    cambios,
    familiasEvaluadas: ["BOT"],
    versiones: { arreglos: new Map([[CLAVE_182, ARREGLO]]), confirmaciones: new Map([[CLAVE_182, mal]]), entradaDe },
  });
  const sigue = r2.incidentes.find((i) => i.clave === CLAVE_182);
  assert.equal(sigue.estado, "ABIERTA");
  assert.equal(sigue.severidad, "IMPORTANTE");
  assert.equal(sigue.cambiadoEn.getTime(), ahora.getTime());
});

prueba("sin arreglo conocido: el incidente igual solo muestra leads que entraron desde su versión", () => {
  const ahora = new Date(CAMBIO + 10 * H);
  const r = alertas.consolidar({
    abiertos: [],
    hallazgos: [hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO), { evidencia: { chats: ["viejo", "antes1"], reglas: [], versiones: [182] } })],
    ahora,
    cambios,
    familiasEvaluadas: ["BOT"],
    versiones: { arreglos: new Map(), inicios: new Map([[CLAVE_182, new Date(CAMBIO)]]), entradaDe },
  });
  assert.deepEqual(r.incidentes[0].evidencia ?? r.incidentes[0].hallazgos[0].evidencia.chats, ["antes1"]);
  assert.equal(r.incidentes[0].severidad, "IMPORTANTE");
});

prueba("la regla que puso el arreglo ganando el primer mensaje es un cambio ESPERADO (OBSERVACIÓN, no escala)", () => {
  const h = hallazgo("BOT:regla-primer-mensaje:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 80 * H), {
    evidencia: { chats: ["cv16c1a0"], reglas: ["Llega del anuncio (texto exacto)", "Pide el combo de camillas"], versiones: [210] },
  });
  const [marcado] = ver.marcarCambiosDelArreglo({ hallazgos: [h], arreglos: [{ version: 182, arreglo: ARREGLO }], libros: new Map([[182, libroMalo], [191, libroArreglado]]) });
  assert.equal(marcado.severidad, "OBSERVACION");
  assert.equal(marcado.tocaProduccion, false);
  assert.match(marcado.titulo, /Cambio esperado/);
  const r = alertas.consolidar({
    abiertos: [],
    hallazgos: [marcado, hallazgo("BOT:rafaga_inicial:combo-camilla", "IMPORTANTE", new Date(CAMBIO + 80 * H))],
    ahora: new Date(CAMBIO + 81 * H),
    cambios: [{ version: 210, anterior: 209, en: new Date(CAMBIO + 80 * H), autor: null, resumen: null }],
    familiasEvaluadas: ["BOT"],
  });
  assert.notEqual(r.incidentes[0].severidad, "CRITICO");
  // Una regla que ya estaba en la versión con el defecto no es "del arreglo".
  const otra = { ...h, evidencia: { ...h.evidencia, reglas: ["Nombra las piezas del combo"] } };
  assert.equal(ver.marcarCambiosDelArreglo({ hallazgos: [otra], arreglos: [{ version: 182, arreglo: ARREGLO }], libros: new Map([[182, libroMalo], [191, libroArreglado]]) })[0].severidad, "IMPORTANTE");
});

/* ------------------------------------------------------------------ atención: asignado sin respuesta humana (10-oct) */

// Sábado 10-oct-2026: 10:22 Bogotá = 15:22 UTC.
const ASIGNADA = Date.parse("2026-10-10T15:22:17Z");
function chatAsignado(parcial = {}) {
  return {
    conversationId: "cv16c1a0254d5cb14719d5cbb7",
    asesoraId: "ingrid",
    asesoraNombre: "Ingrid Sanchez",
    etapa: "NUEVO",
    pausado: false,
    ultimoClienteEn: new Date(Date.parse("2026-10-10T15:22:48Z")),
    ultimaRespuestaHumanaEn: null,
    textosPendientes: [lead.TEXTO_DEL_ANUNCIO_COMBO, "Sirve para pestañas?", "Fotos"],
    textosDelCliente: ["Fotos", "Sirve para pestañas?", lead.TEXTO_DEL_ANUNCIO_COMBO],
    telefono: "573001234567",
    asignadaEn: new Date(ASIGNADA),
    temperatura: "FRIO",
    nombreCliente: "Laura",
    ...parcial,
  };
}

prueba("atención: caso cv16c1a0 (asignado a Ingrid, 'Sirve para pestañas?' + 'Fotos', sin humano) → alerta con mensaje sugerido", () => {
  // 10:50: aún no pasan 30 min laborales (el sábado abre a las 9).
  assert.equal(atencion.detectarAsignadoSinRespuesta([chatAsignado()], new Date(ASIGNADA + 28 * M)).length, 0);
  const ahora = new Date(ASIGNADA + 3 * H); // 13:22, 3 h sin nadie
  const [h] = atencion.detectarAtencion([chatAsignado()], ahora).filter((x) => x.clave.startsWith("ATENCION:asignado-sin-respuesta"));
  assert.ok(h);
  assert.equal(h.clave, "ATENCION:asignado-sin-respuesta:ingrid");
  assert.equal(h.severidad, "IMPORTANTE");
  assert.match(h.titulo, /1 lead\(s\) interesado\(s\) asignado\(s\) a Ingrid Sanchez sin respuesta humana/);
  assert.deepEqual(h.evidencia.chats, ["cv16c1a0254d5cb14719d5cbb7"]);
  assert.ok(h.hechos[0].startsWith("Chat cv16c1a0254d5cb14719d5cbb7: 180 min laborales"));
  assert.match(h.hechos[0], /Tibio/);
  assert.match(h.recomendacion, /Mensaje sugerido: .*pestañas/);
  assert.doesNotMatch(h.recomendacion, /contra ?entrega|gratis/i);
  // La tarjeta del chat lee los minutos y la frase de la alerta.
  const chatsAlerta = cargar("src/features/supervisor/dominio/chats-de-la-alerta.ts");
  const dice = chatsAlerta.loQueDiceLaAlerta([h], "cv16c1a0254d5cb14719d5cbb7");
  assert.equal(dice.esperando, "180 min laborales");
  assert.ok(dice.frase);
});

prueba("atención asignado sin respuesta: CRÍTICO > 2 h si es Caliente; no sale si la asesora escribió, PERDIDO, exterior, dormido o sin interés", () => {
  const ahora = new Date(ASIGNADA + 3 * H);
  const solo = (chats) => atencion.detectarAsignadoSinRespuesta(chats, ahora);
  const caliente = chatAsignado({ conversationId: "cvCal", temperatura: "CALIENTE" });
  assert.equal(solo([caliente])[0].severidad, "CRITICO");
  assert.equal(atencion.detectarAsignadoSinRespuesta([caliente], new Date(ASIGNADA + 90 * M))[0].severidad, "IMPORTANTE");
  // La asesora escribió después de la asignación (aunque el cliente volvió a escribir): no sale.
  assert.equal(solo([chatAsignado({ ultimaRespuestaHumanaEn: new Date(ASIGNADA + 5 * M), ultimoClienteEn: new Date(ASIGNADA + 10 * M) })]).length, 0);
  assert.equal(solo([chatAsignado({ etapa: "PERDIDO" })]).length, 0);
  assert.equal(solo([chatAsignado({ etapa: "GANADO" })]).length, 0);
  assert.equal(solo([chatAsignado({ telefono: "554599887766" })]).length, 0);
  assert.equal(solo([chatAsignado({ dormidoHasta: new Date(ASIGNADA + 30 * 24 * H) })]).length, 0);
  // Sin interés (solo el anuncio y "ok"): no sale.
  assert.equal(solo([chatAsignado({ textosPendientes: [lead.TEXTO_DEL_ANUNCIO_COMBO, "ok"], textosDelCliente: ["ok", lead.TEXTO_DEL_ANUNCIO_COMBO] })]).length, 0);
  // Sin asesora o sin nota de asignación: no es de este detector.
  assert.equal(solo([chatAsignado({ asesoraId: null })]).length, 0);
  assert.equal(solo([chatAsignado({ asignadaEn: null })]).length, 0);
  // Fuera de horario no corre el reloj: asignado el sábado 13:50 → el lunes 8:10 lleva 20 min laborales.
  const sabado = Date.parse("2026-10-10T18:50:00Z");
  assert.equal(atencion.detectarAsignadoSinRespuesta([chatAsignado({ asignadaEn: new Date(sabado) })], new Date(Date.parse("2026-10-12T13:10:00Z"))).length, 0);
  // Precio solo (con el producto del anuncio) ya es interés; "Videos del lavacabezas" también.
  assert.equal(solo([chatAsignado({ textosPendientes: ["cuánto vale"], textosDelCliente: ["cuánto vale", lead.TEXTO_DEL_ANUNCIO_COMBO] })]).length, 1);
  assert.equal(solo([chatAsignado({ textosPendientes: ["Videos del lavacabezas"], textosDelCliente: ["Videos del lavacabezas"] })]).length, 1);
  // Un chat que ya está en "caliente esperando" no se repite en esta alerta.
  const urgente = chatAsignado({ conversationId: "cvUrg", etapa: "NEGOCIACION", textosPendientes: ["cómo hago para separarlo"] });
  const todas = atencion.detectarAtencion([urgente], ahora);
  assert.ok(todas.some((x) => x.clave.startsWith("ATENCION:caliente-esperando")));
  assert.ok(!todas.some((x) => x.clave.startsWith("ATENCION:asignado-sin-respuesta")));
});

console.log(`\n${pruebas} pruebas del Supervisor OK`);

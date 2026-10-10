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

console.log(`\n${pruebas} pruebas del Supervisor OK`);

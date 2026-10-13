// Pruebas del módulo RECUPERACIÓN DE LEADS (pantalla "Semana", alarma de hoy) y de la regla
// "Llamar solo las de 7 días o menos" (Alexander, 13-10-2026). Sin base ni red.
// Correr: npm run test:recuperacion
import assert from "node:assert/strict";

import { cargar } from "./supervisor-cargar.mjs";

const sm = cargar("src/features/recuperacion/dominio/semana.ts");
const li = cargar("src/features/recuperacion/dominio/listas.ts");
const es = cargar("src/features/recuperacion/dominio/en-seguimiento.ts");
const re = cargar("src/features/seguimiento-inteligente/dominio/reactivacion.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const H = 60 * MIN;
const DIA = 24 * H;
// Lunes 6-oct-2026, 9:00 a. m. de Bogotá (14:00 UTC).
const T0 = new Date("2026-10-06T14:00:00Z");
const en = (ms) => new Date(T0.getTime() + ms);
const IN = (ms) => ({ tipo: "IN", en: en(ms) });
const SEG = (ms, clase = "bot") => ({ tipo: "SEG", clase, en: en(ms) });
const lead = (eventos, extra = {}) => ({
  conversationId: `c${Math.random()}`,
  ganado: false,
  ultimoClienteEn: [...eventos].filter((e) => e.tipo === "IN").map((e) => e.en).sort((a, b) => b - a)[0] ?? null,
  eventos,
  ...extra,
});

/* ================================================================================================
   CLASIFICACIÓN DE LOS SEGUIMIENTOS
================================================================================================ */

prueba("clase: bot por origen; follow por el nombre real del Follow", () => {
  assert.equal(sm.claseDeSeguimiento("agente-v3-seguimiento", null), "bot");
  assert.equal(sm.claseDeSeguimiento("follow", "Tras asesora: 1 h"), "tras_asesora");
  assert.equal(sm.claseDeSeguimiento("follow", "Etapa Precio · 1"), "dia_siguiente");
  assert.equal(sm.claseDeSeguimiento("follow", "Etapa Envío · día siguiente"), "dia_siguiente");
  assert.equal(sm.claseDeSeguimiento("follow", "Inteligente: combo-camilla · mensaje_util"), "inteligente");
  assert.equal(sm.claseDeSeguimiento("follow", "Campaña: Reactivación octubre"), "campana");
  assert.equal(sm.claseDeSeguimiento("follow", "Regla vieja"), "otro");
  assert.equal(sm.claseDeSeguimiento("follow", null), "otro");
  assert.equal(sm.claseDeSeguimiento("manual", "Tras asesora: 1 h"), null);
  assert.equal(sm.claseDeSeguimiento(null, null), null);
});

/* ================================================================================================
   RECUPERADOS Y CALLADOS
================================================================================================ */

prueba("recuperado: escribe dentro de las 72 h después de un seguimiento (no antes, no después)", () => {
  assert.equal(sm.fueRecuperado([IN(0), SEG(H), IN(H + 30 * MIN)]), true);
  assert.equal(sm.fueRecuperado([IN(0), SEG(H), IN(H + 72 * H)]), true);
  assert.equal(sm.fueRecuperado([IN(0), SEG(H), IN(H + 73 * H)]), false);
  assert.equal(sm.fueRecuperado([IN(0), IN(10 * MIN)]), false);
  assert.equal(sm.fueRecuperado([IN(2 * H), SEG(3 * H)]), false);
});

prueba("semana: llegaron → seguimiento → recuperados → callados +72 h → compraron", () => {
  const ahora = en(14 * DIA);
  const leads = [
    lead([IN(0)]), // sin seguimiento
    lead([IN(0), SEG(H), IN(2 * H)], { ganado: true }), // recuperado y compró
    lead([IN(0), SEG(H), SEG(DIA, "dia_siguiente")]), // callado
    lead([IN(0), SEG(H)], { ganado: true }), // compró sin recuperarse (venta por otro lado)
    lead([IN(0), SEG(H), IN(10 * DIA)], { ultimoClienteEn: en(13.5 * DIA) }), // escribió tarde: no recuperado ni callado
  ];
  const s = sm.resumirSemana(leads, ahora);
  assert.equal(s.llegaron, 5);
  assert.equal(s.conSeguimiento, 4);
  assert.equal(s.recuperados, 1);
  assert.equal(s.calladosMas72, 2);
  assert.equal(s.compraron, 2);
  assert.equal(s.compraronRecuperados, 1);
  assert.equal(s.pctRecuperados, 25);
});

prueba("números de referencia (6–12 oct): 61 de 301 = 20 %", () => {
  const leads = [];
  for (let i = 0; i < 557; i += 1) {
    if (i < 61) leads.push(lead([IN(0), SEG(H), IN(5 * H)]));
    else if (i < 301) leads.push(lead([IN(0), SEG(H)]));
    else leads.push(lead([IN(0)]));
  }
  const s = sm.resumirSemana(leads, en(10 * DIA));
  assert.deepEqual([s.llegaron, s.conSeguimiento, s.recuperados, s.pctRecuperados], [557, 301, 61, 20]);
});

/* ================================================================================================
   ¿QUÉ SEGUIMIENTO RECUPERA MÁS?
================================================================================================ */

prueba("tipo: contestó en 24 h y ANTES del siguiente seguimiento", () => {
  // El bot a 15 min, el bot a 1 h, el cliente contesta a las 2 h: cuenta para el de 1 h, no el de 15 min.
  const envios = sm.enviosDelLead([IN(0), SEG(15 * MIN), SEG(H), IN(2 * H)]);
  assert.deepEqual(envios.map((e) => e.contesto), [false, true]);
  // Contestó a las 25 h: no cuenta (fuera de las 24 h).
  assert.deepEqual(sm.enviosDelLead([IN(0), SEG(H, "dia_siguiente"), IN(26 * H)]).map((e) => e.contesto), [false]);
});

prueba("tipo: dos mensajes del mismo seguimiento a menos de 2 min son un envío", () => {
  const envios = sm.enviosDelLead([IN(0), SEG(H, "inteligente"), SEG(H + 30_000, "inteligente"), IN(3 * H)]);
  assert.equal(envios.length, 1);
  assert.equal(envios[0].contesto, true);
  // Distinto tipo seguido: dos envíos.
  assert.equal(sm.enviosDelLead([SEG(H, "bot"), SEG(H + 30_000, "tras_asesora")]).length, 2);
});

prueba("tipo: tasa, rojo bajo 5 % y orden por tasa", () => {
  const leads = [];
  for (let i = 0; i < 70; i += 1) leads.push(lead(i < 2 ? [IN(0), SEG(DIA, "dia_siguiente"), IN(DIA + H)] : [IN(0), SEG(DIA, "dia_siguiente")]));
  for (let i = 0; i < 61; i += 1) leads.push(lead(i < 9 ? [IN(0), SEG(DIA, "inteligente"), IN(DIA + H)] : [IN(0), SEG(DIA, "inteligente")]));
  const s = sm.resumirSemana(leads, en(10 * DIA));
  assert.deepEqual(
    s.tipos.map((t) => [t.nombre, t.enviados, t.contestaron, t.pct, t.baja]),
    [
      ["Mensaje útil (inteligente)", 61, 9, 15, false],
      ["Día siguiente", 70, 2, 3, true],
    ],
  );
});

/* ================================================================================================
   ALARMA DE HOY Y COMPARACIÓN
================================================================================================ */

prueba("alarma: días de trabajo de la peor asesora con el tope; sin vencidas no hay alarma", () => {
  assert.equal(sm.diasDeTrabajo(101, 15), 7);
  assert.equal(sm.diasDeTrabajo(15, 15), 1);
  assert.equal(sm.diasDeTrabajo(0, 15), 0);
  const a = sm.armarAlarma({ vencidas: 199, llamadas72h: 146, tope: 15, porAsesora: [{ asesora: "María", tareas: 60 }, { asesora: "Ingrid", tareas: 101 }] });
  assert.deepEqual(a.peor, { asesora: "Ingrid", tareas: 101, dias: 7 });
  const t = sm.textoDeAlarma(a);
  assert.equal(t.titulo, "199 tareas vencidas sin hacer");
  assert.equal(t.detalle, "146 son llamadas de 72 h. Con el tope de 15 por asesora al día, Ingrid tiene trabajo para 7 días.");
  assert.equal(sm.armarAlarma({ vencidas: 0, llamadas72h: 0, tope: 15, porAsesora: [] }), null);
});

prueba("frente a la semana anterior: % recuperados y ventas de recuperados", () => {
  const actual = { pctRecuperados: 20, compraronRecuperados: 1 };
  const antes = { pctRecuperados: 15, compraronRecuperados: 1 };
  const filas = sm.compararSemanas(actual, antes);
  assert.deepEqual(filas.map((f) => [f.nombre, f.actual, f.antes, f.tono]), [
    ["% recuperados", "20 %", "15 %", "sube"],
    ["Ventas de recuperados", "1", "1", "igual"],
  ]);
  assert.equal(sm.compararSemanas(actual, null)[0].antes, "—");
});

/* ================================================================================================
   "LLAMAR SOLO LAS DE 7 DÍAS O MENOS"
================================================================================================ */

prueba("config: recuperacion72h.vencerTrasDias = 7 por defecto, 0 apaga, se lee del JSON", () => {
  assert.equal(cf.CONFIG_POR_DEFECTO.recuperacion72h.vencerTrasDias, 7);
  assert.equal(cf.leerConfigDeTexto(null).recuperacion72h.vencerTrasDias, 7);
  assert.equal(cf.leerConfigDeTexto('{"recuperacion72h":{"vencerTrasDias":10}}').recuperacion72h.vencerTrasDias, 10);
  assert.equal(cf.leerConfigDeTexto('{"recuperacion72h":{"vencerTrasDias":0}}').recuperacion72h.vencerTrasDias, 0);
  assert.equal(cf.leerConfigDeTexto('{"recuperacion72h":{"vencerTrasDias":"x"}}').recuperacion72h.vencerTrasDias, 7);
});

prueba("reactivación: tarea de 72 h con el cliente callado más de 7 días sale; lo demás sigue", () => {
  const ahora = new Date("2026-10-13T15:00:00Z");
  const base = { accion: "tarea_asesora", motivo: "recuperacion_72h", ahora, vencerTrasDias: 7 };
  assert.equal(re.vaAReactivacion({ ...base, ultimoClienteEn: new Date(ahora.getTime() - 8 * DIA) }), true);
  assert.equal(re.vaAReactivacion({ ...base, ultimoClienteEn: new Date(ahora.getTime() - 7 * DIA + MIN) }), false);
  assert.equal(re.vaAReactivacion({ ...base, ultimoClienteEn: new Date(ahora.getTime() - 3 * DIA) }), false);
  assert.equal(re.vaAReactivacion({ ...base, ultimoClienteEn: null }), true);
  // Otras tareas (formulario, cotización…) no se tocan aunque sean viejas.
  assert.equal(re.vaAReactivacion({ ...base, motivo: "formulario_sin_respuesta", ultimoClienteEn: new Date(ahora.getTime() - 20 * DIA) }), false);
  // Lo que no es tarea (espera, aprobación) tampoco.
  assert.equal(re.vaAReactivacion({ ...base, accion: "esperar", ultimoClienteEn: new Date(ahora.getTime() - 20 * DIA) }), false);
  // Apagado (0): todo como antes.
  assert.equal(re.vaAReactivacion({ ...base, vencerTrasDias: 0, ultimoClienteEn: new Date(ahora.getTime() - 20 * DIA) }), false);
  assert.equal(re.corteDeReactivacion(ahora, 0), null);
  assert.equal(re.corteDeReactivacion(ahora, 7).toISOString(), "2026-10-06T15:00:00.000Z");
});

prueba("reactivación: separa la lista (32 de 201 quedan para reactivar)", () => {
  const ahora = new Date("2026-10-13T15:00:00Z");
  const tareas = [];
  for (let i = 0; i < 201; i += 1) {
    const vieja = i < 32;
    tareas.push({ accion: "tarea_asesora", motivo: i < 146 ? "recuperacion_72h" : "formulario_sin_respuesta", ultimoClienteEn: new Date(ahora.getTime() - (vieja ? 9 : 4) * DIA) });
  }
  const { siguen, paraReactivar } = re.separarParaReactivar(tareas, ahora, 7);
  assert.equal(paraReactivar.length, 32);
  assert.equal(siguen.length, 169);
});

/* ================================================================================================
   VISTA "LEADS": LA LISTA DE CADA NÚMERO
================================================================================================ */

// Un lote variado: con y sin seguimiento, recuperados, callados, tardíos, compras, varios tipos.
function loteVariado() {
  const clases = ["bot", "dia_siguiente", "inteligente", "tras_asesora", "campana", "otro"];
  const leads = [];
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 48271) % 2147483647) / 2147483647);
  for (let i = 0; i < 400; i += 1) {
    const eventos = [IN(0)];
    const n = Math.floor(azar() * 4);
    let t = H;
    for (let k = 0; k < n; k += 1) {
      eventos.push(SEG(t, clases[Math.floor(azar() * clases.length)]));
      if (azar() < 0.25) eventos.push(IN(t + azar() * 100 * H));
      t += azar() * 48 * H + MIN;
    }
    const extra = { ganado: azar() < 0.1 };
    if (azar() < 0.1) extra.ultimoClienteEn = en(13.9 * DIA); // escribió hace poco (fuera de la ventana)
    if (azar() < 0.05) extra.ultimoClienteEn = null;
    leads.push(lead(eventos, extra));
  }
  return leads;
}

prueba("leads: cada lista tiene exactamente los leads que cuenta su número en Semana", () => {
  const ahora = en(14 * DIA);
  for (const leads of [loteVariado(), [lead([IN(0)]), lead([IN(0), SEG(H), IN(2 * H)], { ganado: true }), lead([IN(0), SEG(H)])], []]) {
    const s = sm.resumirSemana(leads, ahora);
    const cuenta = (g) => li.leadsDelGrupo(leads, g, ahora).length;
    assert.equal(cuenta("llegaron"), s.llegaron);
    assert.equal(cuenta("seguimiento"), s.conSeguimiento);
    assert.equal(cuenta("recuperados"), s.recuperados);
    assert.equal(cuenta("callados72"), s.calladosMas72);
    assert.equal(cuenta("compraron"), s.compraron);
    assert.equal(cuenta("compraron_recuperados"), s.compraronRecuperados);
    for (const tipo of s.tipos) {
      const lista = li.leadsDelGrupo(leads, `tipo:${tipo.clase}`, ahora);
      assert.ok(lista.length > 0 && lista.length <= tipo.enviados);
      // Los envíos de los leads de la lista son los de la fila del tipo.
      assert.deepEqual(li.enviosDelTipo(lista.map((x) => x.lead), tipo.clase), { enviados: tipo.enviados, contestaron: tipo.contestaron });
    }
  }
});

prueba("leads: la razón de cada uno", () => {
  const ahora = en(14 * DIA);
  assert.equal(li.razonDelLead(lead([IN(0), SEG(H), IN(2 * H)]), "recuperados", ahora), "Contestó al recordatorio del bot en 1 h");
  assert.equal(
    li.razonDelLead(lead([IN(0), SEG(H, "dia_siguiente"), IN(H + 30 * H)]), "recuperados", ahora),
    "Contestó al seguimiento del día siguiente en 30 h",
  );
  assert.equal(
    li.razonDelLead(lead([IN(0), SEG(H), SEG(DIA, "dia_siguiente"), SEG(3 * DIA, "inteligente")]), "callados72", ahora),
    "3 seguimientos sin respuesta · callado hace 14 días",
  );
  assert.equal(li.razonDelLead(lead([IN(0)]), "llegaron", ahora), "Sin seguimiento automático");
  assert.equal(li.razonDelLead(lead([IN(0), SEG(H), IN(2 * H)], { ganado: true }), "compraron", ahora), "Compró · contestó al recordatorio del bot en 1 h");
  assert.equal(li.razonDelLead(lead([IN(0), SEG(H, "inteligente"), IN(3 * H)]), "tipo:inteligente", ahora), "Contestó en menos de 24 h");
  assert.equal(li.razonDelLead(lead([IN(0), SEG(H, "bot"), SEG(2 * H, "bot")]), "tipo:bot", ahora), "2 envíos, no contestó ninguno en 24 h");
});

prueba("leads: orden (callados: el más callado primero; tipo: los que contestaron primero)", () => {
  const ahora = en(14 * DIA);
  const viejo = lead([IN(0), SEG(H)], { conversationId: "viejo", ultimoClienteEn: en(0) });
  const menos = lead([IN(0), SEG(H)], { conversationId: "menos", ultimoClienteEn: en(5 * DIA) });
  assert.deepEqual(li.leadsDelGrupo([menos, viejo], "callados72", ahora).map((x) => x.lead.conversationId), ["viejo", "menos"]);
  const no = lead([IN(0), SEG(H, "bot")], { conversationId: "no" });
  const si = lead([IN(0), SEG(H, "bot"), IN(2 * H)], { conversationId: "si", ultimoClienteEn: en(2 * H) });
  assert.deepEqual(li.leadsDelGrupo([no, si], "tipo:bot", ahora).map((x) => x.lead.conversationId), ["si", "no"]);
});

prueba("leads: URL (grupo, semana por defecto, asesora, ver más)", () => {
  assert.equal(li.grupoPedido("callados72"), "callados72");
  assert.equal(li.grupoPedido("tipo:dia_siguiente"), "tipo:dia_siguiente");
  assert.equal(li.grupoPedido("tipo:nada"), "llegaron");
  assert.equal(li.grupoPedido("vencidas"), "vencidas");
  assert.equal(li.grupoPedido(undefined), "llegaron");
  assert.equal(li.hrefDeRecuperacion({ semana: "2026-10-06" }, "2026-10-06"), "/cliente/crm/recuperacion");
  assert.equal(
    li.hrefDeRecuperacion({ semana: "2026-09-29", vista: "leads", grupo: "tipo:bot" }, "2026-10-06"),
    "/cliente/crm/recuperacion?vista=leads&grupo=tipo%3Abot&semana=2026-09-29",
  );
  assert.equal(
    li.hrefDeRecuperacion({ semana: "2026-10-06", vista: "leads", grupo: "vencidas", asesora: "Ingrid", ver: 400 }, "2026-10-06"),
    "/cliente/crm/recuperacion?vista=leads&grupo=vencidas&asesora=Ingrid&ver=400",
  );
  assert.equal(li.cuantosVer(""), 200);
  assert.equal(li.cuantosVer("400"), 400);
  assert.equal(li.cuantosVer("99999"), 2000);
  assert.equal(li.cuantosVer("-5"), 200);
});

prueba("tareas vencidas: llamadas 72 h, por asesora y vencimiento", () => {
  const ahora = new Date("2026-10-13T15:00:00Z");
  const t = (id, asesora, motivo, horasVencida) => ({
    conversationId: id,
    asesora,
    motivo,
    vence: horasVencida === null ? null : new Date(ahora.getTime() - horasVencida * H),
  });
  const tareas = [
    t("a", "Ingrid", "recuperacion_72h", 5),
    t("b", "María", "formulario_sin_respuesta", 50),
    t("c", "Ingrid", "cotizacion_sin_respuesta", 72),
    t("d", null, "recuperacion_72h", -3),
    t("e", "Ingrid", "recuperacion_72h", null),
  ];
  assert.equal(li.tareasDelGrupo(tareas, "vencidas").length, 5);
  assert.deepEqual(li.tareasDelGrupo(tareas, "llamadas72").map((x) => x.conversationId), ["a", "d", "e"]);
  assert.deepEqual(li.tareasPorAsesora(tareas), [
    { asesora: "Ingrid", tareas: 3 },
    { asesora: "María", tareas: 1 },
    { asesora: "Sin asesora", tareas: 1 },
  ]);
  assert.deepEqual(li.ordenarTareas(tareas, null).map((x) => x.conversationId), ["e", "c", "a", "b", "d"]);
  assert.deepEqual(li.ordenarTareas(tareas, "María").map((x) => x.conversationId), ["b"]);
  assert.equal(li.textoDeVencimiento(new Date(ahora.getTime() - 72 * H), ahora), "Vencida hace 3 días");
  assert.equal(li.textoDeVencimiento(new Date(ahora.getTime() + 5 * H), ahora), "Vence en 5 h");
  assert.equal(li.textoDeVencimiento(null, ahora), "Sin fecha");
});

prueba("en seguimiento ahora: 1 / 2 / 3 o más, programados, y cada lista = su número", () => {
  const ahora = new Date("2026-10-13T15:00:00Z");
  const l = (id, sinRespuesta, horas, programado = false) => ({
    conversationId: id,
    sinRespuesta,
    ultimoSeguimientoEn: new Date(ahora.getTime() - horas * H),
    programado,
    ultimoClienteEn: null,
    ficha: {},
  });
  const leads = [l("a", 1, 2, true), l("b", 2, 30), l("c", 2, 5, true), l("d", 3, 1), l("e", 7, 60), l("f", 0, 1)];
  const r = es.resumirEnSeguimiento(leads);
  assert.deepEqual(r, { total: 5, uno: 1, dos: 2, tresOMas: 2, programados: 2 });
  assert.equal(es.leadsEnSeguimiento(leads, "en_seguimiento").length, r.total);
  assert.equal(es.leadsEnSeguimiento(leads, "en_seguimiento_1").length, r.uno);
  assert.equal(es.leadsEnSeguimiento(leads, "en_seguimiento_2").length, r.dos);
  assert.equal(es.leadsEnSeguimiento(leads, "en_seguimiento_3").length, r.tresOMas);
  assert.deepEqual(es.leadsEnSeguimiento(leads, "en_seguimiento_2").map((x) => x.conversationId), ["c", "b"]);
  assert.equal(es.razonEnSeguimiento(leads[0], ahora), "1 seguimiento sin respuesta · el último hace 2 h · el próximo ya está programado");
  assert.equal(es.razonEnSeguimiento(leads[4], ahora), "7 seguimientos sin respuesta · el último hace 60 h");
  assert.equal(li.grupoPedido("en_seguimiento_3"), "en_seguimiento_3");
  assert.equal(li.nombreDeGrupo("en_seguimiento"), "En seguimiento ahora");
});

console.log(`\n${pruebas} pruebas OK`);

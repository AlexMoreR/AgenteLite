// Pruebas del anti-bloqueo de los automáticos (src/lib/anti-bloqueo/reglas.ts): tope total,
// horario y reprogramación, un solo dueño, texto vigente, espaciado, avisos y la configuración
// (todo apagado por defecto). No necesita base ni red.
// Correr: npm run test:anti-bloqueo
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
      for (const candidato of [base, `${base}.ts`, path.join(base, "index.ts")]) {
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

const r = cargar("src/lib/anti-bloqueo/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Una hora de Bogotá (UTC−5) el 10-oct-2026, como Date. */
const bog = (hhmm, dia = 10) => {
  const [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.UTC(2026, 9, dia, h + 5, m));
};
const min = (fecha, minutos) => new Date(fecha.getTime() + minutos * 60_000);

/* ------------------------------------------------------------------------------------------------
   Configuración
------------------------------------------------------------------------------------------------ */

prueba("config: sin fila, vacía o rota → TODO apagado y avisos por la línea del chat (como hoy)", () => {
  for (const texto of [null, "", "no es json", "[]", "{}"]) {
    const c = r.leerConfigAntiBloqueoDeTexto(texto);
    assert.equal(c.topeTotal.activo, false);
    assert.equal(c.horario.activo, false);
    assert.equal(c.unDueno.activo, false);
    assert.equal(c.textoVigente.activo, false);
    assert.equal(c.espaciado.activo, false);
    assert.equal(c.avisos.via, "linea_del_chat");
  }
  const d = r.leerConfigAntiBloqueoDeTexto(null);
  assert.deepEqual([d.topeTotal.sinRespuesta, d.topeTotal.porSilencio], [2, 2]);
  assert.deepEqual([d.horario.desdeHora, d.horario.hastaHora, d.horario.desfaseMaxMinutos], [8, 20, 30]);
  assert.deepEqual([d.espaciado.minSegundos, d.espaciado.maxSegundos, d.espaciado.porMinuto], [20, 90, 3]);
});

prueba("config: prende lo pedido, limpia valores absurdos y no inventa vías", () => {
  const c = r.leerConfigAntiBloqueoDeTexto(
    JSON.stringify({
      topeTotal: { activo: true, sinRespuesta: "3", porSilencio: -4 },
      horario: { activo: "true", desdeHora: 21, hastaHora: 5 },
      espaciado: { activo: true, minSegundos: 100, maxSegundos: 10, porMinuto: 0 },
      avisos: { via: "telepatia", canalInternoId: "  " },
    }),
  );
  assert.equal(c.topeTotal.activo, true);
  assert.equal(c.topeTotal.sinRespuesta, 3);
  assert.equal(c.topeTotal.porSilencio, 0);
  assert.equal(c.horario.activo, true);
  assert.equal(c.horario.desdeHora, 21);
  assert.equal(c.horario.hastaHora, 22, "el cierre nunca queda antes de la apertura");
  assert.equal(c.espaciado.maxSegundos, 100, "max nunca menor que min");
  assert.equal(c.espaciado.porMinuto, 1);
  assert.equal(c.avisos.via, "linea_del_chat");
  assert.equal(c.avisos.canalInternoId, null);
});

/* ------------------------------------------------------------------------------------------------
   1. Tope total
------------------------------------------------------------------------------------------------ */

const tope = { sinRespuesta: 2, porSilencio: 2 };
const entrada = bog("10:00", 1);

prueba("tope: solo mandó el anuncio → máximo 2 automáticos EN TOTAL, aunque sean de días distintos", () => {
  const h = (automaticos) => ({
    primerEntrante: entrada,
    ultimoEntrante: min(entrada, 1), // "Hola" al minuto: sigue siendo el anuncio
    entrantesDespuesDelAnuncio: 0,
    automaticos,
  });
  assert.equal(r.decidirTope(h([]), tope), null);
  assert.equal(r.decidirTope(h([min(entrada, 15)]), tope), null);
  // El freno viejo dejaba pasar el de mañana (el contador se reiniciaba cada día); el tope no.
  assert.equal(r.decidirTope(h([min(entrada, 15), bog("10:00", 2)]), tope), "tope_sin_respuesta");
  assert.equal(r.decidirTope(h([min(entrada, 15), min(entrada, 75), bog("10:00", 4)]), tope), "tope_sin_respuesta");
});

prueba("tope: un envío de varios mensajes (texto + video en el mismo minuto) cuenta como uno", () => {
  const t = min(entrada, 15);
  assert.equal(r.contarEnvios([t, new Date(t.getTime() + 5_000), new Date(t.getTime() + 40_000)]), 1);
  assert.equal(
    r.decidirTope(
      { primerEntrante: entrada, ultimoEntrante: entrada, entrantesDespuesDelAnuncio: 0, automaticos: [t, new Date(t.getTime() + 5_000)] },
      tope,
    ),
    null,
  );
});

prueba("tope: nunca escribió (lo abrimos nosotros) cuenta como 'sin respuesta'", () => {
  assert.equal(
    r.decidirTope({ primerEntrante: null, ultimoEntrante: null, entrantesDespuesDelAnuncio: 0, automaticos: [bog("9:00"), bog("12:00")] }, tope),
    "tope_sin_respuesta",
  );
});

prueba("tope: respondió → N por silencio; al volver a escribir el cliente, el contador arranca de nuevo", () => {
  const respondio = min(entrada, 30);
  const base = { primerEntrante: entrada, ultimoEntrante: respondio, entrantesDespuesDelAnuncio: 3 };
  // 2 automáticos ANTES de que respondiera no cuentan para este silencio.
  assert.equal(r.decidirTope({ ...base, automaticos: [min(entrada, 15), min(entrada, 20)] }, tope), null);
  assert.equal(r.decidirTope({ ...base, automaticos: [min(respondio, 15)] }, tope), null);
  assert.equal(r.decidirTope({ ...base, automaticos: [min(respondio, 15), bog("11:00", 2)] }, tope), "tope_por_silencio");
  assert.equal(r.decidirTope({ ...base, automaticos: [min(respondio, 15), bog("11:00", 2)] }, { sinRespuesta: 2, porSilencio: 3 }), null);
});

/* ------------------------------------------------------------------------------------------------
   2. Horario y reprogramación
------------------------------------------------------------------------------------------------ */

const horario = { activo: true, desdeHora: 8, hastaHora: 20, desfaseMaxMinutos: 30 };

prueba("horario: 8:00–19:59 de Bogotá adentro; 7:59 y 20:00 afuera", () => {
  assert.equal(r.dentroDelHorario(bog("08:00"), horario), true);
  assert.equal(r.dentroDelHorario(bog("19:59"), horario), true);
  assert.equal(r.dentroDelHorario(bog("07:59"), horario), false);
  assert.equal(r.dentroDelHorario(bog("20:00"), horario), false);
  assert.equal(r.dentroDelHorario(bog("02:15"), horario), false);
  assert.equal(r.minutoDelDiaEnBogota(bog("08:30")), 8 * 60 + 30);
});

prueba("horario: lo de la noche se reprograma a la siguiente apertura + desfase al azar (no se descarta)", () => {
  // 21:30 → mañana 8:00 + desfase
  assert.equal(r.reprogramarFueraDeHorario(bog("21:30"), horario, () => 0).getTime(), bog("08:00", 11).getTime());
  assert.equal(r.reprogramarFueraDeHorario(bog("21:30"), horario, () => 0.5).getTime(), bog("08:15", 11).getTime());
  // 2:15 de la madrugada → HOY 8:00 (no mañana)
  assert.equal(r.reprogramarFueraDeHorario(bog("02:15"), horario, () => 0).getTime(), bog("08:00").getTime());
  // El desfase nunca pasa del máximo.
  const tarde = r.reprogramarFueraDeHorario(bog("23:00"), horario, () => 1);
  assert.ok(tarde.getTime() < bog("08:30", 11).getTime() && tarde.getTime() >= bog("08:29", 11).getTime());
});

prueba("horario V3: callado desde anoche → sale a la apertura + desfase fijo del chat; callado hoy → ya", () => {
  const nocheAnterior = bog("19:40", 9);
  assert.ok(r.esperaDeHorarioV3({ ahora: bog("22:00", 9), silencioDesde: nocheAnterior, horario, semilla: "c1" }), "de noche espera");
  const desfase = r.desfaseFijo("c1", 30);
  assert.ok(desfase >= 0 && desfase <= 30);
  assert.equal(r.desfaseFijo("c1", 30), desfase, "el mismo chat cae siempre en el mismo minuto");
  const espera = r.esperaDeHorarioV3({ ahora: bog("08:00"), silencioDesde: nocheAnterior, horario, semilla: "c1" });
  if (desfase > 0) assert.equal(espera.getTime(), min(bog("08:00"), desfase).getTime());
  assert.equal(r.esperaDeHorarioV3({ ahora: bog("08:31"), silencioDesde: nocheAnterior, horario, semilla: "c1" }), null);
  assert.equal(r.esperaDeHorarioV3({ ahora: bog("10:20"), silencioDesde: bog("10:00"), horario, semilla: "c1" }), null);
});

prueba("horario V3: la ventana de 3 h no cuenta la noche (a las 8:30 mira hasta las 17:30 de ayer)", () => {
  assert.equal(r.inicioDeVentanaHabil(bog("08:30"), 3, horario).getTime(), bog("17:30", 9).getTime());
  assert.equal(r.inicioDeVentanaHabil(bog("14:00"), 3, horario).getTime(), bog("11:00").getTime());
  assert.equal(r.inicioDeVentanaHabil(bog("08:30"), 3, null).getTime(), bog("05:30").getTime(), "sin horario: como hoy");
});

/* ------------------------------------------------------------------------------------------------
   3. Un solo dueño
------------------------------------------------------------------------------------------------ */

prueba("dueño: chat pausado, PERDIDO/GANADO o asesora que escribió → no sale nada automático", () => {
  const inicio = bog("09:00");
  const libre = { automationPaused: false, crmStage: "NUEVO", inicioDeLaCharla: inicio, mensajesHumanos: [] };
  assert.equal(r.decidirDueno(libre), null);
  assert.equal(r.decidirDueno({ ...libre, automationPaused: true }), "chat_pausado");
  assert.equal(r.decidirDueno({ ...libre, crmStage: "PERDIDO" }), "etapa_cerrada");
  assert.equal(r.decidirDueno({ ...libre, crmStage: "GANADO" }), "etapa_cerrada");
  assert.equal(r.decidirDueno({ ...libre, mensajesHumanos: [{ createdAt: bog("09:30"), origen: "manual" }] }), "asesora_escribio");
  assert.equal(r.decidirDueno({ ...libre, mensajesHumanos: [{ createdAt: bog("09:30"), origen: "instance" }] }), "asesora_escribio");
});

prueba("dueño: lo que sale del celular en el primer minuto es el automático de la línea, no una persona", () => {
  const inicio = bog("09:00");
  const estado = {
    automationPaused: false,
    crmStage: "NUEVO",
    inicioDeLaCharla: inicio,
    mensajesHumanos: [{ createdAt: new Date(inicio.getTime() + 20_000), origen: "instance" }],
  };
  assert.equal(r.decidirDueno(estado), null);
});

/* ------------------------------------------------------------------------------------------------
   4. Texto vigente y clase de seguimiento
------------------------------------------------------------------------------------------------ */

prueba("clase: campaña, reactivación, asesora y automáticos (regla, etapa, escalera)", () => {
  assert.equal(r.clasificarFollow({ name: "Campaña: Octubre", followRuleId: null }), "campana");
  assert.equal(r.clasificarFollow({ name: r.NOMBRE_FOLLOW_REACTIVACION, followRuleId: null }), "reactivacion");
  assert.equal(r.clasificarFollow({ name: "Seguimiento desde el chat", followRuleId: null }), "humano");
  assert.equal(r.clasificarFollow({ name: "Llamar el lunes", followRuleId: null }), "humano");
  assert.equal(r.clasificarFollow({ name: null, followRuleId: null }), "humano");
  assert.equal(r.clasificarFollow({ name: null, followRuleId: "regla1" }), "automatico");
  assert.equal(r.clasificarFollow({ name: "Etapa Dudas y objeciones · 2", followRuleId: null }), "automatico");
  assert.equal(r.clasificarFollow({ name: "Sin responder 1", followRuleId: null }), "automatico");
  assert.equal(r.clasificarFollow({ name: "Sin responder al flujo 2", followRuleId: null }), "automatico");
});

prueba("texto vigente: regla apagada o borrada → no sale; texto cambiado → no sale el viejo", () => {
  const agendado = r.firmasDe([{ messageType: "TEXT", content: "Te dejé apartado el combo, puedes pagarlo contraentrega" }]);
  assert.equal(r.decidirTextoVigente({ agendado, vigente: null }), "seguimiento_apagado");
  assert.equal(
    r.decidirTextoVigente({ agendado, vigente: { tipo: "regla", firmas: r.firmasDe([{ messageType: "TEXT", content: "Te dejé apartado el combo" }]) } }),
    "texto_cambiado",
  );
  assert.equal(
    r.decidirTextoVigente({
      agendado,
      vigente: { tipo: "regla", firmas: r.firmasDe([{ messageType: "TEXT", content: "  Te dejé apartado el combo,   puedes pagarlo contraentrega " }]) },
    }),
    null,
    "espacios de más no son un cambio",
  );
});

prueba("texto vigente: embudo (conjunto) — el de 3 días inactivo ya no está entre los vigentes", () => {
  const vigentes = new Set([r.firmaDeAccion({ messageType: "TEXT", content: "Te dejé apartado el combo" })]);
  const delDia3 = r.firmasDe([{ messageType: "TEXT", content: "Flujo del embudo", flowId: "evolution:a:video" }]);
  const delDia1 = r.firmasDe([{ messageType: "TEXT", content: "Te dejé apartado el combo" }]);
  assert.equal(r.decidirTextoVigente({ agendado: delDia1, vigente: { tipo: "conjunto", firmas: vigentes } }), null);
  assert.equal(r.decidirTextoVigente({ agendado: delDia3, vigente: { tipo: "conjunto", firmas: vigentes } }), "texto_cambiado");
  assert.equal(r.decidirTextoVigente({ agendado: delDia1, vigente: { tipo: "conjunto", firmas: new Set() } }), "seguimiento_apagado");
  // Un flujo vigente se reconoce por su id, aunque cambie la etiqueta.
  const conFlujo = new Set([r.firmaDeAccion({ content: "otra etiqueta", flowId: "evolution:a:video" })]);
  assert.equal(r.decidirTextoVigente({ agendado: delDia3, vigente: { tipo: "conjunto", firmas: conFlujo } }), null);
});

/* ------------------------------------------------------------------------------------------------
   5. Espaciado
------------------------------------------------------------------------------------------------ */

prueba("espaciado: espera al azar entre 20 y 90 s", () => {
  const esp = { minSegundos: 20, maxSegundos: 90 };
  assert.equal(r.siguienteEsperaMs(esp, () => 0), 20_000);
  assert.equal(r.siguienteEsperaMs(esp, () => 1), 90_000);
  for (let i = 0; i < 200; i += 1) {
    const ms = r.siguienteEsperaMs(esp);
    assert.ok(ms >= 20_000 && ms <= 90_000);
  }
});

prueba("espaciado: antes de la espera no sale (y dice desde cuándo); tope por minuto por línea", () => {
  const ahora = bog("10:00");
  assert.deepEqual(
    r.decidirEspaciado({ ahora, proximoPermitido: null, enviosUltimoMinuto: 0, masViejoDelMinuto: null, porMinuto: 3 }),
    { enviar: true },
  );
  const espera = r.decidirEspaciado({
    ahora,
    proximoPermitido: new Date(ahora.getTime() + 45_000),
    enviosUltimoMinuto: 1,
    masViejoDelMinuto: null,
    porMinuto: 3,
  });
  assert.equal(espera.enviar, false);
  assert.equal(espera.desde.getTime(), ahora.getTime() + 45_000);
  const lleno = r.decidirEspaciado({
    ahora,
    proximoPermitido: new Date(ahora.getTime() - 1_000),
    enviosUltimoMinuto: 3,
    masViejoDelMinuto: new Date(ahora.getTime() - 50_000),
    porMinuto: 3,
  });
  assert.equal(lleno.enviar, false);
  assert.equal(lleno.desde.getTime(), ahora.getTime() + 10_000, "se libera cuando el más viejo sale del minuto");
});

prueba("espaciado: simulación de una ráfaga del cron (16 vencidos el mismo minuto) → nunca más de 3 por minuto", () => {
  const esp = { minSegundos: 20, maxSegundos: 90, porMinuto: 3 };
  let ahora = bog("10:00").getTime();
  let proximo = null;
  const enviados = [];
  let pendientes = 16;
  let azar = 0;
  while (pendientes > 0) {
    const ultimoMinuto = enviados.filter((t) => t > ahora - 60_000);
    const d = r.decidirEspaciado({
      ahora: new Date(ahora),
      proximoPermitido: proximo,
      enviosUltimoMinuto: ultimoMinuto.length,
      masViejoDelMinuto: ultimoMinuto.length ? new Date(Math.min(...ultimoMinuto)) : null,
      porMinuto: esp.porMinuto,
    });
    if (d.enviar) {
      enviados.push(ahora);
      pendientes -= 1;
      azar = (azar + 0.37) % 1;
      proximo = new Date(ahora + r.siguienteEsperaMs(esp, () => azar));
    }
    ahora += 60_000; // el cron corre cada minuto
  }
  for (const t of enviados) {
    assert.ok(enviados.filter((x) => x > t - 60_000 && x <= t).length <= 3);
  }
  for (let i = 1; i < enviados.length; i += 1) {
    assert.ok(enviados[i] - enviados[i - 1] >= 20_000, "siempre al menos 20 s entre envíos");
  }
});

/* ------------------------------------------------------------------------------------------------
   6. Avisos internos
------------------------------------------------------------------------------------------------ */

prueba("avisos: por defecto la línea del chat y de respaldo la de la config (como hoy)", () => {
  const d = r.leerConfigAntiBloqueoDeTexto(null).avisos;
  assert.deepEqual(r.decidirViaDeAvisos({ avisos: d, canalDelChat: "ventas1", canalDeLaConfig: "admin" }), {
    tipo: "whatsapp",
    canales: ["ventas1", "admin"],
  });
});

prueba("avisos: línea interna → nunca la línea de ventas; push → sin WhatsApp", () => {
  assert.deepEqual(
    r.decidirViaDeAvisos({ avisos: { via: "linea_interna", canalInternoId: null }, canalDelChat: "ventas1", canalDeLaConfig: "admin" }),
    { tipo: "whatsapp", canales: ["admin"] },
  );
  assert.deepEqual(
    r.decidirViaDeAvisos({ avisos: { via: "linea_interna", canalInternoId: "equipo" }, canalDelChat: "ventas1", canalDeLaConfig: "admin" }),
    { tipo: "whatsapp", canales: ["equipo"] },
  );
  assert.deepEqual(
    r.decidirViaDeAvisos({ avisos: { via: "push", canalInternoId: null }, canalDelChat: "ventas1", canalDeLaConfig: "admin" }),
    { tipo: "push" },
  );
});

console.log(`\n${pruebas} pruebas, todas bien.`);

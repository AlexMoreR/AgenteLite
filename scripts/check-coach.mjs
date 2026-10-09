// Pruebas del coach de ventas (src/features/coach/reglas.ts): quien escribio, esperas en horario
// laboral, filtrado de notas SYSTEM, enmascarado de telefonos, armado del prompt sin datos
// personales, puntaje e idempotencia por dia. No necesita base ni red.
// Correr: npm run test:coach
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

const r = cargar("src/features/coach/reglas.ts");
const { POLITICA_COACH } = cargar("src/features/coach/politica.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

/** Hora de Bogota -> instante UTC. "2026-10-08 10:00" (jueves). */
const bog = (texto) => new Date(`${texto.replace(" ", "T")}:00.000-05:00`);

let n = 0;
const msg = (cuando, quien, texto, extra = {}) => {
  n += 1;
  const base = { id: `m${n}`, content: texto, createdAt: bog(cuando), type: "TEXT", rawPayload: {} };
  if (quien === "cliente") return { ...base, direction: "INBOUND", ...extra };
  if (quien === "asesora") return { ...base, direction: "OUTBOUND", rawPayload: { source: "manual", enviadoPorUserId: "u-ingrid" }, ...extra };
  if (quien === "celular") return { ...base, direction: "OUTBOUND", rawPayload: { source: "instance" }, ...extra };
  if (quien === "bot") return { ...base, direction: "OUTBOUND", ...extra };
  return { ...base, direction: "OUTBOUND", type: "SYSTEM", ...extra };
};

const { desde: inicio8, hasta: fin8 } = r.rangoDelDia("2026-10-08");

/* ---------------------------------------------------------------------------------------------- */

prueba("rango del día en Bogotá: 8-oct va de 05:00Z a 05:00Z del 9", () => {
  assert.equal(inicio8.toISOString(), "2026-10-08T05:00:00.000Z");
  assert.equal(fin8.toISOString(), "2026-10-09T05:00:00.000Z");
  assert.equal(r.rangoDelDia("2026-10-08").clave.toISOString(), "2026-10-08T00:00:00.000Z");
  assert.equal(r.diaEnBogota(new Date("2026-10-09T04:30:00Z")), "2026-10-08");
  assert.equal(r.esDiaValido("2026-10-08"), true);
  assert.equal(r.esDiaValido("8-10-2026"), false);
});

prueba("quién escribió: cliente, asesora (CRM), celular, bot y sistema", () => {
  assert.deepEqual(r.autorDelMensaje(msg("2026-10-08 10:00", "cliente", "hola")), { autor: "cliente", userId: null, desdeCelular: false });
  assert.deepEqual(r.autorDelMensaje(msg("2026-10-08 10:00", "asesora", "hola")), { autor: "asesora", userId: "u-ingrid", desdeCelular: false });
  assert.equal(r.autorDelMensaje(msg("2026-10-08 10:00", "celular", "hola")).desdeCelular, true);
  assert.equal(r.autorDelMensaje(msg("2026-10-08 10:00", "bot", "hola")).autor, "bot");
  assert.equal(r.autorDelMensaje(msg("2026-10-08 10:00", "bot", "hola", { rawPayload: { source: "agente-v3-seguimiento" } })).autor, "bot");
  assert.equal(r.autorDelMensaje(msg("2026-10-08 10:00", "sistema", "nota")).autor, "sistema");
});

prueba("minutos laborales: L-V 8-18, sábado 9-14, domingo nada", () => {
  // jueves 10:00 -> 10:46
  assert.equal(r.minutosLaborales(bog("2026-10-08 10:00"), bog("2026-10-08 10:46")), 46);
  // jueves 17:50 -> viernes 8:05 = 10 + 5
  assert.equal(r.minutosLaborales(bog("2026-10-08 17:50"), bog("2026-10-09 08:05")), 15);
  // viernes 17:50 -> lunes 8:05 = 10 (vie) + 300 (sáb 9-14) + 0 (dom) + 5 (lun)
  assert.equal(r.minutosLaborales(bog("2026-10-09 17:50"), bog("2026-10-12 08:05")), 315);
  // sábado 13:50 -> lunes 8:10 = 10 + 10
  assert.equal(r.minutosLaborales(bog("2026-10-10 13:50"), bog("2026-10-12 08:10")), 20);
  // domingo entero: 0
  assert.equal(r.minutosLaborales(bog("2026-10-11 07:00"), bog("2026-10-11 22:00")), 0);
  // noche del jueves: 0
  assert.equal(r.minutosLaborales(bog("2026-10-08 19:00"), bog("2026-10-08 23:30")), 0);
  assert.equal(r.minutosLaborales(bog("2026-10-08 10:00"), bog("2026-10-08 09:00")), 0);
  assert.equal(r.estaEnHorario(bog("2026-10-08 08:00")), true);
  assert.equal(r.estaEnHorario(bog("2026-10-08 18:00")), false);
  assert.equal(r.estaEnHorario(bog("2026-10-10 13:59")), true);
  assert.equal(r.estaEnHorario(bog("2026-10-11 10:00")), false);
});

prueba("el cliente escribió en horario y ninguna PERSONA respondió (el bot no cuenta): sin_respuesta", () => {
  const mensajes = r.normalizarMensajes([
    msg("2026-10-08 10:00", "cliente", "¿Cuánto vale el envío a Montelíbano?"),
    msg("2026-10-08 10:01", "bot", "Te leo 🙌 ¿Qué te gustaría saber?"),
  ]);
  const { eventos } = r.detectarEsperas({ mensajes, desde: inicio8, corte: bog("2026-10-08 23:30") });
  assert.equal(eventos.length, 1);
  assert.equal(eventos[0].tipo, "sin_respuesta");
  assert.equal(eventos[0].minutos, 480); // 10:00 -> 18:00
});

prueba("cliente que escribe fuera de horario (20:00) no castiga ese día", () => {
  const mensajes = r.normalizarMensajes([msg("2026-10-08 20:00", "cliente", "Hola, info del combo")]);
  const { eventos } = r.detectarEsperas({ mensajes, desde: inicio8, corte: fin8 });
  assert.deepEqual(eventos, []);
});

prueba("demora > 15 min en horario cuenta; 10 min no; y la primera respuesta se mide", () => {
  const mensajes = r.normalizarMensajes([
    msg("2026-10-08 09:00", "cliente", "Hola, precio del combo"),
    msg("2026-10-08 09:10", "asesora", "Hola! Vale $989.000"),
    msg("2026-10-08 11:00", "cliente", "¿Y a Cali llega gratis?"),
    msg("2026-10-08 11:46", "asesora", "Sí, gratis en Cali"),
  ]);
  const res = r.detectarEsperas({ mensajes, desde: inicio8, corte: fin8 });
  assert.equal(res.primeraRespuestaMin, 10);
  assert.equal(res.eventos.length, 1);
  assert.equal(res.eventos[0].tipo, "demora");
  assert.equal(res.eventos[0].minutos, 46);
  assert.equal(r.ejeVelocidad(res), 8);
});

prueba("un 'gracias' o un sticker no abre una espera", () => {
  const mensajes = r.normalizarMensajes([
    msg("2026-10-08 09:00", "cliente", "precio?"),
    msg("2026-10-08 09:05", "asesora", "Vale $989.000"),
    msg("2026-10-08 09:06", "cliente", "Ok, gracias!"),
    msg("2026-10-08 09:07", "cliente", "", { type: "STICKER" }),
  ]);
  assert.deepEqual(r.detectarEsperas({ mensajes, desde: inicio8, corte: fin8 }).eventos, []);
});

prueba("la espera se cuenta desde que el chat le cayó a la asesora, no antes", () => {
  const mensajes = r.normalizarMensajes([
    msg("2026-10-08 09:00", "cliente", "Info del combo rosa"),
    msg("2026-10-08 13:00", "asesora", "Hola! ¿Para qué ciudad?"),
  ]);
  const res = r.detectarEsperas({ mensajes, desde: bog("2026-10-08 12:50"), corte: fin8 });
  assert.deepEqual(res.eventos, []);
  assert.equal(res.primeraRespuestaMin, 10);
  // Lo que venía esperando desde la noche anterior se cuenta desde las 8:00 del día.
  const nocturno = r.normalizarMensajes([
    msg("2026-10-07 21:00", "cliente", "¿Hacen envíos a Pasto?"),
    msg("2026-10-08 08:40", "asesora", "Hola! Sí llegamos"),
  ]);
  const res2 = r.detectarEsperas({ mensajes: nocturno, desde: inicio8, corte: fin8 });
  assert.equal(res2.eventos[0].minutos, 40);
});

prueba("filtrado de notas SYSTEM: se van las del Agente V3 y las internas; quedan asignación y etapa", () => {
  const crudos = [
    msg("2026-10-08 09:00", "cliente", "hola"),
    msg("2026-10-08 09:00", "sistema", "Agente V3: Ganó «Pide el combo» porque el cliente dijo hola", { rawPayload: { source: "activity", kind: "note" } }),
    msg("2026-10-08 09:01", "sistema", "Agente V3: se rescató un mensaje", { rawPayload: { source: "activity", kind: "note", rescate: true } }),
    msg("2026-10-08 09:02", "sistema", "María dejó una nota", { rawPayload: { source: "activity", kind: "note" } }),
    msg("2026-10-08 09:03", "sistema", "Magilus asignó a Ingrid", { rawPayload: { source: "activity", kind: "assigned", assigneeUserId: "u-ingrid" } }),
    msg("2026-10-08 09:04", "sistema", 'María cambió la etapa a "Descartado"', { rawPayload: { source: "activity", kind: "stage_changed", actorUserId: "u-maria" } }),
    msg("2026-10-08 09:05", "bot", "Llamada perdida", { rawPayload: { source: "llamada" } }),
    msg("2026-10-08 09:06", "cliente", "estado", { isStatusBroadcast: true }),
  ];
  const limpios = r.normalizarMensajes(crudos);
  assert.equal(limpios.length, 3);
  assert.deepEqual(limpios.map((m) => m.nota?.kind ?? m.autor), ["cliente", "assigned", "stage_changed"]);
  assert.equal(limpios[1].nota.assigneeUserId, "u-ingrid");
  assert.equal(r.esNotaDeDescarte(limpios[2]), true);
  const texto = r.transcripcionParaIA(limpios, { inicioDelDia: inicio8 });
  assert.ok(!texto.includes("Agente V3"));
  assert.ok(!texto.includes("dejó una nota"));
});

prueba("enmascarado: teléfonos, cédulas y correos salen; los precios se quedan", () => {
  assert.equal(r.ultimos4("+57 315 123 8112"), "…8112");
  assert.equal(r.ultimos4(null), "…");
  assert.equal(r.limpiarDatosPersonales("mi número es 315 123 4567"), "mi número es [número …4567]");
  assert.equal(r.limpiarDatosPersonales("llámame al +573151234567"), "llámame al [número …4567]");
  assert.equal(r.limpiarDatosPersonales("cédula 1144087654"), "cédula [número …7654]");
  assert.equal(r.limpiarDatosPersonales("cuenta 123-456789-01"), "cuenta [número …8901]");
  assert.equal(r.limpiarDatosPersonales("escribe a sofia.r@gmail.com"), "escribe a [correo]");
  assert.equal(r.limpiarDatosPersonales("Vale $1.129.000 y separas con 494.500"), "Vale $1.129.000 y separas con 494.500");
  assert.equal(r.limpiarDatosPersonales("total $1129000"), "total $1129000");
  assert.equal(r.limpiarDatosPersonales("2 camillas y 1 silla"), "2 camillas y 1 silla");
  assert.equal(r.primerNombre("SOFÍA ramírez"), "Sofía");
  assert.equal(r.primerNombre("+57 315"), "");
});

prueba("el prompt va sin teléfonos completos ni correos, con …1234 y con la política", () => {
  const mensajes = r.normalizarMensajes([
    msg("2026-10-07 18:30", "cliente", "Hola, soy Sofía Ramírez, mi cel 3151238112"),
    msg("2026-10-08 18:53", "cliente", "Voy al punto mañana, mi correo es sofia.r@gmail.com y cédula 1144087654"),
    msg("2026-10-08 18:55", "asesora", "Listo Sofía, te espero. Tu combo rosa queda en $989.000"),
  ]);
  const ficha = {
    ref: "#8112",
    ultimos4: r.ultimos4("573151238112"),
    nombre: r.primerNombre("Sofía Ramírez"),
    etapa: "Caliente",
    soloPendiente: false,
    hechos: ["no se detectó cotización enviada hoy"],
    transcripcion: r.transcripcionParaIA(mensajes, {
      inicioDelDia: inicio8,
      nombres: { "u-ingrid": "Ingrid" },
      ocultar: r.apellidosDe("Sofía Ramírez"),
    }),
  };
  const { sistema, usuario } = r.armarPromptDelLote({ asesora: "Ingrid", dia: "2026-10-08", fichas: [ficha] });
  const todo = `${sistema}\n${usuario}`;
  for (const prohibido of ["3151238112", "573151238112", "sofia.r@gmail.com", "1144087654", "Ramírez"]) {
    assert.ok(!todo.includes(prohibido), `el prompt no debe traer ${prohibido}`);
  }
  assert.ok(usuario.includes("…8112"));
  assert.ok(usuario.includes("ASESORA Ingrid"));
  assert.ok(usuario.includes("-- antes de hoy"));
  assert.ok(usuario.includes("$989.000"));
  assert.ok(sistema.includes("SUSPENDIDA"));
  assert.ok(sistema.includes("Villavicencio"));
  assert.ok(sistema.includes("San Andrés"));
  assert.ok(sistema.includes("sábado 09:00-14:00"));
});

prueba("puntaje: sin Resultado y con 'no aplica' en seguimiento se reparte el peso", () => {
  assert.equal(r.puntajePonderado({ V: 10, N: 10, A: 10, S: 10, C: 10 }), 10);
  // S null: (8*20 + 6*20 + 4*20 + 10*15) / 75 = 510/75 = 6.8
  assert.equal(r.puntajePonderado({ V: 8, N: 6, A: 4, S: null, C: 10 }), 6.8);
  assert.equal(r.puntajePonderado({ R: 10, V: 5 }), 5);
  assert.equal(r.puntajePonderado({}), null);
  assert.equal(r.puntajePonderado({ V: 14 }), 10);
  assert.deepEqual(r.promedioDeEjes([{ V: 8, S: null }, { V: 6, S: 4 }]), { V: 7, N: null, A: null, S: 4, C: null });
});

prueba("idempotencia por día: el reloj no repite, 'Generar ahora' rehace, nadie pisa una corrida en curso", () => {
  const ahora = bog("2026-10-08 23:35");
  assert.equal(r.decidirCorrida(null, { ahora }), "generar");
  assert.equal(r.decidirCorrida({ estado: "LISTO", iniciadoEn: bog("2026-10-08 23:30") }, { ahora }), "omitir_listo");
  assert.equal(r.decidirCorrida({ estado: "LISTO", iniciadoEn: bog("2026-10-08 23:30") }, { ahora, force: true }), "generar");
  assert.equal(r.decidirCorrida({ estado: "EN_CURSO", iniciadoEn: bog("2026-10-08 23:30") }, { ahora }), "omitir_en_curso");
  assert.equal(r.decidirCorrida({ estado: "EN_CURSO", iniciadoEn: bog("2026-10-08 23:30") }, { ahora, force: true }), "omitir_en_curso");
  // Una corrida que quedó colgada (reinicio) se retoma a los 30 min.
  assert.equal(r.decidirCorrida({ estado: "EN_CURSO", iniciadoEn: bog("2026-10-08 22:00") }, { ahora }), "generar");
  assert.equal(r.decidirCorrida({ estado: "ERROR", iniciadoEn: bog("2026-10-08 23:30") }, { ahora }), "generar");
  // La ventana del reloj: 23:30 a 23:58 de Bogotá.
  assert.equal(r.enVentanaDelReloj(bog("2026-10-08 23:30")), true);
  assert.equal(r.enVentanaDelReloj(bog("2026-10-08 23:58")), true);
  assert.equal(r.enVentanaDelReloj(bog("2026-10-08 23:59")), false);
  assert.equal(r.enVentanaDelReloj(bog("2026-10-08 22:00")), false);
});

prueba("respuesta de la IA: refs desconocidos fuera, tipos raros a 'otro', nada de contraentrega sugerida", () => {
  const crudo = JSON.stringify({
    chats: [
      {
        ref: "#1",
        ejes: { N: 7, A: "5", S: null, C: 12 },
        aciertos: ["Respondió rápido con un total"],
        errores: [{ tipo: "contraentrega", detalle: "Ofreció contraentrega con $150.000" }, { tipo: "inventado", detalle: "x" }],
        fallasDelSistema: ["El bot dijo 'Te leo' cuando ya había dicho el color"],
        temperatura: "CALIENTE",
        motivoNoCierre: "envio",
        porque: "Falta confirmar la ciudad",
        siguienteMensaje: "Hola! Tu combo queda en $989.000 con envío gratis a Cali. ¿Lo separamos?",
      },
      { ref: "#999", ejes: {} },
    ],
    resumen: { loQueHizoBien: "Rapidez", unaCosaAMejorar: "Seguimiento", ejemplo: "#1" },
  });
  const { chats, resumen } = r.parsearRespuestaDelLote(crudo, ["#1", "#2"]);
  assert.equal(chats.size, 1);
  const uno = chats.get("#1");
  assert.deepEqual(uno.ejes, { N: 7, A: 5, S: null, C: 10 });
  assert.equal(uno.temperatura, "caliente");
  assert.deepEqual(uno.errores.map((e) => e.tipo), ["contraentrega", "otro"]);
  assert.equal(resumen.unaCosaAMejorar, "Seguimiento");
  assert.equal(r.parsearRespuestaDelLote("no es json", ["#1"]).chats.size, 0);
  assert.equal(r.mensajeSugeridoValido("Te lo mandamos contraentrega"), "");
  assert.equal(r.mensajeSugeridoValido("Lo separas con $494.500"), "Lo separas con $494.500");
});

prueba("descarte prematuro (< 72 h) y cotización detectada", () => {
  assert.equal(r.esDescartePrematuro({ descartadoEn: bog("2026-10-08 10:08"), ultimoMensajeDelClienteEn: bog("2026-10-08 10:00") }), true);
  assert.equal(r.esDescartePrematuro({ descartadoEn: bog("2026-10-08 10:00"), ultimoMensajeDelClienteEn: bog("2026-10-04 10:00") }), false);
  assert.equal(r.esDescartePrematuro({ descartadoEn: bog("2026-10-08 10:00"), ultimoMensajeDelClienteEn: null }), false);
  const conCot = r.normalizarMensajes([msg("2026-10-08 10:00", "asesora", "Te envío la COT-00123")]);
  assert.equal(r.huboCotizacion(conCot), true);
  const conPdf = r.normalizarMensajes([msg("2026-10-08 10:00", "asesora", "Cotizacion Magilus.pdf", { type: "DOCUMENT" })]);
  assert.equal(r.huboCotizacion(conPdf), true);
  const sin = r.normalizarMensajes([msg("2026-10-08 10:00", "cliente", "mándame la COT-00123")]);
  assert.equal(r.huboCotizacion(sin), false);
});

prueba("costo estimado por modelo y versión de política guardable", () => {
  assert.equal(r.costoUsd("gpt-4.1-mini", 1_000_000, 100_000), 0.56);
  assert.equal(r.costoUsd("gpt-4o-mini", 1_000_000, 0), 0.15);
  assert.ok(POLITICA_COACH.version.length > 5);
  assert.equal(POLITICA_COACH.pago.contraentregaPermitida, false);
});

console.log(`\n${pruebas} pruebas del coach en verde`);

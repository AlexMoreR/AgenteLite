// Pruebas de las AUTOMATIZACIONES con condiciones + acciones (Alexander, 13-10-2026). Sin base ni red.
// Correr: npm run test:automatizaciones
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { RAIZ, cargar } from "./supervisor-cargar.mjs";

const D = "src/features/automatizaciones/dominio";
const md = cargar(`${D}/modelo.ts`);
const cd = cargar(`${D}/condiciones.ts`);
const td = cargar(`${D}/tandas.ts`);
const ej = cargar(`${D}/ejecutar.ts`);
const ab = cargar("src/lib/anti-bloqueo/reglas.ts");
const rc = cargar("src/features/seguimiento-inteligente/dominio/recuperacion.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
const mo = cargar("src/features/seguimiento-inteligente/dominio/motor.ts");

let pruebas = 0;
const pendientes = [];
function prueba(nombre, fn) {
  const r = fn();
  if (r && typeof r.then === "function") {
    pendientes.push(
      r.then(() => {
        pruebas += 1;
        console.log(`ok - ${nombre}`);
      }),
    );
    return;
  }
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
const H = 60 * MIN;
const DIA = 24 * H;
// Martes 13-oct-2026, 10:00 a. m. de Bogotá (15:00 UTC).
const AHORA = new Date("2026-10-13T15:00:00Z");
const hace = (ms) => new Date(AHORA.getTime() - ms);

const MARIA = "user-maria";
const INGRID = "user-ingrid";

function foto(parcial = {}) {
  return {
    conversationId: `c-${Math.random().toString(36).slice(2, 8)}`,
    contactId: `ct-${Math.random().toString(36).slice(2, 8)}`,
    channelId: "linea-1",
    etapa: "CALIFICADO",
    asignadoA: MARIA,
    etiquetas: [],
    abierta: true,
    excluido: false,
    ultimoMensajeEn: hace(4 * DIA),
    ultimoClienteEn: hace(4 * DIA),
    recuperacionVencida: false,
    ...parcial,
  };
}

/* ================================================================================================
   A. MIGRACIÓN DE LAS GUARDADAS CON LA FORMA VIEJA
================================================================================================ */

prueba("A: forma vieja «sin asignar + etapas + canal + días» → condiciones y acción Asignar", () => {
  const vieja = {
    id: "a1",
    nombre: "Descartados para Genesis",
    dueno: "sin_asignar",
    etapas: ["PERDIDO", "INVENTADA"],
    canalId: "linea-1",
    diasSinMensajes: 3,
    soloAbiertas: false,
    cantidad: 20,
    asignarA: "genesis",
    ultimaEjecucion: { fecha: "2026-10-01T10:00:00.000Z", asignados: 12, por: "Alex" },
  };
  const a = md.leerAutomatizacionGuardada(vieja);
  assert.equal(a.id, "a1");
  assert.equal(a.nombre, "Descartados para Genesis");
  assert.deepEqual(a.condiciones, [
    { campo: "asignado", operador: "es", valores: [md.SIN_ASIGNAR] },
    { campo: "etapa", operador: "es", valores: ["PERDIDO"] },
    { campo: "canal", operador: "es", valores: ["linea-1"] },
    { campo: "dias_sin_mensajes", operador: "al_menos", dias: 3 },
  ]);
  assert.deepEqual(a.acciones, [{ tipo: "asignar", usuarioId: "genesis" }]);
  assert.equal(a.soloAbiertas, false);
  assert.equal(a.cantidad, 20);
  assert.equal(a.automatica, false);
  assert.deepEqual(a.ritmo, md.RITMO_POR_DEFECTO);
  assert.equal(a.historial.length, 1);
  assert.equal(a.historial[0].leads, 12);
  assert.equal(a.historial[0].por, "Alex");
});

prueba("A: forma vieja «de:X» y «cualquiera»", () => {
  const deX = md.leerAutomatizacionGuardada({ id: "a2", nombre: "De Ingrid a María", dueno: `de:${INGRID}`, etapas: [], asignarA: MARIA });
  assert.deepEqual(deX.condiciones, [{ campo: "asignado", operador: "es", valores: [INGRID] }]);
  const cualquiera = md.leerAutomatizacionGuardada({ id: "a3", nombre: "Todos a María", dueno: "cualquiera", etapas: [], asignarA: MARIA });
  assert.deepEqual(cualquiera.condiciones, []);
  assert.equal(cualquiera.soloAbiertas, true);
});

prueba("A: la migrada hace lo mismo que antes (sin asignar, etapa, días; nunca los que ya son de la destino)", () => {
  const a = md.leerAutomatizacionGuardada({ id: "a4", nombre: "x", dueno: "sin_asignar", etapas: ["NUEVO"], diasSinMensajes: 3, asignarA: MARIA });
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: null, etapa: "NUEVO" }), a, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: INGRID, etapa: "NUEVO" }), a, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: null, etapa: "CALIFICADO" }), a, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: null, etapa: "NUEVO", ultimoMensajeEn: hace(DIA) }), a, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: null, etapa: "NUEVO", abierta: false }), a, AHORA), false);
  const cualquiera = md.leerAutomatizacionGuardada({ id: "a5", nombre: "x", dueno: "cualquiera", etapas: [], asignarA: MARIA });
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: MARIA }), cualquiera, AHORA), false, "ya es de María");
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: INGRID }), cualquiera, AHORA), true);
});

prueba("A: lo ilegible no rompe (sin nombre o sin acciones = se descarta)", () => {
  assert.equal(md.leerAutomatizacionGuardada(null), null);
  assert.equal(md.leerAutomatizacionGuardada({ id: "x", nombre: "", asignarA: MARIA, dueno: "cualquiera" }), null);
  assert.equal(md.leerAutomatizacionGuardada({ id: "x", nombre: "Sin acciones", condiciones: [], acciones: [] }), null);
  assert.equal(md.leerAutomatizacionGuardada({ nombre: "Sin id", condiciones: [], acciones: [{ tipo: "resolver" }] }), null);
});

/* ================================================================================================
   B. LIMPIEZA Y VALIDACIÓN DE LA FORMA NUEVA
================================================================================================ */

prueba("B: se descartan condiciones y acciones a medio llenar o inventadas", () => {
  const a = md.limpiarAutomatizacion({
    nombre: "  Prueba  ",
    condiciones: [
      { campo: "etapa", operador: "es", valores: [] },
      { campo: "asignado", operador: "no_es", valores: [MARIA, MARIA] },
      { campo: "inventado", operador: "es" },
      { campo: "dias_sin_responder", operador: "al_menos", dias: "5" },
      { campo: "recuperacion_vencida", operador: "si" },
    ],
    acciones: [
      { tipo: "asignar", usuarioId: "" },
      { tipo: "enviar_flujo", flujoId: "evolution:linea:esc", flujoNombre: "Audio" },
      { tipo: "cambiar_etapa", etapa: "GANADO" },
      { tipo: "cambiar_etapa", etapa: "PERDIDO", motivoPerdida: "" },
      { tipo: "cambiar_etapa", etapa: "PERDIDO", motivoPerdida: "sin_respuesta" },
      { tipo: "posponer", dias: 2 },
      { tipo: "hackear" },
    ],
    ritmo: { tanda: 500, cadaMinutos: 1 },
  });
  assert.equal(a.nombre, "Prueba");
  assert.deepEqual(a.condiciones, [
    { campo: "asignado", operador: "no_es", valores: [MARIA] },
    { campo: "dias_sin_responder", operador: "al_menos", dias: 5 },
    { campo: "recuperacion_vencida", operador: "si" },
  ]);
  assert.deepEqual(
    a.acciones.map((x) => x.tipo),
    ["enviar_flujo", "cambiar_etapa", "posponer"],
  );
  assert.equal(a.acciones[1].motivoPerdida, "sin_respuesta");
  assert.deepEqual(a.ritmo, { tanda: 50, cadaMinutos: 5 });
});

prueba("B: el editor dice qué falta", () => {
  const base = { nombre: "x", condiciones: [], soloAbiertas: true, cantidad: null, acciones: [], automatica: false, ritmo: md.RITMO_POR_DEFECTO };
  assert.equal(md.problemaDelBorrador({ ...base, nombre: " " }), "Ponle un nombre");
  assert.equal(md.problemaDelBorrador(base), "Añade al menos una acción");
  assert.match(md.problemaDelBorrador({ ...base, acciones: [{ tipo: "asignar", usuarioId: "" }] }), /Asignar/);
  assert.match(md.problemaDelBorrador({ ...base, acciones: [{ tipo: "resolver" }], condiciones: [{ campo: "canal", operador: "es", valores: [] }] }), /Canal/);
  // Mandar mensajes sin ninguna condición = a TODOS los chats: no se deja.
  assert.match(md.problemaDelBorrador({ ...base, acciones: [{ tipo: "enviar_texto", texto: "hola" }] }), /al menos una condición/);
  assert.equal(md.problemaDelBorrador({ ...base, acciones: [{ tipo: "resolver" }] }), null);
});

prueba("B: criterios del borrador (para contar mientras se arma)", () => {
  const c = md.criteriosDelBorrador({ condiciones: [{ campo: "recuperacion_vencida", operador: "si" }, { campo: "etapa", valores: [] }], acciones: [{ tipo: "asignar", usuarioId: "" }] });
  assert.deepEqual(c.condiciones, [{ campo: "recuperacion_vencida", operador: "si" }]);
  assert.deepEqual(c.acciones, []);
  assert.equal(c.soloAbiertas, true);
});

/* ================================================================================================
   C. CONDICIONES CONTRA UN LEAD
================================================================================================ */

const solo = (condiciones, acciones = [{ tipo: "resolver" }], extra = {}) => ({ condiciones, soloAbiertas: true, acciones, ...extra });

prueba("C: Etapa es / no es (multi)", () => {
  const es = solo([{ campo: "etapa", operador: "es", valores: ["NUEVO", "CALIFICADO"] }]);
  const noEs = solo([{ campo: "etapa", operador: "no_es", valores: ["NUEVO", "CALIFICADO"] }]);
  assert.equal(cd.cumpleCondiciones(foto({ etapa: "CALIFICADO" }), es, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ etapa: "PROPUESTA" }), es, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ etapa: "PROPUESTA" }), noEs, AHORA), true);
});

prueba("C: Asignado (asesora / sin asignar, es / no es)", () => {
  const deMaria = solo([{ campo: "asignado", operador: "es", valores: [MARIA] }]);
  const sinAsignar = solo([{ campo: "asignado", operador: "es", valores: [md.SIN_ASIGNAR] }]);
  const noDeMaria = solo([{ campo: "asignado", operador: "no_es", valores: [MARIA] }]);
  assert.equal(cd.cumpleCondiciones(foto(), deMaria, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: INGRID }), deMaria, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: null }), sinAsignar, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto(), sinAsignar, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ asignadoA: null }), noDeMaria, AHORA), true, "sin dueña no es de María");
});

prueba("C: Etiquetas tiene (alguna) / no tiene (ninguna)", () => {
  const tiene = solo([{ campo: "etiquetas", operador: "tiene", valores: ["vip", "combo"] }]);
  const noTiene = solo([{ campo: "etiquetas", operador: "no_tiene", valores: ["vip", "combo"] }]);
  assert.equal(cd.cumpleCondiciones(foto({ etiquetas: ["combo"] }), tiene, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ etiquetas: [] }), tiene, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ etiquetas: ["otra"] }), noTiene, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ etiquetas: ["vip"] }), noTiene, AHORA), false);
});

prueba("C: Canal (línea)", () => {
  const canal = solo([{ campo: "canal", operador: "es", valores: ["linea-2"] }]);
  assert.equal(cd.cumpleCondiciones(foto({ channelId: "linea-2" }), canal, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ channelId: null }), canal, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ channelId: null }), solo([{ campo: "canal", operador: "no_es", valores: ["linea-2"] }]), AHORA), true);
});

prueba("C: Días sin responder (cliente callado) y Días sin mensajes (de nadie)", () => {
  const sinResponder = solo([{ campo: "dias_sin_responder", operador: "al_menos", dias: 3 }]);
  assert.equal(cd.cumpleCondiciones(foto({ ultimoClienteEn: hace(3 * DIA) }), sinResponder, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ ultimoClienteEn: hace(2 * DIA) }), sinResponder, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ ultimoClienteEn: null }), sinResponder, AHORA), false, "nunca escribió: no");
  // El cliente callado 4 días aunque nosotros le escribimos ayer: sí "sin responder", no "sin mensajes".
  const f = foto({ ultimoClienteEn: hace(4 * DIA), ultimoMensajeEn: hace(DIA) });
  assert.equal(cd.cumpleCondiciones(f, sinResponder, AHORA), true);
  assert.equal(cd.cumpleCondiciones(f, solo([{ campo: "dias_sin_mensajes", operador: "al_menos", dias: 3 }]), AHORA), false);
});

prueba("C: Recuperación vencida sí / no", () => {
  const si = solo([{ campo: "recuperacion_vencida", operador: "si" }]);
  const no = solo([{ campo: "recuperacion_vencida", operador: "no" }]);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: true }), si, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: false }), si, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: false }), no, AHORA), true);
});

prueba("C: todas a la vez (Y), y solo abiertas", () => {
  const a = solo([
    { campo: "recuperacion_vencida", operador: "si" },
    { campo: "asignado", operador: "es", valores: [MARIA] },
  ]);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: true }), a, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: true, asignadoA: INGRID }), a, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: true, abierta: false }), a, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ recuperacionVencida: true, abierta: false }), { ...a, soloAbiertas: false }, AHORA), true);
});

prueba("C: con envíos, nunca a Ganado / Descartado / oculto del CRM", () => {
  const envia = solo([{ campo: "asignado", operador: "es", valores: [MARIA] }], [{ tipo: "enviar_texto", texto: "Hola" }]);
  assert.equal(cd.cumpleCondiciones(foto(), envia, AHORA), true);
  assert.equal(cd.cumpleCondiciones(foto({ etapa: "GANADO" }), envia, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ etapa: "PERDIDO" }), envia, AHORA), false);
  assert.equal(cd.cumpleCondiciones(foto({ excluido: true }), envia, AHORA), false);
  // Sin envíos (p. ej. asignar descartados) los cerrados sí entran.
  assert.equal(cd.cumpleCondiciones(foto({ etapa: "PERDIDO" }), solo([{ campo: "etapa", operador: "es", valores: ["PERDIDO"] }], [{ tipo: "asignar", usuarioId: INGRID }]), AHORA), true);
});

/* ================================================================================================
   D. RITMO DE LOS ENVÍOS (tandas y horario)
================================================================================================ */

const HORARIO = { activo: true, desdeHora: 8, hastaHora: 20, desfaseMaxMinutos: 30 };

prueba("D: de a 10 cada 15 min", () => {
  const horas = td.horasDeEnvio({ cantidad: 25, ritmo: { tanda: 10, cadaMinutos: 15 }, desde: AHORA, horario: HORARIO });
  assert.equal(horas.length, 25);
  assert.equal(horas[0].getTime(), AHORA.getTime());
  assert.equal(horas[9].getTime(), AHORA.getTime());
  assert.equal(horas[10].getTime(), AHORA.getTime() + 15 * MIN);
  assert.equal(horas[24].getTime(), AHORA.getTime() + 30 * MIN);
});

prueba("D: lo que cae después de las 20:00 pasa a las 8:00 del día siguiente (y sigue el ritmo)", () => {
  const tarde = new Date("2026-10-13T00:50:00Z"); // 19:50 Bogotá
  const horas = td.horasDeEnvio({ cantidad: 3, ritmo: { tanda: 1, cadaMinutos: 15 }, desde: tarde, horario: HORARIO });
  assert.equal(horas[0].toISOString(), tarde.toISOString());
  assert.equal(horas[1].toISOString(), "2026-10-13T13:00:00.000Z", "8:00 Bogotá");
  assert.equal(horas[2].toISOString(), "2026-10-13T13:15:00.000Z");
  // Ejecutar de noche: arranca a la mañana.
  const noche = td.horasDeEnvio({ cantidad: 1, ritmo: { tanda: 10, cadaMinutos: 15 }, desde: new Date("2026-10-13T07:00:00Z"), horario: HORARIO });
  assert.equal(noche[0].toISOString(), "2026-10-13T13:00:00.000Z");
});

prueba("D: una corrida nueva no se encima con la cola de la anterior", () => {
  const ultimo = new Date(AHORA.getTime() + 40 * MIN);
  assert.equal(td.inicioDeLaProximaTanda({ ahora: AHORA, ultimoAgendado: ultimo, ritmo: { tanda: 10, cadaMinutos: 15 } }).getTime(), ultimo.getTime() + 15 * MIN);
  assert.equal(td.inicioDeLaProximaTanda({ ahora: AHORA, ultimoAgendado: null, ritmo: { tanda: 10, cadaMinutos: 15 } }).getTime(), AHORA.getTime());
  assert.equal(td.inicioDeLaProximaTanda({ ahora: AHORA, ultimoAgendado: hace(H), ritmo: { tanda: 10, cadaMinutos: 15 } }).getTime(), AHORA.getTime());
});

prueba("D: el reloj la corre cada 30 min solo con el interruptor prendido", () => {
  assert.equal(md.leTocaAlReloj({ automatica: false, ultimaAutomaticaEn: null }, AHORA), false);
  assert.equal(md.leTocaAlReloj({ automatica: true, ultimaAutomaticaEn: null }, AHORA), true);
  assert.equal(md.leTocaAlReloj({ automatica: true, ultimaAutomaticaEn: hace(10 * MIN).toISOString() }, AHORA), false);
  assert.equal(md.leTocaAlReloj({ automatica: true, ultimaAutomaticaEn: hace(30 * MIN).toISOString() }, AHORA), true);
});

/* ================================================================================================
   E. EL ANTI-BLOQUEO RECONOCE LOS ENVÍOS DE UNA AUTOMATIZACIÓN
================================================================================================ */

prueba("E: el seguimiento se llama «Automatización: … #id» y es su propia clase", () => {
  const nombre = md.nombreDelEnvio({ id: "abc123ef-0000", nombre: "Recuperación María" });
  assert.equal(nombre, "Automatización: Recuperación María #abc123");
  assert.equal(md.idCortoDelEnvio(nombre), "abc123");
  assert.equal(md.idCortoDelEnvio("Campaña: Octubre"), null);
  assert.equal(ab.clasificarFollow({ name: nombre, followRuleId: null }), "automatizacion");
  assert.equal(ab.clasificarFollow({ name: "Campaña: Octubre", followRuleId: null }), "campana");
  assert.equal(ab.clasificarFollow({ name: "Recordatorio de María", followRuleId: null }), "humano");
});

prueba("E: en el motor de seguimientos: tope sí, dueño no, cerrados nunca, y al salir cierra la recuperación", () => {
  const follows = fs.readFileSync(path.join(RAIZ, "src/features/seguimientos/services/follows.ts"), "utf8");
  assert.match(follows, /tope: esAutomatico \|\| esAutomatizacion/);
  assert.match(follows, /dueno: esAutomatico && !esToqueDeCadencia && !esTrasAsesora/);
  assert.match(follows, /contacto\.excludedFromCrm \|\| contacto\.crmStage === "GANADO" \|\| contacto\.crmStage === "PERDIDO"/);
  assert.match(follows, /esTrasAsesora \|\| esAutomatizacion/, "si una persona escribió después de agendado, no sale");
  assert.match(follows, /clase === "automatizacion"[\s\S]{0,600}cerrarRecuperacionPorAutomatizacion/);
});

/* ================================================================================================
   F. EJECUTAR DE PUNTA A PUNTA (primer uso real de Alexander)
   Condiciones: Recuperación vencida + Asignado a María Bautista.
   Acciones: Enviar flujo (audio) + Enviar texto.
================================================================================================ */

function puertosDePrueba(leads, opciones = {}) {
  const registro = { marcados: [], aplicadas: [], agendados: [] };
  const procesados = new Set(opciones.yaProcesados ?? []);
  return {
    registro,
    puertos: {
      horario: HORARIO,
      buscarLeads: async (tope) => leads.slice(0, tope),
      marcarProcesado: async (f) => {
        if (procesados.has(f.conversationId)) return false;
        procesados.add(f.conversationId);
        registro.marcados.push(f.conversationId);
        return true;
      },
      aplicar: async (accion, f) => {
        if (opciones.fallaEn === f.conversationId) throw new Error("se cayó la base");
        registro.aplicadas.push([f.conversationId, accion.tipo]);
      },
      agendarEnvio: async (f, envios, en) => {
        registro.agendados.push({ conversationId: f.conversationId, envios: envios.map((e) => e.tipo), en });
      },
      ultimoEnvioAgendado: async () => opciones.ultimoAgendado ?? null,
    },
  };
}

const PRIMER_USO = md.leerAutomatizacionGuardada({
  id: "rec-maria-0001",
  nombre: "Recuperación de María",
  condiciones: [
    { campo: "recuperacion_vencida", operador: "si" },
    { campo: "asignado", operador: "es", valores: [MARIA] },
  ],
  acciones: [
    { tipo: "enviar_flujo", flujoId: "evolution:linea-1:audio-recuperacion", flujoNombre: "Audio recuperación" },
    { tipo: "enviar_texto", texto: "¿Te ayudo con el envío a tu ciudad? 😊" },
  ],
  ritmo: { tanda: 2, cadaMinutos: 15 },
});

prueba("F: el primer uso real se guarda bien", () => {
  assert.ok(PRIMER_USO);
  assert.equal(md.problemaDelBorrador(PRIMER_USO), null);
  assert.equal(md.tieneEnvios(PRIMER_USO.acciones), true);
});

prueba("F: solo los de María con la 72 h vencida; flujo y texto juntos, en orden, de a 2 cada 15 min", async () => {
  const buenos = [foto({ recuperacionVencida: true }), foto({ recuperacionVencida: true }), foto({ recuperacionVencida: true })];
  const leads = [
    ...buenos,
    foto({ recuperacionVencida: false }), // de María, sin tarea vencida
    foto({ recuperacionVencida: true, asignadoA: INGRID }), // de Ingrid
    foto({ recuperacionVencida: true, etapa: "GANADO" }), // cerrado: nunca se le escribe
    foto({ recuperacionVencida: true, excluido: true }), // oculto del CRM
  ];
  const { puertos, registro } = puertosDePrueba(leads);
  const r = await ej.ejecutarAutomatizacion(PRIMER_USO, puertos, AHORA);
  assert.equal(r.leads, 3);
  assert.equal(r.envios, 3);
  assert.deepEqual(r.errores, []);
  assert.deepEqual(registro.marcados, buenos.map((f) => f.conversationId));
  assert.deepEqual(registro.aplicadas, [], "no hay acciones inmediatas");
  assert.deepEqual(registro.agendados.map((a) => a.envios), [["enviar_flujo", "enviar_texto"], ["enviar_flujo", "enviar_texto"], ["enviar_flujo", "enviar_texto"]]);
  assert.deepEqual(registro.agendados.map((a) => a.en.getTime() - AHORA.getTime()), [0, 0, 15 * MIN]);
  assert.equal(r.ultimaTandaEn.getTime(), AHORA.getTime() + 15 * MIN);
  const fila = ej.comoEjecucion(r, { fecha: AHORA, por: "Alex", origen: "manual" });
  assert.deepEqual([fila.leads, fila.envios, fila.errores], [3, 3, 0]);
});

prueba("F: la automática no repite: los ya procesados se saltan (aunque la consulta los traiga)", async () => {
  const a = foto({ recuperacionVencida: true });
  const b = foto({ recuperacionVencida: true });
  const { puertos, registro } = puertosDePrueba([a, b], { yaProcesados: [a.conversationId] });
  const r = await ej.ejecutarAutomatizacion(PRIMER_USO, puertos, AHORA);
  assert.equal(r.leads, 1);
  assert.deepEqual(registro.agendados.map((x) => x.conversationId), [b.conversationId]);
  // Segunda vuelta: ya no queda nadie.
  const r2 = await ej.ejecutarAutomatizacion(PRIMER_USO, puertos, AHORA);
  assert.equal(r2.leads, 0);
  assert.equal(r2.envios, 0);
});

prueba("F: la cola nueva arranca después de la que quedó agendada", async () => {
  const { puertos, registro } = puertosDePrueba([foto({ recuperacionVencida: true })], { ultimoAgendado: new Date(AHORA.getTime() + H) });
  await ej.ejecutarAutomatizacion(PRIMER_USO, puertos, AHORA);
  assert.equal(registro.agendados[0].en.getTime(), AHORA.getTime() + H + 15 * MIN);
});

prueba("F: acciones inmediatas en orden; un lead que falla no frena a los demás; Descartar antes de enviar = no se envía", async () => {
  const auto = md.leerAutomatizacionGuardada({
    id: "mix-0002",
    nombre: "Mixta",
    condiciones: [{ campo: "asignado", operador: "es", valores: [md.SIN_ASIGNAR] }],
    acciones: [
      { tipo: "asignar", usuarioId: MARIA },
      { tipo: "anadir_etiqueta", etiquetaId: "rec" },
      { tipo: "enviar_texto", texto: "Hola" },
      { tipo: "nota", texto: "Se le escribió desde la automatización" },
    ],
    cantidad: 2,
  });
  const a = foto({ asignadoA: null });
  const b = foto({ asignadoA: null });
  const c = foto({ asignadoA: null });
  const { puertos, registro } = puertosDePrueba([a, b, c], { fallaEn: a.conversationId });
  const r = await ej.ejecutarAutomatizacion(auto, puertos, AHORA);
  assert.equal(r.leads, 2, "cantidad máxima 2");
  assert.deepEqual(registro.aplicadas, [
    [b.conversationId, "asignar"],
    [b.conversationId, "anadir_etiqueta"],
    [b.conversationId, "nota"],
  ]);
  assert.equal(r.errores.length, 3, "las 3 acciones de a fallaron, sin frenar a b");
  assert.equal(r.envios, 2, "el envío igual se agenda para los dos");

  const descarta = md.leerAutomatizacionGuardada({
    id: "desc-0003",
    nombre: "Descarta y escribe",
    condiciones: [{ campo: "asignado", operador: "es", valores: [MARIA] }],
    acciones: [
      { tipo: "cambiar_etapa", etapa: "PERDIDO", motivoPerdida: "sin_respuesta" },
      { tipo: "enviar_texto", texto: "Chao" },
    ],
  });
  const p2 = puertosDePrueba([foto()]);
  const r2 = await ej.ejecutarAutomatizacion(descarta, p2.puertos, AHORA);
  assert.equal(r2.envios, 0);
  assert.match(r2.errores[0].error, /No se envió: es Descartado/);
});

/* ================================================================================================
   G. LA TAREA DE RECUPERACIÓN 72 H QUEDA HECHA CUANDO SALE EL ENVÍO
================================================================================================ */

const ENTRADA = "2026-10-12T14:12:00.000Z";
const DATOS_TAREA = {
  accion: "tarea_asesora",
  motivo: "recuperacion_72h",
  modo: "activo",
  toque: "llamar",
  prioridad: "B",
  clave: "recuperacion_72h:llamar",
  recuperacion: { fase: "llamar", entradaEn: ENTRADA, silencioDesde: "2026-10-09T14:12:00.000Z" },
};

prueba("G: con la tarea pendiente: evento de cierre + la foto deja de ser tarea (conserva el motivo)", () => {
  const ev = rc.eventosDeCierrePorAutomatizacion({
    conversationId: "c1",
    accion: "tarea_asesora",
    accionDatos: DATOS_TAREA,
    automatizacion: "Recuperación de María",
    ahora: AHORA,
  });
  assert.equal(ev.length, 2);
  assert.equal(ev[0].tipo, "RECUPERACION_72H");
  assert.equal(ev[0].claveUnica, `REC:activo:c1:${ENTRADA.slice(0, 16)}:automatizacion`);
  assert.equal(ev[0].datos.fase, rc.FASE_ATENDIDA_POR_AUTOMATIZACION);
  assert.equal(ev[0].datos.entradaEn, ENTRADA);
  assert.equal(ev[0].datos.desdeFase, "llamar");
  assert.equal(ev[1].tipo, "SIGUIENTE_ACCION");
  assert.equal(ev[1].datos.accion, "esperar", "sale de Mi día, tope y listas (todas piden tarea_asesora)");
  assert.equal(ev[1].datos.motivo, "recuperacion_72h", "el motor ve que salió de la recuperación y registra su decisión nueva");
  assert.equal(ev[1].datos.toque, "automatizacion", "no aparece como «en espera» del audio");
  assert.notEqual(ev[1].datos.clave, DATOS_TAREA.clave);
});

prueba("G: sin tarea de recuperación pendiente no toca nada", () => {
  const base = { conversationId: "c1", automatizacion: "x", ahora: AHORA };
  assert.equal(rc.eventosDeCierrePorAutomatizacion({ ...base, accion: "esperar", accionDatos: DATOS_TAREA }), null);
  assert.equal(rc.eventosDeCierrePorAutomatizacion({ ...base, accion: "tarea_asesora", accionDatos: { ...DATOS_TAREA, motivo: "cotizacion_sin_respuesta" } }), null);
  assert.equal(rc.eventosDeCierrePorAutomatizacion({ ...base, accion: "tarea_asesora", accionDatos: null }), null);
});

prueba("G: el motor no la vuelve a abrir; si el cliente responde, el flujo normal sigue", () => {
  const T0 = new Date("2026-10-12T14:00:00Z");
  const mas = (min) => new Date(T0.getTime() + min * MIN);
  const IN = (min, texto) => ({ direccion: "IN", tipo: "TEXT", texto, en: mas(min), leidoEn: mas(min), origen: "webhook" });
  const OUT = (min, texto, origen = "manual") => ({ direccion: "OUT", tipo: "TEXT", texto, en: mas(min), leidoEn: mas(min + 1), estado: "READ", origen });
  const charla = [IN(0, "Hola, me interesa el combo"), OUT(0.2, "Bienvenid@", null), IN(5, "¿Cuánto vale y hacen envíos?"), OUT(12, "Está en $989.000 y sí enviamos")];
  const entrada = new Date(mas(12).getTime() + 72 * H);
  const config = cf.leerConfigDeTexto(JSON.stringify({ calificacion: { activo: true }, motor: { modo: "sombra" }, recuperacion72h: { modo: "activo" } }));
  const ficha = (parcial) => ({
    conversationId: "c1",
    nombre: "Laura",
    etapaCrm: "NUEVO",
    pausado: true,
    asignadaA: MARIA,
    pais: "CO",
    marcaExterior: false,
    inicioDeLaCharla: T0,
    familiaDelBot: "combo-camilla",
    flujosEnviados: [],
    cotizacion: { en: null, ref: null, total: null },
    mensajesUtiles: 0,
    mensajes: charla,
    llamadas: [],
    historialCompleto: true,
    ...parcial,
  });
  const t = new Date(entrada.getTime() + 2 * H);
  // Sin cerrar: tarea de llamar.
  const antes = mo.evaluarLead(ficha({}), config, t);
  assert.equal(antes.decision.motivo, "recuperacion_72h");
  assert.equal(antes.decision.accion, "tarea_asesora");
  // La automatización le envió el audio + texto (salen como "follow", no cuentan como audio humano) y la cerró.
  const conEnvio = [...charla, { ...OUT(12 + 72 * 60 + 90, null, "follow"), tipo: "AUDIO" }, OUT(12 + 72 * 60 + 91, "¿Te ayudo?", "follow")];
  const cerrada = mo.evaluarLead(ficha({ mensajes: conEnvio, recuperacionesCerradas: [entrada.toISOString().slice(0, 16)] }), config, new Date(t.getTime() + H));
  assert.equal(cerrada.recuperacion.tipo, "fuera");
  assert.equal(cerrada.recuperacion.motivo, "cerrada_a_mano");
  assert.notEqual(cerrada.decision.motivo, "recuperacion_72h");
  // El cliente contesta: ya no hay silencio; la recuperación cerrada no estorba.
  const respondio = [...conEnvio, IN(12 + 72 * 60 + 200, "Sí, todavía lo quiero")];
  const despues = mo.evaluarLead(ficha({ mensajes: respondio, recuperacionesCerradas: [entrada.toISOString().slice(0, 16)] }), config, new Date(t.getTime() + 3 * H));
  assert.equal(despues.recuperacion.tipo, "fuera");
  assert.equal(despues.recuperacion.motivo, "cliente_esperando");
  assert.equal(rc.cortoUnSilencioLargo(respondio, 72), true, "cuenta como recuperado");
});

prueba("G: el servicio cuenta la fase «automatizacion» como cerrada", () => {
  const servicio = fs.readFileSync(path.join(RAIZ, "src/features/seguimiento-inteligente/servicios/recuperacion.ts"), "utf8");
  assert.match(servicio, /d\.fase === FASE_ATENDIDA_POR_AUTOMATIZACION/);
});

await Promise.all(pendientes);
console.log(`\n${pruebas} pruebas ok`);

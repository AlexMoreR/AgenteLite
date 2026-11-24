// Pruebas de las TARJETAS SIN SEÑAL (lib/sin-latido.mjs y su lugar en el planificador), sin red, sin CRM y sin WhatsApp:
//   node trabajador-tablero/pruebas/probar-sin-latido.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Un crm simulado anota lo que se le pide; el reloj se adelanta a mano (en minutos).
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { crearPlanificador } from "../lib/bucle.mjs";
import { completarConfig } from "../lib/config.mjs";
import { ErrorDelCrm } from "../lib/crm.mjs";
import { crearEstadoDeMotores } from "../lib/motores.mjs";
import { decidirRecogida } from "../lib/recoger-errores.mjs";
import { MARCA_SIN_LATIDO, MINUTOS_ENTRE_REVISIONES, MINUTOS_SIN_SENAL, crearGuardiaSinLatido, leerSinLatido, motivoDeDosVeces, rutaDeSinLatido } from "../lib/sin-latido.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "sin-latido-"));
let numero = 0;
const MIN = 60_000;
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
const nuevaConfig = (extra = {}) =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    repos: { aizencrm: { ruta: T, subirSolo: false, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
    ...extra,
  });

/** Un crm que solo anota. `fallar[accion]` = un ErrorDelCrm para esa acción (candidatas es la lectura del estado). */
function crmFalso({ fallar = {}, sueltasAlArrancar = [] } = {}) {
  const pedidos = [];
  const anotar = (accion, ...datos) => {
    pedidos.push({ accion, datos });
    if (fallar[accion]) throw fallar[accion];
    return { ok: true };
  };
  return {
    pedidos,
    acciones: () => pedidos.map((p) => p.accion),
    candidatas: async () => anotar("candidatas"),
    soltar: async (id, motivo, extra) => anotar("soltar", id, motivo, extra),
    error: async (id, motivo, zonas, reversion, extra) => anotar("error", id, motivo, extra),
    aviso: async (texto, tipo, tarjetaId) => anotar("aviso", texto, tipo, tarjetaId),
    arranque: async () => {
      anotar("arranque");
      return { ok: true, sueltas: sueltasAlArrancar };
    },
  };
}

/** Un reloj que se adelanta: `reloj.pasar(minutos)`. */
function crearReloj(inicio = Date.parse("2026-11-18T12:00:00Z")) {
  let ahora = inicio;
  return { ahora: () => ahora, pasar: (minutos) => (ahora += minutos * MIN) };
}

const tarjeta = (id, extra = {}) => ({ id, titulo: `Tarjeta ${id}`, repo: "aizencrm", ultimosIntentos: [], ...extra });
const guardiaDe = (crm, config, reloj, extra = {}) => crearGuardiaSinLatido({ crm, config, registro: registroFalso(), ahora: reloj.ahora, ...extra });

await prueba("los valores por defecto: revisar cada 15 min, 30 min sin señal; la configuración los cambia y lo inválido vuelve al defecto", async () => {
  assert.equal(MINUTOS_ENTRE_REVISIONES, 15);
  assert.equal(MINUTOS_SIN_SENAL, 30);
  assert.deepEqual(nuevaConfig().sinLatido, { revisarCadaMinutos: 15, minutosSinSenal: 30 });
  assert.deepEqual(nuevaConfig({ sinLatido: { revisarCadaMinutos: 5, minutosSinSenal: 45 } }).sinLatido, { revisarCadaMinutos: 5, minutosSinSenal: 45 });
  assert.deepEqual(nuevaConfig({ sinLatido: { revisarCadaMinutos: -1, minutosSinSenal: "x" } }).sinLatido, { revisarCadaMinutos: 15, minutosSinSenal: 30 });
});

await prueba("29 min sin señal: no se suelta; 31 min: se suelta UNA vez (1 de 2), sin ERROR ni WhatsApp", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const guardia = guardiaDe(crm, config, reloj);
  guardia.tomada(tarjeta("a"), "construir");
  reloj.pasar(29);
  assert.deepEqual(await guardia.revisar({ forzar: true }), { sueltas: [], errores: [], preguntas: [] });
  assert.equal(crm.pedidos.length, 0, "a los 29 min no se toca ni se llama al CRM");
  reloj.pasar(2);
  const hechas = await guardia.revisar({ forzar: true });
  assert.deepEqual(hechas, { sueltas: ["a"], errores: [], preguntas: [] });
  assert.deepEqual(crm.acciones(), ["candidatas", "soltar"]);
  const [id, motivo, extra] = crm.pedidos[1].datos;
  assert.equal(id, "a");
  assert.match(motivo, /lleva 31 min/);
  assert.equal(extra.categoria, "coordinador_cortado");
  assert.equal(extra.etapa, "construir");
  assert.ok(extra.causa.includes(MARCA_SIN_LATIDO), "la causa lleva la marca: el contador también queda en los intentos del CRM");
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.a.veces, 1);
  // Revisar otra vez no la vuelve a soltar (ya no está en las manos).
  reloj.pasar(20);
  await guardia.revisar();
  assert.equal(crm.acciones().filter((a) => a === "soltar").length, 1);
});

await prueba("la revisión corre solo cada 15 min (sin forzar) y sin tarjetas atrasadas ni llama al CRM", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const guardia = guardiaDe(crm, config, reloj);
  guardia.tomada(tarjeta("p"), "planear");
  reloj.pasar(10);
  guardia.tomada(tarjeta("q"), "planear");
  reloj.pasar(21);
  // La primera revisión corre (p lleva 31 min, q solo 21); hasta pasar 15 min no vuelve a mirar nada.
  await guardia.revisar();
  assert.deepEqual(crm.acciones(), ["candidatas", "soltar"]);
  reloj.pasar(11); // q ya lleva 32 min, pero la última revisión fue hace 11
  await guardia.revisar();
  assert.equal(crm.acciones().length, 2, "antes de los 15 min no revisa");
  reloj.pasar(5);
  await guardia.revisar();
  assert.equal(crm.acciones().filter((a) => a === "soltar").length, 2, "pasados los 15 min vuelve a revisar y suelta q");
  // Sin atrasadas no hay ni una llamada al CRM.
  const config2 = nuevaConfig();
  const crm2 = crmFalso();
  const guardia2 = guardiaDe(crm2, config2, reloj);
  guardia2.tomada(tarjeta("r"), "planear");
  reloj.pasar(10);
  await guardia2.revisar({ forzar: true });
  assert.equal(crm2.pedidos.length, 0);
});

await prueba("la segunda vez sin señal: ERROR con el motivo claro y UN solo WhatsApp (necesita, con la tarjeta)", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const guardia = guardiaDe(crm, config, reloj);
  guardia.tomada(tarjeta("b"), "planear");
  reloj.pasar(40);
  await guardia.revisar({ forzar: true });
  // Vuelve a la fila y se toma otra vez: el contador sigue en 1.
  reloj.pasar(5);
  guardia.tomada(tarjeta("b"), "planear");
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.b.veces, 1);
  reloj.pasar(40);
  const hechas = await guardia.revisar({ forzar: true });
  assert.deepEqual(hechas, { sueltas: [], errores: ["b"], preguntas: [] });
  assert.deepEqual(crm.acciones().filter((a) => a !== "candidatas"), ["soltar", "error", "aviso"]);
  const error = crm.pedidos.find((p) => p.accion === "error");
  const [id, motivo, extra] = error.datos;
  assert.equal(id, "b");
  assert.match(motivo, /sin señal de la sesión más de 30 min, dos veces/);
  assert.equal(extra.etapa, "planear");
  const aviso = crm.pedidos.find((p) => p.accion === "aviso");
  const [texto, tipo, tarjetaId] = aviso.datos;
  assert.equal(tipo, "necesita");
  assert.equal(tarjetaId, "b");
  assert.match(texto, /Tarjeta b/);
  assert.ok(!texto.includes("\n"), "el WhatsApp es de una sola línea");
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.b, undefined, "en ERROR sale del archivo");
  // Más revisiones: ningún aviso más.
  reloj.pasar(120);
  await guardia.revisar({ forzar: true });
  await guardia.revisar({ forzar: true });
  assert.equal(crm.acciones().filter((a) => a === "aviso").length, 1, "un solo aviso por tarjeta");
  // El recogedor diario no la reintenta sola: la deja al dueño.
  assert.equal(decidirRecogida({ motivo, ultimosIntentos: [{ etapa: "planear", categoria: "coordinador_cortado" }] }).accion, "dueno");
  assert.match(motivoDeDosVeces({ etapa: "planear" }), /Necesita que/);
});

await prueba("si el WhatsApp falla la tarjeta ya está en ERROR y no se insiste", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso({ fallar: { aviso: new ErrorDelCrm("Bad Gateway", 502) } });
  const guardia = guardiaDe(crm, config, reloj);
  guardia.tomada(tarjeta("w", { ultimosIntentos: [{ etapa: "construir", causa: `${MARCA_SIN_LATIDO} y nadie la trabajaba (1 de 2).` }] }), "construir");
  reloj.pasar(31);
  assert.deepEqual((await guardia.revisar({ forzar: true })).errores, ["w"]);
  reloj.pasar(60);
  await guardia.revisar({ forzar: true });
  assert.equal(crm.acciones().filter((a) => a === "aviso").length, 1);
});

await prueba("sesión viva: nunca se toca, ni con 5 h sin latido; el reloj corre desde el último latido", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const vivas = new Set(["d"]);
  const guardia = guardiaDe(crm, config, reloj, { vivas: () => vivas });
  guardia.tomada(tarjeta("d"), "construir");
  // "d": una sesión viva sin latido 5 h (el CRM no contesta, por ejemplo): no se toca.
  reloj.pasar(300);
  await guardia.revisar({ forzar: true });
  assert.equal(crm.pedidos.length, 0, "la viva no se toca");
  // Una construcción de 180 min en la nube que late cada minuto, y luego 30 min de subida: nunca pasa de 30 min sin latido.
  const config2 = nuevaConfig();
  const crm2 = crmFalso();
  const guardia2 = guardiaDe(crm2, config2, reloj);
  guardia2.tomada(tarjeta("f"), "construir");
  for (let minuto = 0; minuto < 210; minuto += 1) {
    reloj.pasar(1);
    guardia2.latio("f");
    if (minuto % 15 === 0) await guardia2.revisar({ forzar: true });
  }
  reloj.pasar(20);
  await guardia2.revisar({ forzar: true });
  assert.equal(crm2.pedidos.length, 0, "3,5 h desde que se tomó pero 20 min desde el último latido: no se toca");
  guardia2.termino("f", { ok: true });
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.f, undefined);
});

await prueba("pregunta abierta: ERROR con la pregunta escrita, sin contar como reintento y sin WhatsApp", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const preguntas = [];
  const guardia = guardiaDe(crm, config, reloj, {
    preguntaDeLaTarjeta: async (entrada, id) => {
      preguntas.push(id);
      return id === "n" ? "¿El descuento aplica a camillas o solo a sillas?" : null;
    },
  });
  guardia.tomada(tarjeta("n"), "construir");
  guardia.tomada(tarjeta("o"), "construir");
  reloj.pasar(35);
  const hechas = await guardia.revisar({ forzar: true });
  assert.deepEqual(hechas, { sueltas: ["o"], errores: [], preguntas: ["n"] });
  const error = crm.pedidos.find((p) => p.accion === "error");
  const [id, motivo, extra] = error.datos;
  assert.equal(id, "n");
  assert.match(motivo, /hizo una pregunta y paró: ¿El descuento aplica a camillas o solo a sillas\?/);
  assert.match(motivo, /Necesita que la contestes/);
  assert.equal(extra.categoria, "nube_pregunta");
  assert.ok(!crm.acciones().includes("aviso"), "la pregunta no manda WhatsApp");
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.n, undefined, "sale del archivo: no hay reintento pendiente");
  // Si no se pudo mirar la rama (sin red a GitHub) espera; no suelta a ciegas.
  const config2 = nuevaConfig();
  const crm2 = crmFalso();
  const guardia2 = guardiaDe(crm2, config2, reloj, {
    preguntaDeLaTarjeta: async () => {
      throw new Error("gh: sin conexión");
    },
  });
  guardia2.tomada(tarjeta("m"), "construir");
  reloj.pasar(35);
  await guardia2.revisar({ forzar: true });
  assert.deepEqual(crm2.acciones(), ["candidatas"], "sin poder mirar la rama no suelta");
  // Pasado demasiado tiempo (4 veces el umbral) se suelta igual: un fallo permanente de GitHub no la deja colgada para siempre.
  reloj.pasar(120);
  await guardia2.revisar({ forzar: true });
  assert.ok(crm2.acciones().includes("soltar"));
});

await prueba("el CRM da 502: no se suelta nada; los 30 min cuentan desde que se pudo leer", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso({ fallar: { candidatas: new ErrorDelCrm("Bad Gateway", 502) } });
  const registro = registroFalso();
  const guardia = crearGuardiaSinLatido({ crm, config, registro, ahora: reloj.ahora });
  guardia.tomada(tarjeta("x"), "construir");
  reloj.pasar(90);
  const hechas = await guardia.revisar({ forzar: true });
  assert.deepEqual(hechas, { sueltas: [], errores: [], preguntas: [] });
  assert.deepEqual(crm.acciones(), ["candidatas"], "solo intentó leer el estado");
  assert.ok(registro.lineas.some((l) => /el CRM no contesta/.test(l)));
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.x.enLasManos, true);
  // El CRM vuelve: el reloj de 30 min va desde la última falla del CRM, no desde el último latido (que fue hace 90 min).
  crm.pedidos.length = 0;
  crm.candidatas = async () => ({ ok: true });
  reloj.pasar(29);
  await guardia.revisar({ forzar: true });
  assert.equal(crm.pedidos.length, 0, "hace 29 min de la última falla del CRM: todavía no suelta");
  reloj.pasar(2);
  assert.deepEqual((await guardia.revisar({ forzar: true })).sueltas, ["x"]);
  // Un 502 al soltar (la lectura sí funcionó) tampoco la pierde: lo intenta en la próxima revisión.
  const config2 = nuevaConfig();
  const crm2 = crmFalso({ fallar: { soltar: new ErrorDelCrm("Bad Gateway", 502) } });
  const guardia2 = guardiaDe(crm2, config2, reloj);
  guardia2.tomada(tarjeta("y"), "planear");
  reloj.pasar(40);
  await guardia2.revisar({ forzar: true });
  await guardia2.revisar({ forzar: true });
  assert.equal(crm2.acciones().filter((a) => a === "soltar").length, 2);
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.y.enLasManos, true);
});

await prueba("reinicio entre el primer y el segundo intento: el contador se conserva (archivo, y si se perdió, los intentos del CRM)", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const primera = guardiaDe(crm, config, reloj);
  primera.tomada(tarjeta("g"), "construir");
  reloj.pasar(40);
  await primera.revisar({ forzar: true });
  // El Coordinador se reinicia: otra guardia, la misma carpeta.
  const segunda = guardiaDe(crm, config, reloj);
  segunda.tomada(tarjeta("g"), "construir");
  reloj.pasar(40);
  const tercera = guardiaDe(crm, config, reloj);
  assert.deepEqual((await tercera.revisar()).errores, ["g"]);
  assert.deepEqual(crm.acciones().filter((a) => a !== "candidatas"), ["soltar", "error", "aviso"]);

  // Sin archivo (se borró la carpeta de trabajo): el contador sale de los intentos que trae /tomar (también las marcas de la versión de 2 h).
  const config2 = nuevaConfig();
  const crm2 = crmFalso();
  const sinArchivo = guardiaDe(crm2, config2, reloj);
  const intentos = [{ numero: 4, etapa: "construir", categoria: "coordinador_cortado", causa: `${MARCA_SIN_LATIDO} y nadie la trabajaba (1 de 2).`, accion: "esperar", cuentaComoIntento: false }];
  sinArchivo.tomada(tarjeta("h", { ultimosIntentos: intentos }), "construir");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.h.veces, 1);
  fs.rmSync(rutaDeSinLatido(config2.carpetaTrabajo));
  sinArchivo.tomada(tarjeta("v", { ultimosIntentos: [{ ...intentos[0], causa: "sin latido más de 2 h y nadie la trabajaba (1 de 2)." }] }), "construir");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.v.veces, 1);
  // La marca de OTRA etapa no cuenta.
  fs.rmSync(rutaDeSinLatido(config2.carpetaTrabajo));
  sinArchivo.tomada(tarjeta("i", { ultimosIntentos: intentos }), "subir");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.i.veces, 0);
});

await prueba("el CRM ya la movió (409) se olvida; sin red (0) se reintenta en la próxima revisión", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso({ fallar: { soltar: new ErrorDelCrm("Esa acción no se puede desde APROBADO.", 409) } });
  const guardia = guardiaDe(crm, config, reloj);
  guardia.tomada(tarjeta("j"), "planear");
  reloj.pasar(40);
  await guardia.revisar({ forzar: true });
  assert.equal(leerSinLatido(config.carpetaTrabajo).tarjetas.j, undefined);

  const config2 = nuevaConfig();
  const sinRed = crmFalso({ fallar: { soltar: new ErrorDelCrm("No se pudo hablar con el CRM.", 0) } });
  const guardia2 = guardiaDe(sinRed, config2, reloj);
  guardia2.tomada(tarjeta("k"), "planear");
  reloj.pasar(40);
  await guardia2.revisar({ forzar: true });
  await guardia2.revisar({ forzar: true });
  assert.equal(sinRed.acciones().filter((a) => a === "soltar").length, 2, "lo intenta otra vez");
  assert.equal(leerSinLatido(config2.carpetaTrabajo).tarjetas.k.enLasManos, true);
});

const planificadorDe = (crm, config, reloj, extra = {}) =>
  crearPlanificador({
    crm,
    config,
    registro: registroFalso(),
    medidor: { medir: () => ({ cpu: 10, memoria: 20 }), parar: () => undefined },
    motores: crearEstadoDeMotores(config),
    vigilante: null,
    pausaSesion: null,
    ahora: reloj.ahora,
    ...extra,
  });

await prueba("arranque tras un apagón: retoma solas las que quedaron a medias, sin esperar y sin contar como intento", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  // El proceso anterior dejó tres tomadas: "vieja" (9 días, SUBIENDO que /arranque no suelta), "corta" (10 min, con candado: la suelta
  // /arranque) y "reintento" (ya había una vez sin señal, 5 h).
  const antes = guardiaDe(crmFalso(), config, reloj);
  antes.tomada(tarjeta("reintento", { ultimosIntentos: [{ etapa: "construir", causa: MARCA_SIN_LATIDO }] }), "construir");
  antes.termino("reintento", { ok: false });
  antes.tomada(tarjeta("vieja"), "subir");
  reloj.pasar(9 * 24 * 60 - 12);
  antes.tomada(tarjeta("corta"), "planear");
  reloj.pasar(10);
  const crm = crmFalso({ sueltasAlArrancar: ["corta"] });
  const planificador = planificadorDe(crm, config, reloj);
  await planificador.iniciar();
  assert.deepEqual(crm.pedidos.map((p) => `${p.accion}${p.accion === "soltar" ? ` ${p.datos[0]}` : ""}`), ["arranque", "soltar vieja"]);
  assert.match(crm.pedidos[1].datos[1], /no cuenta como intento/);
  const guardado = leerSinLatido(config.carpetaTrabajo).tarjetas;
  assert.equal(guardado.vieja, undefined, "retomada: no cuenta como intento");
  assert.equal(guardado.corta, undefined, "la soltó /arranque: no cuenta como intento");
  assert.equal(guardado.reintento.veces, 1, "lo que ya llevaba un intento lo conserva");
  planificador.parar();

  // Si la tarjeta SUBIENDO ya no está en su etapa (409), se olvida; con el CRM caído (502) queda para la revisión de cada 15 min.
  const config2 = nuevaConfig();
  const antes2 = guardiaDe(crmFalso(), config2, reloj);
  antes2.tomada(tarjeta("s1"), "subir");
  antes2.tomada(tarjeta("s2"), "subir");
  let n = 0;
  const crm2 = crmFalso();
  crm2.soltar = async (id, motivo, extra) => {
    crm2.pedidos.push({ accion: "soltar", datos: [id, motivo, extra] });
    if (n++ === 0) throw new ErrorDelCrm("Esa acción no se puede desde HECHO.", 409);
    throw new ErrorDelCrm("Bad Gateway", 502);
  };
  const planificador2 = planificadorDe(crm2, config2, reloj);
  await planificador2.iniciar();
  const guardado2 = leerSinLatido(config2.carpetaTrabajo).tarjetas;
  assert.equal(guardado2.s1, undefined);
  assert.equal(guardado2.s2.enLasManos, true, "con 502 sigue tomada: la revisión periódica la suelta");
  planificador2.parar();
});

await prueba("el planificador: la revisión corre cada 15 min y una sesión suya viva nunca se suelta", async () => {
  const config = nuevaConfig();
  const reloj = crearReloj();
  const crm = crmFalso();
  const planificador = planificadorDe(crm, config, reloj);
  const guardia = guardiaDe(crmFalso(), config, reloj);
  guardia.tomada(tarjeta("z"), "planear");
  reloj.pasar(45);
  await planificador.revisarSinLatido();
  assert.deepEqual(crm.acciones(), ["candidatas", "soltar"], "orfana de 45 min: la suelta");
  await planificador.revisarSinLatido();
  assert.equal(crm.acciones().filter((a) => a === "soltar").length, 1, "la segunda llamada inmediata no vuelve a mirar");
  planificador.parar();
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas de las tarjetas sin señal: todas bien`);

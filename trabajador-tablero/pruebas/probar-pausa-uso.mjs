// Pruebas de la PAUSA POR USO DE CLAUDE (lib/pausa-uso.mjs + el vigilante de motores.mjs), sin CRM ni Claude de verdad:
//   node trabajador-tablero/pruebas/probar-pausa-uso.mjs   (también corre dentro de npm run test:trabajador-tablero)
// Una lectura simulada al 79 %, 80 % y 100 %, el reinicio, el reinicio del Coordinador en plena pausa, la lectura que
// falla, el interruptor y el umbral. Las pruebas con tarjetas corriendo y el WhatsApp están en probar-trabajador.mjs.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { completarConfig } from "../lib/config.mjs";
import { crearEstadoDeMotores, crearVigilanteDeUso, leerUsoDeClaude } from "../lib/motores.mjs";
import { crearPausaPorUso, fechaDelReinicio, periodosAltos, textoDelAvisoDePausa, textoDelAvisoDeReanudar, textoDelReinicio, umbralValido } from "../lib/pausa-uso.mjs";

let pruebas = 0;
async function prueba(nombre, fn) {
  await fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "pausa-uso-"));
let numero = 0;
const registroFalso = () => {
  const lineas = [];
  return { lineas, info: (m) => lineas.push(`INFO ${m}`), aviso: (m) => lineas.push(`AVISO ${m}`), error: (m) => lineas.push(`ERROR ${m}`) };
};
const nuevaConfig = (extra = {}) =>
  completarConfig({
    urlCrm: "https://crm.ejemplo.com",
    claveTrabajador: "aizen_trab_x",
    carpetaTrabajo: path.join(T, `trabajo${numero++}`),
    repos: { aizencrm: { ruta: T, ramaBase: "main", remoto: "origin", verificar: [["true"]] } },
    ...extra,
  });
const texto = (sesion, semana = 6) =>
  `Current session: ${sesion}% used · resets Oct 26, 3:20pm (America/Bogota)\nCurrent week (all models): ${semana}% used · resets Oct 30, 7am (America/Bogota)\n`;
const uso = (sesion, semana = 6) => leerUsoDeClaude(texto(sesion, semana));
// 26-oct-2026, 1:00 p. m. en Bogotá.
const AHORA = Date.parse("2026-10-26T18:00:00Z");

await prueba("la hora de reinicio: con fecha, sin fecha y sin hora (Bogotá, UTC-5)", () => {
  assert.equal(new Date(fechaDelReinicio("Oct 26, 3:20pm (America/Bogota)", AHORA)).toISOString(), "2026-10-26T20:20:00.000Z");
  assert.equal(new Date(fechaDelReinicio("Oct 30, 7am (America/Bogota)", AHORA)).toISOString(), "2026-10-30T12:00:00.000Z");
  assert.equal(new Date(fechaDelReinicio("3:20pm", AHORA)).toISOString(), "2026-10-26T20:20:00.000Z", "sin fecha: hoy");
  assert.equal(new Date(fechaDelReinicio("9am", AHORA)).toISOString(), "2026-10-27T14:00:00.000Z", "sin fecha y ya pasó: mañana");
  assert.equal(new Date(fechaDelReinicio("12am", AHORA)).toISOString(), "2026-10-27T05:00:00.000Z");
  assert.equal(fechaDelReinicio("cuando se pueda", AHORA), null, "sin hora no se inventa");
  assert.equal(fechaDelReinicio("", AHORA), null);
  const { alto, reiniciaEn } = periodosAltos(uso(85, 90), 80, AHORA);
  assert.equal(alto.length, 2);
  assert.equal(new Date(reiniciaEn).toISOString(), "2026-10-30T12:00:00.000Z", "con los dos altos, vuelve cuando se reinicie el último");
  assert.equal(umbralValido(49), null);
  assert.equal(umbralValido(95), 95);
  assert.equal(umbralValido(96), null);
});

await prueba("79 %: no se pausa, no hay aviso y el panel dice 79 %", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  assert.deepEqual(pausa.leyo(uso(79), null), { entro: false, salio: false });
  assert.equal(pausa.pausado(), false);
  assert.deepEqual(pausa.pendientes(), []);
  const resumen = pausa.resumen();
  assert.equal(resumen.sesion.porcentaje, 79);
  assert.equal(resumen.semana.porcentaje, 6);
  assert.equal(resumen.pausado, false);
  assert.equal(resumen.activa, true);
  assert.equal(resumen.umbral, 80);
});

await prueba("80 %: se pausa y sale UN solo aviso (aunque pasen varias lecturas); 100 % igual", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  assert.deepEqual(pausa.leyo(uso(80), null), { entro: true, salio: false });
  assert.equal(pausa.pausado(), true);
  const [aviso, ...otros] = pausa.pendientes();
  assert.equal(otros.length, 0);
  assert.equal(aviso.clave, "pausa");
  assert.match(aviso.texto, /^⛔ Se paró todo: el uso de Claude llegó al 80 %\.\nSe reanuda el lun,? 26 (de )?oct,? 3:20 p\. m\.\.\nVer: https:\/\/crm\.ejemplo\.com\/cliente\/tablero-ia\?vista=coordinador$/);
  assert.ok(aviso.texto.split("\n").length <= 3, "máximo 3 líneas");
  pausa.avisado("pausa");
  assert.deepEqual(pausa.pendientes(), [], "ya avisado: no se repite");
  assert.deepEqual(pausa.leyo(uso(90), null), { entro: false, salio: false }, "sigue pausado, no entra otra vez");
  assert.deepEqual(pausa.leyo(uso(100), null), { entro: false, salio: false });
  assert.deepEqual(pausa.pendientes(), [], "al 100 % tampoco hay un segundo aviso");
  assert.equal(pausa.resumen().pausado, true);
  assert.equal(pausa.resumen().reiniciaEn, "2026-10-26T20:20:00.000Z");
});

await prueba("la semana también pausa, y vuelve cuando se reinicia la semana", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  pausa.leyo(uso(10, 81), null);
  assert.equal(pausa.pausado(), true);
  assert.equal(pausa.resumen().reiniciaEn, "2026-10-30T12:00:00.000Z");
});

await prueba("reinicio: el uso baja a 5 %, sale de la pausa y avisa en una línea (una sola vez)", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  pausa.leyo(uso(80), null);
  pausa.avisado("pausa");
  assert.deepEqual(pausa.leyo(uso(5), null), { entro: false, salio: true });
  assert.equal(pausa.pausado(), false);
  const [aviso, ...otros] = pausa.pendientes();
  assert.equal(otros.length, 0);
  assert.deepEqual([aviso.clave, aviso.texto], ["reanudar", textoDelAvisoDeReanudar()]);
  assert.equal(aviso.texto.split("\n").length, 1, "una línea");
  assert.match(aviso.texto, /Volvió a trabajar: el uso de Claude se reinició\./);
  pausa.avisado("reanudar");
  assert.deepEqual(pausa.pendientes(), []);
});

await prueba("si el aviso de la pausa no salió (silenciado), no se avisa 'volvió' sin haber avisado que se paró", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  pausa.leyo(uso(85), null);
  assert.equal(pausa.pendientes()[0].clave, "pausa", "sigue pendiente (se reintenta a las 7 a. m.)");
  pausa.leyo(uso(5), null);
  assert.deepEqual(pausa.pendientes(), [], "salió de la pausa antes de avisarla: no hay nada que avisar");
});

await prueba("el Coordinador se reinicia en plena pausa: sigue pausado y no repite el WhatsApp", () => {
  const config = nuevaConfig();
  const antes = crearPausaPorUso({ config, registro: registroFalso(), ahora: () => AHORA });
  antes.leyo(uso(82), null);
  antes.avisado("pausa");
  const despues = crearPausaPorUso({ config, registro: registroFalso(), ahora: () => AHORA + 60_000 });
  assert.equal(despues.pausado(), true, "la pausa está guardada en estado-uso.json");
  assert.deepEqual(despues.pendientes(), [], "y el aviso ya salió: no se repite");
  assert.equal(despues.resumen().reiniciaEn, "2026-10-26T20:20:00.000Z");
  assert.deepEqual(despues.leyo(uso(3), null), { entro: false, salio: true });
  assert.equal(despues.pendientes()[0].clave, "reanudar");
  const guardado = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-uso.json"), "utf8"));
  assert.equal(guardado.pausaUso.pausa, null);
});

await prueba("lectura que falla 3 veces seguidas: no se pausa, el panel lo dice y sale UN aviso; después de una buena y otra mala racha, otra vez uno", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  pausa.leyo(null, "salió con código 1");
  pausa.leyo(null, "salió con código 1");
  assert.deepEqual(pausa.pendientes(), [], "con dos fallas todavía no avisa");
  pausa.leyo(null, "salió con código 1");
  assert.equal(pausa.pausado(), false, "sin número no se pausa");
  const [aviso] = pausa.pendientes();
  assert.equal(aviso.clave, "lectura");
  assert.match(aviso.texto, /^⚠️ No pude leer el uso de Claude desde las 1:00 p\. m\.: no sé si se acerca al límite\.\nVer: /);
  assert.ok(pausa.resumen().sinLeerDesde, "el panel lo dice");
  pausa.avisado("lectura");
  for (let i = 0; i < 5; i += 1) pausa.leyo(null, "x");
  assert.deepEqual(pausa.pendientes(), [], "no se repite mientras siga fallando");
  pausa.leyo(uso(40), null);
  assert.equal(pausa.resumen().sinLeerDesde, null, "una lectura buena limpia la falla");
  for (let i = 0; i < 3; i += 1) pausa.leyo(null, "x");
  assert.deepEqual(pausa.pendientes().map((p) => p.clave), ["lectura"], "falla otra vez tras una buena: avisa de nuevo, una vez");
});

await prueba("en pausa y sin poder leer: sigue pausado; pasada la hora de reinicio (con margen) se levanta sola", () => {
  let reloj = AHORA;
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => reloj });
  pausa.leyo(uso(90), null);
  for (let i = 0; i < 3; i += 1) pausa.leyo(null, "x");
  assert.equal(pausa.pausado(), true, "antes de la hora de reinicio no se levanta");
  reloj = Date.parse("2026-10-26T20:20:00Z") + 31 * 60_000;
  assert.deepEqual(pausa.leyo(null, "x"), { entro: false, salio: true });
  assert.equal(pausa.pausado(), false);
});

await prueba("interruptor: apagado no pausa ni al 100 %, y apagarlo en plena pausa la levanta sin avisar 'volvió'", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  pausa.ajustes({ activa: false, umbral: 80 });
  assert.deepEqual(pausa.leyo(uso(100), null), { entro: false, salio: false });
  assert.equal(pausa.pausado(), false);
  pausa.ajustes({ activa: true, umbral: 80 });
  pausa.leyo(uso(100), null);
  assert.equal(pausa.pausado(), true, "prendida vuelve a pausar con la lectura ya conocida");
  pausa.avisado("pausa");
  pausa.ajustes({ activa: false, umbral: 80 });
  assert.equal(pausa.pausado(), false, "apagarlo en plena pausa la levanta al instante");
  assert.deepEqual(pausa.pendientes(), [], "el dueño la apagó: no se avisa que 'se reinició el uso'");
});

await prueba("umbral: con 60 % se pausa al 60 %; fuera de 50 a 95 no se acepta; subirlo en plena pausa la levanta", () => {
  const pausa = crearPausaPorUso({ config: nuevaConfig(), registro: registroFalso(), ahora: () => AHORA });
  pausa.ajustes({ activa: true, umbral: 60 });
  pausa.leyo(uso(59), null);
  assert.equal(pausa.pausado(), false);
  pausa.leyo(uso(60), null);
  assert.equal(pausa.pausado(), true);
  assert.match(pausa.pendientes()[0].texto, /llegó al 60 %/);
  pausa.ajustes({ activa: true, umbral: 20 });
  assert.equal(pausa.umbral(), 60, "un umbral fuera de rango se ignora");
  pausa.ajustes({ activa: true, umbral: 90 });
  assert.equal(pausa.pausado(), false, "con el umbral en 90 y el uso en 60 ya no hace falta pausar");
});

await prueba("la config: pausa prendida al 80 %, lee cada 5 min (cada 2 desde el 70 %); valores raros se rechazan", () => {
  const config = nuevaConfig();
  assert.deepEqual(config.pausaUso, { activa: true, umbral: 80, cercaDesde: 70, vigilarCercaMinutos: 2 });
  assert.equal(config.vigilarUsoMinutos, 5);
  assert.equal(nuevaConfig({ umbralClaude: 85 }).pausaUso.umbral, 85, "sin pausaUso.umbral usa umbralClaude");
  assert.throws(() => nuevaConfig({ pausaUso: { umbral: 99 } }), /pausaUso\.umbral/);
  assert.throws(() => nuevaConfig({ pausaUso: { activa: "sí" } }), /pausaUso\.activa/);
});

await prueba("el vigilante lee cada 5 min, cada 2 desde el 70 % o en pausa, y avisa a la pausa; la pausa se guarda sin pisar el cruce del umbral", async () => {
  let reloj = AHORA;
  let lecturas = 0;
  let respuesta = texto(40);
  const config = nuevaConfig();
  const registro = registroFalso();
  const pausa = crearPausaPorUso({ config, registro, ahora: () => reloj });
  const vigilante = crearVigilanteDeUso({
    config,
    registro,
    estado: crearEstadoDeMotores(config),
    entorno: {},
    ahora: () => reloj,
    pausa,
    leer: async () => {
      lecturas += 1;
      return { texto: respuesta, motivo: null };
    },
  });
  const pasar = async (minutos) => {
    reloj += minutos * 60_000;
    await vigilante.vigilar();
  };
  await vigilante.vigilar();
  assert.equal(lecturas, 1);
  await pasar(4);
  assert.equal(lecturas, 1, "a los 4 min no vuelve a leer (bajo el 70 %)");
  await pasar(1);
  assert.equal(lecturas, 2, "a los 5 min sí");
  respuesta = texto(72);
  await pasar(5);
  assert.equal(lecturas, 3);
  await pasar(1);
  assert.equal(lecturas, 3, "al 72 % lee cada 2 min: al minuto todavía no");
  await pasar(1);
  assert.equal(lecturas, 4, "y a los 2 min sí");
  respuesta = texto(81);
  await pasar(2);
  assert.equal(pausa.pausado(), true, "al 81 % el vigilante pausa");
  const archivo = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-uso.json"), "utf8"));
  assert.ok(archivo.pausaUso.pausa, "la pausa quedó guardada");
  assert.ok(archivo.avisado.sesion, "y el cruce del umbral de siempre también (no se pisan)");
  await pasar(2);
  assert.equal(lecturas, 6, "en pausa sigue leyendo cada 2 min");
  respuesta = texto(5);
  await pasar(2);
  assert.equal(pausa.pausado(), false, "al reiniciarse el uso, sale");
  assert.ok(registro.lineas.some((l) => /sale la pausa por uso/.test(l)));
  const archivo2 = JSON.parse(fs.readFileSync(path.join(config.carpetaTrabajo, "estado-uso.json"), "utf8"));
  assert.equal(archivo2.avisado.sesion, null, "el cruce de siempre se limpió");
});

await prueba("los textos: el aviso de la pausa sin hora de reinicio y la hora de Bogotá", () => {
  const config = nuevaConfig();
  assert.match(textoDelAvisoDePausa({ umbral: 80, reiniciaEn: null, config }), /Se reanuda cuando se reinicie el uso\./);
  assert.match(textoDelReinicio(Date.parse("2026-10-26T20:20:00Z")), /3:20 p\. m\.$/);
});

fs.rmSync(T, { recursive: true, force: true });
console.log(`\n${pruebas} pruebas, todas bien`);

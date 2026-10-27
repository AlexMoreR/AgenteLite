// Pruebas de EMBUDO POR PASO: el historial y el paso anterior de la foto del lead
// (src/features/embudo/dominio/eventos.ts) y las cuentas del reporte (dominio/por-paso.ts): "se quedó
// aquí" a las 24 h, llegaron / se quedaron, tasa de paso a paso, mayor caída, grupos bot / asesora,
// tiempos y marca del V2. Sin base ni red. Correr: npm run test:embudo-por-paso
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const eventos = cargar("src/features/embudo/dominio/eventos.ts");
const porPaso = cargar("src/features/embudo/dominio/por-paso.ts");

let pruebas = 0;
const fallas = [];
function prueba(nombre, fn) {
  try {
    fn();
    pruebas += 1;
    console.log(`ok - ${nombre}`);
  } catch (error) {
    fallas.push(nombre);
    console.log(`FALLA - ${nombre}\n  ${String(error?.stack ?? error).split("\n").slice(0, 6).join("\n  ")}`);
  }
}

const AHORA = new Date("2026-10-27T15:00:00.000Z");
const hace = (horas) => new Date(AHORA.getTime() - horas * 3_600_000);
const contexto = { conversationId: "c1", contactId: "k1", workspaceId: "ws1", channelId: "L1", inicioDeLaCharla: hace(100) };
const pasoEntra = (paso, cuando, datos = {}) => ({ tipo: "PASO_ENTRA", origen: "motor", paso, producto: "combo-camilla", createdAt: cuando, datos });

function recorrer(lista) {
  let foto = null;
  for (const evento of lista) foto = eventos.aplicarEvento(foto, evento, contexto);
  return foto;
}

prueba("guarda el paso anterior, desde cuándo y el historial", () => {
  const foto = recorrer([pasoEntra("PRESENTACION", hace(50)), pasoEntra("PRODUCTO", hace(40)), pasoEntra("OBJECIONES", hace(30))]);
  assert.equal(foto.pasoActual, "OBJECIONES");
  assert.equal(foto.pasoAnterior, "PRODUCTO");
  assert.equal(foto.pasoDesde.getTime(), hace(30).getTime());
  assert.deepEqual(foto.pasoHistorial.map((c) => c.paso), ["PRESENTACION", "PRODUCTO", "OBJECIONES"]);
  assert.equal(foto.pasoHistorial[0].producto, "combo-camilla");
});

prueba("un evento que repite el paso no suma otro cambio (PASO_ENTRA + TURNO_V3 de la misma vuelta)", () => {
  const foto = recorrer([
    pasoEntra("PRODUCTO", hace(10)),
    { tipo: "TURNO_V3", origen: "motor", paso: "PRODUCTO", producto: "combo-camilla", createdAt: hace(10), datos: { mensajes: 1 } },
  ]);
  assert.equal(foto.pasoHistorial.length, 1);
});

prueba("el historial no pasa de 10 cambios y conserva los últimos", () => {
  const pasos = ["PRESENTACION", "PRODUCTO"];
  const lista = Array.from({ length: 25 }, (_, i) => pasoEntra(pasos[i % 2], hace(100 - i)));
  const foto = recorrer(lista);
  assert.equal(foto.pasoHistorial.length, eventos.MAXIMO_DE_PASOS);
  assert.equal(eventos.MAXIMO_DE_PASOS, 10);
  assert.equal(foto.pasoHistorial.at(-1).en, hace(76).toISOString());
});

prueba("volver a un paso anterior queda en el historial", () => {
  const foto = recorrer([pasoEntra("PRODUCTO", hace(20)), pasoEntra("OBJECIONES", hace(15)), pasoEntra("PRODUCTO", hace(10))]);
  assert.equal(foto.pasoAnterior, "OBJECIONES");
  assert.deepEqual(foto.pasoHistorial.map((c) => c.paso), ["PRODUCTO", "OBJECIONES", "PRODUCTO"]);
  assert.equal(foto.pasoMaximo, "OBJECIONES");
});

prueba("los avisos del V3 y del V2 quedan marcados", () => {
  const v3 = recorrer([pasoEntra("PRESENTACION", hace(9), { agente: "v3" })]);
  const v2 = recorrer([pasoEntra("PRESENTACION", hace(9), { agente: "v2" })]);
  assert.equal(v3.pasoHistorial[0].agente, "v3");
  assert.equal(v2.pasoHistorial[0].agente, "v2");
  // El turno del V3 que arma eventosDelTurno marca v3.
  const turno = eventos.eventosDelTurno({
    conversationId: "c1",
    traza: {
      libroVersion: 1, antes: { pasoActual: "PRESENTACION", producto: "p", esPrimerMensaje: false }, despues: { pasoActual: "PRODUCTO", producto: "p" },
      intenciones: [], tiposDeAccion: [], conSaludo: false, envioFlujo: false, mensajesEnviados: 1, reglaId: null, reglaNombre: null, cuando: hace(1).toISOString(),
    },
    atendido: true,
    mensajeCliente: "hola",
  });
  assert.equal(turno.find((e) => e.tipo === "PASO_ENTRA").datos.agente, "v3");
});

prueba("una foto de antes (sin historial) sigue funcionando", () => {
  const anterior = { ...eventos.leadVacio(contexto), pasoActual: "PRODUCTO", pasoMaximo: "PRODUCTO" };
  const foto = eventos.aplicarEvento(anterior, pasoEntra("CIERRE", hace(2)), contexto);
  assert.equal(foto.pasoAnterior, "PRODUCTO");
  assert.equal(foto.pasoHistorial.length, 1);
});

let n = 0;
function lead(extra = {}) {
  n += 1;
  return {
    conversationId: `c${n}`, entradaEn: hace(200), familia: "combo", canalId: "L1", pasoActual: "PRESENTACION", pasoMaximo: "PRESENTACION",
    pasoAnterior: null, pasoDesde: hace(100), pasoHistorial: null, ultimoClienteEn: hace(1), compro: false, conAsesora: false, ...extra,
  };
}
const muchos = (cuantos, extra) => Array.from({ length: cuantos }, () => lead(extra));

prueba("25 horas sin escribir se quedó; 23 horas no", () => {
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(25) }), AHORA), true);
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(23) }), AHORA), false);
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(24) }), AHORA), false);
  // Vuelve a escribir: deja de contar.
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(0.5) }), AHORA), false);
  // Ya compró o no tiene paso: no.
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(80), compro: true }), AHORA), false);
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(80), pasoActual: null }), AHORA), false);
  // Sin dato de cuándo escribió: cuenta desde que entró al paso.
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: null, pasoDesde: hace(30) }), AHORA), true);
});

// 100 en Presentación (de ellos 60 siguieron), 60 llegaron a Producto (30 siguieron), 30 a Objeciones (12 siguieron), 12 a Cierre.
const flujo = [
  ...muchos(40, { pasoActual: "PRESENTACION", pasoMaximo: "PRESENTACION", ultimoClienteEn: hace(50) }),
  ...muchos(30, { pasoActual: "PRODUCTO", pasoMaximo: "PRODUCTO", ultimoClienteEn: hace(30) }),
  ...muchos(10, { pasoActual: "PRODUCTO", pasoMaximo: "PRODUCTO", ultimoClienteEn: hace(2) }),
  ...muchos(18, { pasoActual: "OBJECIONES", pasoMaximo: "OBJECIONES", ultimoClienteEn: hace(40) }),
  ...muchos(12, { pasoActual: "CIERRE", pasoMaximo: "CIERRE", ultimoClienteEn: hace(5) }),
  // Uno que pasó a Objeciones y volvió a Producto: no suma otra vez a «llegaron».
  lead({ pasoActual: "PRODUCTO", pasoMaximo: "OBJECIONES", ultimoClienteEn: hace(1) }),
];

prueba("llegaron, se quedaron y en curso por paso", () => {
  const { bot } = porPaso.armarEmbudoPorPaso(flujo, AHORA);
  const [pres, prod, obj, cierre] = bot.pasos;
  assert.deepEqual([pres.llegaron, prod.llegaron, obj.llegaron, cierre.llegaron], [111, 71, 31, 12]);
  assert.equal(pres.seQuedaron, 40);
  assert.equal(prod.seQuedaron, 30);
  assert.equal(prod.enCurso, 11);
  assert.equal(obj.seQuedaron, 18);
  assert.equal(cierre.seQuedaron, 0);
  assert.equal(bot.chats, 111);
});

prueba("la tasa de paso a paso y el paso de mayor caída", () => {
  const { bot } = porPaso.armarEmbudoPorPaso(flujo, AHORA);
  assert.equal(bot.pasos[0].tasaAlSiguiente, 64);
  assert.equal(bot.pasos[1].tasaAlSiguiente, 43.7);
  assert.equal(bot.pasos[2].tasaAlSiguiente, 38.7);
  assert.equal(bot.pasos[3].tasaAlSiguiente, null);
  assert.equal(bot.mayorCaida.desde, "OBJECIONES");
  assert.equal(bot.mayorCaida.hacia, "CIERRE");
  assert.equal(bot.mayorCaida.noPasaron, 19);
  assert.equal(bot.pasos[3].pocosDatos, true);
  assert.equal(bot.pasos[0].pocosDatos, false);
});

prueba("60 % de Presentación pasa a Producto", () => {
  const leads = [...muchos(40, {}), ...muchos(60, { pasoActual: "PRODUCTO", pasoMaximo: "PRODUCTO" })];
  const { bot } = porPaso.armarEmbudoPorPaso(leads, AHORA);
  assert.equal(bot.pasos[0].tasaAlSiguiente, 60);
});

prueba("los chats con asesora van en su grupo aparte", () => {
  const leads = [...muchos(10, {}), ...muchos(5, { conAsesora: true, pasoActual: "CIERRE", pasoMaximo: "CIERRE" })];
  const embudo = porPaso.armarEmbudoPorPaso(leads, AHORA);
  assert.equal(embudo.bot.chats, 10);
  assert.equal(embudo.asesora.chats, 5);
  assert.equal(embudo.bot.pasos[3].llegaron, 0);
  assert.equal(embudo.asesora.pasos[3].llegaron, 5);
  assert.equal(embudo.total, 15);
});

prueba("Identificación cuenta dentro de Presentación; sin paso no cuenta", () => {
  const leads = [lead({ pasoActual: "IDENTIFICACION", pasoMaximo: "IDENTIFICACION", ultimoClienteEn: hace(30) }), lead({ pasoActual: null, pasoMaximo: null })];
  const { bot } = porPaso.armarEmbudoPorPaso(leads, AHORA);
  assert.equal(bot.pasos[0].llegaron, 1);
  assert.equal(bot.pasos[0].seQuedaron, 1);
  assert.equal(bot.conPaso, 1);
  assert.equal(bot.chats, 2);
});

prueba("el tiempo promedio en cada paso sale del historial", () => {
  const historial = [
    { paso: "PRESENTACION", producto: "p", en: hace(30).toISOString(), agente: "v3" },
    { paso: "PRODUCTO", producto: "p", en: hace(28).toISOString(), agente: "v3" },
    { paso: "OBJECIONES", producto: "p", en: hace(20).toISOString(), agente: "v3" },
  ];
  const { bot } = porPaso.armarEmbudoPorPaso([lead({ pasoActual: "OBJECIONES", pasoMaximo: "OBJECIONES", pasoHistorial: historial })], AHORA);
  assert.equal(bot.pasos[0].horasPromedio, 2);
  assert.equal(bot.pasos[1].horasPromedio, 8);
  assert.equal(bot.pasos[2].horasPromedio, null);
  assert.equal(porPaso.textoDeHoras(2), "2 h");
  assert.equal(porPaso.textoDeHoras(0.5), "30 min");
  assert.equal(porPaso.textoDeHoras(72), "3 días");
});

prueba("sin chats todo queda en cero y el texto lo dice", () => {
  const embudo = porPaso.armarEmbudoPorPaso([], AHORA);
  assert.equal(embudo.bot.mayorCaida, null);
  assert.ok(porPaso.textoDelEmbudoPorPaso({ producto: "Combo camilla", desde: "2026-10-01", hasta: "2026-10-27", embudo }).includes("todavía no hay"));
});

prueba("la frase para la reunión nombra los pasos y la mayor caída", () => {
  const embudo = porPaso.armarEmbudoPorPaso([...flujo, ...muchos(3, { conAsesora: true })], AHORA);
  const frase = porPaso.textoDelEmbudoPorPaso({ producto: "Combo camilla", desde: "2026-10-01", hasta: "2026-10-27", embudo });
  assert.ok(frase.includes("Presentación 111"));
  assert.ok(frase.includes("entre Objeciones y Cierre"));
  assert.ok(frase.includes("3 chats los tomó una asesora"));
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}

// Pruebas del EMBUDO POR PASO (src/features/embudo/dominio/por-paso.ts y el detalle de paso de
// dominio/eventos.ts): paso anterior, historial de 10, "se quedó aquí" a las 24 h, tasas, grupo de
// asesora y aviso del V2. Sin base ni red. Correr: npm run test:embudo-por-paso
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

const contexto = { conversationId: "c1", contactId: "k1", workspaceId: "ws1", channelId: "L1", inicioDeLaCharla: new Date("2026-10-01T10:00:00Z") };
const en = (horas) => new Date(Date.parse("2026-10-01T10:00:00Z") + horas * 3_600_000);
const entra = (paso, horas, extra = {}) => ({ tipo: "PASO_ENTRA", origen: "motor", paso, producto: "combo-camilla", createdAt: en(horas), ...extra });

prueba("guarda paso anterior, desde cuándo y el historial", () => {
  let foto = eventos.aplicarEvento(null, entra("PRESENTACION", 0), contexto);
  assert.equal(foto.pasoAnterior, null);
  assert.equal(foto.pasoDesde.getTime(), en(0).getTime());
  foto = eventos.aplicarEvento(foto, entra("PRODUCTO", 2), contexto);
  assert.equal(foto.pasoActual, "PRODUCTO");
  assert.equal(foto.pasoAnterior, "PRESENTACION");
  assert.equal(foto.pasoDesde.getTime(), en(2).getTime());
  assert.deepEqual(foto.pasoHistorial.map((c) => c.paso), ["PRESENTACION", "PRODUCTO"]);
  assert.equal(foto.pasoHistorial[1].producto, "combo-camilla");
  assert.equal(foto.pasoHistorial[1].motor, "v3");
});

prueba("el historial no pasa de 10 cambios", () => {
  let foto = null;
  const pasos = ["PRESENTACION", "PRODUCTO"];
  for (let i = 0; i < 25; i += 1) foto = eventos.aplicarEvento(foto, entra(pasos[i % 2], i), contexto);
  assert.equal(foto.pasoHistorial.length, 10);
  assert.equal(foto.pasoHistorial.at(-1).en, en(24).toISOString());
});

prueba("el aviso del V2 queda marcado como del V2", () => {
  const foto = eventos.aplicarEvento(null, entra("OBJECIONES", 0, { datos: { motor: "v2", desde: "PRODUCTO" } }), contexto);
  assert.equal(foto.pasoHistorial[0].motor, "v2");
});

prueba("un evento que no cambia el paso no toca el historial", () => {
  let foto = eventos.aplicarEvento(null, entra("PRODUCTO", 0), contexto);
  foto = eventos.aplicarEvento(foto, { tipo: "SEGUIMIENTO_ENVIADO", origen: "reloj", paso: "PRODUCTO", producto: "combo-camilla", createdAt: en(5) }, contexto);
  assert.equal(foto.pasoHistorial.length, 1);
  assert.equal(foto.pasoDesde.getTime(), en(0).getTime());
});

const ahora = new Date("2026-10-10T12:00:00Z");
const hace = (h) => new Date(ahora.getTime() - h * 3_600_000);
const lead = (extra = {}) => ({
  pasoActual: "PRESENTACION", pasoMaximo: "PRESENTACION", pasoDesde: hace(100), ultimoClienteEn: hace(100), entradaEn: hace(100),
  pasoHistorial: null, conAsesora: false, compro: false, ...extra,
});

prueba("25 horas sin escribir se quedó; 23 horas no", () => {
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(25) }), ahora), true);
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(23) }), ahora), false);
  assert.equal(porPaso.seQuedoAqui(lead({ ultimoClienteEn: hace(25), compro: true }), ahora), false);
});

prueba("llegaron, se quedaron y tasas de paso a paso", () => {
  const leads = [
    ...Array.from({ length: 4 }, () => lead({ pasoActual: "PRESENTACION" })),
    ...Array.from({ length: 3 }, () => lead({ pasoActual: "PRODUCTO", pasoMaximo: "PRODUCTO" })),
    lead({ pasoActual: "CIERRE", pasoMaximo: "CIERRE", ultimoClienteEn: hace(1) }),
    lead({ pasoActual: "PRODUCTO", pasoMaximo: "OBJECIONES", ultimoClienteEn: hace(2) }),
    lead({ pasoActual: "IDENTIFICACION", pasoMaximo: "IDENTIFICACION" }),
  ];
  const { bot } = porPaso.calcularEmbudoPorPaso(leads, ahora);
  const [pres, prod, obj, cierre] = bot.pasos;
  assert.deepEqual([pres.llegaron, prod.llegaron, obj.llegaron, cierre.llegaron], [10, 5, 2, 1]);
  // IDENTIFICACION cuenta en Presentación; el de CIERRE y el de PRODUCTO reciente siguen activos.
  assert.deepEqual([pres.seQuedaron, prod.seQuedaron, obj.seQuedaron, cierre.seQuedaron], [5, 3, 0, 0]);
  assert.equal(pres.tasaAlSiguiente, 50);
  assert.equal(prod.tasaAlSiguiente, 40);
  assert.equal(cierre.tasaAlSiguiente, null);
  assert.equal(bot.mayorCaida.desde, "PRESENTACION");
  assert.equal(bot.mayorCaida.quedaron, 5);
  assert.equal(pres.pocosDatos, true);
});

prueba("los chats con asesora van aparte", () => {
  const r = porPaso.calcularEmbudoPorPaso([lead(), lead({ conAsesora: true }), lead({ conAsesora: true })], ahora);
  assert.equal(r.bot.chats, 1);
  assert.equal(r.asesora.chats, 2);
  assert.equal(r.bot.pasos[0].llegaron, 1);
});

prueba("tiempo promedio en el paso sale del historial", () => {
  const h = (paso, horas) => ({ paso, producto: "combo-camilla", en: en(horas).toISOString(), motor: "v3" });
  const l = lead({ pasoActual: "PRODUCTO", pasoMaximo: "PRODUCTO", pasoHistorial: [h("PRESENTACION", 0), h("PRODUCTO", 4)] });
  const { bot } = porPaso.calcularEmbudoPorPaso([l], ahora);
  assert.equal(bot.pasos[0].horasPromedio, 4);
  assert.equal(bot.pasos[1].horasPromedio, null);
});

prueba("sin chats la frase lo dice y no truena", () => {
  const r = porPaso.calcularEmbudoPorPaso([], ahora);
  assert.equal(r.bot.mayorCaida, null);
  assert.ok(porPaso.textoDeEmbudoPorPaso(r, "Combo camilla").includes("Todavía no hay"));
});

console.log(`\n${pruebas} pruebas ok, ${fallas.length} con falla`);
if (fallas.length) {
  console.log("Fallaron:", fallas.join(" | "));
  process.exit(1);
}

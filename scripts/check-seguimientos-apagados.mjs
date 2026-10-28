// Pruebas de los SEGUIMIENTOS AUTOMÁTICOS QUE SE APAGAN SOLOS (src/features/seguimientos/dominio/apagado.ts,
// tarjeta prioridad 1 del dueño, 28-10-2026): caso real de la clienta de Yair, a quien el robot le siguió
// mandando "Tras asesora: 1 h / 24 h" cuando ya había dicho que iba a pagar y venía a Cali.
// Sin base ni red. Correr: npm run test:seguimientos-apagados
import assert from "node:assert/strict";
import fs from "node:fs";

import { cargar } from "./supervisor-cargar.mjs";

const ap = cargar("src/features/seguimientos/dominio/apagado.ts");
const cf = cargar("src/features/seguimiento-inteligente/dominio/config.ts");
const ta = cargar("src/features/seguimiento-inteligente/dominio/tras-asesora.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const H = 3_600_000;
const T0 = new Date("2026-10-28T15:00:00.000Z");
const mas = (horas) => new Date(T0.getTime() + horas * H);
const IN = (horas, texto, tipo = "TEXT") => ({ direccion: "IN", tipo, texto, en: mas(horas), leidoEn: mas(horas), origen: "webhook" });
const BOT = (horas, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: mas(horas), leidoEn: null, origen: "agente-v3" });
const ASESORA = (horas, texto, tipo = "TEXT") => ({ direccion: "OUT", tipo, texto, en: mas(horas), leidoEn: null, origen: "manual" });

const decidir = (mensajes, parcial = {}) =>
  ap.decidirApagado({ tipo: "embudo", etapaCrm: "PROPUESTA", interruptorApagado: false, mensajes, inicioDeLaCharla: T0, ahora: mas(30), ...parcial });

/* ---- 1. Nada de eso → sí sale ---- */
prueba("nada de eso: el seguimiento sale (el bot habló, el cliente calló, etapa abierta)", () => {
  const charla = [IN(0, "Hola, me interesa"), BOT(0.01, "¡Hola! ¿Qué producto te interesa?"), BOT(1, "¿Sigues interesada?")];
  assert.equal(decidir(charla), null);
  assert.equal(decidir(charla, { tipo: "otro" }), null);
});

/* ---- 2. Interruptor ---- */
prueba("interruptor apagado: no sale, con cualquier tipo de seguimiento", () => {
  for (const tipo of ["embudo", "tras_asesora", "otro"]) {
    assert.equal(decidir([IN(0, "Hola")], { tipo, interruptorApagado: true })?.codigo, "interruptor");
  }
});

/* ---- 3. Etapa de venta o cierre ---- */
prueba("etapa de venta/cierre (Negociación, Ganado): no sale; Nuevo/Calificado/Propuesta sí pueden", () => {
  assert.equal(decidir([IN(0, "Hola")], { etapaCrm: "NEGOCIACION" })?.codigo, "etapa_de_venta");
  assert.equal(decidir([IN(0, "Hola")], { etapaCrm: "GANADO" })?.codigo, "etapa_de_venta");
  for (const etapa of ["NUEVO", "CALIFICADO", "PROPUESTA", null]) assert.equal(decidir([IN(0, "Hola")], { etapaCrm: etapa }), null);
});

/* ---- 4. La asesora escribió a mano (solo embudo / producto) ---- */
prueba("asesora escribió a mano en las últimas 24 h: no salen los del embudo ni por producto", () => {
  const charla = [IN(0, "Hola"), BOT(0.01, "Bienvenida"), ASESORA(2, "Hola, soy María, te cuento del combo")];
  assert.equal(decidir(charla, { ahora: mas(10) })?.codigo, "asesora_escribio");
  assert.equal(decidir(charla, { ahora: mas(10), tipo: "otro" }), null, "los 'Inteligente' tienen su propio motor");
});

prueba("asesora escribió hace MÁS de 24 h, o fue el bot/el sistema/el primer minuto del celular: no cuenta", () => {
  assert.equal(decidir([IN(0, "Hola"), ASESORA(2, "Hola")], { ahora: mas(2 + 25) }), null);
  assert.equal(decidir([IN(0, "Hola"), BOT(2, "Hola, soy el bot")], { ahora: mas(10) }), null);
  const delSistema = { direccion: "OUT", tipo: "SYSTEM", texto: "📝 nota", en: mas(2), leidoEn: null, origen: "activity" };
  assert.equal(decidir([IN(0, "Hola"), delSistema], { ahora: mas(10) }), null);
  const delCelularAlInicio = { direccion: "OUT", tipo: "TEXT", texto: "Bienvenida automática del celular", en: new Date(T0.getTime() + 20_000), leidoEn: null, origen: "instance" };
  assert.equal(decidir([IN(0, "Hola"), delCelularAlInicio], { ahora: mas(10) }), null);
});

/* ---- 5. El cliente confirma compra o pago ---- */
prueba("el cliente confirma: 'te consigno', 'voy a ir', 'ya pagué', comprobante → no sale", () => {
  for (const texto of ["Listo, te consigno hoy", "Voy a ir a Cali mañana a pagar", "ya pagué", "ya hice la transferencia", "Me lo llevo", "te adjunto el comprobante"]) {
    assert.equal(decidir([IN(0, "Hola"), BOT(1, "Total $989.000"), IN(2, texto)])?.codigo, "cliente_confirmo", texto);
  }
});

prueba("un 'sí' suelto cuenta SOLO si lo último del negocio fue una pregunta de cierre o de pago", () => {
  assert.equal(decidir([IN(0, "Hola"), BOT(1, "¿Te lo separo con el 50% de anticipo?"), IN(2, "Sí")])?.codigo, "cliente_confirmo");
  assert.equal(decidir([IN(0, "Hola"), BOT(1, "¿Hacemos el pago por Nequi o por transferencia?"), IN(2, "dale")])?.codigo, "cliente_confirmo");
  // Un 'sí' a una pregunta que no es de cierre no apaga nada.
  assert.equal(decidir([IN(0, "Hola"), BOT(1, "¿Quieres que te cuente más del producto?"), IN(2, "Sí")]), null);
  // Un 'sí' sin pregunta antes tampoco.
  assert.equal(decidir([IN(0, "Hola"), BOT(1, "Tenemos el combo en blanco."), IN(2, "Sí")]), null);
});

prueba("una imagen cuenta (comprobante) solo si antes se habló del pago", () => {
  assert.equal(decidir([IN(0, "Hola"), BOT(1, "Te paso la cuenta de Bancolombia para la consignación"), IN(2, null, "IMAGE")])?.codigo, "cliente_confirmo");
  assert.equal(decidir([IN(0, "Hola"), BOT(1, "Mira el catálogo"), IN(2, null, "IMAGE")]), null);
});

prueba("conservadora: negaciones, preguntas y confirmaciones muy viejas no apagan", () => {
  for (const texto of ["no te consigno todavía", "¿cómo te consigno?", "¿voy a ir a Cali? no sé", "no voy a ir", "cuánto cuesta el envío", "me interesa mucho"]) {
    assert.equal(decidir([IN(0, "Hola"), BOT(1, "Total $989.000"), IN(2, texto)]), null, texto);
  }
  // Confirmó hace 20 días, no vale.
  assert.equal(decidir([IN(0, "te consigno hoy")], { ahora: mas(20 * 24) }), null);
});

/* ---- 6. 'Tras asesora' ---- */
prueba("Tras asesora: la asesora escribió y NO la frena la regla de 'asesora escribió' (para eso existe)", () => {
  const charla = [IN(0, "Hola, ¿cuánto cuesta?"), ASESORA(1, "Cuesta $989.000, te comparto fotos de las referencias.")];
  assert.equal(decidir(charla, { tipo: "tras_asesora", ahora: mas(3) }), null);
});

prueba("Tras asesora: la asesora prometió enviar o pidió esperar → no sale", () => {
  for (const texto of ["listo deme un momento y te envío todo", "dame un momento por favor", "ya te paso los datos", "ya te comparto la cuenta", "te mando el catálogo", "en un momento te escribo", "Un momento y te envío"]) {
    // Sin confirmación de compra de por medio: un cliente que solo preguntó.
    const sinConfirmar = [IN(0, "¿Qué referencias tienen?"), ASESORA(1, texto)];
    assert.equal(decidir(sinConfirmar, { tipo: "tras_asesora", ahora: mas(3) })?.codigo, "asesora_prometio", texto);
  }
});

prueba("Tras asesora: si la promesa ya se cumplió (después mandó fotos) o fue una pregunta, no se frena por eso", () => {
  const cumplida = [IN(0, "¿Qué referencias tienen?"), ASESORA(1, "Deme un momento y le envío"), ASESORA(1.1, null, "IMAGE")];
  assert.equal(decidir(cumplida, { tipo: "tras_asesora", ahora: mas(3) }), null);
  const pregunta = [IN(0, "¿Qué referencias tienen?"), ASESORA(1, "¿Te comparto las fotos?")];
  assert.equal(decidir(pregunta, { tipo: "tras_asesora", ahora: mas(3) }), null);
});

prueba("Tras asesora: si el cliente confirmó o el chat está en venta/cierre, tampoco sale", () => {
  const charla = [IN(0, "Hola, ¿cuánto cuesta?"), ASESORA(1, "Son $989.000"), IN(1.5, "Listo, voy a ir a Cali a pagar"), ASESORA(2, "Perfecto, te espero")];
  assert.equal(decidir(charla, { tipo: "tras_asesora", ahora: mas(4) })?.codigo, "cliente_confirmo");
  assert.equal(decidir([IN(0, "Hola"), ASESORA(1, "Son $989.000")], { tipo: "tras_asesora", etapaCrm: "NEGOCIACION", ahora: mas(3) })?.codigo, "etapa_de_venta");
  assert.equal(decidir([IN(0, "Hola"), ASESORA(1, "Son $989.000")], { tipo: "tras_asesora", interruptorApagado: true, ahora: mas(3) })?.codigo, "interruptor");
});

/* ---- 7. El caso real, contra la regla que AGENDA el 'Tras asesora' ---- */
const TA = cf.leerConfigDeTexto(JSON.stringify({ trasAsesora: { modo: "activo" } })).trasAsesora;
const entradaTA = (mensajes, parcial = {}) => ({
  mensajes,
  notas: [],
  inicio: T0,
  nombre: "Laura Gómez",
  pausado: true,
  pausadoEn: new Date(mensajes.filter((m) => m.origen === "manual").at(-1).en.getTime() + 2_000),
  etapaCrm: "PROPUESTA",
  noInteresa: false,
  dormido: false,
  pospuesto: false,
  caliente: false,
  config: TA,
  horario: { desde: 0, hasta: 24, dias: [0, 1, 2, 3, 4, 5, 6] },
  ahora: mas(1 + 1.1),
  ...parcial,
});

prueba("caso real: 'listo deme un momento y te envío todo' + 'voy a ir a Cali a pagar' → el Tras asesora 1 h NO sale", () => {
  const real = [IN(0, "Hola, me interesa el combo"), ASESORA(0.5, "Son $989.000, ¿cómo prefieres pagar?"), IN(0.7, "Voy a ir a Cali y pago allá"), ASESORA(1, "listo deme un momento y te envío todo")];
  const r = ta.decidirTrasAsesora(entradaTA(real));
  assert.equal(r.sale, false);
  assert.ok(["asesora_prometio", "cliente_confirmo"].includes(r.motivo), r.motivo);
});

prueba("Tras asesora (agenda): promesa sola, confirmación sola y etapa de venta cada una lo frena; sin nada, SÍ sale", () => {
  const promesa = [IN(0, "¿Qué referencias tienen?"), ASESORA(1, "listo deme un momento y te envío todo")];
  assert.equal(ta.decidirTrasAsesora(entradaTA(promesa)).motivo, "asesora_prometio");
  const confirmo = [IN(0, "Hola"), ASESORA(0.5, "Son $989.000"), IN(0.6, "Perfecto, te consigno hoy"), ASESORA(1, "Quedo atenta")];
  assert.equal(ta.decidirTrasAsesora(entradaTA(confirmo)).motivo, "cliente_confirmo");
  const normal = [IN(0, "¿Qué referencias tienen?"), ASESORA(1, "Hola, tenemos tres referencias, mira las fotos")];
  assert.equal(ta.decidirTrasAsesora(entradaTA(normal, { etapaCrm: "NEGOCIACION" })).motivo, "etapa_de_venta");
  const sale = ta.decidirTrasAsesora(entradaTA(normal));
  assert.equal(sale.sale, true, JSON.stringify(sale));
  assert.equal(sale.nombreDelFollow, "Tras asesora: 1 h");
});

/* ---- 8. Qué Follow es de qué tipo ---- */
prueba("tipo de seguimiento por nombre/regla", () => {
  assert.equal(ap.tipoDeSeguimiento({ name: "Tras asesora: 1 h", followRuleId: null }), "tras_asesora");
  assert.equal(ap.tipoDeSeguimiento({ name: "Etapa Bienvenida · 1 día", followRuleId: null }), "embudo");
  assert.equal(ap.tipoDeSeguimiento({ name: "Sin responder 1", followRuleId: null }), "embudo");
  assert.equal(ap.tipoDeSeguimiento({ name: null, followRuleId: "regla1" }), "embudo");
  assert.equal(ap.tipoDeSeguimiento({ name: "Inteligente: útil", followRuleId: null }), "otro");
});

/* ---- 9. Cableado (sin base: se comprueba que cada punto de envío llama a la revisión) ---- */
prueba("cableado: el motor de Follows, el reloj V3, el barrido 'Tras asesora' y el interruptor del chat usan la regla", () => {
  const leer = (ruta) => fs.readFileSync(ruta, "utf8");
  assert.match(leer("src/features/seguimientos/services/follows.ts"), /apagarSiCorresponde\(\{[\s\S]*?seguimientos_apagados/);
  assert.match(leer("src/features/agente-v3/servicios/seguimientos.ts"), /apagarSiCorresponde\(/);
  assert.match(leer("src/features/seguimiento-inteligente/servicios/tras-asesora.ts"), /seguimientosApagados" = false/);
  assert.match(leer("src/components/chats/chat-header-actions.tsx"), /InterruptorDeSeguimientos/);
  assert.match(leer("src/app/actions/chats-actions.ts"), /anotarSeguimientosApagados/);
  assert.match(leer("src/features/seguimientos/services/apagado.ts"), /PREFIJO_NOTA_APAGADOS = "Seguimientos apagados: "/);
  assert.match(leer("prisma/schema.prisma"), /seguimientosApagados\s+Boolean\s+@default\(false\)/);
});

console.log(`\n${pruebas} pruebas de seguimientos apagados: todas pasaron.`);

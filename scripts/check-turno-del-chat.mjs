// Pruebas de "¿DE QUIÉN ES EL TURNO?" (src/lib/turno-del-chat.ts), la definición única que usan el
// Supervisor, el Supervisor accionable y el seguimiento inteligente (12-10-2026). Sin base ni red.
// Correr: npm run test:turno-del-chat
import assert from "node:assert/strict";
import { cargar } from "./supervisor-cargar.mjs";

const tu = cargar("src/lib/turno-del-chat.ts");
const at = cargar("src/features/supervisor/dominio/detectores-atencion.ts");
const ex = cargar("src/features/supervisor/dominio/exclusiones.ts");
const gr = cargar("src/features/avisos-gravedad/dominio/reglas.ts");
const acc = cargar("src/features/supervisor-accionable/dominio/reglas.ts");

let pruebas = 0;
function prueba(nombre, fn) {
  fn();
  pruebas += 1;
  console.log(`ok - ${nombre}`);
}

const MIN = 60_000;
// Miércoles 7-oct, 10:00 Bogotá.
const T0 = new Date("2026-10-07T15:00:00Z");
const en = (min) => new Date(T0.getTime() + min * MIN);
const IN = (min, texto, tipo = "TEXT") => ({ direccion: "IN", tipo, texto, en: en(min), origen: null });
const BOT = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: en(min), origen: null });
const AUTO = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: en(min), origen: "agente-v3-seguimiento" });
const ASESORA = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: en(min), origen: "manual" });
const CELULAR = (min, texto) => ({ direccion: "OUT", tipo: "TEXT", texto, en: en(min), origen: "instance" });
const NOTA = (min, texto) => ({ direccion: "OUT", tipo: "SYSTEM", texto, en: en(min), origen: null });
const ANUNCIO = "Hola, me interesa el COMBO de estética (camilla, escalera, silla y auxiliar)";
const turno = (mensajes, ahoraMin) => tu.turnoDelChat(mensajes, ahoraMin === undefined ? {} : { ahora: en(ahoraMin) });

prueba("cliente escribió y nadie le contestó → MAGILUS desde su primer mensaje sin respuesta", () => {
  const t = turno([IN(0, ANUNCIO), BOT(0.2, "¿Qué servicios vas a ofrecer?"), IN(5, "Masajes"), IN(6, "¿cuánto vale?")]);
  assert.equal(t.de, "MAGILUS");
  assert.equal(t.motivo, "cliente_escribio");
  assert.equal(t.desde.getTime(), en(5).getTime());
  // El primer mensaje del lead, sin nada nuestro todavía: también.
  assert.equal(turno([IN(0, "Hola")]).de, "MAGILUS");
  // Nunca escribió.
  assert.equal(turno([BOT(0, "Hola")]).de, "NADIE");
});

prueba("el bot contestó bien y quedó esperando → CLIENTE (sin asesora no es un problema)", () => {
  const t = turno([IN(0, ANUNCIO), BOT(0.2, "Bienvenid@"), BOT(0.3, "¿Qué servicios vas a ofrecer?")]);
  assert.equal(t.de, "CLIENTE");
  assert.equal(t.motivo, "bot_respondio");
  assert.equal(t.desde.getTime(), en(0.3).getTime());
  // Pregunta concreta contestada por el bot.
  assert.equal(turno([IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos a Pereira?"), BOT(5.2, "Sí, enviamos. ¿En qué color?")]).de, "CLIENTE");
  // Los seguimientos automáticos no mueven el "desde" (el descarte cuenta desde la respuesta real).
  const conAuto = turno([IN(0, ANUNCIO), BOT(0.3, "¿Qué servicios?"), AUTO(60, "¿Sigues ahí?"), AUTO(600, "¿Te ayudo?")]);
  assert.equal(conAuto.de, "CLIENTE");
  assert.equal(conAuto.desde.getTime(), en(0.3).getTime());
});

prueba("la asesora contestó → CLIENTE; el celular en el primer minuto (saludo automático) no es persona", () => {
  const t = turno([IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿y el envío?"), ASESORA(9, "Hola, el envío a Cali es gratis")]);
  assert.equal(t.de, "CLIENTE");
  assert.equal(t.motivo, "persona_respondio");
  assert.equal(t.ultimaPersonaEn.getTime(), en(9).getTime());
  const saludo = turno([IN(0, "Lo quiero, ¿cómo lo separo?"), CELULAR(0.5, "Gracias por escribir a Magilus")]);
  assert.equal(saludo.de, "MAGILUS", "el saludo del celular no atiende una intención fuerte");
  assert.equal(turno([IN(0, "Lo quiero, ¿cómo lo separo?"), CELULAR(3, "Hola, te paso los datos")]).de, "CLIENTE");
});

prueba("despedidas, gracias, emojis y auto-respuestas NO le pasan el turno a Magilus", () => {
  const base = [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿hacen envíos?"), ASESORA(9, "Sí, a todo el país")];
  for (const cierre of ["Muchas gracias", "feliz noche", "👍🙏", "Ah, bueno, visto, muy bien, muchas gracias.", "Gracias por comunicarte con Spa Luna, te responderemos pronto"]) {
    const t = turno([...base, IN(20, cierre)]);
    assert.equal(t.de, "CLIENTE", cierre);
  }
  // Lo que SÍ pasa el turno: un "?" suelto, "listo", "sí", "Muchas gracias, ¿y el envío?", una foto, un audio.
  for (const [texto, tipo] of [["?", "TEXT"], ["listo", "TEXT"], ["sí", "TEXT"], ["Muchas gracias, ¿y el envío?", "TEXT"], ["", "IMAGE"], ["", "AUDIO"]]) {
    assert.equal(turno([...base, IN(20, texto, tipo)]).de, "MAGILUS", `${tipo}:${texto}`);
  }
  // Un audio transcrito que es solo "gracias" es un cierre.
  assert.equal(turno([...base, IN(20, "muchas gracias", "AUDIO")]).de, "CLIENTE");
  // Si solo dijo "gracias" y nada más en toda la charla, no le toca a nadie de Magilus.
  assert.equal(turno([IN(0, "gracias")]).motivo, "solo_cierre");
});

prueba("el bot PASÓ el chat a una persona → MAGILUS hasta que una persona escriba", () => {
  const frase = [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "Ya tengo camilla me falta la silla"), BOT(5.3, "¡Perfecto! 🛒 En un momento una asesora te escribe para confirmarte el envío y finalizar tu compra.")];
  const t = turno(frase);
  assert.equal(t.de, "MAGILUS");
  assert.equal(t.motivo, "bot_paso_a_asesora");
  assert.equal(t.desde.getTime(), en(5.3).getTime());
  // La nota del sistema basta.
  assert.equal(turno([IN(0, "quiero hablar con alguien"), BOT(0.2, "Claro"), NOTA(0.3, "El agente pide un asesor: el cliente pide una persona")]).motivo, "bot_paso_a_asesora");
  // "Agente V3: Ganó …" u otras notas no son un pase.
  assert.equal(turno([IN(0, ANUNCIO), BOT(0.2, "fotos"), NOTA(0.3, 'Agente V3: Ganó "Red del paso" porque…')]).de, "CLIENTE");
  // La asesora escribe → ya no.
  assert.equal(turno([...frase, ASESORA(30, "Hola, soy María. ¿Te la enviamos a Cali?")]).de, "CLIENTE");
  // Si la persona habló ANTES del pase, el pase sigue pendiente.
  assert.equal(turno([IN(0, "hola"), ASESORA(1, "Hola"), IN(5, "otra cosa"), BOT(5.2, "Una asesora te escribe en un momento")]).motivo, "bot_paso_a_asesora");
});

prueba("intención FUERTE sin ninguna persona después → MAGILUS aunque el bot haya contestado", () => {
  const mensajes = [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "Lo quiero, ¿cómo hago para separarlo?"), BOT(5.2, "Se separa con el 50 %. ¿En qué ciudad estás?")];
  const t = turno(mensajes);
  assert.equal(t.de, "MAGILUS");
  assert.equal(t.motivo, "intencion_fuerte");
  assert.ok(t.frase);
  assert.equal(turno([IN(0, "ya pagué, te mando el comprobante"), BOT(0.2, "¡Gracias!")]).motivo, "intencion_fuerte");
  // Con una persona después de la señal: ya fue atendida.
  assert.equal(turno([...mensajes, ASESORA(20, "Hola, te paso la cuenta")]).de, "CLIENTE");
  // Una señal media (precio, fotos, envío) contestada por el bot: turno del cliente.
  assert.equal(turno([IN(0, "¿cuánto vale?"), BOT(0.3, "El combo vale $989.000. ¿Te comparto fotos?")]).de, "CLIENTE");
});

prueba("casos reales de la simulación del 12-10: frases de pase, bot que no entendió, promesa y color elegido", () => {
  // cvbe3c2497 / cv7b681f07 / cv20746cfe: "En un momento una de nuestras asesoras te contacta 🙌".
  assert.equal(turno([IN(0, "Holaa reina como está ??"), BOT(0.2, "En un momento una de nuestras asesoras te contacta 🙌")]).motivo, "bot_paso_a_asesora");
  // cva3fbd05f: "Este color me llama la atención" + "Costo?" y el bot cae en la red del paso.
  const red = turno([
    BOT(0, "¿En qué color lo quieres?😊"),
    IN(1, "Este color me llama la atención"),
    IN(1.1, "Costo?"),
    BOT(1.2, "Te leo 🙌 ¿Qué te gustaría saber del combo: precio, materiales, garantía o envío?"),
    NOTA(1.2, 'Agente V3: Ganó "Red del paso OBJECIONES: no se entendió, ofrecer los datos clave" porque no había ninguna regla'),
  ]);
  assert.equal(red.de, "MAGILUS");
  assert.equal(red.motivo, "bot_no_entendio");
  assert.equal(red.desde.getTime(), en(1.1).getTime());
  // La red que ya quedó atrás (el cliente contestó y el bot respondió bien) no cuenta.
  const atras = turno([IN(0, "hola"), BOT(0.1, "¿Qué servicios?"), NOTA(0.1, 'Agente V3: Ganó "Red del paso PRESENTACIÓN: no se entendió" porque…'), IN(2, "masajes"), BOT(2.1, "¡Perfecto! ¿Te comparto las fotos?")]);
  assert.equal(atras.de, "CLIENTE");
  // cvde4da5c7: "espera pregunto al muchacho de la transportadora" + "Mil gracias 🙏".
  const promesa = turno([IN(0, "¿cuánto vale el transporte a Tenjo?"), ASESORA(6, "👩🏻‍💻*Ingrid Sanchez* espera pregunto al muchacho de la transportadora"), IN(7, "Mil gracias 🙏")]);
  assert.equal(promesa.de, "MAGILUS");
  assert.equal(promesa.motivo, "promesa_pendiente");
  assert.equal(turno([IN(0, "¿cuánto vale el transporte?"), ASESORA(6, "espera pregunto"), ASESORA(90, "Reina, allá cobran 100 mil el envío"), IN(91, "Vale mil gracias")]).de, "CLIENTE");
  // cv80897d20: "Color negro" → eligió color: intención fuerte hasta que escriba una persona.
  const color = turno([BOT(0, "¿En qué color lo quieres?😊"), IN(1, "Color negro"), BOT(1.2, "El Combo Camillas está en $989.000. ¿En qué ciudad estás?")]);
  assert.equal(color.motivo, "intencion_fuerte");
  // "¿la tienen en negro?" no es elegir.
  assert.equal(turno([IN(1, "¿la tienen en negro?"), BOT(1.2, "Sí, en negro, blanco y rosado")]).de, "CLIENTE");
});

prueba("`ahora` corta el futuro (la simulación no mira mensajes posteriores)", () => {
  const mensajes = [IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "¿envían a Cali?"), BOT(5.2, "Sí")];
  assert.equal(turno(mensajes, 5.1).de, "MAGILUS");
  assert.equal(turno(mensajes, 6).de, "CLIENTE");
});

/* ------------------------------------------------------------------------------------------------
   El Supervisor con el turno calculado
------------------------------------------------------------------------------------------------ */

const AHORA = en(90);
function chat(parcial) {
  return {
    conversationId: "cv1",
    asesoraId: "ingrid",
    asesoraNombre: "Ingrid",
    etapa: "NUEVO",
    ultimoClienteEn: en(5),
    ultimaRespuestaHumanaEn: null,
    textosPendientes: ["Lo quiero, ¿cómo hago para separarlo?"],
    telefono: "573001112233",
    asignadaEn: en(1),
    ...parcial,
  };
}

prueba("Supervisor: sin el turno, la regla de antes; con turno del CLIENTE, no espera (ni caliente, ni asignado, ni sin dueña)", () => {
  const sinTurno = chat({ textosPendientes: ["¿hacen envíos a Pereira?"], etapa: "NEGOCIACION" });
  assert.equal(at.estadoDeEspera(sinTurno, AHORA).esperando, true, "regla de antes: nadie humano respondió");
  const delCliente = { ...sinTurno, turno: turno([IN(5, "¿hacen envíos a Pereira?"), BOT(5.2, "Sí, enviamos")]) };
  assert.equal(at.estadoDeEspera(delCliente, AHORA).esperando, false);
  assert.equal(at.detectarAtencion([delCliente], AHORA).length, 0);
  assert.equal(at.detectarAtencion([{ ...delCliente, asesoraId: null }], AHORA).length, 0, "sin asesora por sí solo no es un problema");
  assert.equal(ex.motivoDeExclusion({ etapa: "NUEVO", turno: delCliente.turno }, AHORA), "ya_respondio");
});

prueba("Supervisor: con turno de MAGILUS por intención fuerte sí avisa (y cuenta desde la señal)", () => {
  const c = chat({ turno: turno([IN(0, ANUNCIO), BOT(0.2, "fotos"), IN(5, "Lo quiero, ¿cómo hago para separarlo?"), BOT(5.2, "Se separa con el 50 %")]) });
  const e = at.estadoDeEspera(c, AHORA);
  assert.equal(e.esperando, true);
  assert.equal(e.minutos, 85);
  const claves = at.detectarAtencion([c], AHORA).map((h) => h.clave);
  assert.ok(claves.includes("ATENCION:caliente-esperando:ingrid"), claves.join(","));
  assert.equal(ex.motivoDeExclusion({ etapa: "NUEVO", turno: c.turno }, AHORA), null);
});

prueba("Supervisor: 'asignado sin respuesta' solo si le toca a Magilus", () => {
  const interesado = { textosPendientes: ["Sirve para pestañas?", "Fotos"], textosDelCliente: [ANUNCIO, "Sirve para pestañas?", "Fotos"] };
  const conBot = chat({ ...interesado, turno: turno([IN(0, ANUNCIO), IN(1, "Sirve para pestañas?"), IN(2, "Fotos"), BOT(2.3, "Te comparto las fotos. ¿En qué color lo quieres?")]) });
  assert.equal(at.detectarAsignadoSinRespuesta([conBot], AHORA).length, 0);
  const sinRespuesta = chat({ ...interesado, turno: turno([IN(0, ANUNCIO), IN(1, "Sirve para pestañas?"), IN(2, "Fotos")]) });
  assert.equal(at.detectarAsignadoSinRespuesta([sinRespuesta], AHORA).length, 1);
});

prueba("'Ya pagué' sin persona sigue siendo CRÍTICO aunque el bot conteste", () => {
  const c = chat({ textosPendientes: ["ya pagué, te mando el comprobante"], ultimoClienteEn: en(5), turno: turno([IN(5, "ya pagué, te mando el comprobante"), BOT(5.2, "¡Gracias!")]) });
  assert.equal(gr.detectarPagoSinRespuesta([c], AHORA, 30).length, 1);
  const atendido = { ...c, turno: turno([IN(5, "ya pagué, te mando el comprobante"), BOT(5.2, "¡Gracias!"), ASESORA(20, "Recibido, gracias")]) };
  assert.equal(gr.detectarPagoSinRespuesta([atendido], AHORA, 30).length, 0);
});

prueba("Accionable: una acción abierta deja de aplicar si el turno pasó al cliente (sin segundo aviso ni escalada)", () => {
  const sup = { id: "ingrid", nombre: "Ingrid" };
  const config = { ...acc.CONFIG_ACCIONABLE_POR_DEFECTO, activo: true };
  const esperando = chat({ etapa: "NEGOCIACION", textosPendientes: ["¿me lo envían a Cali?"], turno: turno([IN(5, "¿me lo envían a Cali?")]) });
  const t1 = en(25);
  const hallazgos = at.detectarAtencion([esperando], t1);
  const candidatas = acc.candidatasDeLaVuelta({ hallazgos, chats: [esperando], ahora: t1, supervisora: sup, extras: new Map() });
  assert.ok(candidatas.length >= 1);
  const r1 = acc.avanzar({ estado: acc.estadoVacio(), candidatas, chats: [esperando], atendidas: {}, ahora: t1, config, supervisora: sup });
  const id = Object.keys(r1.estado.acciones)[0];
  assert.equal(r1.estado.acciones[id].estado, "AVISADA");
  // El bot le contestó (bien) y quedó esperando al cliente.
  const contestado = { ...esperando, turno: turno([IN(5, "¿me lo envían a Cali?"), BOT(26, "¡Sí! El envío a Cali es gratis. ¿En qué color lo quieres?")]) };
  const r2 = acc.avanzar({ estado: r1.estado, candidatas: [], chats: [contestado], atendidas: {}, ahora: en(80), config, supervisora: sup });
  assert.equal(r2.estado.acciones[id].estado, "YA_NO_APLICA");
  assert.ok(!r2.eventos.some((e) => e.tipo === "escalar" || e.tipo === "segundo_aviso"));
});

console.log(`\n${pruebas} pruebas del turno OK`);

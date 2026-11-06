// Pruebas de la marca "Sin responder". Correr: npm run test:sin-responder
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  colorSinResponder,
  marcaSinResponder,
  minutosSinResponder,
  siguienteSinResponderDesde,
  textoSinResponder,
} from "./sin-responder";
import {
  areConversationListItemsEqual,
  buildConversationItemFromListSnapshot,
  buildConversationItemFromSnapshot,
  mergeConversationListItem,
} from "../../../components/chats/chat-inbox-conversation-utils";
import type {
  LiveConversationListSnapshot,
  LiveConversationSnapshot,
  SharedInboxConversationItem,
} from "../../../components/chats/chat-inbox-types";

const AHORA = new Date("2026-11-06T15:00:00.000Z");
const haceMinutos = (min: number, extraMs = 0) => new Date(AHORA.getTime() - min * 60_000 - extraMs);

test("los minutos son enteros y nunca negativos", () => {
  assert.equal(minutosSinResponder(haceMinutos(15, 59_000), AHORA), 15);
  assert.equal(minutosSinResponder(haceMinutos(0, 30_000), AHORA), 0);
  assert.equal(minutosSinResponder(new Date(AHORA.getTime() + 120_000), AHORA), 0);
  assert.equal(minutosSinResponder(haceMinutos(3).toISOString(), AHORA), 3);
  assert.equal(minutosSinResponder(null, AHORA), null);
  assert.equal(minutosSinResponder("no-es-fecha", AHORA), null);
});

test("15 min es amarillo y 16 min es rojo", () => {
  assert.equal(colorSinResponder(0), "amarillo");
  assert.equal(colorSinResponder(15), "amarillo");
  assert.equal(colorSinResponder(16), "rojo");
  assert.deepEqual(marcaSinResponder({ desde: haceMinutos(15), resuelto: false, ahora: AHORA }), {
    minutos: 15,
    texto: "Sin responder · 15 min",
    color: "amarillo",
  });
  assert.deepEqual(marcaSinResponder({ desde: haceMinutos(16), resuelto: false, ahora: AHORA }), {
    minutos: 16,
    texto: "Sin responder · 16 min",
    color: "rojo",
  });
});

test("59 min sigue en minutos y 60 min da 1 h", () => {
  assert.equal(textoSinResponder(59), "Sin responder · 59 min");
  assert.equal(textoSinResponder(60), "Sin responder · 1 h");
  assert.equal(textoSinResponder(119), "Sin responder · 1 h");
  assert.equal(textoSinResponder(120), "Sin responder · 2 h");
});

test("23 h 59 min sigue en horas y 24 h da 1 d", () => {
  assert.equal(textoSinResponder(24 * 60 - 1), "Sin responder · 23 h");
  assert.equal(textoSinResponder(24 * 60), "Sin responder · 1 d");
  assert.equal(textoSinResponder(3 * 24 * 60 + 5), "Sin responder · 3 d");
});

test("un chat resuelto o ya respondido no lleva marca", () => {
  assert.equal(marcaSinResponder({ desde: haceMinutos(40), resuelto: true, ahora: AHORA }), null);
  assert.equal(marcaSinResponder({ desde: null, resuelto: false, ahora: AHORA }), null);
});

test("siguienteSinResponderDesde: una saliente valida (asesora o bot) quita la marca", () => {
  const desde = haceMinutos(30);
  for (const status of ["SENT", "DELIVERED", "READ", "QUEUED", null]) {
    assert.equal(
      siguienteSinResponderDesde(desde, { direccion: "OUTBOUND", tipo: "TEXT", status, fecha: AHORA }),
      null,
    );
  }
  assert.equal(siguienteSinResponderDesde(null, { direccion: "OUTBOUND", tipo: "TEMPLATE", status: "SENT", fecha: AHORA }), null);
});

test("siguienteSinResponderDesde: una entrante empieza el reloj o lo deja en el primer mensaje", () => {
  const primero = haceMinutos(30);
  assert.equal(
    siguienteSinResponderDesde(null, { direccion: "INBOUND", tipo: "TEXT", status: "RECEIVED", fecha: AHORA }),
    AHORA,
  );
  assert.equal(
    siguienteSinResponderDesde(primero, { direccion: "INBOUND", tipo: "AUDIO", status: "RECEIVED", fecha: AHORA }),
    primero,
  );
});

test("siguienteSinResponderDesde: SYSTEM o FAILED no cambian nada", () => {
  const desde = haceMinutos(30);
  for (const actual of [desde, null]) {
    // Nota interna o de actividad (saliente SYSTEM) y llamada (SYSTEM en cualquier sentido).
    assert.equal(siguienteSinResponderDesde(actual, { direccion: "OUTBOUND", tipo: "SYSTEM", status: "SENT", fecha: AHORA }), actual);
    assert.equal(siguienteSinResponderDesde(actual, { direccion: "INBOUND", tipo: "SYSTEM", status: "RECEIVED", fecha: AHORA }), actual);
    // Saliente que fallo: no le llego al cliente.
    assert.equal(siguienteSinResponderDesde(actual, { direccion: "OUTBOUND", tipo: "TEXT", status: "FAILED", fecha: AHORA }), actual);
  }
});

/* ------------------------------------------------------------------------------------------------
   Mezcla en la bandeja (parte 3): como se mueve la marca con los avisos en vivo, el chat abierto
   y los refrescos del servidor. Se recorre el mismo camino que handleListUpdate de shared-inbox:
   buildConversationItemFromListSnapshot y despues mergeConversationListItem.
------------------------------------------------------------------------------------------------ */

const ESPERA_DESDE = haceMinutos(20);

const filaEsperando: SharedInboxConversationItem = {
  id: "agent:c1",
  source: "agent",
  label: "Cliente",
  secondaryLabel: "573000000000",
  incomingCount: 2,
  lastMessage: "Hola, precio?",
  lastMessageType: "TEXT",
  lastMessageDirection: "INBOUND",
  lastMessageStatus: "RECEIVED",
  lastMessageAt: haceMinutos(5),
  sinResponderDesde: ESPERA_DESDE,
  href: "/cliente/chats?chatKey=agent:c1",
};

function avisoEnVivo(
  existing: SharedInboxConversationItem,
  snapshot: Partial<LiveConversationListSnapshot>,
): SharedInboxConversationItem {
  const base = buildConversationItemFromListSnapshot(
    { id: existing.id, lastMessageAt: null, ...snapshot } as LiveConversationListSnapshot,
    existing,
  );
  return mergeConversationListItem(base, existing);
}

test("mezcla: una actualizacion sin el dato ni el mensaje no borra la marca", () => {
  // Por ejemplo, un cambio de etiquetas o de etapa: no trae direccion ni sinResponderDesde.
  const fila = avisoEnVivo(filaEsperando, { tags: [{ label: "VIP", color: "#CAECFA" }], lastMessageAt: haceMinutos(5) });
  assert.equal(fila.sinResponderDesde, ESPERA_DESDE);
});

test("mezcla: una saliente la quita (los dos envios propios de shared-inbox)", () => {
  // El texto del compositor (optimisticListSnapshot).
  const trasTexto = avisoEnVivo(filaEsperando, {
    incomingCount: 0,
    lastMessage: "Hola! Cuesta 50.000",
    lastMessageType: "TEXT",
    lastMessageDirection: "OUTBOUND",
    lastMessageAt: AHORA,
  });
  assert.equal(trasTexto.sinResponderDesde, null);
  assert.equal(areConversationListItemsEqual(trasTexto, filaEsperando), false, "el cambio se tiene que ver");
  // Foto, nota de voz, ubicacion... (handleEnvioTerminado).
  const trasFoto = avisoEnVivo(filaEsperando, {
    incomingCount: 0,
    lastMessage: null,
    lastMessageType: "IMAGE",
    lastMessageDirection: "OUTBOUND",
    lastMessageAt: AHORA,
  });
  assert.equal(trasFoto.sinResponderDesde, null);
});

test("mezcla: el dato del servidor manda, tambien cuando es null (no se usa ??)", () => {
  const contestado = avisoEnVivo(filaEsperando, {
    lastMessageDirection: "INBOUND",
    lastMessageType: "TEXT",
    lastMessageAt: AHORA,
    sinResponderDesde: null,
  });
  assert.equal(contestado.sinResponderDesde, null);
  const conTexto = avisoEnVivo({ ...filaEsperando, sinResponderDesde: null }, {
    lastMessageDirection: "INBOUND",
    lastMessageAt: AHORA,
    sinResponderDesde: ESPERA_DESDE.toISOString(),
  });
  assert.equal(conTexto.sinResponderDesde, ESPERA_DESDE.toISOString());
});

test("mezcla: una nota SYSTEM no la quita", () => {
  const fila = avisoEnVivo(filaEsperando, {
    lastMessage: "Nota interna",
    lastMessageType: "SYSTEM",
    lastMessageDirection: "OUTBOUND",
    lastMessageStatus: "SENT",
    lastMessageAt: AHORA,
  });
  assert.equal(fila.sinResponderDesde, ESPERA_DESDE);
});

test("mezcla: un entrante nuevo mantiene la fecha inicial (no reinicia el reloj)", () => {
  const fila = avisoEnVivo(filaEsperando, {
    lastMessage: "Sigo esperando",
    lastMessageType: "TEXT",
    lastMessageDirection: "INBOUND",
    lastMessageAt: AHORA,
    incomingCount: 3,
  });
  assert.equal(fila.sinResponderDesde, ESPERA_DESDE);
  // Y si ya estaba contestado, el entrante empieza el reloj en su propia fecha.
  const nueva = avisoEnVivo({ ...filaEsperando, sinResponderDesde: null }, {
    lastMessageType: "TEXT",
    lastMessageDirection: "INBOUND",
    lastMessageAt: AHORA,
  });
  assert.equal(nueva.sinResponderDesde, AHORA);
});

test("mezcla: la fila del chat abierto borra el verde pero conserva la marca", () => {
  const chatAbierto = {
    id: "agent:c1",
    label: "Cliente",
    secondaryLabel: "573000000000",
    messages: [
      { id: "m1", content: "Hola, precio?", direction: "INBOUND", type: "TEXT", createdAt: haceMinutos(5) },
      {
        id: "m2",
        content: "Fulana tomo esta conversacion",
        direction: "OUTBOUND",
        type: "SYSTEM",
        rawPayload: { source: "activity" },
        createdAt: haceMinutos(1),
      },
    ],
  } as unknown as LiveConversationSnapshot;
  const fila = buildConversationItemFromSnapshot(chatAbierto, filaEsperando);
  assert.equal(fila.incomingCount, 0);
  assert.equal(fila.sinResponderDesde, ESPERA_DESDE);

  // Con la respuesta ya cargada en el chat abierto, la marca se va.
  const contestado = buildConversationItemFromSnapshot(
    {
      ...chatAbierto,
      messages: [
        ...chatAbierto.messages,
        { id: "m3", content: "Cuesta 50.000", direction: "OUTBOUND", type: "TEXT", outboundStatusLabel: "SENT", createdAt: AHORA },
      ],
    } as unknown as LiveConversationSnapshot,
    filaEsperando,
  );
  assert.equal(contestado.sinResponderDesde, null);

  // Una burbuja propia que fallo ("error") no cuenta como respuesta.
  const fallida = buildConversationItemFromSnapshot(
    {
      ...chatAbierto,
      messages: [
        ...chatAbierto.messages,
        { id: "m4", content: "Cuesta 50.000", direction: "OUTBOUND", type: "TEXT", outboundStatusLabel: "error", createdAt: AHORA },
      ],
    } as unknown as LiveConversationSnapshot,
    filaEsperando,
  );
  assert.equal(fallida.sinResponderDesde, ESPERA_DESDE);
});

test("mezcla: tras un envio fallido, el refresco del servidor la devuelve", () => {
  // El envio propio quita la marca al instante (aviso local, con la hora del envio).
  const trasEnviar = avisoEnVivo(filaEsperando, {
    lastMessage: "Cuesta 50.000",
    lastMessageType: "TEXT",
    lastMessageDirection: "OUTBOUND",
    lastMessageAt: AHORA,
    incomingCount: 0,
  });
  assert.equal(trasEnviar.sinResponderDesde, null);

  // El envio fallo: el servidor sigue con el entrante como ultimo mensaje y la marca puesta. Esa
  // fila es MAS VIEJA que la que tiene la bandeja, pero su sinResponderDesde manda igual.
  const delServidor: SharedInboxConversationItem = { ...filaEsperando, incomingCount: 0 };
  const refrescada = mergeConversationListItem(delServidor, trasEnviar);
  assert.equal(refrescada.sinResponderDesde, ESPERA_DESDE);
  assert.equal(refrescada.lastMessageDirection, "OUTBOUND", "el resto de la fila mas nueva se conserva");

  // Una fila del servidor sin el dato (undefined) no borra lo que ya habia.
  const sinDato = mergeConversationListItem({ ...delServidor, sinResponderDesde: undefined }, filaEsperando);
  assert.equal(sinDato.sinResponderDesde, ESPERA_DESDE);
});

import { test } from "node:test";
import assert from "node:assert/strict";

import { traducirEventoWaha } from "./waha";
import {
  extractEvolutionLocation,
  extractEvolutionMessageText,
  extractEvolutionMessageType,
} from "./evolution-webhook";

/*
  Las ubicaciones y las tarjetas de contacto que llegan por WAHA tienen que entrar al chat.

  Antes se descartaban como "mensaje sin texto ni media" y la asesora no veia nada. Ademas se
  comprueba que texto, foto, pedido y anuncio salen exactamente igual que antes del cambio: es la
  puerta por la que entran todos los mensajes de venta.
*/

function evento(payload: Record<string, unknown>) {
  return {
    event: "message.any",
    session: "linea_ventas",
    payload: {
      id: "false_573001112233@c.us_ABC123",
      timestamp: 1762300000,
      from: "573001112233@c.us",
      fromMe: false,
      source: "app",
      hasMedia: false,
      ...payload,
    },
  };
}

function mensajeDe(resultado: ReturnType<typeof traducirEventoWaha>) {
  assert.equal(resultado.motivo, undefined, `se descarto: ${resultado.motivo}`);
  const data = (resultado.evolution as { data: { message: Record<string, unknown> } }).data;
  return data.message;
}

const VCARD_JUAN = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Pérez;Juan;;;",
  "FN:Juan Pérez",
  "item1.TEL;waid=573104445566:+57 310 4445566",
  "item1.X-ABLabel:Móvil",
  "END:VCARD",
].join("\n");

const VCARD_ANA = "BEGIN:VCARD\r\nVERSION:3.0\r\nFN:Ana Gómez\r\nTEL;type=CELL:+57 300 9998877\r\nEND:VCARD";

test("ubicacion fija en _data.Message.locationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      // En algunos motores el body es la miniatura: no tiene que salir como texto.
      body: "/9j/4AAQSkZJRgABAQAAAQ",
      _data: {
        Message: {
          locationMessage: {
            degreesLatitude: 4.6097,
            degreesLongitude: -74.0817,
            name: "Magilus",
            address: "Carrera 27 # 10-20, Bogotá",
            JPEGThumbnail: "/9j/4AAQSkZJRgABAQAAAQ",
          },
        },
      },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, {
    locationMessage: {
      degreesLatitude: 4.6097,
      degreesLongitude: -74.0817,
      name: "Magilus",
      address: "Carrera 27 # 10-20, Bogotá",
    },
  });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(resultado.evolution), {
    latitude: 4.6097,
    longitude: -74.0817,
    name: "Magilus",
    address: "Carrera 27 # 10-20, Bogotá",
  });
  assert.equal(extractEvolutionMessageText(resultado.evolution), "Magilus · Carrera 27 # 10-20, Bogotá");
  assert.equal(resultado.media, undefined);
  assert.equal(resultado.mediaFaltante, undefined);
});

test("ubicacion con los nombres de whatsmeow (mayuscula) y una miniatura marcada como archivo", () => {
  const resultado = traducirEventoWaha(
    evento({
      hasMedia: true,
      _data: { Message: { LocationMessage: { DegreesLatitude: "6.2442", DegreesLongitude: "-75.5812" } } },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, { locationMessage: { degreesLatitude: 6.2442, degreesLongitude: -75.5812 } });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(resultado.evolution), {
    latitude: 6.2442,
    longitude: -75.5812,
    name: null,
    address: null,
  });
  assert.equal(extractEvolutionMessageText(resultado.evolution), "6.2442, -75.5812");
  assert.equal(resultado.media, undefined);
  assert.equal(resultado.mediaFaltante, undefined);
});

test("ubicacion en tiempo real sale como liveLocationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          liveLocationMessage: {
            degreesLatitude: 3.4516,
            degreesLongitude: -76.532,
            sequenceNumber: 1,
          },
        },
      },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, { liveLocationMessage: { degreesLatitude: 3.4516, degreesLongitude: -76.532 } });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "LOCATION");
  const ubicacion = extractEvolutionLocation(resultado.evolution);
  assert.equal(ubicacion?.latitude, 3.4516);
  assert.equal(ubicacion?.longitude, -76.532);
});

test("ubicacion que solo trae el campo location de WAHA sale como locationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      location: { latitude: "10.391", longitude: "-75.4794", name: "Casa", address: "Cartagena" },
      _data: { Message: {} },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, {
    locationMessage: { degreesLatitude: 10.391, degreesLongitude: -75.4794, name: "Casa", address: "Cartagena" },
  });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(resultado.evolution), {
    latitude: 10.391,
    longitude: -75.4794,
    name: "Casa",
    address: "Cartagena",
  });
});

test("ubicacion que manda la asesora desde el celular conserva fromMe, source y la cita", () => {
  const cita = { stanzaId: "XYZ", quotedMessage: { conversation: "¿me manda su ubicación?" } };
  const resultado = traducirEventoWaha(
    evento({
      fromMe: true,
      source: "app",
      _data: {
        Message: {
          locationMessage: { degreesLatitude: 4.7, degreesLongitude: -74.05, contextInfo: cita },
        },
      },
    }),
  );
  const data = (resultado.evolution as { data: Record<string, unknown> }).data;
  assert.equal((data.key as { fromMe: boolean }).fromMe, true);
  assert.equal(data.wahaSource, "app");
  assert.deepEqual(data.message, {
    locationMessage: { degreesLatitude: 4.7, degreesLongitude: -74.05, contextInfo: cita },
  });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "LOCATION");
});

test("coordenadas fuera de rango no se toman como ubicacion", () => {
  const resultado = traducirEventoWaha(
    evento({ _data: { Message: { locationMessage: { degreesLatitude: 200, degreesLongitude: 500 } } } }),
  );
  assert.match(resultado.motivo ?? "", /mensaje sin texto ni media \(locationMessage\)/);
});

test("un contacto sale como texto con nombre y telefono", () => {
  const resultado = traducirEventoWaha(
    evento({
      // En algunos motores el body es la vCard cruda: no tiene que salir tal cual.
      body: VCARD_JUAN,
      _data: { Message: { contactMessage: { displayName: "Juan", vcard: VCARD_JUAN } } },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, { conversation: "👤 Contacto: Juan Pérez · +57 310 4445566" });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "TEXT");
  assert.ok(String(mensaje.conversation).startsWith("👤 Contacto:"));
});

test("varios contactos salen una linea por cada uno", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          contactsArrayMessage: {
            displayName: "2 contactos",
            contacts: [
              { displayName: "Juan", vcard: VCARD_JUAN },
              { displayName: "Ana", vcard: VCARD_ANA },
            ],
          },
        },
      },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, {
    conversation: "👤 Contacto: Juan Pérez · +57 310 4445566\n👤 Contacto: Ana Gómez · +57 300 9998877",
  });
});

test("contacto que solo trae el campo vCards de WAHA", () => {
  const resultado = traducirEventoWaha(evento({ vCards: [VCARD_ANA], _data: { Message: {} } }));
  assert.deepEqual(mensajeDe(resultado), { conversation: "👤 Contacto: Ana Gómez · +57 300 9998877" });
});

/*
  Lo que ya funcionaba tiene que salir IGUAL. Cada resultado esperado es el que daba el codigo
  antes de este cambio.
*/

test("un texto sale igual que antes", () => {
  const resultado = traducirEventoWaha(
    evento({ body: "Hola, ¿tienen envío?", _data: { notifyName: "Laura", Message: { conversation: "Hola" } } }),
  );
  assert.deepEqual(resultado, {
    evolution: {
      event: "messages.upsert",
      instance: "linea_ventas",
      data: {
        wahaSource: "app",
        key: { remoteJid: "573001112233@s.whatsapp.net", fromMe: false, id: "false_573001112233@c.us_ABC123" },
        message: { conversation: "Hola, ¿tienen envío?" },
        pushName: "Laura",
        messageTimestamp: 1762300000,
      },
    },
  });
});

test("una foto con URL sale igual que antes", () => {
  const resultado = traducirEventoWaha(
    evento({
      body: "esta",
      hasMedia: true,
      media: { url: "http://waha:3000/api/files/foto.jpg", mimetype: "image/jpeg" },
      _data: { Message: { imageMessage: { caption: "esta" } } },
    }),
  );
  assert.deepEqual(resultado, {
    evolution: {
      event: "messages.upsert",
      instance: "linea_ventas",
      data: {
        wahaSource: "app",
        key: { remoteJid: "573001112233@s.whatsapp.net", fromMe: false, id: "false_573001112233@c.us_ABC123" },
        message: {
          imageMessage: { url: "http://waha:3000/api/files/foto.jpg", mimetype: "image/jpeg", caption: "esta" },
        },
        pushName: null,
        messageTimestamp: 1762300000,
      },
    },
    media: { url: "http://waha:3000/api/files/foto.jpg", mimetype: "image/jpeg" },
  });
});

test("un pedido del catalogo sale igual que antes", () => {
  const resultado = traducirEventoWaha(
    evento({
      body: "",
      _data: { Message: { orderMessage: { itemCount: 3, totalAmount1000: 150000000, totalCurrencyCode: "COP" } } },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    conversation:
      "🛒 *Pedido desde el catálogo*\n3 artículos\nTotal: 150.000 COP\n_El detalle de los artículos se ve en WhatsApp._",
  });
});

test("una tarjeta de anuncio sale igual que antes", () => {
  const contextInfo = { externalAdReply: { title: "Somos Magilus", sourceUrl: "https://fb.me/abc" } };
  const resultado = traducirEventoWaha(
    evento({
      body: "",
      _data: { Message: { interactiveMessage: { body: { text: "Hola, quiero más información" }, contextInfo } } },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    extendedTextMessage: { text: "Hola, quiero más información", contextInfo },
  });
});

test("un mensaje sin nada que leer se sigue descartando con sus bloques", () => {
  const resultado = traducirEventoWaha(evento({ body: "", _data: { Message: { pollCreationMessage: {} } } }));
  assert.equal(resultado.motivo, "mensaje sin texto ni media (pollCreationMessage)");
});

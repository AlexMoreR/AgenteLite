// Pruebas de la traduccion de ubicaciones y contactos de WAHA. Correr: npm run test:waha-ubicacion
import assert from "node:assert/strict";
import { test } from "node:test";

import { extractEvolutionLocation, extractEvolutionMessageType, extractEvolutionMessageText } from "./evolution-webhook";
import { traducirEventoWaha } from "./waha";

const evento = (payload: Record<string, unknown>) => ({
  event: "message.any",
  session: "ventas1",
  payload: {
    id: "false_573001112233@c.us_ABC",
    timestamp: 1760000000,
    from: "573001112233@c.us",
    fromMe: false,
    source: "app",
    body: "",
    hasMedia: false,
    ...payload,
  },
});

const mensajeDe = (resultado: ReturnType<typeof traducirEventoWaha>) => {
  assert.equal(resultado.motivo, undefined, `se descarto: ${resultado.motivo}`);
  const data = (resultado.evolution as { data: Record<string, unknown> }).data;
  return data.message as Record<string, unknown>;
};

test("ubicacion fija de _data.Message.locationMessage sale como locationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          locationMessage: {
            degreesLatitude: 4.6097,
            degreesLongitude: -74.0817,
            name: "Casa",
            address: "Calle 10 # 5-20, Bogotá",
            JPEGThumbnail: "AAAA",
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
      name: "Casa",
      address: "Calle 10 # 5-20, Bogotá",
    },
  });
  assert.equal(resultado.media, undefined);
  assert.equal(resultado.mediaFaltante, undefined);

  // El webhook la reconoce como ubicacion con las mismas coordenadas.
  const evolution = resultado.evolution!;
  assert.deepEqual(extractEvolutionLocation(evolution), {
    latitude: 4.6097,
    longitude: -74.0817,
    name: "Casa",
    address: "Calle 10 # 5-20, Bogotá",
  });
  assert.equal(extractEvolutionMessageType(evolution), "LOCATION");
  assert.equal(extractEvolutionMessageText(evolution), "Casa · Calle 10 # 5-20, Bogotá");
});

test("con mayuscula (whatsmeow) y coordenadas en texto tambien se lee", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: { Message: { LocationMessage: { DegreesLatitude: "6.2442", DegreesLongitude: "-75.5812" } } },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    locationMessage: { degreesLatitude: 6.2442, degreesLongitude: -75.5812 },
  });
  const evolution = resultado.evolution!;
  assert.equal(extractEvolutionMessageType(evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(evolution), {
    latitude: 6.2442,
    longitude: -75.5812,
    name: null,
    address: null,
  });
  assert.equal(extractEvolutionMessageText(evolution), "6.2442, -75.5812");
});

test("ubicacion en tiempo real sale como liveLocationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          liveLocationMessage: { degreesLatitude: 3.4516, degreesLongitude: -76.532, caption: "Voy en camino" },
        },
      },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    liveLocationMessage: { degreesLatitude: 3.4516, degreesLongitude: -76.532, address: "Voy en camino" },
  });
  const evolution = resultado.evolution!;
  assert.equal(extractEvolutionMessageType(evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(evolution), {
    latitude: 3.4516,
    longitude: -76.532,
    name: null,
    address: "Voy en camino",
  });
});

test("una ubicacion que trae solo el campo location de WAHA sale como locationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      location: { latitude: "10.391", longitude: "-75.4794", description: "Cartagena" },
      _data: { Message: {} },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    locationMessage: { degreesLatitude: 10.391, degreesLongitude: -75.4794, address: "Cartagena" },
  });
  const evolution = resultado.evolution!;
  assert.equal(extractEvolutionMessageType(evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(evolution), {
    latitude: 10.391,
    longitude: -75.4794,
    name: null,
    address: "Cartagena",
  });
});

test("una ubicacion con miniatura (hasMedia sin url) no se vuelve archivo perdido", () => {
  const resultado = traducirEventoWaha(
    evento({
      hasMedia: true,
      _data: { Message: { locationMessage: { degreesLatitude: 4.6, degreesLongitude: -74.08 } } },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    locationMessage: { degreesLatitude: 4.6, degreesLongitude: -74.08 },
  });
  assert.equal(resultado.mediaFaltante, undefined);
});

test("coordenadas fuera de rango no son ubicacion y se descartan como antes", () => {
  const resultado = traducirEventoWaha(
    evento({ _data: { Message: { locationMessage: { degreesLatitude: 200, degreesLongitude: 10 } } } }),
  );
  assert.equal(resultado.motivo, "mensaje sin texto ni media (locationMessage)");
});

test("la ubicacion que manda la asesora desde el celular respeta fromMe y source, y conserva la cita", () => {
  const cita = { stanzaId: "XYZ", quotedMessage: { conversation: "¿Dónde queda?" } };
  const resultado = traducirEventoWaha(
    evento({
      id: "true_573001112233@c.us_DEF",
      fromMe: true,
      source: "app",
      _data: {
        Message: {
          locationMessage: { degreesLatitude: 4.65, degreesLongitude: -74.05, name: "Magilus", contextInfo: cita },
        },
      },
    }),
  );
  const data = (resultado.evolution as { data: Record<string, unknown> }).data;
  assert.equal(data.wahaSource, "app");
  assert.deepEqual(data.key, {
    remoteJid: "573001112233@s.whatsapp.net",
    fromMe: true,
    id: "true_573001112233@c.us_DEF",
  });
  assert.deepEqual(data.message, {
    locationMessage: { degreesLatitude: 4.65, degreesLongitude: -74.05, name: "Magilus", contextInfo: cita },
  });
});

const VCARD_JUAN = [
  "BEGIN:VCARD",
  "VERSION:3.0",
  "N:Pérez;Juan;;;",
  "FN:Juan Pérez",
  "item1.TEL;waid=573104445566:+57 310 4445566",
  "item1.X-ABLabel:Celular",
  "END:VCARD",
].join("\n");

const VCARD_ANA = ["BEGIN:VCARD", "VERSION:3.0", "FN:Ana Gómez", "TEL;type=CELL;waid=573205556677:+57 320 5556677", "END:VCARD"].join(
  "\n",
);

test("un contacto sale como texto con el nombre y el telefono", () => {
  const resultado = traducirEventoWaha(
    evento({ _data: { Message: { contactMessage: { displayName: "Juan Pérez", vcard: VCARD_JUAN } } } }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, { conversation: "👤 Contacto: Juan Pérez · +57 310 4445566" });
  assert.ok((mensaje.conversation as string).startsWith("👤 Contacto:"));
  assert.equal(extractEvolutionMessageType(resultado.evolution), "TEXT");
});

test("el contacto le gana a un body con la vCard cruda", () => {
  const resultado = traducirEventoWaha(
    evento({ body: VCARD_JUAN, _data: { Message: { ContactMessage: { DisplayName: "Juan Pérez", Vcard: VCARD_JUAN } } } }),
  );
  assert.deepEqual(mensajeDe(resultado), { conversation: "👤 Contacto: Juan Pérez · +57 310 4445566" });
});

test("varios contactos salen una linea por cada uno", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          contactsArrayMessage: {
            displayName: "2 contactos",
            contacts: [
              { displayName: "Juan Pérez", vcard: VCARD_JUAN },
              { displayName: "Ana Gómez", vcard: VCARD_ANA },
            ],
          },
        },
      },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    conversation: "👤 Contacto: Juan Pérez · +57 310 4445566\n👤 Contacto: Ana Gómez · +57 320 5556677",
  });
});

test("los contactos del campo vCards de WAHA tambien se leen", () => {
  const resultado = traducirEventoWaha(evento({ vCards: [VCARD_JUAN, VCARD_ANA], _data: { Message: {} } }));
  assert.deepEqual(mensajeDe(resultado), {
    conversation: "👤 Contacto: Juan Pérez · +57 310 4445566\n👤 Contacto: Ana Gómez · +57 320 5556677",
  });
});

/*
  Lo que ya funcionaba sale IGUAL. Los resultados esperados se sacaron del waha.ts de antes del
  cambio, con estos mismos eventos.
*/
test("un texto sale igual que antes", () => {
  const resultado = traducirEventoWaha(
    evento({ body: "Hola, ¿tienen camillas?", _data: { notifyName: "Laura", Message: { conversation: "Hola" } } }),
  );
  assert.deepEqual(resultado, {
    evolution: {
      event: "messages.upsert",
      instance: "ventas1",
      data: {
        wahaSource: "app",
        key: { remoteJid: "573001112233@s.whatsapp.net", fromMe: false, id: "false_573001112233@c.us_ABC" },
        message: { conversation: "Hola, ¿tienen camillas?" },
        pushName: "Laura",
        messageTimestamp: 1760000000,
      },
    },
  });
});

test("una foto con URL sale igual que antes", () => {
  const resultado = traducirEventoWaha(
    evento({
      body: "Esta",
      hasMedia: true,
      media: { url: "http://waha:3000/api/files/foto.jpg", mimetype: "image/jpeg" },
      _data: { Message: { imageMessage: { caption: "Esta" } } },
    }),
  );
  assert.deepEqual(resultado, {
    evolution: {
      event: "messages.upsert",
      instance: "ventas1",
      data: {
        wahaSource: "app",
        key: { remoteJid: "573001112233@s.whatsapp.net", fromMe: false, id: "false_573001112233@c.us_ABC" },
        message: {
          imageMessage: { url: "http://waha:3000/api/files/foto.jpg", mimetype: "image/jpeg", caption: "Esta" },
        },
        pushName: null,
        messageTimestamp: 1760000000,
      },
    },
    media: { url: "http://waha:3000/api/files/foto.jpg", mimetype: "image/jpeg" },
  });
});

test("un pedido del catalogo sale igual que antes", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: { Message: { orderMessage: { itemCount: 3, totalAmount1000: 450000000, totalCurrencyCode: "COP" } } },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    conversation:
      "🛒 *Pedido desde el catálogo*\n3 artículos\nTotal: 450.000 COP\n_El detalle de los artículos se ve en WhatsApp._",
  });
});

test("una tarjeta de anuncio sale igual que antes", () => {
  const contexto = { externalAdReply: { title: "Somos Magilus", sourceId: "120" } };
  const resultado = traducirEventoWaha(
    evento({
      _data: { Message: { interactiveMessage: { body: { text: "¡Hola! Quiero más información" }, contextInfo: contexto } } },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    extendedTextMessage: { text: "¡Hola! Quiero más información", contextInfo: contexto },
  });
});

test("un mensaje sin nada que leer se sigue descartando con sus bloques", () => {
  const resultado = traducirEventoWaha(evento({ _data: { Message: { protocolMessage: {} } } }));
  assert.equal(resultado.motivo, "mensaje sin texto ni media (protocolMessage)");
});

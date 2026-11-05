import { test } from "node:test";
import assert from "node:assert/strict";

import { traducirEventoWaha } from "./waha";
import {
  extractEvolutionLocation,
  extractEvolutionMessageType,
} from "./evolution-webhook";

/*
  Las ubicaciones que llegan por WAHA tienen que salir como un mensaje de ubicacion de Evolution
  (locationMessage o liveLocationMessage), que la burbuja ya sabe dibujar como mapa. Antes se
  descartaban como "mensaje sin texto ni media" o quedaban como un archivo que no se pudo bajar.
*/

const base = { event: "message.any", session: "ventas" };

function evento(payload: Record<string, unknown>) {
  return {
    ...base,
    payload: {
      id: "false_573001112233@c.us_UBI1",
      timestamp: 1760000100,
      from: "573001112233@c.us",
      fromMe: false,
      source: "app",
      body: "",
      // WAHA marca la miniatura del mapa como media, pero sin archivo.
      hasMedia: true,
      media: null,
      ...payload,
    },
  };
}

function mensajeDe(
  resultado: ReturnType<typeof traducirEventoWaha>,
): Record<string, unknown> {
  assert.equal(
    resultado.motivo,
    undefined,
    `no debia descartarse: ${resultado.motivo}`,
  );
  const data = (
    resultado.evolution as { data: { message: Record<string, unknown> } }
  ).data;
  return data.message;
}

test("1) _data.Message.locationMessage sale como locationMessage con sus coordenadas", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        notifyName: "Ana",
        Message: {
          locationMessage: {
            DegreesLatitude: 6.2442,
            DegreesLongitude: -75.5812,
            Name: "Magilus",
            Address: "Carrera 27 # 10-20, Medellín",
            JPEGThumbnail: "miniatura-en-base64",
          },
        },
      },
    }),
  );
  const mensaje = mensajeDe(resultado);
  assert.deepEqual(mensaje, {
    locationMessage: {
      degreesLatitude: 6.2442,
      degreesLongitude: -75.5812,
      name: "Magilus",
      address: "Carrera 27 # 10-20, Medellín",
    },
  });
  assert.equal(resultado.media, undefined);
  assert.equal(resultado.mediaFaltante, undefined);
  const data = (resultado.evolution as { data: Record<string, unknown> }).data;
  assert.equal(data.pushName, "Ana");
  assert.equal(data.wahaSource, "app");
});

test("2) liveLocationMessage sale como liveLocationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          liveLocationMessage: {
            degreesLatitude: "4.6097",
            degreesLongitude: "-74.0817",
            jpegThumbnail: "x",
          },
        },
      },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    liveLocationMessage: {
      degreesLatitude: 4.6097,
      degreesLongitude: -74.0817,
    },
  });
});

test("3) solo el campo location de WAHA sale como locationMessage", () => {
  const resultado = traducirEventoWaha(
    evento({
      hasMedia: false,
      location: {
        latitude: 3.4516,
        longitude: -76.532,
        description: "Casa de la clienta",
        address: "Cali",
      },
      _data: { Message: {} },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    locationMessage: {
      degreesLatitude: 3.4516,
      degreesLongitude: -76.532,
      name: "Casa de la clienta",
      address: "Cali",
    },
  });
});

test("4) la ubicacion que manda la asesora conserva fromMe", () => {
  const resultado = traducirEventoWaha(
    evento({
      fromMe: true,
      _data: {
        Message: {
          locationMessage: { degreesLatitude: 6.25, degreesLongitude: -75.56 },
        },
      },
    }),
  );
  const data = (resultado.evolution as { data: { key: { fromMe: boolean } } })
    .data;
  assert.equal(data.key.fromMe, true);
  assert.ok(mensajeDe(resultado).locationMessage);
});

test("4b) conserva la cita (contextInfo) de la ubicacion", () => {
  const contextInfo = {
    stanzaId: "ABC",
    quotedMessage: { conversation: "¿Dónde quedas?" },
  };
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          locationMessage: {
            degreesLatitude: 6.25,
            degreesLongitude: -75.56,
            contextInfo,
          },
        },
      },
    }),
  );
  assert.deepEqual(mensajeDe(resultado), {
    locationMessage: {
      degreesLatitude: 6.25,
      degreesLongitude: -75.56,
      contextInfo,
    },
  });
});

test("4c) recorta el nombre y la direccion a un largo maximo", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          locationMessage: {
            degreesLatitude: 6.25,
            degreesLongitude: -75.56,
            name: "n".repeat(5000),
            address: "d".repeat(5000),
          },
        },
      },
    }),
  );
  const ubicacion = mensajeDe(resultado).locationMessage as {
    name: string;
    address: string;
  };
  assert.ok(ubicacion.name.length <= 200);
  assert.ok(ubicacion.address.length <= 300);
});

test("5) coordenadas fuera de rango no salen como ubicacion", () => {
  for (const [lat, lon] of [
    [91, -75],
    [-91, -75],
    [6, 181],
    [6, -181],
    ["no-es-numero", -75],
  ] as const) {
    const resultado = traducirEventoWaha(
      evento({
        hasMedia: false,
        location: { latitude: lat, longitude: lon },
        _data: {
          Message: {
            locationMessage: { degreesLatitude: lat, degreesLongitude: lon },
          },
        },
      }),
    );
    const mensaje = (
      resultado.evolution as
        | { data?: { message?: Record<string, unknown> } }
        | undefined
    )?.data?.message;
    assert.equal(
      mensaje?.locationMessage,
      undefined,
      `salio una ubicacion con ${lat}, ${lon}`,
    );
    assert.equal(mensaje?.liveLocationMessage, undefined);
  }
});

test("6) el webhook lee la ubicacion traducida: mismas coordenadas y tipo LOCATION", () => {
  const resultado = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          locationMessage: {
            DegreesLatitude: 6.2442,
            DegreesLongitude: -75.5812,
            Name: "Magilus",
            Address: "Cra 27",
          },
        },
      },
    }),
  );
  assert.deepEqual(extractEvolutionLocation(resultado.evolution), {
    latitude: 6.2442,
    longitude: -75.5812,
    name: "Magilus",
    address: "Cra 27",
  });
  assert.equal(extractEvolutionMessageType(resultado.evolution), "LOCATION");

  const enVivo = traducirEventoWaha(
    evento({
      _data: {
        Message: {
          liveLocationMessage: {
            degreesLatitude: 4.6,
            degreesLongitude: -74.08,
          },
        },
      },
    }),
  );
  assert.equal(extractEvolutionMessageType(enVivo.evolution), "LOCATION");
  assert.deepEqual(extractEvolutionLocation(enVivo.evolution), {
    latitude: 4.6,
    longitude: -74.08,
    name: null,
    address: null,
  });
});

/*
  Regresion: estas salidas se guardaron ANTES de agregar el lector de ubicacion. Un texto, una
  foto con URL, un pedido del catalogo y una tarjeta de anuncio tienen que salir exactamente igual.
*/
const regresion = {
  texto: {
    ...base,
    payload: {
      id: "false_573001112233@c.us_AAA1",
      timestamp: 1760000000,
      from: "573001112233@c.us",
      fromMe: false,
      source: "app",
      body: "Hola, buenas",
      hasMedia: false,
      _data: { notifyName: "Ana", Message: { conversation: "Hola, buenas" } },
    },
  },
  foto: {
    ...base,
    payload: {
      id: "false_573001112233@c.us_AAA2",
      timestamp: 1760000001,
      from: "573001112233@c.us",
      fromMe: false,
      source: "app",
      body: "Mira esta",
      hasMedia: true,
      media: {
        url: "https://waha.local/api/files/ventas/AAA2.jpeg",
        mimetype: "image/jpeg",
      },
      _data: {
        pushName: "Ana",
        Message: {
          imageMessage: { caption: "Mira esta", JPEGThumbnail: "abc" },
        },
      },
    },
  },
  pedido: {
    ...base,
    payload: {
      id: "false_573001112233@c.us_AAA3",
      timestamp: 1760000002,
      from: "573001112233@c.us",
      fromMe: false,
      body: "",
      hasMedia: false,
      _data: {
        notifyName: "Ana",
        Message: {
          orderMessage: {
            itemCount: 3,
            totalAmount1000: 150000000,
            totalCurrencyCode: "COP",
            orderTitle: "Pedido",
          },
        },
      },
    },
  },
  anuncio: {
    ...base,
    payload: {
      id: "false_573001112233@c.us_AAA4",
      timestamp: 1760000003,
      from: "573001112233@c.us",
      fromMe: false,
      body: "",
      hasMedia: false,
      _data: {
        notifyName: "Ana",
        Message: {
          interactiveMessage: {
            body: { text: "Hola, quiero más información" },
            contextInfo: {
              externalAdReply: {
                title: "Somos Magilus",
                sourceUrl: "https://fb.me/x",
                sourceId: "123",
              },
            },
          },
        },
      },
    },
  },
};

const salidasDeAntes: Record<keyof typeof regresion, unknown> = {
  texto: {
    evolution: {
      event: "messages.upsert",
      instance: "ventas",
      data: {
        wahaSource: "app",
        key: {
          remoteJid: "573001112233@s.whatsapp.net",
          fromMe: false,
          id: "false_573001112233@c.us_AAA1",
        },
        message: {
          conversation: "Hola, buenas",
        },
        pushName: "Ana",
        messageTimestamp: 1760000000,
      },
    },
  },
  foto: {
    evolution: {
      event: "messages.upsert",
      instance: "ventas",
      data: {
        wahaSource: "app",
        key: {
          remoteJid: "573001112233@s.whatsapp.net",
          fromMe: false,
          id: "false_573001112233@c.us_AAA2",
        },
        message: {
          imageMessage: {
            url: "https://waha.local/api/files/ventas/AAA2.jpeg",
            mimetype: "image/jpeg",
            caption: "Mira esta",
          },
        },
        pushName: "Ana",
        messageTimestamp: 1760000001,
      },
    },
    media: {
      url: "https://waha.local/api/files/ventas/AAA2.jpeg",
      mimetype: "image/jpeg",
    },
  },
  pedido: {
    evolution: {
      event: "messages.upsert",
      instance: "ventas",
      data: {
        key: {
          remoteJid: "573001112233@s.whatsapp.net",
          fromMe: false,
          id: "false_573001112233@c.us_AAA3",
        },
        message: {
          conversation:
            "🛒 *Pedido desde el catálogo*\n3 artículos\nTotal: 150.000 COP\nPedido\n_El detalle de los artículos se ve en WhatsApp._",
        },
        pushName: "Ana",
        messageTimestamp: 1760000002,
      },
    },
  },
  anuncio: {
    evolution: {
      event: "messages.upsert",
      instance: "ventas",
      data: {
        key: {
          remoteJid: "573001112233@s.whatsapp.net",
          fromMe: false,
          id: "false_573001112233@c.us_AAA4",
        },
        message: {
          extendedTextMessage: {
            text: "Hola, quiero más información",
            contextInfo: {
              externalAdReply: {
                title: "Somos Magilus",
                sourceUrl: "https://fb.me/x",
                sourceId: "123",
              },
            },
          },
        },
        pushName: "Ana",
        messageTimestamp: 1760000003,
      },
    },
  },
};

for (const nombre of Object.keys(regresion) as (keyof typeof regresion)[]) {
  test(`7) regresion: ${nombre} sale igual que antes`, () => {
    assert.deepEqual(
      traducirEventoWaha(regresion[nombre]),
      salidasDeAntes[nombre],
    );
  });
}

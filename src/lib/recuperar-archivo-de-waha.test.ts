import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

import {
  chatYMensajeDeWaha,
  hayQueRecuperar,
  olvidarIntentos,
  recuperarArchivoDeWaha,
  sesionDeUnArchivoDeWaha,
  type DependenciasDeLaRecuperacion,
} from "./recuperar-archivo-de-waha";

const URL_DE_WAHA = "https://waha-1.magilus.com/api/files/ventas-1/ACC255866D1C2AB1CD5ECB40F5958B61.mp4";
const VIDEO = {
  id: "m1",
  externalId: "false_32290285596732@lid_ACC255866D1C2AB1CD5ECB40F5958B61",
  mediaUrl: URL_DE_WAHA,
  type: "VIDEO" as const,
};
const BYTES = Buffer.alloc(6000, 7);

function dependencias(cambios: Partial<DependenciasDeLaRecuperacion> = {}) {
  const llamadas: string[] = [];
  const apuntadas: Array<[string, string]> = [];
  const base: DependenciasDeLaRecuperacion = {
    leerPayloadCompleto: async () => {
      llamadas.push("base");
      return { source: "webhook", evolution: { data: { message: { videoMessage: { mimetype: "video/mp4" } } } } };
    },
    conexionDeLaSesion: async (sesion) => {
      llamadas.push(`conexion:${sesion}`);
      return { baseUrl: "https://waha-1.magilus.com", apiToken: "clave" };
    },
    bajar: async (_conexion, url) => {
      llamadas.push(`bajar:${url}`);
      return null;
    },
    pedirOtraVez: async (_c, sesion, chatId, mensajeId) => {
      llamadas.push(`otra-vez:${sesion}:${chatId}:${mensajeId}`);
      return null;
    },
    guardar: async ({ bytes, mimeType }) => {
      llamadas.push(`guardar:${bytes.length}:${mimeType}`);
      return { enlace: "/uploads/chat-media/abc.mp4" };
    },
    apuntarFila: async (id, enlace) => {
      apuntadas.push([id, enlace]);
    },
    avisar: () => {},
  };
  return { deps: { ...base, ...cambios }, llamadas, apuntadas };
}

beforeEach(() => olvidarIntentos());

test("reconoce un archivo de WAHA y su línea", () => {
  assert.equal(sesionDeUnArchivoDeWaha(URL_DE_WAHA), "ventas-1");
  assert.equal(sesionDeUnArchivoDeWaha("/uploads/chat-media/abc.mp4"), null);
  assert.equal(sesionDeUnArchivoDeWaha("https://crm.magilus.com/uploads/chat-media/abc.mp4"), null);
  assert.equal(sesionDeUnArchivoDeWaha("https://scontent.fbcdn.net/v/x.jpg"), null);
  assert.equal(sesionDeUnArchivoDeWaha(null), null);
});

test("saca el chat y el id del mensaje de WAHA", () => {
  assert.deepEqual(chatYMensajeDeWaha(VIDEO.externalId), {
    chatId: "32290285596732@lid",
    mensajeId: VIDEO.externalId,
  });
  assert.equal(chatYMensajeDeWaha("3EB0ABC"), null);
});

test("si el base64 quedó en la fila, lo guarda sin ir a WAHA", async () => {
  const { deps, llamadas, apuntadas } = dependencias({
    leerPayloadCompleto: async () => ({
      evolution: { data: { base64: BYTES.toString("base64"), message: { videoMessage: { mimetype: "video/mp4" } } } },
    }),
  });
  const enlace = await recuperarArchivoDeWaha(VIDEO, deps);
  assert.equal(enlace, "/uploads/chat-media/abc.mp4");
  assert.deepEqual(apuntadas, [["m1", "/uploads/chat-media/abc.mp4"]]);
  assert.ok(llamadas.includes("guardar:6000:video/mp4"));
  assert.ok(!llamadas.some((l) => l.startsWith("bajar")));
});

test("sin base64, lo baja de WAHA con la clave de la línea", async () => {
  const { deps, llamadas, apuntadas } = dependencias({
    bajar: async () => ({ bytes: BYTES, mimetype: "video/mp4" }),
  });
  assert.equal(await recuperarArchivoDeWaha(VIDEO, deps), "/uploads/chat-media/abc.mp4");
  assert.deepEqual(apuntadas, [["m1", "/uploads/chat-media/abc.mp4"]]);
  assert.ok(llamadas.includes("conexion:ventas-1"));
  assert.ok(!llamadas.some((l) => l.startsWith("otra-vez")));
});

test("si WAHA ya no lo tiene, se lo pide otra vez a WhatsApp", async () => {
  const { deps, llamadas, apuntadas } = dependencias({
    bajar: async (_c, url) => (url.endsWith("NUEVO.mp4") ? { bytes: BYTES, mimetype: null } : null),
    pedirOtraVez: async (_c, sesion, chatId) => {
      assert.equal(sesion, "ventas-1");
      assert.equal(chatId, "32290285596732@lid");
      return { url: "https://waha-1.magilus.com/api/files/ventas-1/NUEVO.mp4", mimetype: "video/mp4" };
    },
  });
  assert.equal(await recuperarArchivoDeWaha(VIDEO, deps), "/uploads/chat-media/abc.mp4");
  assert.ok(llamadas.includes("guardar:6000:video/mp4"));
  assert.equal(apuntadas.length, 1);
});

test("si nada sale, no toca la fila y no insiste en media hora", async () => {
  const { deps, apuntadas } = dependencias();
  const ahora = 1_000_000;
  assert.equal(await recuperarArchivoDeWaha(VIDEO, deps, ahora), null);
  assert.equal(apuntadas.length, 0);
  assert.equal(hayQueRecuperar(VIDEO, ahora + 60_000), false);
  assert.equal(hayQueRecuperar(VIDEO, ahora + 31 * 60_000), true);
});

test("un archivo que ya está en nuestro disco no se toca", async () => {
  const { deps, llamadas } = dependencias();
  const guardado = { ...VIDEO, mediaUrl: "/uploads/chat-media/abc.mp4" };
  assert.equal(hayQueRecuperar(guardado), false);
  assert.equal(await recuperarArchivoDeWaha(guardado, deps), null);
  assert.equal(llamadas.length, 0);
});

test("si la base falla, nunca lanza", async () => {
  const { deps } = dependencias({
    conexionDeLaSesion: async () => {
      throw new Error("la base no responde");
    },
  });
  assert.equal(await recuperarArchivoDeWaha(VIDEO, deps), null);
});

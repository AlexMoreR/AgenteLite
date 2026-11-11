import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { enviarMediaWaha, esOggOpus, primerosBytesDelArchivo } from "./waha";

/*
  La nota de voz que ya es OGG con opus sale con `convert: false` (WAHA no la vuelve a convertir).
  Si WAHA la rechaza (4xx), se reintenta UNA vez con `convert: true`, el camino de siempre.
  El video sigue con `convert: true`; foto y documento no llevan `convert`.
*/

/** El comienzo real de un .ogg con opus: pagina "OggS" + paquete "OpusHead". */
function bytesOggOpus(): Buffer {
  const cabecera = Buffer.alloc(28);
  cabecera.write("OggS", 0, "latin1");
  cabecera[26] = 1; // un segmento
  cabecera[27] = 19;
  const opus = Buffer.from("OpusHead\x01\x01\x38\x01\x80\xbb\x00\x00\x00\x00\x00", "latin1");
  return Buffer.concat([cabecera, opus, Buffer.alloc(30)]);
}

/** Un OGG con vorbis: empieza con "OggS" pero no es opus. */
function bytesOggVorbis(): Buffer {
  const cabecera = Buffer.alloc(28);
  cabecera.write("OggS", 0, "latin1");
  cabecera[26] = 1;
  cabecera[27] = 30;
  return Buffer.concat([cabecera, Buffer.from("\x01vorbis", "latin1"), Buffer.alloc(40)]);
}

/** El comienzo de un .m4a (AAC): caja "ftyp". */
function bytesM4a(): Buffer {
  return Buffer.concat([Buffer.from("\x00\x00\x00\x20ftypM4A \x00\x00\x02\x00", "latin1"), Buffer.alloc(60)]);
}

type Pedido = { url: string; cuerpo: Record<string, unknown> | null };

const fetchOriginal = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = fetchOriginal;
});

/**
 * Un WAHA de mentira. `archivo` es lo que devuelve la URL del audio; `respuestaDeEnvio` decide que
 * contesta cada pedido de envio (por numero de intento).
 */
function instalarFetch(opciones: {
  archivo?: Buffer | "falla";
  respuestaDeEnvio?: (intento: number, cuerpo: Record<string, unknown>) => Response;
}): Pedido[] {
  const pedidos: Pedido[] = [];
  let intentosDeEnvio = 0;
  globalThis.fetch = (async (entrada: string | URL | Request, init?: RequestInit) => {
    const url = String(entrada);
    const cuerpo = typeof init?.body === "string" ? (JSON.parse(init.body) as Record<string, unknown>) : null;
    pedidos.push({ url, cuerpo });
    if (url.startsWith("https://crm.ejemplo.com/")) {
      if (opciones.archivo === "falla" || !opciones.archivo) {
        throw new Error("sin red");
      }
      return new Response(new Uint8Array(opciones.archivo), { status: 206 });
    }
    if (/\/api\/send(Voice|Video|Image|File)$/.test(url)) {
      intentosDeEnvio += 1;
      const respuesta = opciones.respuestaDeEnvio?.(intentosDeEnvio, cuerpo ?? {});
      return respuesta ?? Response.json({ id: "true_573196892277@c.us_ABC" });
    }
    // Visto, presencia: no importan aca.
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
  return pedidos;
}

const conexion = { baseUrl: "https://waha.ejemplo.com", apiToken: "clave-de-prueba" };

function enviar(tipo: "image" | "video" | "audio" | "document", extra: Record<string, unknown> = {}) {
  return enviarMediaWaha({
    connection: conexion,
    sesion: "ventas",
    telefono: "573196892277",
    tipo,
    url: "https://crm.ejemplo.com/uploads/nota.ogg",
    mimetype: tipo === "audio" ? "audio/ogg" : null,
    ...extra,
  });
}

const enviosA = (pedidos: Pedido[], ruta: string) => pedidos.filter((p) => p.url.endsWith(ruta));

test("esOggOpus reconoce opus por los bytes y no se deja engañar", () => {
  assert.equal(esOggOpus(bytesOggOpus()), true);
  assert.equal(esOggOpus(bytesOggVorbis()), false);
  assert.equal(esOggOpus(bytesM4a()), false);
  assert.equal(esOggOpus(new Uint8Array(0)), false);
});

test("primerosBytesDelArchivo lee el comienzo del base64 (tambien como data URL)", async () => {
  const base64 = bytesOggOpus().toString("base64");
  const directo = await primerosBytesDelArchivo({ base64 });
  assert.ok(directo && esOggOpus(directo));
  const dataUrl = await primerosBytesDelArchivo({ base64: `data:audio/ogg;base64,${base64}` });
  assert.ok(dataUrl && esOggOpus(dataUrl));
});

test("nota de voz en OGG opus: sendVoice con convert false y mimetype opus", async () => {
  const pedidos = instalarFetch({ archivo: bytesOggOpus() });
  const resultado = await enviar("audio");
  const envios = enviosA(pedidos, "/api/sendVoice");
  assert.equal(envios.length, 1);
  assert.equal(envios[0].cuerpo?.convert, false);
  assert.equal((envios[0].cuerpo?.file as Record<string, unknown>).mimetype, "audio/ogg; codecs=opus");
  assert.equal(resultado.externalId, "true_573196892277@c.us_ABC");
});

test("nota de voz en base64 OGG opus tambien sale con convert false", async () => {
  const pedidos = instalarFetch({});
  await enviar("audio", { url: null, base64: bytesOggOpus().toString("base64") });
  const envios = enviosA(pedidos, "/api/sendVoice");
  assert.equal(envios.length, 1);
  assert.equal(envios[0].cuerpo?.convert, false);
});

for (const [nombre, archivo] of [
  ["m4a", bytesM4a()],
  ["OGG sin opus", bytesOggVorbis()],
  ["no se pudo leer", "falla"],
] as const) {
  test(`nota de voz ${nombre}: convert true, un solo pedido`, async () => {
    const pedidos = instalarFetch({ archivo });
    await enviar("audio");
    const envios = enviosA(pedidos, "/api/sendVoice");
    assert.equal(envios.length, 1);
    assert.equal(envios[0].cuerpo?.convert, true);
    assert.equal((envios[0].cuerpo?.file as Record<string, unknown>).mimetype, "audio/ogg");
  });
}

test("si WAHA rechaza (4xx) el convert false, se reintenta UNA vez con convert true", async () => {
  const pedidos = instalarFetch({
    archivo: bytesOggOpus(),
    respuestaDeEnvio: (intento) =>
      intento === 1 ? new Response("convert must be true", { status: 400 }) : Response.json({ id: "ok" }),
  });
  await enviar("audio");
  const envios = enviosA(pedidos, "/api/sendVoice");
  assert.equal(envios.length, 2);
  assert.equal(envios[0].cuerpo?.convert, false);
  assert.equal(envios[1].cuerpo?.convert, true);
  // El reintento vuelve al tipo original, no al de opus.
  assert.equal((envios[1].cuerpo?.file as Record<string, unknown>).mimetype, "audio/ogg");
});

test("si falla dos veces, no hay un tercer intento y el error sube", async () => {
  const pedidos = instalarFetch({
    archivo: bytesOggOpus(),
    respuestaDeEnvio: () => new Response("rechazado", { status: 422 }),
  });
  await assert.rejects(enviar("audio"));
  assert.equal(enviosA(pedidos, "/api/sendVoice").length, 2);
});

test("un error 5xx con convert false NO se reintenta (la nota pudo haber salido)", async () => {
  const pedidos = instalarFetch({
    archivo: bytesOggOpus(),
    respuestaDeEnvio: () => new Response("timeout del gateway", { status: 504 }),
  });
  await assert.rejects(enviar("audio"));
  assert.equal(enviosA(pedidos, "/api/sendVoice").length, 1);
});

test("con convert true un rechazo no tiene reintento extra", async () => {
  const pedidos = instalarFetch({
    archivo: bytesM4a(),
    respuestaDeEnvio: () => new Response("rechazado", { status: 400 }),
  });
  await assert.rejects(enviar("audio"));
  const envios = enviosA(pedidos, "/api/sendVoice");
  assert.equal(envios.length, 1);
  assert.equal(envios[0].cuerpo?.convert, true);
});

test("video sigue con convert true; foto y documento no llevan convert", async () => {
  const pedidos = instalarFetch({ archivo: bytesOggOpus() });
  await enviar("video", { url: "https://crm.ejemplo.com/uploads/video.mp4" });
  await enviar("image", { url: "https://crm.ejemplo.com/uploads/foto.jpg" });
  await enviar("document", { url: "https://crm.ejemplo.com/uploads/doc.pdf" });
  assert.equal(enviosA(pedidos, "/api/sendVideo")[0].cuerpo?.convert, true);
  assert.equal("convert" in (enviosA(pedidos, "/api/sendImage")[0].cuerpo ?? {}), false);
  assert.equal("convert" in (enviosA(pedidos, "/api/sendFile")[0].cuerpo ?? {}), false);
  // Solo la nota de voz lee el comienzo del archivo.
  assert.equal(pedidos.filter((p) => p.url.startsWith("https://crm.ejemplo.com/")).length, 0);
});

test("cada envio deja una linea [envio-medio] gateway-waha con convert y ms", async () => {
  instalarFetch({ archivo: bytesOggOpus() });
  const lineas: string[] = [];
  const infoOriginal = console.info;
  console.info = (...args: unknown[]) => {
    lineas.push(args.map(String).join(" "));
  };
  try {
    await enviar("audio");
  } finally {
    console.info = infoOriginal;
  }
  const linea = lineas.find((l) => l.startsWith("[envio-medio]"));
  assert.ok(linea, "falta la linea [envio-medio]");
  const datos = JSON.parse(linea.slice("[envio-medio] ".length)) as Record<string, unknown>;
  assert.equal(datos.paso, "gateway-waha");
  assert.equal(datos.convert, false);
  assert.equal(datos.reintento, false);
  assert.equal(typeof datos.ms, "number");
  assert.ok(!linea.includes("573196892277"), "la linea no lleva telefonos");
});

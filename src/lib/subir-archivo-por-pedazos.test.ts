import { test } from "node:test";
import assert from "node:assert/strict";

import { PEDAZOS_A_LA_VEZ, subirArchivoPorPedazos } from "./subir-archivo-por-pedazos";

/*
  Pruebas de quien sube, con un `fetch` de mentira que anota cada pedido: cuando empieza, cuando
  termina y como termina. Asi se puede comprobar el orden y cuantos van a la vez sin red.
*/

const TROZO = 512 * 1024;
const ENDPOINT = "/api/cliente/chats/upload-media/chunk";

type Pedido = { indice: number; inicio: number; fin?: number; status?: number };

type Respuesta = { status: number; cuerpo: Record<string, unknown> } | "red";

function archivoDePedazos(cantidad: number) {
  // El ultimo pedazo queda mas chico, como pasa casi siempre.
  return new File([new Uint8Array(TROZO * (cantidad - 1) + 1000)], "catalogo.pdf", { type: "application/pdf" });
}

const sinEsperar = async () => {};

/**
 * Instala el fetch de mentira. `responder` decide que contesta cada pedido (por indice y por
 * numero de intento de ese indice); `demora` cuanto tarda.
 */
function instalarFetch(opciones: {
  responder?: (indice: number, intento: number, total: number) => Respuesta;
  demora?: (indice: number) => number;
}) {
  let reloj = 0;
  let enCurso = 0;
  let maxEnCurso = 0;
  const pedidos: Pedido[] = [];
  const avisos: Array<Record<string, unknown>> = [];
  const intentos = new Map<number, number>();
  const original = globalThis.fetch;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    if (String(url).endsWith("/fallo")) {
      avisos.push(JSON.parse(String(init?.body)));
      return new Response("{}", { status: 200 });
    }

    const cuerpo = init?.body as FormData;
    const indice = Number(cuerpo.get("index"));
    const total = Number(cuerpo.get("total"));
    const intento = (intentos.get(indice) ?? 0) + 1;
    intentos.set(indice, intento);

    const pedido: Pedido = { indice, inicio: ++reloj };
    pedidos.push(pedido);
    enCurso += 1;
    maxEnCurso = Math.max(maxEnCurso, enCurso);

    try {
      await new Promise<void>((listo, fallar) => {
        const temporizador = setTimeout(listo, opciones.demora?.(indice) ?? 1 + (indice % 4));
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(temporizador);
          fallar(new DOMException("cancelado", "AbortError"));
        });
      });

      const respuesta = opciones.responder?.(indice, intento, total) ?? {
        status: 200,
        cuerpo:
          indice === total - 1
            ? { ok: true, completo: true, url: "/uploads/chat-media/x.pdf", fileName: "catalogo.pdf", mimeType: "application/pdf", mediaType: "DOCUMENT" }
            : { ok: true, recibido: indice },
      };

      if (respuesta === "red") {
        throw new TypeError("Failed to fetch");
      }
      pedido.status = respuesta.status;
      return new Response(JSON.stringify(respuesta.cuerpo), { status: respuesta.status });
    } finally {
      pedido.fin = ++reloj;
      enCurso -= 1;
    }
  }) as typeof fetch;

  return {
    pedidos,
    avisos,
    intentos,
    maxEnCurso: () => maxEnCurso,
    restaurar: () => {
      globalThis.fetch = original;
    },
  };
}

test("nunca hay mas de 3 pedazos en camino y el ultimo sale cuando los demas entraron", async () => {
  const red = instalarFetch({});
  try {
    const resultado = await subirArchivoPorPedazos({ file: archivoDePedazos(10), endpoint: ENDPOINT, esperar: sinEsperar });

    assert.equal(resultado.error, undefined);
    assert.equal(resultado.archivo?.url, "/uploads/chat-media/x.pdf");
    assert.equal(PEDAZOS_A_LA_VEZ, 3);
    assert.ok(red.maxEnCurso() <= 3, `hubo ${red.maxEnCurso()} a la vez`);
    assert.equal(red.maxEnCurso(), 3, "con 10 pedazos tienen que ir 3 a la vez");

    const ultimo = red.pedidos.find((pedido) => pedido.indice === 9)!;
    const demas = red.pedidos.filter((pedido) => pedido.indice !== 9);
    assert.equal(demas.length, 9);
    for (const pedido of demas) {
      assert.equal(pedido.status, 200);
      assert.ok(pedido.fin! < ultimo.inicio, `el pedazo ${pedido.indice} termino despues de que salio el ultimo`);
    }
    console.log(`  a la vez como maximo: ${red.maxEnCurso()}; el ultimo salio en el paso ${ultimo.inicio}, despues de que terminaran los 9 anteriores`);
  } finally {
    red.restaurar();
  }
});

test("un pedazo que falla dos veces se pide 3 veces y los demas una sola", async () => {
  const esperas: number[] = [];
  const red = instalarFetch({
    responder: (indice, intento, total) => {
      if (indice === 2 && intento <= 2) return intento === 1 ? "red" : { status: 502, cuerpo: { ok: false } };
      return indice === total - 1
        ? { status: 200, cuerpo: { ok: true, completo: true, url: "/u.pdf", mediaType: "DOCUMENT" } }
        : { status: 200, cuerpo: { ok: true } };
    },
  });
  try {
    const resultado = await subirArchivoPorPedazos({
      file: archivoDePedazos(6),
      endpoint: ENDPOINT,
      esperar: async (ms) => {
        esperas.push(ms);
      },
    });

    assert.equal(resultado.error, undefined);
    assert.equal(red.intentos.get(2), 3);
    for (const indice of [0, 1, 3, 4, 5]) {
      assert.equal(red.intentos.get(indice), 1, `el pedazo ${indice} se pidio ${red.intentos.get(indice)} veces`);
    }
    assert.deepEqual(esperas, [1000, 2000], "la espera crece entre intentos");
    assert.equal(red.avisos.length, 0);
    console.log(`  pedidos por pedazo: ${JSON.stringify(Object.fromEntries(red.intentos))}; esperas: ${esperas.join(", ")} ms`);
  } finally {
    red.restaurar();
  }
});

test("ante un 400 no sale ningun pedazo nuevo, nunca se pide el ultimo y se devuelve el error", async () => {
  const red = instalarFetch({
    responder: (indice) =>
      indice === 1 ? { status: 400, cuerpo: { ok: false, error: "Formato no permitido (x)." } } : { status: 200, cuerpo: { ok: true } },
    // El 1 contesta rapido; los que van con el tardan mas y quedan en camino.
    demora: (indice) => (indice === 1 ? 1 : 30),
  });
  try {
    const resultado = await subirArchivoPorPedazos({ file: archivoDePedazos(8), endpoint: ENDPOINT, esperar: sinEsperar });

    assert.deepEqual(resultado, { error: "Formato no permitido (x)." });
    const rechazo = red.pedidos.find((pedido) => pedido.indice === 1)!;
    const despues = red.pedidos.filter((pedido) => pedido.inicio > rechazo.fin!);
    assert.deepEqual(despues, [], "salieron pedazos despues del 400");
    assert.equal(red.pedidos.some((pedido) => pedido.indice === 7), false, "se pidio el ultimo");
    assert.equal(red.intentos.get(1), 1, "el 400 no se reintenta");
    assert.equal(red.avisos.length, 0);
    console.log(`  pedidos hechos: ${red.pedidos.map((pedido) => pedido.indice).join(", ")}; ninguno despues del 400`);
  } finally {
    red.restaurar();
  }
});

test("un 409 tampoco se reintenta", async () => {
  const red = instalarFetch({
    responder: (indice, _intento, total) =>
      indice === total - 1 ? { status: 409, cuerpo: { ok: false, error: "Faltan partes del archivo." } } : { status: 200, cuerpo: { ok: true } },
  });
  try {
    const resultado = await subirArchivoPorPedazos({ file: archivoDePedazos(3), endpoint: ENDPOINT, esperar: sinEsperar });
    assert.deepEqual(resultado, { error: "Faltan partes del archivo." });
    assert.equal(red.intentos.get(2), 1);
    assert.equal(red.avisos.length, 1, "el corte queda registrado una vez");
  } finally {
    red.restaurar();
  }
});

test("si un pedazo se agota, se para todo, el aviso sale una sola vez y se devuelve el error", async () => {
  const red = instalarFetch({
    responder: (indice) => (indice === 0 ? "red" : { status: 200, cuerpo: { ok: true } }),
    demora: (indice) => (indice === 0 ? 1 : 5),
  });
  try {
    const resultado = await subirArchivoPorPedazos({ file: archivoDePedazos(20), endpoint: ENDPOINT, esperar: sinEsperar });

    assert.match(resultado.error ?? "", /^Se cortó la subida \(\d+% enviado\)/);
    assert.equal(red.intentos.get(0), 6, "seis intentos por pedazo");
    assert.equal(red.pedidos.some((pedido) => pedido.indice === 19), false, "se pidio el ultimo");
    assert.equal(red.avisos.length, 1);
    assert.equal(red.avisos[0].trozo, 0);
    console.log(`  ${resultado.error}; pedidos: ${red.pedidos.length}; avisos: ${red.avisos.length}`);
  } finally {
    red.restaurar();
  }
});

test("onAvance cuenta los pedazos terminados, nunca baja y termina en 1", async () => {
  const red = instalarFetch({ demora: (indice) => [9, 1, 5, 2, 7, 1, 3, 8, 1, 4][indice % 10] });
  const avances: number[] = [];
  try {
    const resultado = await subirArchivoPorPedazos({
      file: archivoDePedazos(10),
      endpoint: ENDPOINT,
      esperar: sinEsperar,
      onAvance: (avance) => avances.push(avance),
    });

    assert.equal(resultado.error, undefined);
    for (let i = 1; i < avances.length; i += 1) {
      assert.ok(avances[i] >= avances[i - 1], `bajo de ${avances[i - 1]} a ${avances[i]}`);
    }
    assert.equal(avances.at(-1), 1);
    assert.equal(avances.length, 10);
    console.log(`  avances: ${avances.map((avance) => avance.toFixed(1)).join(" ")}`);
  } finally {
    red.restaurar();
  }
});

test("un archivo de un solo pedazo sube igual que antes", async () => {
  const red = instalarFetch({});
  try {
    const resultado = await subirArchivoPorPedazos({
      file: new File([new Uint8Array(300)], "foto.jpg", { type: "image/jpeg" }),
      endpoint: ENDPOINT,
      esperar: sinEsperar,
    });
    assert.equal(resultado.error, undefined);
    assert.equal(red.pedidos.length, 1);
    assert.equal(red.pedidos[0].indice, 0);
  } finally {
    red.restaurar();
  }
});

test("si el archivo no se puede leer no sale ningun pedazo", async () => {
  const red = instalarFetch({});
  const roto = new File([new Uint8Array(10)], "video.mp4", { type: "video/mp4" });
  roto.slice = () => {
    throw new Error("NotReadableError");
  };
  try {
    const resultado = await subirArchivoPorPedazos({ file: roto, endpoint: ENDPOINT, esperar: sinEsperar });
    assert.match(resultado.error ?? "", /No se pudo leer el archivo/);
    assert.equal(red.pedidos.length, 0);
    assert.equal(red.avisos.length, 1);
  } finally {
    red.restaurar();
  }
});

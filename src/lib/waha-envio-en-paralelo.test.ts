// Envios por WAHA en paralelo (velocidad, 11-nov-2026). Correr: npm run test:waha-paralelo
import assert from "node:assert/strict";
import { test } from "node:test";

import { enviarTextoWaha } from "./waha";

type Llamada = { ruta: string; empezo: number; termino?: number };

function wahaFalso(demoraDeLeidoMs: number) {
  const llamadas: Llamada[] = [];
  const inicio = Date.now();
  globalThis.fetch = (async (url: string | URL | Request) => {
    const ruta = String(url).replace("http://waha.test", "");
    const llamada: Llamada = { ruta, empezo: Date.now() - inicio };
    llamadas.push(llamada);
    const demora = ruta.endsWith("/messages/read") ? demoraDeLeidoMs : 20;
    await new Promise((listo) => setTimeout(listo, demora));
    llamada.termino = Date.now() - inicio;
    const cuerpo = ruta === "/api/sendText" ? JSON.stringify({ id: "true_573000000000@c.us_ABC" }) : "";
    return new Response(cuerpo, { status: 200 });
  }) as typeof fetch;
  return { llamadas, inicio };
}

const conexion = { baseUrl: "http://waha.test", apiToken: "clave-de-prueba" } as Parameters<typeof enviarTextoWaha>[0]["connection"];

test("un 'leido' lento (3 s) ya no frena el texto: sale en lo que tarda el envio", async () => {
  const { llamadas, inicio } = wahaFalso(3000);
  const resultado = await enviarTextoWaha({ connection: conexion, sesion: "admin", telefono: "573000000000", texto: "hola" });
  const tardo = Date.now() - inicio;
  assert.equal(resultado.externalId, "true_573000000000@c.us_ABC");
  assert.ok(tardo < 1000, `tardo ${tardo} ms (antes esperaba el leido de 3 s)`);
  // Leido y envio salieron a la vez (los dos empezaron casi en el mismo instante).
  const leido = llamadas.find((l) => l.ruta.endsWith("/messages/read"));
  const envio = llamadas.find((l) => l.ruta === "/api/sendText");
  assert.ok(leido && envio);
  assert.ok(Math.abs(envio.empezo - leido.empezo) < 100, "el envio no espera al leido");
});

test("'desconectada' va UNA vez y despues de que terminan leido y envio", async () => {
  const { llamadas } = wahaFalso(200);
  await enviarTextoWaha({ connection: conexion, sesion: "admin", telefono: "573000000000", texto: "hola" });
  await new Promise((listo) => setTimeout(listo, 400));
  const presencias = llamadas.filter((l) => l.ruta.endsWith("/presence"));
  assert.equal(presencias.length, 1, "antes eran dos");
  const leido = llamadas.find((l) => l.ruta.endsWith("/messages/read"))!;
  const envio = llamadas.find((l) => l.ruta === "/api/sendText")!;
  assert.ok(presencias[0].empezo >= Math.max(leido.termino ?? 0, envio.termino ?? 0) - 5);
});

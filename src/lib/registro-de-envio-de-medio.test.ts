import { test } from "node:test";
import assert from "node:assert/strict";

import { lineaDeEnvioDeMedio, registrarEnvioDeMedio } from "./registro-de-envio-de-medio";
// El mismo criterio que usa la vigilancia de 30 minutos para decidir si una linea es una falla.
import { esLineaDeErrorReal } from "../../trabajador-tablero/lib/zonas.mjs";

/*
  Un envio de archivo que falla por red o por tiempo deja UNA linea [envio-medio] informativa
  (sin palabras de error): la vigilancia no la cuenta como falla nueva. Las demas fallas (un 500
  de la pasarela) siguen contando como error.
*/

const DATOS = {
  resultado: "fallo",
  canal: "evolution",
  tipo: "DOCUMENT",
  conversationId: "cv8273ff183c29151fd15ad09e",
  pesoKb: 14416,
  controlesMs: 43,
  gatewayMs: 5199,
  totalMs: 5645,
};

/** Corre `accion` capturando lo que sale por console.info y console.error. */
function capturarRegistro(accion: () => void) {
  const info: string[] = [];
  const error: string[] = [];
  const infoOriginal = console.info;
  const errorOriginal = console.error;
  console.info = (...args: unknown[]) => void info.push(args.map(String).join(" "));
  console.error = (...args: unknown[]) => void error.push(args.map(String).join(" "));
  try {
    accion();
  } finally {
    console.info = infoOriginal;
    console.error = errorOriginal;
  }
  return { info, error };
}

test("fetch failed: una sola linea [envio-medio] informativa con causa sin-conexion", () => {
  const { info, error } = capturarRegistro(() => {
    const { pasajera } = registrarEnvioDeMedio(DATOS, { falla: new Error("fetch failed") });
    assert.equal(pasajera, true);
  });
  assert.deepEqual(error, [], "no debe salir nada por console.error");
  assert.equal(info.length, 1, "una sola linea");
  const linea = info[0];
  assert.ok(linea.startsWith("[envio-medio] "));
  assert.ok(linea.includes('"causa":"sin-conexion"'), linea);
  assert.ok(linea.includes('"pesoKb":14416') && linea.includes('"gatewayMs":5199'), linea);
  assert.ok(!linea.includes("\n"), "sin saltos de linea");
  assert.equal(esLineaDeErrorReal(linea), false, `la vigilancia no la cuenta como falla: ${linea}`);
});

test("conexion rechazada (ECONNREFUSED / ECONNRESET): tambien sin-conexion y no cuenta como error", () => {
  for (const codigo of ["ECONNREFUSED", "ECONNRESET"]) {
    const falla = Object.assign(new Error(`connect ${codigo} 10.0.0.1:8080`), { code: codigo });
    const { linea, nivel } = lineaDeEnvioDeMedio(DATOS, { falla });
    assert.equal(nivel, "info");
    assert.ok(linea.includes('"causa":"sin-conexion"'), linea);
    assert.ok(!linea.includes(codigo), "sin el mensaje de la falla");
    assert.equal(esLineaDeErrorReal(linea), false, linea);
  }
});

test("TimeoutError: causa tardo-demasiado y no cuenta como error", () => {
  const falla = new Error("The operation was aborted due to timeout");
  falla.name = "TimeoutError";
  const { linea, nivel, pasajera } = lineaDeEnvioDeMedio(DATOS, { falla });
  assert.equal(nivel, "info");
  assert.equal(pasajera, true);
  assert.ok(linea.includes('"causa":"tardo-demasiado"'), linea);
  assert.equal(esLineaDeErrorReal(linea), false, linea);
});

test("Evolution respondió 500: sigue como error, con el detalle", () => {
  const { info, error } = capturarRegistro(() => {
    const { pasajera } = registrarEnvioDeMedio(DATOS, { falla: new Error("Evolution respondió 500") });
    assert.equal(pasajera, false);
  });
  assert.deepEqual(info, []);
  assert.equal(error.length, 1);
  const linea = error[0];
  assert.ok(linea.startsWith("[envio-medio] "));
  assert.ok(linea.includes('"causa":"http-500"'), linea);
  assert.ok(linea.includes('"error":"Evolution respondió 500"'), linea);
  assert.equal(esLineaDeErrorReal(linea), true, `la vigilancia si la cuenta como falla: ${linea}`);
});

test("la falla como texto (API oficial devuelve { error }): mismo criterio", () => {
  assert.equal(lineaDeEnvioDeMedio(DATOS, { falla: "fetch failed" }).nivel, "info");
  const rechazo = lineaDeEnvioDeMedio(DATOS, { falla: "Meta respondió 400" });
  assert.equal(rechazo.nivel, "error");
  assert.equal(esLineaDeErrorReal(rechazo.linea), true, rechazo.linea);
});

test("envio que salio: linea informativa sin causa", () => {
  const { linea, nivel } = lineaDeEnvioDeMedio({ resultado: "ok", canal: "evolution", gatewayMs: 300 });
  assert.equal(nivel, "info");
  assert.ok(!linea.includes('"causa"'));
  assert.equal(esLineaDeErrorReal(linea), false, linea);
});

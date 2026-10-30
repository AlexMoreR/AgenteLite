import { test } from "node:test";
import assert from "node:assert/strict";

import {
  ESPERAS_REINTENTO_MS,
  MAX_NO_ENVIADOS,
  MENSAJE_GATEWAY_TARDO,
  VIDA_NO_ENVIADO_MS,
  agregarFallosPorAnotar,
  clasificarFalloDelGateway,
  diaDeColombia,
  enviarConReintentos,
  falloDeRed,
  guardarNoEnviados,
  idDeMensajeValido,
  leerFallosPorAnotar,
  leerNoEnviados,
  leerRespuestaDelEnvio,
  motivoSeReintentaSolo,
  nuevoIdDeMensaje,
  resumirErroresDeEnvio,
  type NoEnviadoGuardado,
  type RespuestaDelEnvio,
} from "./chat-envio-reintento";

const sinEsperar = async () => {};

/*
  Un "servidor" de mentira con la misma regla que la ruta real: si el numero unico ya se envio,
  contesta "ya enviado" y NO lo vuelve a mandar a WhatsApp. Cuenta cuantas veces le llega cada texto
  al cliente, que es lo que importa: nunca mas de una.
*/
function servidorDePrueba(guion: Array<"sin_red" | "caido" | "rechazo" | "timeout" | "ok" | "respuesta_perdida">) {
  const entregadosAlCliente = new Map<string, number>();
  const idsRecibidos: string[] = [];
  let paso = 0;
  const enviar = async (clientMessageId: string): Promise<RespuestaDelEnvio> => {
    const accion = guion[Math.min(paso, guion.length - 1)];
    paso += 1;
    if (accion === "sin_red") {
      return falloDeRed();
    }
    idsRecibidos.push(clientMessageId);
    if ((entregadosAlCliente.get(clientMessageId) ?? 0) > 0) {
      return { ok: true, repetido: true };
    }
    if (accion === "caido") {
      return leerRespuestaDelEnvio(502, null);
    }
    if (accion === "rechazo") {
      return leerRespuestaDelEnvio(200, { ok: false, error: "WAHA respondio 500", motivo: "gateway_rechazo", reintentable: true });
    }
    if (accion === "timeout") {
      // El gateway tardo y SI lo mando: no se sabe desde aca.
      entregadosAlCliente.set(clientMessageId, 1);
      return leerRespuestaDelEnvio(200, { ok: false, error: MENSAJE_GATEWAY_TARDO, motivo: "timeout_gateway", reintentable: false });
    }
    entregadosAlCliente.set(clientMessageId, 1);
    if (accion === "respuesta_perdida") {
      // Salio, pero la respuesta no llego al navegador (se corto la señal).
      return falloDeRed();
    }
    return leerRespuestaDelEnvio(200, { ok: true });
  };
  return { enviar, entregadosAlCliente, idsRecibidos };
}

test("numero unico: valido, distinto cada vez, y rechaza basura", () => {
  const a = nuevoIdDeMensaje();
  const b = nuevoIdDeMensaje();
  assert.notEqual(a, b);
  assert.equal(idDeMensajeValido(a), a);
  assert.equal(idDeMensajeValido("  abcdEFGH-123_x "), "abcdEFGH-123_x");
  assert.equal(idDeMensajeValido("corto"), null);
  assert.equal(idDeMensajeValido("con espacio adentro 123"), null);
  assert.equal(idDeMensajeValido("'; DROP TABLE x; --"), null);
  assert.equal(idDeMensajeValido(null), null);
  assert.equal(idDeMensajeValido(123), null);
});

test("caida del gateway: se reintenta solo con el MISMO numero y llega una sola vez", async () => {
  const servidor = servidorDePrueba(["rechazo", "ok"]);
  const id = nuevoIdDeMensaje();
  const esperas: number[] = [];
  const { resultado, intentos } = await enviarConReintentos({
    enviar: () => servidor.enviar(id),
    esperar: async (ms) => {
      esperas.push(ms);
    },
  });
  assert.equal(resultado.ok, true);
  assert.equal(intentos, 2);
  assert.deepEqual(esperas, [ESPERAS_REINTENTO_MS[0]]);
  assert.equal(servidor.entregadosAlCliente.get(id), 1);
  assert.ok(servidor.idsRecibidos.every((recibido) => recibido === id));
});

test("caida de la conexion: sin red dos veces y despues sale; los que no llegaron quedan para anotar", async () => {
  const servidor = servidorDePrueba(["sin_red", "sin_red", "ok"]);
  const id = nuevoIdDeMensaje();
  const { resultado, intentos, sinLlegar } = await enviarConReintentos({ enviar: () => servidor.enviar(id), esperar: sinEsperar });
  assert.equal(resultado.ok, true);
  assert.equal(intentos, 3);
  assert.equal(sinLlegar.length, 2);
  assert.deepEqual(sinLlegar.map((fallo) => fallo.intento), [1, 2]);
  assert.equal(servidor.entregadosAlCliente.get(id), 1);
});

test("como mucho 2 reintentos: si sigue caido queda 'No se envió' y no se pierde", async () => {
  const servidor = servidorDePrueba(["caido"]);
  const { resultado, intentos } = await enviarConReintentos({ enviar: () => servidor.enviar("mensaje-1234"), esperar: sinEsperar });
  assert.equal(resultado.ok, false);
  assert.equal(intentos, 1 + ESPERAS_REINTENTO_MS.length);
  assert.equal(servidor.entregadosAlCliente.size, 0);
});

test("gateway que tardo: NO se reintenta solo; Reintentar con el mismo numero no lo duplica", async () => {
  const servidor = servidorDePrueba(["timeout", "ok"]);
  const id = "mensaje-timeout-1";
  const primero = await enviarConReintentos({ enviar: () => servidor.enviar(id), esperar: sinEsperar });
  assert.equal(primero.resultado.ok, false);
  assert.equal(primero.intentos, 1);
  // La asesora toca Reintentar: mismo numero.
  const reintento = await enviarConReintentos({ enviar: () => servidor.enviar(id), esperar: sinEsperar });
  assert.deepEqual(reintento.resultado, { ok: true, repetido: true });
  assert.equal(servidor.entregadosAlCliente.get(id), 1);
});

test("respuesta perdida en el camino: el reintento contesta 'ya enviado' y el cliente lo recibe una vez", async () => {
  const servidor = servidorDePrueba(["respuesta_perdida", "ok"]);
  const id = "mensaje-perdido-1";
  const { resultado } = await enviarConReintentos({ enviar: () => servidor.enviar(id), esperar: sinEsperar });
  assert.deepEqual(resultado, { ok: true, repetido: true });
  assert.equal(servidor.entregadosAlCliente.get(id), 1);
});

test("errores de validacion (chat equivocado, sin permiso) no se reintentan", async () => {
  let llamadas = 0;
  const { resultado } = await enviarConReintentos({
    enviar: async () => {
      llamadas += 1;
      return leerRespuestaDelEnvio(200, { ok: false, error: "No se envió: el mensaje iba para otro chat.", motivo: "otro", reintentable: false });
    },
    esperar: sinEsperar,
  });
  assert.equal(llamadas, 1);
  assert.equal(resultado.ok, false);
});

test("leerRespuestaDelEnvio: el proxy sin la app, 504 y cuerpos raros", () => {
  assert.deepEqual(leerRespuestaDelEnvio(502, null), {
    ok: false,
    error: "El servidor no respondió. Toca Reintentar.",
    motivo: "sin_red",
    reintentable: true,
  });
  const lento = leerRespuestaDelEnvio(504, "<html>");
  assert.equal(lento.ok, false);
  assert.equal(!lento.ok && lento.reintentable, false);
  assert.deepEqual(leerRespuestaDelEnvio(200, { ok: true, repetido: true, extra: 1 }), { ok: true, repetido: true });
  // El servidor no puede pedir reintento de algo que no es seguro.
  const forzado = leerRespuestaDelEnvio(200, { ok: false, error: "x", motivo: "timeout_gateway", reintentable: true });
  assert.equal(!forzado.ok && forzado.reintentable, false);
  const motivoRaro = leerRespuestaDelEnvio(200, { ok: false, motivo: "inventado" });
  assert.equal(!motivoRaro.ok && motivoRaro.motivo, "otro");
});

test("clasificarFalloDelGateway: tardo vs no estaba vs rechazo", () => {
  const timeout = Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
  assert.equal(clasificarFalloDelGateway(timeout), "timeout_gateway");
  assert.equal(clasificarFalloDelGateway(new Error("WhatsApp no respondio a tiempo (25s). Volve a intentar en un minuto.")), "timeout_gateway");
  assert.equal(clasificarFalloDelGateway(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })), "timeout_gateway");
  assert.equal(clasificarFalloDelGateway(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })), "conexion_cerrada");
  assert.equal(clasificarFalloDelGateway(new Error(MENSAJE_GATEWAY_TARDO)), "timeout_gateway");
  assert.equal(clasificarFalloDelGateway(new Error("connection closed")), "conexion_cerrada");
  assert.equal(clasificarFalloDelGateway(new Error("WAHA respondio 500")), "gateway_rechazo");
  assert.equal(motivoSeReintentaSolo("timeout_gateway"), false);
  assert.equal(motivoSeReintentaSolo("guardado_fallo"), false);
  assert.equal(motivoSeReintentaSolo("conexion_cerrada"), true);
});

function noEnviado(id: string, createdAt: number): NoEnviadoGuardado {
  return {
    id,
    conversationId: "cmabc",
    chatKey: "agent:cmabc",
    content: "*Ingrid*\nHola, ¿te sirve el envio?",
    matchContent: "Hola, ¿te sirve el envio?",
    campos: [
      ["message", "Hola, ¿te sirve el envio?"],
      ["clientMessageId", "id-unico-123"],
    ],
    createdAt,
    errorDetail: "Sin conexión",
  };
}

test("los 'No se envió' sobreviven a recargar: se guardan y se leen con su texto y su numero", () => {
  const ahora = Date.now();
  const texto = guardarNoEnviados([noEnviado("optimistic:1", ahora - 1000)]);
  const leidos = leerNoEnviados(texto, ahora);
  assert.equal(leidos.length, 1);
  assert.equal(leidos[0].matchContent, "Hola, ¿te sirve el envio?");
  assert.deepEqual(leidos[0].campos[1], ["clientMessageId", "id-unico-123"]);
});

test("leerNoEnviados descarta lo viejo, lo roto y lo que pasa del tope", () => {
  const ahora = Date.now();
  assert.deepEqual(leerNoEnviados("no es json", ahora), []);
  assert.deepEqual(leerNoEnviados(null, ahora), []);
  assert.deepEqual(leerNoEnviados(JSON.stringify([{ id: 1 }]), ahora), []);
  assert.deepEqual(leerNoEnviados(guardarNoEnviados([noEnviado("viejo", ahora - VIDA_NO_ENVIADO_MS - 1)]), ahora), []);
  const muchos = Array.from({ length: MAX_NO_ENVIADOS + 5 }, (_, i) => noEnviado(`m${i}`, ahora - i));
  assert.equal(leerNoEnviados(JSON.stringify(muchos), ahora).length, MAX_NO_ENVIADOS);
});

test("fallos por anotar: se suman con tope y se filtran los rotos", () => {
  const fallo = {
    conversationId: "cmabc",
    source: "agent" as const,
    motivo: "sin_red" as const,
    detalle: "Sin conexión",
    clientMessageId: "id-unico-123",
    intento: 1,
    ocurrioEn: Date.now(),
  };
  const lista = agregarFallosPorAnotar([], [fallo, fallo]);
  assert.equal(lista.length, 2);
  assert.equal(leerFallosPorAnotar(JSON.stringify([...lista, { motivo: "inventado" }])).length, 2);
  assert.deepEqual(leerFallosPorAnotar("{"), []);
});

test("medir: por dia (con los dias en cero), por linea y por motivo, en hora de Colombia", () => {
  assert.equal(diaDeColombia(new Date("2026-10-28T03:00:00Z")), "2026-10-27");
  const filas = [
    { createdAt: new Date("2026-10-27T15:00:00Z"), lineaId: "l1", lineaNombre: "Ventas 1", gateway: "WAHA", motivo: "timeout_gateway", origen: "servidor" },
    { createdAt: new Date("2026-10-27T16:00:00Z"), lineaId: "l1", lineaNombre: "Ventas 1", gateway: "WAHA", motivo: "sin_red", origen: "navegador" },
    { createdAt: new Date("2026-10-29T16:00:00Z"), lineaId: "l2", lineaNombre: "Ventas 2", gateway: "EVOLUTION_GO", motivo: "timeout_gateway", origen: "servidor" },
  ];
  const resumen = resumirErroresDeEnvio(filas, "2026-10-27", "2026-10-29");
  assert.equal(resumen.total, 3);
  assert.deepEqual(resumen.por_dia, [
    { dia: "2026-10-27", errores: 2 },
    { dia: "2026-10-28", errores: 0 },
    { dia: "2026-10-29", errores: 1 },
  ]);
  assert.deepEqual(resumen.por_linea[0], { linea: "Ventas 1", gateway: "WAHA", errores: 2 });
  assert.deepEqual(resumen.por_motivo[0], { motivo: "timeout_gateway", errores: 2 });
  assert.equal(resumen.sin_llegar_al_servidor, 1);
  assert.equal(resumen.promedio_por_dia, 1);
});

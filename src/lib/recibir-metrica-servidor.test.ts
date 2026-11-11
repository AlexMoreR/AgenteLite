import assert from "node:assert/strict";
import test from "node:test";

import type { MuestraServidor } from "./metricas-servidor";
import {
  CLAVE_ESTADO_ALERTA_CPU,
  leerEstadoAlertaCpu,
  recibirMetricaServidor,
  type PiezasDeMetrica,
  type ResultadoDelAviso,
} from "./recibir-metrica-servidor";
import { autorizadoPorElReloj } from "./secreto-del-reloj";

const SECRETO = "secreto-de-prueba-del-reloj";
process.env.FOLLOW_CRON_SECRET = SECRETO;
delete process.env.DAILY_REPORT_CRON_SECRET;
delete process.env.EVOLUTION_WEBHOOK_SECRET;

const MINUTO = 60_000;

function cabeceras(valores: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(valores).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (nombre: string) => mapa.get(nombre.toLowerCase()) ?? null };
}

function foto(cpuTotal: number): Record<string, unknown> {
  return {
    cpuTotal,
    load1: 1,
    nucleos: 4,
    memUsadaMb: 4096,
    memTotalMb: 8192,
    swapUsadoMb: 0,
    discoUsadoGb: 120,
    discoTotalGb: 193,
    contenedores: [
      { nombre: "crm-aizenbot_app.1", cpu: 70, memMb: 900, memLimiteMb: null },
      { nombre: "crm-postgres", cpu: 20, memMb: 1200 },
    ],
  };
}

// Base, WhatsApp y reloj simulados: la prueba nunca toca Prisma ni manda nada.
function simular(opciones: { aviso?: ResultadoDelAviso; fallaGuardar?: boolean } = {}) {
  let ahora = new Date("2026-11-11T15:00:00Z");
  const fotos: Array<{ muestra: MuestraServidor; tomadaEn: Date }> = [];
  const ajustes = new Map<string, string>();
  const avisos: Array<{ titulo: string; texto: string }> = [];
  const piezas: PiezasDeMetrica = {
    ahora: () => ahora,
    autorizado: autorizadoPorElReloj,
    guardar: async (muestra, tomadaEn) => {
      if (opciones.fallaGuardar) throw new Error("base caída");
      fotos.push({ muestra, tomadaEn });
    },
    borrarAntesDe: async (fecha) => {
      const antes = fotos.length;
      for (let i = fotos.length - 1; i >= 0; i--) if (fotos[i].tomadaEn < fecha) fotos.splice(i, 1);
      return antes - fotos.length;
    },
    ultimas: async (cuantas) =>
      [...fotos]
        .sort((a, b) => b.tomadaEn.getTime() - a.tomadaEn.getTime())
        .slice(0, cuantas)
        .map((f) => f.muestra),
    leerEstado: async () => ajustes.get(CLAVE_ESTADO_ALERTA_CPU) ?? null,
    guardarEstado: async (valor) => {
      ajustes.set(CLAVE_ESTADO_ALERTA_CPU, valor);
    },
    avisar: async (pedido) => {
      avisos.push({ titulo: pedido.titulo, texto: pedido.texto });
      return opciones.aviso ?? { mandada: true, motivo: null };
    },
    registrar: () => {},
  };
  return {
    piezas,
    fotos,
    ajustes,
    avisos,
    avanzar: (ms: number) => {
      ahora = new Date(ahora.getTime() + ms);
    },
    enviar: (cuerpo: unknown, headers = cabeceras({ "x-follow-cron-secret": SECRETO })) =>
      recibirMetricaServidor({ headers, leerJson: async () => cuerpo }, piezas),
  };
}

test("sin cabecera de secreto → 401 y no guarda nada", async () => {
  const s = simular();
  const r = await s.enviar(foto(10), cabeceras());
  assert.equal(r.status, 401);
  assert.equal(r.cuerpo.ok, false);
  assert.equal(s.fotos.length, 0);
});

test("con un secreto equivocado → 401, en cualquier cabecera", async () => {
  const s = simular();
  for (const nombre of ["x-daily-report-secret", "x-follow-cron-secret", "x-webhook-secret", "authorization"]) {
    const valor = nombre === "authorization" ? "Bearer otro-secreto" : "otro-secreto";
    const r = await s.enviar(foto(10), cabeceras({ [nombre]: valor }));
    assert.equal(r.status, 401, nombre);
  }
  assert.equal(s.fotos.length, 0);
});

test("sin ningún secreto configurado en el servidor nadie pasa", async () => {
  const guardado = process.env.FOLLOW_CRON_SECRET;
  delete process.env.FOLLOW_CRON_SECRET;
  try {
    const s = simular();
    const r = await s.enviar(foto(10), cabeceras({ "x-follow-cron-secret": "" }));
    assert.equal(r.status, 401);
  } finally {
    process.env.FOLLOW_CRON_SECRET = guardado;
  }
});

test("el secreto bueno sirve por Authorization: Bearer", async () => {
  const s = simular();
  const r = await s.enviar(foto(10), cabeceras({ authorization: `Bearer ${SECRETO}` }));
  assert.equal(r.status, 200);
});

test("cuerpo roto con secreto bueno → 400 y no guarda nada", async () => {
  const s = simular();
  const noEsJson = await recibirMetricaServidor(
    {
      headers: cabeceras({ "x-follow-cron-secret": SECRETO }),
      leerJson: async () => {
        throw new SyntaxError("Unexpected token");
      },
    },
    s.piezas,
  );
  assert.equal(noEsJson.status, 400);
  assert.equal(noEsJson.cuerpo.ok, false);

  const sinCampos = await s.enviar({ cpuTotal: "mucho" });
  assert.equal(sinCampos.status, 400);
  assert.match(String(sinCampos.cuerpo.error), /cpuTotal/);

  const lista = await s.enviar([1, 2, 3]);
  assert.equal(lista.status, 400);
  assert.equal(s.fotos.length, 0);
});

test("foto buena → 200, la guarda y borra las de más de 7 días", async () => {
  const s = simular();
  await s.enviar(foto(10));
  s.avanzar(8 * 24 * 60 * MINUTO);
  const r = await s.enviar(foto(12));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);
  assert.equal(r.cuerpo.guardada, true);
  assert.equal(r.cuerpo.borradas, 1);
  assert.equal(s.fotos.length, 1);
  assert.deepEqual(r.cuerpo.alerta, { evaluada: true, mandada: false, motivo: "CPU normal" });
});

test("si no se puede guardar la foto → 500 sin detalles internos", async () => {
  const s = simular({ fallaGuardar: true });
  const r = await s.enviar(foto(10));
  assert.equal(r.status, 500);
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /base caída/);
});

test("5 fotos seguidas por encima de 85 % → avisa una vez y repite a los 60 min", async () => {
  const s = simular();
  for (let i = 0; i < 4; i++) {
    const r = await s.enviar(foto(95));
    assert.equal((r.cuerpo.alerta as { mandada: boolean }).mandada, false);
    s.avanzar(MINUTO);
  }
  const quinta = await s.enviar(foto(95));
  assert.deepEqual(quinta.cuerpo.alerta, { evaluada: true, mandada: true, motivo: null });
  assert.equal(s.avisos.length, 1);
  assert.equal(s.avisos[0].titulo, "Servidor con CPU alta");
  assert.match(s.avisos[0].texto, /CPU alta: 95 %/);
  assert.equal(leerEstadoAlertaCpu(s.ajustes.get(CLAVE_ESTADO_ALERTA_CPU)).activa, true);

  s.avanzar(MINUTO);
  const sexta = await s.enviar(foto(95));
  assert.equal((sexta.cuerpo.alerta as { mandada: boolean }).mandada, false);
  assert.equal(s.avisos.length, 1);

  s.avanzar(60 * MINUTO);
  await s.enviar(foto(95));
  assert.equal(s.avisos.length, 2);
});

test("envío bloqueado (interruptor o uno por día) → ok:true, mandada:false con el motivo, y el estado igual se guarda", async () => {
  const s = simular({ aviso: { mandada: false, motivo: "interruptor apagado: no se mandó" } });
  for (let i = 0; i < 5; i++) {
    await s.enviar(foto(99));
    s.avanzar(MINUTO);
  }
  const r = await s.enviar(foto(99));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);
  assert.equal(s.avisos.length, 1, "no se reintenta cada minuto");
  const estado = leerEstadoAlertaCpu(s.ajustes.get(CLAVE_ESTADO_ALERTA_CPU));
  assert.equal(estado.activa, true);
  assert.ok(estado.ultimoEnvio);
});

test("el aviso que se bloquea devuelve su motivo en la respuesta", async () => {
  const s = simular({ aviso: { mandada: false, motivo: "ya se le mandó hoy" } });
  let ultima;
  for (let i = 0; i < 5; i++) {
    ultima = await s.enviar(foto(99));
    s.avanzar(MINUTO);
  }
  assert.deepEqual(ultima?.cuerpo.alerta, { evaluada: true, mandada: false, motivo: "ya se le mandó hoy" });
});

test("si el aviso lanza, la foto queda guardada y responde 200", async () => {
  const s = simular();
  s.piezas.avisar = async () => {
    throw new Error("gateway caído");
  };
  let ultima;
  for (let i = 0; i < 5; i++) {
    ultima = await s.enviar(foto(99));
    s.avanzar(MINUTO);
  }
  assert.equal(ultima?.status, 200);
  assert.equal(s.fotos.length, 5);
  assert.deepEqual(ultima?.cuerpo.alerta, { evaluada: true, mandada: false, motivo: "el envío del WhatsApp falló" });
});

test("cuando la CPU baja, la alerta se apaga", async () => {
  const s = simular();
  for (let i = 0; i < 5; i++) {
    await s.enviar(foto(99));
    s.avanzar(MINUTO);
  }
  await s.enviar(foto(20));
  assert.equal(leerEstadoAlertaCpu(s.ajustes.get(CLAVE_ESTADO_ALERTA_CPU)).activa, false);
});

test("el estado guardado roto se lee como sin alerta", () => {
  assert.deepEqual(leerEstadoAlertaCpu("{roto"), { activa: false, ultimoEnvio: null });
  assert.deepEqual(leerEstadoAlertaCpu(null), { activa: false, ultimoEnvio: null });
  assert.deepEqual(leerEstadoAlertaCpu('{"activa":true,"ultimoEnvio":"2026-11-11T10:00:00.000Z"}'), {
    activa: true,
    ultimoEnvio: "2026-11-11T10:00:00.000Z",
  });
});

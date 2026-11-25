import assert from "node:assert/strict";
import test from "node:test";

import type { ConsultaLenta, MuestraServidor } from "./metricas-servidor";
import {
  CLAVE_CONSULTAS_LENTAS,
  CLAVE_ESTADO_ALERTA_CPU,
  CLAVE_ESTADO_ALERTA_CPU_BASE,
  TITULO_ALERTA_CPU_BASE,
  TITULO_ALERTA_CONSULTAS_LENTAS,
  leerEstadoAlertaCpu,
  leerEstadoConsultasLentas,
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
function simular(
  opciones: {
    aviso?: ResultadoDelAviso;
    fallaGuardar?: boolean;
    consultasLentas?: () => Promise<ConsultaLenta[]>;
  } = {},
) {
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
    ultimosContenedores: async (cuantas) =>
      [...fotos]
        .sort((a, b) => b.tomadaEn.getTime() - a.tomadaEn.getTime())
        .slice(0, cuantas)
        .map((f) => f.muestra.contenedores as unknown),
    leerEstadoBase: async () => ajustes.get(CLAVE_ESTADO_ALERTA_CPU_BASE) ?? null,
    guardarEstadoBase: async (valor) => {
      ajustes.set(CLAVE_ESTADO_ALERTA_CPU_BASE, valor);
    },
    // Por defecto la base no tiene consultas lentas.
    leerConsultasLentas: opciones.consultasLentas ?? (async () => []),
    leerEstadoConsultas: async () => ajustes.get(CLAVE_CONSULTAS_LENTAS) ?? null,
    guardarEstadoConsultas: async (valor) => {
      ajustes.set(CLAVE_CONSULTAS_LENTAS, valor);
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

// ---------------------------------------------------------------------------------------------------------
// Aviso "Base de datos saturada".
// ---------------------------------------------------------------------------------------------------------

/** Una foto con el servidor tranquilo (CPU total 10 %) y Postgres en `cpuBase` %. */
function fotoConBase(cpuBase: number): Record<string, unknown> {
  return {
    ...foto(10),
    contenedores: [
      { nombre: "crm-aizenbot_app.1", cpu: 30, memMb: 900, memLimiteMb: null },
      { nombre: "crm-postgres", cpu: cpuBase, memMb: 1200, memLimiteMb: 4096 },
    ],
  };
}

const avisosDeLaBase = (s: ReturnType<typeof simular>) => s.avisos.filter((a) => a.titulo === TITULO_ALERTA_CPU_BASE);

test("3 fotos con Postgres en 250 % → avisa \"Base de datos saturada\"", async () => {
  const s = simular();
  for (let i = 0; i < 2; i++) {
    const r = await s.enviar(fotoConBase(250));
    assert.equal((r.cuerpo.alertaBase as { mandada: boolean }).mandada, false);
    s.avanzar(MINUTO);
  }
  const tercera = await s.enviar(fotoConBase(250));
  assert.equal(tercera.status, 200);
  assert.deepEqual(tercera.cuerpo.alertaBase, { evaluada: true, mandada: true, motivo: null });
  assert.equal(s.avisos.length, 1, "la alerta de CPU del servidor no suena");
  assert.equal(s.avisos[0].titulo, "Base de datos saturada");
  assert.match(s.avisos[0].texto, /crm-postgres usa 250 % de CPU/);
  assert.equal(leerEstadoAlertaCpu(s.ajustes.get(CLAVE_ESTADO_ALERTA_CPU_BASE)).activa, true);
  assert.equal(s.ajustes.has(CLAVE_ESTADO_ALERTA_CPU), false, "no toca el estado de la alerta de CPU");
});

test("3 fotos con Postgres en 200 % exacto → no avisa", async () => {
  const s = simular();
  let ultima;
  for (let i = 0; i < 3; i++) {
    ultima = await s.enviar(fotoConBase(200));
    s.avanzar(MINUTO);
  }
  assert.equal(avisosDeLaBase(s).length, 0);
  assert.deepEqual(ultima?.cuerpo.alertaBase, { evaluada: true, mandada: false, motivo: "CPU normal" });
});

test("el aviso de la base no se repite antes de 60 min", async () => {
  const s = simular();
  for (let i = 0; i < 3; i++) {
    await s.enviar(fotoConBase(250));
    s.avanzar(MINUTO);
  }
  assert.equal(avisosDeLaBase(s).length, 1);
  for (let i = 0; i < 50; i++) {
    await s.enviar(fotoConBase(250));
    s.avanzar(MINUTO);
  }
  assert.equal(avisosDeLaBase(s).length, 1, "sigue saturada, pero no pasaron 60 min");
  s.avanzar(10 * MINUTO);
  await s.enviar(fotoConBase(250));
  assert.equal(avisosDeLaBase(s).length, 2);
});

test("si la pieza nueva lanza, la foto queda guardada y responde 200", async () => {
  const s = simular();
  s.piezas.ultimosContenedores = async () => {
    throw new Error("base caída");
  };
  const r = await s.enviar(fotoConBase(250));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.ok, true);
  assert.equal(s.fotos.length, 1);
  assert.equal((r.cuerpo.alertaBase as { evaluada: boolean }).evaluada, false);
  assert.doesNotMatch(JSON.stringify(r.cuerpo), /base caída/);

  const t = simular();
  t.piezas.guardarEstadoBase = async () => {
    throw new Error("no guarda");
  };
  t.piezas.avisar = async () => {
    throw new Error("gateway caído");
  };
  let ultima;
  for (let i = 0; i < 3; i++) {
    ultima = await t.enviar(fotoConBase(250));
    t.avanzar(MINUTO);
  }
  assert.equal(ultima?.status, 200);
  assert.equal(t.fotos.length, 3);
});

test("una foto sin contenedor de la base no avisa y lo dice", async () => {
  const s = simular();
  const r = await s.enviar({ ...foto(10), contenedores: [{ nombre: "crm-aizenbot_app.1", cpu: 300, memMb: 900 }] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.alertaBase, { evaluada: true, mandada: false, motivo: "la foto no trae el contenedor de la base" });
});

// ---------------------------------------------------------------------------------------------------------
// Consultas lentas de la base
// ---------------------------------------------------------------------------------------------------------

const CONSULTA_DE_15_S: ConsultaLenta = {
  base: "aizen_crm",
  segundos: 15,
  texto: `SELECT * FROM "public"."Message" WHERE phone = '573001234567'`,
};

test("consultas lentas: 2 llamadas seguidas con una consulta de 15 s avisan \"Base de datos con consultas lentas\"", async () => {
  const s = simular({ consultasLentas: async () => [CONSULTA_DE_15_S] });
  const primera = await s.enviar(foto(10));
  assert.equal(primera.status, 200);
  assert.equal(s.avisos.length, 0);
  s.avanzar(MINUTO);
  const segunda = await s.enviar(foto(10));
  assert.equal(segunda.status, 200);
  const avisos = s.avisos.filter((a) => a.titulo === TITULO_ALERTA_CONSULTAS_LENTAS);
  assert.equal(avisos.length, 1);
  assert.equal(avisos[0].titulo, "Base de datos con consultas lentas");
  assert.match(avisos[0].texto, /Message/);
  assert.match(avisos[0].texto, /aizen_crm/);
  assert.doesNotMatch(avisos[0].texto, /573001234567/);
  assert.equal((segunda.cuerpo.consultasLentas as { mandada: boolean }).mandada, true);

  const guardado = leerEstadoConsultasLentas(s.ajustes.get(CLAVE_CONSULTAS_LENTAS));
  assert.equal(guardado.leidaEn, new Date("2026-11-11T15:01:00Z").toISOString());
  assert.equal(guardado.rachaDeFotos, 2);
  assert.equal(guardado.ultimoAvisoEn, guardado.leidaEn);
  assert.equal(guardado.consultas.length, 1);
  assert.deepEqual(
    { base: guardado.consultas[0].base, segundos: guardado.consultas[0].segundos },
    { base: "aizen_crm", segundos: 15 },
  );
  assert.doesNotMatch(s.ajustes.get(CLAVE_CONSULTAS_LENTAS) ?? "", /573001234567/);

  // A los 30 min no repite; a los 60 sí.
  s.avanzar(29 * MINUTO);
  await s.enviar(foto(10));
  assert.equal(s.avisos.filter((a) => a.titulo === TITULO_ALERTA_CONSULTAS_LENTAS).length, 1);
  s.avanzar(31 * MINUTO);
  await s.enviar(foto(10));
  assert.equal(s.avisos.filter((a) => a.titulo === TITULO_ALERTA_CONSULTAS_LENTAS).length, 2);
});

test("consultas lentas: una sola llamada con consulta lenta no avisa", async () => {
  const s = simular({ consultasLentas: async () => [CONSULTA_DE_15_S] });
  const r = await s.enviar(foto(10));
  assert.equal(r.status, 200);
  assert.equal(s.avisos.length, 0);
  const guardado = leerEstadoConsultasLentas(s.ajustes.get(CLAVE_CONSULTAS_LENTAS));
  assert.equal(guardado.rachaDeFotos, 1);
  assert.equal(guardado.consultas.length, 1);
});

test("consultas lentas: una foto sin consultas en medio vuelve a empezar la racha", async () => {
  let hay = true;
  const s = simular({ consultasLentas: async () => (hay ? [CONSULTA_DE_15_S] : []) });
  await s.enviar(foto(10));
  hay = false;
  s.avanzar(MINUTO);
  await s.enviar(foto(10));
  assert.equal(leerEstadoConsultasLentas(s.ajustes.get(CLAVE_CONSULTAS_LENTAS)).rachaDeFotos, 0);
  hay = true;
  s.avanzar(MINUTO);
  await s.enviar(foto(10));
  assert.equal(s.avisos.length, 0);
});

test("consultas lentas: si leerConsultasLentas lanza un error, responde 200, guarda la foto y no toca leidaEn", async () => {
  let falla = false;
  const s = simular({
    consultasLentas: async () => {
      if (falla) throw new Error("permiso denegado para pg_stat_activity");
      return [];
    },
  });
  await s.enviar(foto(10));
  const antes = s.ajustes.get(CLAVE_CONSULTAS_LENTAS);
  assert.ok(antes);
  falla = true;
  s.avanzar(MINUTO);
  const r = await s.enviar(foto(10));
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.guardada, true);
  assert.equal(s.fotos.length, 2);
  const consultasLentas = r.cuerpo.consultasLentas as { evaluada: boolean; motivo: string };
  assert.equal(consultasLentas.evaluada, false);
  assert.match(consultasLentas.motivo, /no se pudieron leer/);
  assert.equal(s.ajustes.get(CLAVE_CONSULTAS_LENTAS), antes);
});

test("consultas lentas: el estado guardado roto se lee como vacío", () => {
  assert.deepEqual(leerEstadoConsultasLentas("{roto"), { leidaEn: null, consultas: [], rachaDeFotos: 0, ultimoAvisoEn: null });
  assert.deepEqual(leerEstadoConsultasLentas(null).consultas, []);
});

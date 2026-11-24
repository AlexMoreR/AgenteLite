import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { ORIGEN_MARKETPLACE } from "@/features/alertas/dominio/reglas";

import {
  CLAVE_ALERTA_IP,
  CLAVE_ALERTA_TUNEL,
  CLAVE_ULTIMO_CHEQUEO_NETMAGI,
  TEXTO_TUNEL_CAIDO,
  describirUltimoChequeoNetmagi,
  leerUltimoChequeoNetmagi,
  recibirEstadoProxyNetmagi,
  type PiezasDeProxyNetmagi,
} from "./recibir-estado-proxy-netmagi";
import { autorizadoPorElReloj } from "./secreto-del-reloj";

const SECRETO = "secreto-de-prueba-del-reloj";
process.env.FOLLOW_CRON_SECRET = SECRETO;
delete process.env.DAILY_REPORT_CRON_SECRET;
delete process.env.EVOLUTION_WEBHOOK_SECRET;

const NEGOCIO = "negocio-magilus";

function cabeceras(valores: Record<string, string> = {}) {
  const mapa = new Map(Object.entries(valores).map(([k, v]) => [k.toLowerCase(), v]));
  return { get: (nombre: string) => mapa.get(nombre.toLowerCase()) ?? null };
}

type AlertaSimulada = { clave: string; titulo: string; detalle: string; origen: string; estado: "NUEVA" | "RESUELTA"; veces: number };

// Base simulada con la misma regla de registrarAlerta: una sola alerta abierta por clave (si sigue abierta, se refresca).
function simular() {
  const alertas: AlertaSimulada[] = [];
  const ajustes = new Map<string, string>();
  const registros: string[] = [];
  const piezas: PiezasDeProxyNetmagi = {
    ahora: () => new Date("2026-11-24T15:00:00Z"),
    autorizado: autorizadoPorElReloj,
    buscarNegocio: async () => NEGOCIO,
    registrarAlerta: async (pedido) => {
      assert.equal(pedido.workspaceId, NEGOCIO);
      const abierta = alertas.find((a) => a.clave === pedido.clave && a.estado === "NUEVA");
      if (abierta) {
        abierta.veces += 1;
        return { creada: false };
      }
      alertas.push({ clave: pedido.clave, titulo: pedido.titulo, detalle: pedido.detalle, origen: pedido.origen, estado: "NUEVA", veces: 1 });
      return { creada: true };
    },
    resolverPorClave: async (workspaceId, clave) => {
      assert.equal(workspaceId, NEGOCIO);
      let cerradas = 0;
      for (const a of alertas) {
        if (a.clave !== clave || a.estado !== "NUEVA") continue;
        a.estado = "RESUELTA";
        cerradas++;
      }
      return cerradas;
    },
    leerAjuste: async () => ajustes.get(CLAVE_ULTIMO_CHEQUEO_NETMAGI) ?? null,
    guardarAjuste: async (valor) => void ajustes.set(CLAVE_ULTIMO_CHEQUEO_NETMAGI, valor),
    registrar: (mensaje) => void registros.push(mensaje),
  };
  const mandar = (cuerpo: unknown, headers: Record<string, string> = { "x-follow-cron-secret": SECRETO }) =>
    recibirEstadoProxyNetmagi({ headers: cabeceras(headers), leerJson: async () => cuerpo }, piezas);
  const abiertas = () => alertas.filter((a) => a.estado === "NUEVA");
  return { alertas, abiertas, ajustes, registros, mandar, piezas };
}

test("sin secreto da 401 y no toca nada", async () => {
  const s = simular();
  const r = await s.mandar({ fuente: "tunel", puertoAbierto: false }, {});
  assert.equal(r.status, 401);
  const mal = await s.mandar({ fuente: "tunel", puertoAbierto: false }, { "x-follow-cron-secret": "otro" });
  assert.equal(mal.status, 401);
  assert.equal(s.alertas.length, 0);
  assert.equal(s.ajustes.size, 0);
});

test("túnel caído crea una sola alerta aunque llegue dos veces", async () => {
  const s = simular();
  assert.equal((await s.mandar({ fuente: "tunel", puertoAbierto: false })).status, 200);
  assert.equal((await s.mandar({ fuente: "tunel", puertoAbierto: false })).status, 200);
  assert.equal(s.alertas.length, 1);
  const [alerta] = s.alertas;
  assert.equal(alerta.clave, CLAVE_ALERTA_TUNEL);
  assert.equal(alerta.titulo, TEXTO_TUNEL_CAIDO);
  assert.equal(alerta.titulo, "El túnel de aizen1 no responde (puerto 1080 cerrado). Las cuentas que salen por ese túnel están sin internet.");
  assert.doesNotMatch(alerta.titulo, /mf\d/);
  assert.equal(alerta.origen, ORIGEN_MARKETPLACE);
  assert.equal(alerta.veces, 2);
  const chequeo = leerUltimoChequeoNetmagi(s.ajustes.get(CLAVE_ULTIMO_CHEQUEO_NETMAGI));
  assert.equal(chequeo?.tunel, "caido");
  assert.equal(chequeo?.fuente, "tunel");
});

test("túnel vuelve y la alerta se cierra", async () => {
  const s = simular();
  await s.mandar({ fuente: "tunel", puertoAbierto: false });
  const r = await s.mandar({ fuente: "tunel", puertoAbierto: true });
  assert.equal(r.status, 200);
  assert.deepEqual(r.cuerpo.cerradas, [CLAVE_ALERTA_TUNEL]);
  assert.equal(s.abiertas().length, 0);
  assert.equal(leerUltimoChequeoNetmagi(s.ajustes.get(CLAVE_ULTIMO_CHEQUEO_NETMAGI))?.tunel, "bien");
});

test("IP distinta crea la alerta de IP; la misma IP la cierra", async () => {
  const s = simular();
  await s.mandar({ fuente: "tunel", puertoAbierto: true, ipSalida: "190.1.2.3", ipEsperada: "13.140.235.16" });
  assert.equal(s.abiertas().length, 1);
  const [alerta] = s.abiertas();
  assert.equal(alerta.clave, CLAVE_ALERTA_IP);
  assert.equal(
    alerta.titulo,
    "La IP de salida del túnel cambió: se esperaba 13.140.235.16 y ahora sale 190.1.2.3. No se cambió nada; revisa antes de usar las cuentas.",
  );
  await s.mandar({ fuente: "tunel", puertoAbierto: true, ipSalida: "13.140.235.16", ipEsperada: "13.140.235.16" });
  assert.equal(s.abiertas().length, 0);
});

test("mf11 con error crea «mf11 (Sofía): sin conexión por el proxy…» una sola vez, y ok la cierra", async () => {
  const s = simular();
  const aviso = { fuente: "cuenta", navegador: "mf11", cuenta: "Sofía", error: "ERR_PROXY_CONNECTION_FAILED" };
  assert.equal((await s.mandar(aviso)).status, 200);
  assert.equal((await s.mandar(aviso)).status, 200);
  assert.equal(s.alertas.length, 1);
  assert.equal(s.alertas[0].clave, "netmagi:proxy:mf11");
  assert.equal(s.alertas[0].titulo, "mf11 (Sofía): sin conexión por el proxy. Revisa que aizen1 esté encendido y el túnel activo.");
  assert.match(s.alertas[0].detalle, /ERR_PROXY_CONNECTION_FAILED/);

  const ok = await s.mandar({ fuente: "cuenta", navegador: "mf11", estado: "ok" });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.cuerpo.cerradas, ["netmagi:proxy:mf11"]);
  assert.equal(s.abiertas().length, 0);
});

test("el aviso de cuenta conserva el último estado del túnel en el chequeo", async () => {
  const s = simular();
  await s.mandar({ fuente: "tunel", puertoAbierto: false });
  await s.mandar({ fuente: "cuenta", navegador: "mf3", cuenta: "Laura", error: "ERR_TUNNEL_CONNECTION_FAILED" });
  const chequeo = leerUltimoChequeoNetmagi(s.ajustes.get(CLAVE_ULTIMO_CHEQUEO_NETMAGI));
  assert.equal(chequeo?.fuente, "cuenta");
  assert.equal(chequeo?.tunel, "caido");
  assert.equal(describirUltimoChequeoNetmagi(chequeo, new Date("2026-11-24T15:07:00Z")).startsWith("último chequeo hace 7 min: túnel caído"), true);
  assert.equal(describirUltimoChequeoNetmagi(null, new Date()), "sin chequeos todavía");
});

test("cuerpo mal formado da 400 sin romper nada", async () => {
  const s = simular();
  const malos: unknown[] = [
    null,
    [],
    "hola",
    {},
    { fuente: "otra" },
    { fuente: "tunel" },
    { fuente: "tunel", puertoAbierto: "no" },
    { fuente: "tunel", puertoAbierto: true, ipSalida: "<script>" },
    { fuente: "cuenta", navegador: "chrome1", cuenta: "Sofía", error: "ERR_PROXY_CONNECTION_FAILED" },
    { fuente: "cuenta", navegador: "mf", estado: "ok" },
    { fuente: "cuenta", navegador: "mf11", cuenta: "Sofía", error: "OTRO_ERROR" },
    { fuente: "cuenta", navegador: "mf11", error: "ERR_PROXY_CONNECTION_FAILED" },
    { fuente: "cuenta", navegador: "mf11", estado: "mal" },
  ];
  for (const cuerpo of malos) {
    const r = await s.mandar(cuerpo);
    assert.equal(r.status, 400, JSON.stringify(cuerpo));
    assert.equal(r.cuerpo.ok, false);
    assert.equal(typeof r.cuerpo.error, "string");
  }
  const roto = await recibirEstadoProxyNetmagi(
    { headers: cabeceras({ "x-follow-cron-secret": SECRETO }), leerJson: async () => JSON.parse("{roto") },
    s.piezas,
  );
  assert.equal(roto.status, 400);
  assert.equal(s.alertas.length, 0);
  assert.equal(s.ajustes.size, 0);
  // Después de los malos, uno bueno sigue funcionando.
  assert.equal((await s.mandar({ fuente: "tunel", puertoAbierto: false })).status, 200);
  assert.equal(s.alertas.length, 1);
});

test("si falla guardar el chequeo, la alerta igual queda y responde 200", async () => {
  const s = simular();
  s.piezas.guardarAjuste = async () => {
    throw new Error("base caída");
  };
  const r = await s.mandar({ fuente: "tunel", puertoAbierto: false });
  assert.equal(r.status, 200);
  assert.equal(r.cuerpo.chequeoGuardado, false);
  assert.equal(s.alertas.length, 1);
  assert.equal(s.registros.length, 1);
});

test("la ruta usa el secreto del reloj, las alertas de siempre y no manda WhatsApp", () => {
  const raiz = process.cwd();
  const ruta = readFileSync(path.join(raiz, "src/app/api/cron/proxy-netmagi/route.ts"), "utf8");
  assert.match(ruta, /autorizado: autorizadoPorElReloj/);
  assert.match(ruta, /registrarAlerta/);
  assert.match(ruta, /resolverAlertasPorClave/);
  assert.match(ruta, /NETMAGI_WORKSPACE_ID/);
  assert.doesNotMatch(ruta, /mandarWhatsApp|enviar:|agentes-de-area/);
  assert.doesNotMatch(ruta, /export async function GET/);
});

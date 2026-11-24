// NETMAGI (parte 1): lo que hace POST /api/cron/proxy-netmagi.
//
// Recibe el estado del túnel SOCKS de aizen1 (por donde salen las cuentas de Marketplace mf1 a mf14) y el de cada
// cuenta, y abre o cierra alertas en /cliente/alertas. Solo lee y avisa: nunca cambia IPs, proxies ni cuentas, y
// no sale nada por WhatsApp (no se pasa `enviar` a registrarAlerta).
//
// Este archivo no importa la base: la ruta le pasa esas piezas (registrar alerta, resolver por clave, leer y guardar
// el ajuste, buscar el negocio). Así las pruebas corren sin base (src/lib/recibir-estado-proxy-netmagi.test.ts).

import { ORIGEN_MARKETPLACE, type Prioridad } from "@/features/alertas/dominio/reglas";

/** Una sola fila de AppSetting con el último chequeo: {fecha, fuente, resultado, tunel}. */
export const CLAVE_ULTIMO_CHEQUEO_NETMAGI = "netmagi_proxy_ultimo_chequeo";
export const CLAVE_ALERTA_TUNEL = "netmagi:tunel";
export const CLAVE_ALERTA_IP = "netmagi:ip";
export const claveAlertaDeCuenta = (navegador: string) => `netmagi:proxy:${navegador}`;

export const TEXTO_TUNEL_CAIDO =
  "El túnel de aizen1 no responde (puerto 1080 cerrado). Las cuentas que salen por ese túnel están sin internet.";
export const textoIpCambiada = (esperada: string, salida: string) =>
  `La IP de salida del túnel cambió: se esperaba ${esperada} y ahora sale ${salida}. No se cambió nada; revisa antes de usar las cuentas.`;
export const textoCuentaSinProxy = (navegador: string, cuenta: string) =>
  `${navegador} (${cuenta}): sin conexión por el proxy. Revisa que aizen1 esté encendido y el túnel activo.`;

export const ERRORES_DE_PROXY = ["ERR_PROXY_CONNECTION_FAILED", "ERR_TUNNEL_CONNECTION_FAILED"] as const;
export type ErrorDeProxy = (typeof ERRORES_DE_PROXY)[number];

const PRIORIDAD: Prioridad = "ALTA";
const RE_NAVEGADOR = /^mf\d{1,3}$/;
// Solo números, letras hex, puntos y dos puntos (IPv4 o IPv6): nada de texto libre en la alerta.
const RE_IP = /^[0-9a-fA-F.:]{2,45}$/;
const MAXIMO_NOMBRE = 60;

export type AvisoNetmagi =
  | { fuente: "tunel"; puertoAbierto: boolean; ipSalida: string | null; ipEsperada: string | null }
  | { fuente: "cuenta"; navegador: string; cuenta: string; error: ErrorDeProxy }
  | { fuente: "cuenta"; navegador: string; estado: "ok" };

export type EstadoDelTunel = "bien" | "caido";

export type UltimoChequeoNetmagi = {
  fecha: string;
  fuente: "tunel" | "cuenta";
  resultado: string;
  /** El último estado conocido del túnel (se conserva cuando llega un aviso de cuenta). */
  tunel: EstadoDelTunel | null;
};

export type PiezasDeProxyNetmagi = {
  ahora: () => Date;
  autorizado: (headers: { get: (nombre: string) => string | null }) => boolean;
  /** El negocio donde van las alertas; null si no hay ninguno. */
  buscarNegocio: () => Promise<string | null>;
  /** registrarAlerta de src/features/alertas/servicios/alertas.ts (una sola alerta abierta por clave). */
  registrarAlerta: (pedido: { workspaceId: string; clave: string; prioridad: Prioridad; titulo: string; detalle: string; origen: string }) => Promise<unknown>;
  /** resolverAlertasPorClave: devuelve cuántas cerró. */
  resolverPorClave: (workspaceId: string, clave: string, ahora: Date) => Promise<number>;
  leerAjuste: () => Promise<string | null>;
  guardarAjuste: (valor: string) => Promise<void>;
  registrar: (mensaje: string) => void;
};

export type RespuestaDeProxyNetmagi = { status: number; cuerpo: Record<string, unknown> };

function textoNoVacio(valor: unknown): string | null {
  return typeof valor === "string" && valor.trim() ? valor.trim() : null;
}

/** Valida el cuerpo. Devuelve el aviso o el error en palabras sencillas. */
export function validarAvisoNetmagi(json: unknown): { ok: true; aviso: AvisoNetmagi } | { ok: false; error: string } {
  if (!json || typeof json !== "object" || Array.isArray(json)) return { ok: false, error: "El cuerpo tiene que ser un objeto JSON." };
  const o = json as Record<string, unknown>;

  if (o.fuente === "tunel") {
    if (typeof o.puertoAbierto !== "boolean") return { ok: false, error: "Falta puertoAbierto (true o false)." };
    const ips: { ipSalida: string | null; ipEsperada: string | null } = { ipSalida: null, ipEsperada: null };
    for (const campo of ["ipSalida", "ipEsperada"] as const) {
      if (o[campo] === undefined || o[campo] === null) continue;
      const ip = textoNoVacio(o[campo]);
      if (!ip || !RE_IP.test(ip)) return { ok: false, error: `${campo} no es una IP válida.` };
      ips[campo] = ip;
    }
    return { ok: true, aviso: { fuente: "tunel", puertoAbierto: o.puertoAbierto, ...ips } };
  }

  if (o.fuente === "cuenta") {
    const navegador = textoNoVacio(o.navegador)?.toLowerCase() ?? null;
    if (!navegador || !RE_NAVEGADOR.test(navegador)) return { ok: false, error: "navegador tiene que ser mf seguido de un número (p. ej. mf11)." };
    if (o.estado === "ok" && o.error === undefined) return { ok: true, aviso: { fuente: "cuenta", navegador, estado: "ok" } };
    if (o.estado !== undefined) return { ok: false, error: "estado solo puede ser \"ok\" (y sin error)." };
    if (!ERRORES_DE_PROXY.includes(o.error as ErrorDeProxy)) {
      return { ok: false, error: `error tiene que ser ${ERRORES_DE_PROXY.join(" o ")}, o mandar estado "ok".` };
    }
    const cuenta = textoNoVacio(o.cuenta);
    if (!cuenta || cuenta.length > MAXIMO_NOMBRE) return { ok: false, error: `Falta cuenta (el nombre, hasta ${MAXIMO_NOMBRE} letras).` };
    return { ok: true, aviso: { fuente: "cuenta", navegador, cuenta, error: o.error as ErrorDeProxy } };
  }

  return { ok: false, error: "fuente tiene que ser \"tunel\" o \"cuenta\"." };
}

/** El último chequeo guardado; si falta o está roto, null. */
export function leerUltimoChequeoNetmagi(valor: string | null | undefined): UltimoChequeoNetmagi | null {
  if (!valor) return null;
  try {
    const crudo = JSON.parse(valor) as unknown;
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return null;
    const o = crudo as Record<string, unknown>;
    if (typeof o.fecha !== "string" || Number.isNaN(new Date(o.fecha).getTime())) return null;
    if (o.fuente !== "tunel" && o.fuente !== "cuenta") return null;
    return {
      fecha: o.fecha,
      fuente: o.fuente,
      resultado: typeof o.resultado === "string" ? o.resultado : "",
      tunel: o.tunel === "bien" || o.tunel === "caido" ? o.tunel : null,
    };
  } catch {
    return null;
  }
}

/** La línea del MCP: «último chequeo hace X min: túnel bien / caído», o «sin chequeos todavía». */
export function describirUltimoChequeoNetmagi(guardado: UltimoChequeoNetmagi | null, ahora: Date): string {
  if (!guardado) return "sin chequeos todavía";
  const minutos = Math.max(0, Math.round((ahora.getTime() - new Date(guardado.fecha).getTime()) / 60_000));
  const tunel = guardado.tunel === "bien" ? "túnel bien" : guardado.tunel === "caido" ? "túnel caído" : "túnel sin chequear";
  const ultimo = guardado.fuente === "cuenta" ? ` (último aviso de cuenta: ${guardado.resultado})` : "";
  return `último chequeo hace ${minutos} min: ${tunel}${ultimo}`;
}

function mensajeDe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recibe un aviso de NETMAGI. 401 sin secreto válido, 400 si el cuerpo no sirve, 500 si no hay negocio. Las alertas
 * nunca lanzan (registrarAlerta y resolverAlertasPorClave lo cuidan); el ajuste, si falla, solo se dice.
 */
export async function recibirEstadoProxyNetmagi(
  entrada: { headers: { get: (nombre: string) => string | null }; leerJson: () => Promise<unknown> },
  piezas: PiezasDeProxyNetmagi,
): Promise<RespuestaDeProxyNetmagi> {
  if (!piezas.autorizado(entrada.headers)) return { status: 401, cuerpo: { ok: false } };

  let json: unknown;
  try {
    json = await entrada.leerJson();
  } catch {
    return { status: 400, cuerpo: { ok: false, error: "El cuerpo no es un JSON válido." } };
  }
  const validado = validarAvisoNetmagi(json);
  if (!validado.ok) return { status: 400, cuerpo: { ok: false, error: validado.error } };
  const aviso = validado.aviso;

  let workspaceId: string | null;
  try {
    workspaceId = await piezas.buscarNegocio();
  } catch (error) {
    piezas.registrar(`[proxy-netmagi] no se pudo buscar el negocio: ${mensajeDe(error)}`);
    return { status: 500, cuerpo: { ok: false, error: "No se pudo buscar el negocio." } };
  }
  if (!workspaceId) {
    return { status: 500, cuerpo: { ok: false, error: "Ningún negocio: falta NETMAGI_WORKSPACE_ID o los avisos en Mi empresa → Equipo." } };
  }

  const ahora = piezas.ahora();
  const abiertas: string[] = [];
  const cerradas: string[] = [];
  const abrir = async (clave: string, texto: string, detalle: string) => {
    await piezas.registrarAlerta({ workspaceId, clave, prioridad: PRIORIDAD, titulo: texto, detalle: `${texto}\n${detalle}`, origen: ORIGEN_MARKETPLACE });
    abiertas.push(clave);
  };
  const cerrar = async (clave: string) => {
    if ((await piezas.resolverPorClave(workspaceId, clave, ahora)) > 0) cerradas.push(clave);
  };

  let resultado: string;
  let tunel: EstadoDelTunel | null;
  if (aviso.fuente === "tunel") {
    tunel = aviso.puertoAbierto ? "bien" : "caido";
    if (aviso.puertoAbierto) await cerrar(CLAVE_ALERTA_TUNEL);
    else await abrir(CLAVE_ALERTA_TUNEL, TEXTO_TUNEL_CAIDO, "Aviso del chequeo de NETMAGI. No se cambió nada.");
    const partes = [aviso.puertoAbierto ? "túnel bien" : "túnel caído"];
    if (aviso.ipSalida && aviso.ipEsperada) {
      if (aviso.ipSalida !== aviso.ipEsperada) {
        await abrir(CLAVE_ALERTA_IP, textoIpCambiada(aviso.ipEsperada, aviso.ipSalida), "Aviso del chequeo de NETMAGI. No se cambió nada.");
        partes.push(`IP distinta (${aviso.ipSalida})`);
      } else {
        await cerrar(CLAVE_ALERTA_IP);
        partes.push("IP la esperada");
      }
    }
    resultado = partes.join(", ");
  } else {
    let anterior: UltimoChequeoNetmagi | null = null;
    try {
      anterior = leerUltimoChequeoNetmagi(await piezas.leerAjuste());
    } catch (error) {
      piezas.registrar(`[proxy-netmagi] no se pudo leer el último chequeo: ${mensajeDe(error)}`);
    }
    tunel = anterior?.tunel ?? null;
    const clave = claveAlertaDeCuenta(aviso.navegador);
    if ("error" in aviso) {
      await abrir(clave, textoCuentaSinProxy(aviso.navegador, aviso.cuenta), `Error del navegador: ${aviso.error}. No se cambió nada.`);
      resultado = `${aviso.navegador} sin conexión (${aviso.error})`;
    } else {
      await cerrar(clave);
      resultado = `${aviso.navegador} bien`;
    }
  }

  const chequeo: UltimoChequeoNetmagi = { fecha: ahora.toISOString(), fuente: aviso.fuente, resultado, tunel };
  let guardado = true;
  try {
    await piezas.guardarAjuste(JSON.stringify(chequeo));
  } catch (error) {
    guardado = false;
    piezas.registrar(`[proxy-netmagi] no se pudo guardar el último chequeo: ${mensajeDe(error)}`);
  }

  return { status: 200, cuerpo: { ok: true, resultado, abiertas, cerradas, chequeoGuardado: guardado } };
}

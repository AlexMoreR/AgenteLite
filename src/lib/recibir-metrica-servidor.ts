// Monitoreo del servidor (parte 2): lo que hace POST /api/cron/metricas-servidor.
//
// Este archivo no importa la base ni el WhatsApp: la ruta le pasa esas piezas (guardar, borrar, leer las
// últimas fotos, leer y guardar el estado de la alerta, avisar y el reloj). Así las pruebas corren sin
// base (src/lib/recibir-metrica-servidor.test.ts). Las reglas puras están en ./metricas-servidor.

import {
  MINUTOS_ENTRE_ALERTAS,
  MUESTRAS_PARA_ALERTA,
  UMBRAL_CPU_ALERTA,
  cpuEfectivo,
  evaluarAlerta,
  textoDeAlerta,
  validarMuestra,
  type EstadoAlertaCpu,
  type MuestraServidor,
} from "./metricas-servidor";

/** Dónde se guarda el estado de la alerta: AppSetting `servidor:alerta-cpu` = {activa, ultimoEnvio}. */
export const CLAVE_ESTADO_ALERTA_CPU = "servidor:alerta-cpu";
/** Las fotos con más días que esto se borran en cada llamada (sin cron aparte). */
export const DIAS_QUE_SE_GUARDAN = 7;
export const TITULO_ALERTA_CPU = "Servidor con CPU alta";

export type ResultadoDelAviso = { mandada: boolean; motivo: string | null };

export type PiezasDeMetrica = {
  ahora: () => Date;
  autorizado: (headers: { get: (nombre: string) => string | null }) => boolean;
  guardar: (muestra: MuestraServidor, tomadaEn: Date) => Promise<void>;
  /** Borra las fotos tomadas antes de `fecha` y dice cuántas borró. */
  borrarAntesDe: (fecha: Date) => Promise<number>;
  /** Las últimas `cuantas` fotos, de la más nueva a la más vieja. */
  ultimas: (cuantas: number) => Promise<Array<Pick<MuestraServidor, "cpuTotal" | "load1" | "nucleos">>>;
  leerEstado: () => Promise<string | null>;
  guardarEstado: (valor: string) => Promise<void>;
  avisar: (pedido: { titulo: string; texto: string; ahora: Date }) => Promise<ResultadoDelAviso>;
  registrar: (mensaje: string) => void;
};

export type RespuestaDeMetrica = { status: number; cuerpo: Record<string, unknown> };

/** El estado guardado; si falta o está roto, el de arranque (sin alerta). */
export function leerEstadoAlertaCpu(valor: string | null | undefined): EstadoAlertaCpu {
  const vacio: EstadoAlertaCpu = { activa: false, ultimoEnvio: null };
  if (!valor) return vacio;
  try {
    const crudo = JSON.parse(valor) as unknown;
    if (!crudo || typeof crudo !== "object" || Array.isArray(crudo)) return vacio;
    const objeto = crudo as Record<string, unknown>;
    return {
      activa: objeto.activa === true,
      ultimoEnvio: typeof objeto.ultimoEnvio === "string" && objeto.ultimoEnvio ? objeto.ultimoEnvio : null,
    };
  } catch {
    return vacio;
  }
}

function mismoEstado(a: EstadoAlertaCpu, b: EstadoAlertaCpu) {
  return a.activa === b.activa && a.ultimoEnvio === b.ultimoEnvio;
}

/** Por qué no se avisó, en palabras sencillas. */
function motivoSinAviso(ultimasCpu: number[]): string {
  if (ultimasCpu.length === 0 || !(ultimasCpu[0] > UMBRAL_CPU_ALERTA)) return "CPU normal";
  const recientes = ultimasCpu.slice(0, MUESTRAS_PARA_ALERTA);
  if (recientes.length < MUESTRAS_PARA_ALERTA || !recientes.every((cpu) => cpu > UMBRAL_CPU_ALERTA)) {
    return `CPU alta, pero todavía no hay ${MUESTRAS_PARA_ALERTA} fotos seguidas por encima de ${UMBRAL_CPU_ALERTA} %`;
  }
  return `ya se avisó hace menos de ${MINUTOS_ENTRE_ALERTAS} min`;
}

function mensajeDe(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Recibe una foto del servidor. 401 sin secreto válido, 400 si el cuerpo no sirve, 500 si no se pudo
 * guardar. Guardada la foto, nada más la tumba: el borrado y la alerta, si fallan, solo lo dicen.
 */
export async function recibirMetricaServidor(
  entrada: { headers: { get: (nombre: string) => string | null }; leerJson: () => Promise<unknown> },
  piezas: PiezasDeMetrica,
): Promise<RespuestaDeMetrica> {
  if (!piezas.autorizado(entrada.headers)) return { status: 401, cuerpo: { ok: false } };

  let json: unknown;
  try {
    json = await entrada.leerJson();
  } catch {
    return { status: 400, cuerpo: { ok: false, error: "El cuerpo no es un JSON válido." } };
  }
  const validada = validarMuestra(json);
  if (!validada.ok) return { status: 400, cuerpo: { ok: false, error: validada.error } };
  const muestra = validada.muestra;

  const ahora = piezas.ahora();
  try {
    await piezas.guardar(muestra, ahora);
  } catch (error) {
    piezas.registrar(`[metricas-servidor] no se pudo guardar la foto: ${mensajeDe(error)}`);
    return { status: 500, cuerpo: { ok: false, error: "No se pudo guardar la foto." } };
  }

  let borradas: number | null = null;
  try {
    borradas = await piezas.borrarAntesDe(new Date(ahora.getTime() - DIAS_QUE_SE_GUARDAN * 24 * 60 * 60_000));
  } catch (error) {
    piezas.registrar(`[metricas-servidor] no se pudieron borrar las fotos viejas: ${mensajeDe(error)}`);
  }

  const alerta = await revisarAlerta(muestra, ahora, piezas);
  return { status: 200, cuerpo: { ok: true, guardada: true, borradas, alerta } };
}

async function revisarAlerta(
  muestra: MuestraServidor,
  ahora: Date,
  piezas: PiezasDeMetrica,
): Promise<{ evaluada: boolean; mandada: boolean; motivo: string | null }> {
  let ultimasCpu: number[];
  let estado: EstadoAlertaCpu;
  try {
    const [ultimas, guardado] = await Promise.all([piezas.ultimas(MUESTRAS_PARA_ALERTA), piezas.leerEstado()]);
    ultimasCpu = ultimas.map((foto) => cpuEfectivo(foto));
    estado = leerEstadoAlertaCpu(guardado);
  } catch (error) {
    piezas.registrar(`[metricas-servidor] no se pudo leer para la alerta: ${mensajeDe(error)}`);
    return { evaluada: false, mandada: false, motivo: "no se pudo leer las últimas fotos o el estado de la alerta" };
  }

  const { mandar, estadoNuevo } = evaluarAlerta({ ultimasCpu, estado, ahora });

  let resultado: ResultadoDelAviso = { mandada: false, motivo: motivoSinAviso(ultimasCpu) };
  if (mandar) {
    try {
      resultado = await piezas.avisar({ titulo: TITULO_ALERTA_CPU, texto: textoDeAlerta(muestra), ahora });
    } catch (error) {
      piezas.registrar(`[metricas-servidor] el aviso falló: ${mensajeDe(error)}`);
      resultado = { mandada: false, motivo: "el envío del WhatsApp falló" };
    }
  }

  // Se guarda aunque el envío no salga: así un aviso bloqueado no se reintenta cada minuto (espera 60 min).
  if (!mismoEstado(estado, estadoNuevo)) {
    try {
      await piezas.guardarEstado(JSON.stringify(estadoNuevo));
    } catch (error) {
      piezas.registrar(`[metricas-servidor] no se pudo guardar el estado de la alerta: ${mensajeDe(error)}`);
      return { evaluada: true, mandada: resultado.mandada, motivo: `${resultado.motivo ?? "mandada"}; no se pudo guardar el estado de la alerta` };
    }
  }
  return { evaluada: true, mandada: resultado.mandada, motivo: resultado.motivo };
}

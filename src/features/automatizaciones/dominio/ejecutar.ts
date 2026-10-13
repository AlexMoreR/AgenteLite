/**
 * CORRER UNA AUTOMATIZACIÓN (código puro: la base entra por `Puertos`).
 *
 * Para cada lead que cumple las condiciones (vuelto a mirar justo antes de actuar):
 *   1. se marca como procesado por ESTA automatización (una nota en el chat): una automática no lo
 *      vuelve a tomar, y si dos corridas se pisan, solo una lo procesa;
 *   2. se hacen, en orden, las acciones inmediatas (asignar, etiquetas, resolver, posponer, abrir,
 *      nota, etapa);
 *   3. los envíos (flujo / texto, en su orden) se AGENDAN como un seguimiento por lead, de a tandas
 *      (dominio/tandas.ts). Salen por el motor de seguimientos con el anti-bloqueo de siempre, y al
 *      salir cierran la tarea de Recuperación 72 h vencida (ver follows.ts).
 *
 * Un lead que falla no frena a los demás: queda contado en `errores` con el motivo.
 */

import { cumpleCondiciones, motivoParaNoEnviar, type FotoDelLead } from "./condiciones";
import {
  MAXIMO_POR_EJECUCION,
  separarAcciones,
  type Accion,
  type Automatizacion,
  type Ejecucion,
} from "./modelo";
import { horasDeEnvio, inicioDeLaProximaTanda } from "./tandas";
import type { ConfigAntiBloqueo } from "../../../lib/anti-bloqueo/reglas";

export type EnvioAgendado = Extract<Accion, { tipo: "enviar_flujo" | "enviar_texto" }>;

export type Puertos = {
  /** Los candidatos (ya filtrados en SQL y sin los que esta automatización ya procesó), hasta `tope`. */
  buscarLeads(tope: number): Promise<FotoDelLead[]>;
  /** Deja la marca "procesado por esta automatización". false = ya estaba (otra corrida lo tomó). */
  marcarProcesado(foto: FotoDelLead): Promise<boolean>;
  aplicar(accion: Accion, foto: FotoDelLead): Promise<void>;
  /** Agenda los envíos de un lead para `en`. */
  agendarEnvio(foto: FotoDelLead, envios: EnvioAgendado[], en: Date): Promise<void>;
  /** La hora del último envío que esta automatización todavía tiene agendado (null = ninguno). */
  ultimoEnvioAgendado(): Promise<Date | null>;
  horario: ConfigAntiBloqueo["horario"] | null;
};

export type ResultadoDeEjecucion = {
  leads: number;
  envios: number;
  errores: Array<{ conversationId: string; error: string }>;
  /** Cuándo sale la última tanda (null = sin envíos). */
  ultimaTandaEn: Date | null;
};

function mensajeDe(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).slice(0, 160);
}

export async function ejecutarAutomatizacion(
  automatizacion: Pick<Automatizacion, "condiciones" | "soloAbiertas" | "acciones" | "cantidad" | "ritmo">,
  puertos: Puertos,
  ahora: Date,
): Promise<ResultadoDeEjecucion> {
  const tope = Math.min(automatizacion.cantidad ?? MAXIMO_POR_EJECUCION, MAXIMO_POR_EJECUCION);
  const candidatos = (await puertos.buscarLeads(tope)).filter((foto) => cumpleCondiciones(foto, automatizacion, ahora)).slice(0, tope);
  const { inmediatas, envios } = separarAcciones(automatizacion.acciones);

  const errores: ResultadoDeEjecucion["errores"] = [];
  const paraEnviar: FotoDelLead[] = [];
  let leads = 0;

  for (const foto of candidatos) {
    try {
      if (!(await puertos.marcarProcesado(foto))) continue;
    } catch (error) {
      errores.push({ conversationId: foto.conversationId, error: mensajeDe(error) });
      continue;
    }
    leads += 1;
    let etapa = foto.etapa;
    for (const accion of inmediatas) {
      try {
        await puertos.aplicar(accion, { ...foto, etapa });
        if (accion.tipo === "cambiar_etapa") etapa = accion.etapa;
      } catch (error) {
        errores.push({ conversationId: foto.conversationId, error: mensajeDe(error) });
      }
    }
    if (envios.length) {
      // Una acción de antes (Cambiar etapa → Descartado) pudo cerrar el lead: ahí ya no se escribe.
      const motivo = motivoParaNoEnviar({ etapa, excluido: foto.excluido });
      if (motivo) errores.push({ conversationId: foto.conversationId, error: `No se envió: ${motivo}` });
      else paraEnviar.push(foto);
    }
  }

  let agendados = 0;
  let ultimaTandaEn: Date | null = null;
  if (paraEnviar.length) {
    const desde = inicioDeLaProximaTanda({ ahora, ultimoAgendado: await puertos.ultimoEnvioAgendado(), ritmo: automatizacion.ritmo });
    const horas = horasDeEnvio({ cantidad: paraEnviar.length, ritmo: automatizacion.ritmo, desde, horario: puertos.horario });
    for (const [i, foto] of paraEnviar.entries()) {
      try {
        await puertos.agendarEnvio(foto, envios, horas[i]);
        agendados += 1;
        ultimaTandaEn = horas[i];
      } catch (error) {
        errores.push({ conversationId: foto.conversationId, error: mensajeDe(error) });
      }
    }
  }

  return { leads, envios: agendados, errores, ultimaTandaEn };
}

/** La fila del historial que se ve en la tarjeta. */
export function comoEjecucion(resultado: ResultadoDeEjecucion, input: { fecha: Date; por: string; origen: Ejecucion["origen"] }): Ejecucion {
  const detalle = [...new Set(resultado.errores.map((e) => e.error))].slice(0, 5);
  return {
    fecha: input.fecha.toISOString(),
    por: input.por,
    origen: input.origen,
    leads: resultado.leads,
    envios: resultado.envios,
    errores: resultado.errores.length,
    detalle,
  };
}

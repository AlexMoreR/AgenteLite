/**
 * EL RITMO DE LOS ENVÍOS de una automatización (código puro).
 *
 * WhatsApp bloquea líneas que mandan muchos mensajes parecidos a gente que hace rato no escribe.
 * Por eso nada sale todo junto: los leads se agendan de a `tanda` cada `cadaMinutos`, y solo dentro
 * del horario del anti-bloqueo (si está prendido). Encima de esto, cada envío pasa por el motor de
 * seguimientos, que aplica el espaciado entre mensajes de la línea, el tope y el resto.
 */

import { dentroDelHorario, siguienteApertura, type ConfigAntiBloqueo } from "../../../lib/anti-bloqueo/reglas";
import type { RitmoDeEnvio } from "./modelo";

const MIN = 60_000;

/** Lleva una hora al horario: si cae afuera, a la siguiente apertura. */
function alHorario(fecha: Date, horario: ConfigAntiBloqueo["horario"] | null): Date {
  if (!horario?.activo || dentroDelHorario(fecha, horario)) return fecha;
  return siguienteApertura(fecha, horario);
}

/**
 * La hora de salida de cada uno de `cantidad` envíos.
 *
 * `desde`: la primera tanda (ahora, o después de la última que esta automatización dejó agendada,
 * para que dos corridas seguidas no se encimen). Cada tanda va `cadaMinutos` después de la
 * anterior; si una cae fuera del horario, esa y las que siguen arrancan en la siguiente apertura.
 */
export function horasDeEnvio(input: {
  cantidad: number;
  ritmo: RitmoDeEnvio;
  desde: Date;
  horario: ConfigAntiBloqueo["horario"] | null;
}): Date[] {
  const tanda = Math.max(1, input.ritmo.tanda);
  const paso = Math.max(1, input.ritmo.cadaMinutos) * MIN;
  const horas: Date[] = [];
  let actual = alHorario(input.desde, input.horario);
  for (let i = 0; i < input.cantidad; i += 1) {
    if (i > 0 && i % tanda === 0) actual = alHorario(new Date(actual.getTime() + paso), input.horario);
    horas.push(actual);
  }
  return horas;
}

/** Desde cuándo puede salir la próxima tanda, si ya quedaron envíos agendados de esta automatización. */
export function inicioDeLaProximaTanda(input: { ahora: Date; ultimoAgendado: Date | null; ritmo: RitmoDeEnvio }): Date {
  if (!input.ultimoAgendado) return input.ahora;
  const siguiente = input.ultimoAgendado.getTime() + Math.max(1, input.ritmo.cadaMinutos) * MIN;
  return new Date(Math.max(input.ahora.getTime(), siguiente));
}

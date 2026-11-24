/**
 * Las dos líneas chicas que van debajo del nombre de cada persona en Mi empresa → Equipo:
 * su última conexión y su última acción, ya en palabras.
 *
 * Sin base de datos ni Prisma, para probarlas con datos armados a mano. La página junta los datos
 * (`leerActividadDelEquipo` y `ultimaAccionPorPersona`) y aquí solo se arman los textos.
 */
import { fechaYHoraDeBogota } from "@/lib/hora-de-lista";

/**
 * La app anota el latido cada 4 minutos mientras la pantalla está abierta. Con menos de 6 minutos
 * desde el último, la persona sigue ahí; se deja un margen por si un latido llega tarde.
 */
export const MINUTOS_DE_CONECTADA_AHORA = 6;

export type LineasDeLaPersona = {
  /** "Última conexión: 24 nov 2026, 3:42 p. m. · Chats · Ana · Android" o "Sin registro todavía". */
  conexion: string;
  conectadaAhora: boolean;
  /** "Última acción: Envió un mensaje · Salón Rosa · 24 nov 2026, 3:40 p. m." o "Sin acciones en 30 días". */
  accion: string;
};

export function lineasDeLaPersona(input: {
  /** El último latido, si hay: cuándo (ISO), dónde estaba ya en palabras y desde qué aparato. */
  latido: { cuando: string; donde: string; aparato: string } | null;
  ultimaAccion: { texto: string; cliente: string | null; cuando: Date } | null;
  ahora?: Date;
}): LineasDeLaPersona {
  const ahora = input.ahora ?? new Date();

  let conexion = "Sin registro todavía";
  let conectadaAhora = false;
  const cuando = input.latido ? new Date(input.latido.cuando) : null;
  if (input.latido && cuando && !Number.isNaN(cuando.getTime())) {
    const partes = [fechaYHoraDeBogota(cuando), input.latido.donde.trim(), input.latido.aparato.trim()].filter(Boolean);
    conexion = `Última conexión: ${partes.join(" · ")}`;
    const minutos = (ahora.getTime() - cuando.getTime()) / 60_000;
    // Un reloj un poco adelantado da minutos negativos: sigue siendo "ahora".
    conectadaAhora = minutos < MINUTOS_DE_CONECTADA_AHORA;
  }

  let accion = "Sin acciones en 30 días";
  if (input.ultimaAccion && !Number.isNaN(input.ultimaAccion.cuando.getTime())) {
    const partes = [input.ultimaAccion.texto, input.ultimaAccion.cliente?.trim(), fechaYHoraDeBogota(input.ultimaAccion.cuando)].filter(
      Boolean,
    );
    accion = `Última acción: ${partes.join(" · ")}`;
  }

  return { conexion, conectadaAhora, accion };
}

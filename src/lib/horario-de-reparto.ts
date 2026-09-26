import { cache } from "react";

import {
  esSiempre,
  normalizarHorario,
  type HorarioSemanal,
} from "@/lib/horario-de-reparto-dias";
import { prisma } from "@/lib/prisma";

export {
  DIAS_DE_LA_SEMANA,
  esSiempre,
  horarioSiempre,
  normalizarHorario,
  type HorarioDelDia,
  type HorarioSemanal,
  type ModoDelDia,
} from "@/lib/horario-de-reparto-dias";

/*
  EL HORARIO DE REPARTO: en qué días y horas a cada persona le pueden caer leads automáticos.

  Pedido de Alex (26-sep-2026): "Stheffani el sábado hasta las 6:00 p. m., el domingo nada; Ingrid
  todo el tiempo". Es por PERSONA y vale para todas sus líneas; se edita en Mi empresa -> Equipo.

  Solo frena lo AUTOMÁTICO (reparto por turnos y reglas de campaña). Fuera de su horario la persona
  sigue viendo y atendiendo lo suyo, y un jefe le puede asignar a mano. Es la misma idea que la pausa
  de reparto, pero con reloj.

  Quien no tiene horario guardado recibe siempre: así estaba todo antes de esto.
  Se guarda en AppSetting para no migrar la base de producción.
*/

/** La hora que vale es la del negocio, no la del servidor (que corre en UTC). */
const ZONA_HORARIA = "America/Bogota";

const clave = (workspaceId: string) => `equipo:horario-reparto:${workspaceId}`;

export const leerHorariosDeReparto = cache(async (workspaceId: string): Promise<Record<string, HorarioSemanal>> => {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(workspaceId) } });
  if (!fila) {
    return {};
  }
  try {
    const datos = JSON.parse(fila.value) as unknown;
    if (!datos || typeof datos !== "object" || Array.isArray(datos)) {
      return {};
    }
    return Object.fromEntries(
      Object.entries(datos as Record<string, unknown>).map(([userId, horario]) => [userId, normalizarHorario(horario)]),
    );
  } catch {
    return {};
  }
});

export async function guardarHorarioDeReparto(workspaceId: string, userId: string, horario: HorarioSemanal) {
  const fila = await prisma.appSetting.findUnique({ where: { key: clave(workspaceId) } });
  let todos: Record<string, unknown> = {};
  try {
    const datos = fila ? (JSON.parse(fila.value) as unknown) : {};
    if (datos && typeof datos === "object" && !Array.isArray(datos)) {
      todos = datos as Record<string, unknown>;
    }
  } catch {
    todos = {};
  }

  const limpio = normalizarHorario(horario);
  if (esSiempre(limpio)) {
    delete todos[userId];
  } else {
    todos[userId] = limpio;
  }

  const valor = JSON.stringify(todos);
  await prisma.appSetting.upsert({
    where: { key: clave(workspaceId) },
    create: { key: clave(workspaceId), value: valor },
    update: { value: valor },
  });
}

/** Día de la semana y minutos desde la medianoche, en la hora del negocio. */
function momentoLocal(fecha: Date) {
  const partes = new Intl.DateTimeFormat("en-US", {
    timeZone: ZONA_HORARIA,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(fecha);
  const valor = (tipo: string) => partes.find((parte) => parte.type === tipo)?.value ?? "";
  const dia = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(valor("weekday"));
  return { dia: dia < 0 ? 0 : dia, minutos: Number(valor("hour")) * 60 + Number(valor("minute")) };
}

function aMinutos(hora: string) {
  const [horas, minutos] = hora.split(":").map(Number);
  return horas * 60 + minutos;
}

/**
 * ¿Le puede caer un lead automático en este momento?
 * "De 08:00 a 18:00" incluye las 08:00 y deja de recibir a las 18:00 en punto.
 */
export function recibeEnEsteMomento(horario: HorarioSemanal | undefined, fecha = new Date()) {
  if (!horario) {
    return true;
  }
  const { dia, minutos } = momentoLocal(fecha);
  const hoy = horario[dia];
  if (!hoy || hoy.modo === "todo") {
    return true;
  }
  if (hoy.modo === "nada") {
    return false;
  }
  const desde = aMinutos(hoy.desde);
  const hasta = aMinutos(hoy.hasta);
  // Un horario que cruza la medianoche (22:00 a 02:00) se lee como dos tramos del mismo día.
  return desde <= hasta ? minutos >= desde && minutos < hasta : minutos >= desde || minutos < hasta;
}

/** De una lista de personas, las que están dentro de su horario ahora. Conserva el orden. */
export async function filtrarPorHorario(workspaceId: string, userIds: string[], fecha = new Date()) {
  if (userIds.length === 0) {
    return userIds;
  }
  const horarios = await leerHorariosDeReparto(workspaceId);
  return userIds.filter((userId) => recibeEnEsteMomento(horarios[userId], fecha));
}

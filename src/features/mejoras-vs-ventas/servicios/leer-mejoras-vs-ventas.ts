import { prisma } from "@/lib/prisma";
import { leadsNuevosDelDia } from "@/features/leads-nuevos/servicios/leads-nuevos-del-dia";
import { terminadasDeLaSemana } from "@/features/tableros-inteligentes/services/archivadas";
import { todoElNegocio } from "@/features/tableros-inteligentes/services/tableros";

import {
  DIAS_DE_LA_SERIE,
  META_COTIZACIONES_DEL_DIA,
  armarFilas,
  cambiosPorDia,
  contarPorDia,
  diasDeLaVentana,
  hoyEnColombia,
  sumarDias,
  tramosDePedido,
  ventasPorDia,
  type FilaDelDia,
  type TarjetaTerminada,
} from "../dominio/serie";
import { leerGestionDeLaVentana, type ClienteDeGestion } from "./leer-gestion";

/**
 * MEJORAS VS VENTAS (solo lectura): los últimos 30 días (hora de Colombia, hoy incluido) con leads nuevos,
 * cotizaciones y ventas de Gestión, y los cambios que se terminaron cada día en el tablero "Sistemas".
 * No escribe en ninguna base ni manda mensajes. A la vista solo llegan conteos y el código y título de las tarjetas.
 */

export const NOMBRE_DEL_TABLERO = "Sistemas";
export const BASE_DEL_DUENO = "Base del 6-nov (la dio el dueño): 185 leads, 3 cotizaciones y 0 ventas de leads del día.";
/** Leads: de a 3 días a la vez (cada día son 2 consultas pesadas). */
const LEADS_A_LA_VEZ = 3;

export type MejorasVsVentas = {
  hoy: string;
  meta: number;
  cotizacionesDeHoy: number | null;
  filas: FilaDelDia[];
  avisos: string[];
  base: string;
};

/* Memoria de los leads por día: los días pasados 6 horas, hoy 5 minutos. */
const MEMORIA_LEADS = new Map<string, { vence: number; total: number }>();

async function leadsDelDia(workspaceId: string, fecha: string, hoy: string, leer: typeof leadsNuevosDelDia): Promise<number> {
  const clave = `${workspaceId}:${fecha}`;
  const guardado = MEMORIA_LEADS.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.total;
  const { total } = await leer(workspaceId, fecha);
  MEMORIA_LEADS.set(clave, { vence: Date.now() + (fecha === hoy ? 5 * 60_000 : 6 * 3_600_000), total });
  return total;
}

async function leerLeads(workspaceId: string, dias: string[], hoy: string, leer: typeof leadsNuevosDelDia) {
  const porDia = new Map<string, number | null>();
  let fallidos = 0;
  for (let i = 0; i < dias.length; i += LEADS_A_LA_VEZ) {
    const grupo = dias.slice(i, i + LEADS_A_LA_VEZ);
    const totales = await Promise.all(
      grupo.map((fecha) =>
        leadsDelDia(workspaceId, fecha, hoy, leer).catch(() => {
          fallidos += 1;
          return null;
        }),
      ),
    );
    grupo.forEach((fecha, j) => porDia.set(fecha, totales[j]));
  }
  return { porDia, aviso: fallidos ? `No se pudieron leer los leads de ${fallidos} día(s): quedan sin dato.` : null };
}

/** Las tarjetas terminadas del tablero "Sistemas" en las semanas que toca la ventana. */
async function leerCambios(workspaceId: string, dias: string[]): Promise<{ tarjetas: TarjetaTerminada[] | null; aviso: string | null }> {
  try {
    const tablero = await prisma.tableroInteligente.findFirst({
      where: { workspaceId, nombre: { equals: NOMBRE_DEL_TABLERO, mode: "insensitive" } },
      orderBy: { creadoEn: "asc" },
      select: { id: true },
    });
    if (!tablero) return { tarjetas: null, aviso: `No se encontró el tablero "${NOMBRE_DEL_TABLERO}": la gráfica sale sin marcas de cambios.` };
    // Una fecha por semana (lunes a domingo): cada 7 días desde el primero, más el último.
    const semanas = new Set<string>();
    for (let fecha = dias[0]; fecha <= dias[dias.length - 1]; fecha = sumarDias(fecha, 7)) semanas.add(fecha);
    semanas.add(dias[dias.length - 1]);
    const tarjetas: TarjetaTerminada[] = [];
    for (const semana of semanas) {
      const resultado = await terminadasDeLaSemana(todoElNegocio(workspaceId), semana, tablero.id);
      for (const t of resultado.tarjetas) tarjetas.push({ codigo: t.codigo, titulo: t.titulo, estado: t.estado, terminadaEn: t.terminadaEn });
    }
    return { tarjetas, aviso: null };
  } catch {
    return { tarjetas: null, aviso: "No se pudieron leer los cambios del tablero: la gráfica sale sin marcas." };
  }
}

export async function leerMejorasVsVentas(
  workspaceId: string,
  opciones: { ahora?: Date; clienteDeGestion?: ClienteDeGestion; leerLeads?: typeof leadsNuevosDelDia } = {},
): Promise<MejorasVsVentas> {
  const hoy = hoyEnColombia(opciones.ahora);
  const dias = diasDeLaVentana(hoy, DIAS_DE_LA_SERIE);
  const tramos = tramosDePedido(dias).map((tramo) => ({ ...tramo, esDeHoy: tramo.hasta >= hoy }));

  const [leads, gestion, cambios] = await Promise.all([
    leerLeads(workspaceId, dias, hoy, opciones.leerLeads ?? leadsNuevosDelDia),
    leerGestionDeLaVentana(workspaceId, tramos, { cliente: opciones.clienteDeGestion ?? null }),
    leerCambios(workspaceId, dias),
  ]);

  const filas = armarFilas(dias, {
    leads: leads.porDia,
    cotizaciones: gestion.cotizaciones ? contarPorDia(gestion.cotizaciones, dias) : null,
    ventas: gestion.abonos ? ventasPorDia(gestion.abonos, gestion.origenPorVenta, dias) : null,
    cambios: cambios.tarjetas ? cambiosPorDia(cambios.tarjetas, dias) : null,
  });

  const avisos = [leads.aviso, ...gestion.avisos, cambios.aviso].filter((aviso): aviso is string => Boolean(aviso));
  return {
    hoy,
    meta: META_COTIZACIONES_DEL_DIA,
    cotizacionesDeHoy: filas[filas.length - 1]?.cotizaciones ?? null,
    filas,
    avisos,
    base: BASE_DEL_DUENO,
  };
}

/** Solo para las pruebas: vacía la memoria de los leads. */
export function olvidarMemoriaDeLeads() {
  MEMORIA_LEADS.clear();
}

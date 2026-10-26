import { prisma } from "@/lib/prisma";

import {
  armarReporte,
  type OrigenDelChat,
  type ReporteDePauta,
  type VentaConOrigen,
} from "../dominio/reporte";
import { leerGastoPorAnuncio } from "./meta-ads-lectura";
import { limitesDelRango } from "./ventas-de-gestion";

/** SOLO LECTURA: arma el reporte de pauta de un rango. Lo usan la pantalla y la herramienta MCP. */

export const esDia = (valor: string) => /^\d{4}-\d{2}-\d{2}$/.test(valor) && !Number.isNaN(new Date(`${valor}T00:00:00-05:00`).getTime());

function hoyEnBogota(ahora = new Date()) {
  return new Date(ahora.getTime() - 5 * 3_600_000).toISOString().slice(0, 10);
}

/** Sin fechas: el mes en curso (hora de Colombia). */
export function rangoPorDefecto(ahora = new Date()) {
  const hoy = hoyEnBogota(ahora);
  return { desde: `${hoy.slice(0, 8)}01`, hasta: hoy };
}

export type LecturaDePauta = {
  desde: string;
  hasta: string;
  reporte: ReporteDePauta;
  fuenteDeVentas: "gestion" | "crm" | "sin_datos";
  ventasSinMonto: boolean;
};

export async function leerReporteDePauta(workspaceId: string, pedido: { desde?: string | null; hasta?: string | null }): Promise<LecturaDePauta> {
  const porDefecto = rangoPorDefecto();
  const desde = pedido.desde && esDia(pedido.desde) ? pedido.desde : porDefecto.desde;
  const hasta = pedido.hasta && esDia(pedido.hasta) ? pedido.hasta : porDefecto.hasta;
  const { desdeFecha, hastaFecha } = limitesDelRango(desde, hasta);

  const [origenesDb, ventasDb, gastos] = await Promise.all([
    prisma.origenDePauta.findMany({
      where: { workspaceId, llegoEn: { gte: desdeFecha, lt: hastaFecha } },
      select: { id: true, contactId: true, anuncioId: true, anuncioNombre: true, conjuntoNombre: true, campanaId: true, campanaNombre: true },
    }),
    prisma.ventaDePauta.findMany({
      where: { workspaceId, pagadaEn: { gte: desdeFecha, lt: hastaFecha } },
      select: { ventaGestionId: true, monto: true, origenDePautaId: true },
    }),
    leerGastoPorAnuncio(desde, hasta),
  ]);

  // Calientes: temperatura CALIENTE o ya con cotización, anticipo o venta (misma regla que Comparar embudos).
  const contactIds = origenesDb.map((o) => o.contactId);
  const calientes = contactIds.length
    ? await prisma.embudoLead.findMany({
        where: {
          workspaceId,
          contactId: { in: contactIds },
          OR: [{ temperatura: "CALIENTE" }, { cotizacionEn: { not: null } }, { anticipoEn: { not: null } }, { ventaEn: { not: null } }],
        },
        select: { contactId: true },
      })
    : [];
  const calientesSet = new Set(calientes.map((c) => c.contactId));

  const origenes: OrigenDelChat[] = origenesDb.map((o) => ({
    contactId: o.contactId,
    anuncioId: o.anuncioId,
    anuncioNombre: o.anuncioNombre,
    conjuntoNombre: o.conjuntoNombre,
    campanaId: o.campanaId,
    campanaNombre: o.campanaNombre,
    caliente: calientesSet.has(o.contactId),
  }));

  // El origen de una venta puede ser de un chat que llegó antes del rango: se busca por id, no por fecha.
  const idsDeOrigen = [...new Set(ventasDb.map((v) => v.origenDePautaId).filter((id): id is string => Boolean(id)))];
  const origenesDeVentas = idsDeOrigen.length
    ? await prisma.origenDePauta.findMany({ where: { workspaceId, id: { in: idsDeOrigen } }, select: { id: true, anuncioId: true, campanaId: true } })
    : [];
  const porId = new Map(origenesDeVentas.map((o) => [o.id, o]));
  const ventas: VentaConOrigen[] = ventasDb.map((v) => ({
    origen: v.origenDePautaId ? porId.get(v.origenDePautaId) ?? null : null,
    monto: v.monto,
  }));

  return {
    desde,
    hasta,
    reporte: armarReporte({ origenes, ventas, gastos }),
    fuenteDeVentas: ventasDb.length === 0 ? "sin_datos" : ventasDb.some((v) => v.ventaGestionId.startsWith("CRM:")) ? "crm" : "gestion",
    ventasSinMonto: ventasDb.length > 0 && ventasDb.every((v) => v.monto === null),
  };
}

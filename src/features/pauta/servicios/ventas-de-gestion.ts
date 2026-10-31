import { prisma } from "@/lib/prisma";
import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";

import { variantesDeTelefono } from "../dominio/reporte";

/**
 * ORIGEN DE LA VENTA: trae las ventas pagadas (solo leer), las cruza por teléfono con el cliente
 * (con y sin 57) y guarda cada venta con la campaña de ese cliente. Sin chat de anuncio = ORGANICO_OTRO.
 *
 * Gestión: GET /api/ventas/pagadas?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (misma conexión y llave del
 * catálogo) → { ventas: [{ id, cotizacion, telefono, monto, pagadaEn, ciudad?, departamento? }] }. Hoy ese endpoint puede no
 * existir en Gestión: entonces la lista sale de los GANADO del CRM (fecha y cotización, SIN monto).
 */

export type VentaPagada = {
  id: string;
  cotizacion: string | null;
  telefono: string | null;
  monto: number | null;
  pagadaEn: Date;
  /** Opcionales: solo si Gestión los manda. Los usa el mapa de Colombia de la pauta. */
  ciudad?: string | null;
  departamento?: string | null;
};

export type FuenteDeVentas = "gestion" | "crm";

/** Las ventas pagadas que manda Gestión en el rango. null = Gestión no está conectada, no respondió o no tiene la lista. */
export async function pedirAGestion(workspaceId: string, desde: string, hasta: string): Promise<VentaPagada[] | null> {
  const conexion = await leerConexionConGestion(workspaceId);
  if (!conexion) return null;
  try {
    const url = new URL("/api/ventas/pagadas", new URL(conexion.url).origin);
    url.searchParams.set("desde", desde);
    url.searchParams.set("hasta", hasta);
    const respuesta = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${conexion.llave}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!respuesta.ok) return null;
    const datos = (await respuesta.json()) as { ventas?: Array<Record<string, unknown>> };
    if (!Array.isArray(datos.ventas)) return null;
    const ventas: VentaPagada[] = [];
    for (const v of datos.ventas) {
      const pagada = new Date(String(v.pagadaEn ?? ""));
      const id = v.id === undefined || v.id === null ? "" : String(v.id);
      if (!id || Number.isNaN(pagada.getTime())) continue;
      const monto = Number(v.monto);
      ventas.push({
        id,
        cotizacion: typeof v.cotizacion === "string" && v.cotizacion.trim() ? v.cotizacion.trim() : null,
        telefono: typeof v.telefono === "string" ? v.telefono : null,
        monto: v.monto !== null && v.monto !== undefined && Number.isFinite(monto) ? monto : null,
        pagadaEn: pagada,
        ...(typeof v.ciudad === "string" && v.ciudad.trim() ? { ciudad: v.ciudad.trim() } : {}),
        ...(typeof v.departamento === "string" && v.departamento.trim() ? { departamento: v.departamento.trim() } : {}),
      });
    }
    return ventas;
  } catch {
    return null;
  }
}

async function ventasDelCrm(workspaceId: string, desdeFecha: Date, hastaFecha: Date): Promise<VentaPagada[]> {
  const ganados = await prisma.contact.findMany({
    where: { workspaceId, crmStage: "GANADO", wonAt: { gte: desdeFecha, lt: hastaFecha } },
    select: { id: true, phoneNumber: true, wonAt: true, wonQuoteRef: true },
  });
  return ganados.flatMap((c) =>
    c.wonAt
      ? [{ id: `CRM:${c.wonQuoteRef ?? c.id}`, cotizacion: c.wonQuoteRef, telefono: c.phoneNumber, monto: null, pagadaEn: c.wonAt }]
      : [],
  );
}

/** Días AAAA-MM-DD en hora de Colombia → instantes UTC [desde, hasta). */
export function limitesDelRango(desde: string, hasta: string) {
  return {
    desdeFecha: new Date(`${desde}T00:00:00-05:00`),
    hastaFecha: new Date(new Date(`${hasta}T00:00:00-05:00`).getTime() + 86_400_000),
  };
}

export async function sincronizarVentasDePauta(
  workspaceId: string,
  desde: string,
  hasta: string,
): Promise<{ fuente: FuenteDeVentas; ventas: number; dePauta: number }> {
  const { desdeFecha, hastaFecha } = limitesDelRango(desde, hasta);
  const deGestion = await pedirAGestion(workspaceId, desde, hasta);
  const fuente: FuenteDeVentas = deGestion ? "gestion" : "crm";
  const ventas = deGestion ?? (await ventasDelCrm(workspaceId, desdeFecha, hastaFecha));

  // Clientes por teléfono: todas las variantes de todas las ventas, en una sola consulta.
  const variantes = [...new Set(ventas.flatMap((v) => variantesDeTelefono(v.telefono)))];
  const contactos = variantes.length
    ? await prisma.contact.findMany({ where: { workspaceId, phoneNumber: { in: variantes } }, select: { id: true, phoneNumber: true } })
    : [];
  const origenes = contactos.length
    ? await prisma.origenDePauta.findMany({ where: { workspaceId, contactId: { in: contactos.map((c) => c.id) } }, select: { id: true, contactId: true } })
    : [];
  const origenDe = new Map(origenes.map((o) => [o.contactId, o.id]));
  const contactosPorTelefono = new Map<string, string[]>();
  for (const c of contactos) contactosPorTelefono.set(c.phoneNumber, [...(contactosPorTelefono.get(c.phoneNumber) ?? []), c.id]);

  let dePauta = 0;
  for (const v of ventas) {
    const ids = variantesDeTelefono(v.telefono).flatMap((t) => contactosPorTelefono.get(t) ?? []);
    // Si el mismo cliente quedó en dos fichas (57… y sin 57), manda la que tiene anuncio.
    const contactId = ids.find((id) => origenDe.has(id)) ?? ids[0] ?? null;
    const origenDePautaId = contactId ? origenDe.get(contactId) ?? null : null;
    const categoria = origenDePautaId ? "PAUTA" : "ORGANICO_OTRO";
    if (origenDePautaId) dePauta += 1;
    const datos = { cotizacion: v.cotizacion, telefono: v.telefono, monto: v.monto, pagadaEn: v.pagadaEn, contactId, origenDePautaId, categoria };
    await prisma.ventaDePauta.upsert({
      where: { workspaceId_ventaGestionId: { workspaceId, ventaGestionId: v.id } },
      create: { workspaceId, ventaGestionId: v.id, ...datos },
      update: datos,
    });
  }
  return { fuente, ventas: ventas.length, dePauta };
}

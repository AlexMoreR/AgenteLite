import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";

import type { CotizacionDeGestion } from "../dominio/reglas";

/**
 * COTIZACIONES DE UN DÍA (solo leer): las cotizaciones que se crearon en Gestión ese día (hora de Colombia),
 * con su vendedora. Es la misma fuente que `listar_cotizaciones` del MCP de Gestión.
 *
 * Gestión: GET /api/cotizaciones?desde=AAAA-MM-DD&hasta=AAAA-MM-DD (misma conexión y llave del catálogo)
 * → { cotizaciones: [{ numero, vendedora, creadaEn }] }.
 * Si Gestión no responde devuelve `null` (nunca se inventa el número con otra fuente).
 */

export type CotizacionesDelDia = { cotizaciones: CotizacionDeGestion[]; motivo?: undefined } | { cotizaciones: null; motivo: string };

const texto = (valor: unknown) => (typeof valor === "string" && valor.trim() ? valor.trim() : null);

function nombreDeVendedora(fila: Record<string, unknown>): string | null {
  const directo = texto(fila.vendedora) ?? texto(fila.vendedor) ?? texto(fila.vendedoraNombre);
  if (directo) return directo;
  for (const clave of ["vendedora", "vendedor", "usuario", "creadaPor"]) {
    const anidado = fila[clave];
    if (anidado && typeof anidado === "object") {
      const nombre = texto((anidado as Record<string, unknown>).nombre) ?? texto((anidado as Record<string, unknown>).name);
      if (nombre) return nombre;
    }
  }
  return null;
}

export async function cotizacionesDelDiaEnGestion(workspaceId: string, fecha: string): Promise<CotizacionesDelDia> {
  const conexion = await leerConexionConGestion(workspaceId);
  if (!conexion) return { cotizaciones: null, motivo: "Este negocio no tiene conexión con Gestión." };
  try {
    const url = new URL("/api/cotizaciones", new URL(conexion.url).origin);
    url.searchParams.set("desde", fecha);
    url.searchParams.set("hasta", fecha);
    const respuesta = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${conexion.llave}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(30_000),
    });
    if (!respuesta.ok) return { cotizaciones: null, motivo: `Gestión respondió ${respuesta.status} al pedir las cotizaciones.` };
    const datos = (await respuesta.json()) as { cotizaciones?: unknown };
    if (!Array.isArray(datos.cotizaciones)) return { cotizaciones: null, motivo: "Gestión no devolvió la lista de cotizaciones." };
    const cotizaciones = datos.cotizaciones
      .filter((fila): fila is Record<string, unknown> => Boolean(fila) && typeof fila === "object")
      .map((fila) => ({ vendedora: nombreDeVendedora(fila) }));
    return { cotizaciones };
  } catch (error) {
    return { cotizaciones: null, motivo: `No se pudo leer Gestión: ${error instanceof Error ? error.message : String(error)}` };
  }
}

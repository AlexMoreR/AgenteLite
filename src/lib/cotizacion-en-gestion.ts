import type { PedidoDeCotizacion } from "@/features/cotizaciones/services/generar-cotizacion";
import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";

/**
 * POST /api/cotizaciones de Gestion: crea la cotizacion con los datos de la ficha del chat.
 *
 * Misma conexion y llave que el catalogo, los envios y el aviso de origen (AppSetting
 * gestion:catalogo:<workspaceId>, ver sincronizacion-gestion.ts): no hay variables nuevas.
 * La llave nunca va al log. Gestion es idempotente (mismo chat + mismos productos en 10 min =
 * la misma cotizacion), asi que reintentar un corte de red no duplica.
 */
export async function crearCotizacionEnGestion(
  workspaceId: string,
  pedido: PedidoDeCotizacion,
): Promise<{ ok: true; status: number; cuerpo: unknown } | { ok: false; error: string }> {
  const conexion = await leerConexionConGestion(workspaceId);
  if (!conexion) {
    return { ok: false, error: "Este negocio no tiene conexión con Gestión." };
  }
  const url = new URL("/api/cotizaciones", new URL(conexion.url).origin);
  const cuerpo = JSON.stringify(pedido);

  let ultimoError = "Gestión no respondió. Prueba de nuevo.";
  for (let intento = 0; intento < 2; intento += 1) {
    try {
      const respuesta = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${conexion.llave}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: cuerpo,
        cache: "no-store",
        signal: AbortSignal.timeout(20_000),
      });
      const datos = await respuesta.json().catch(() => null);
      // 5xx: un reintento (idempotente). 4xx no se arregla reintentando.
      if (respuesta.status >= 500 && intento === 0) {
        ultimoError = `Gestión respondió ${respuesta.status}.`;
        continue;
      }
      return { ok: true, status: respuesta.status, cuerpo: datos };
    } catch (error) {
      ultimoError = error instanceof Error && error.name === "TimeoutError" ? "Gestión tardó demasiado. Prueba de nuevo." : ultimoError;
    }
  }
  console.warn("[cotizacion-gestion] sin respuesta", { workspaceId, error: ultimoError });
  return { ok: false, error: ultimoError };
}

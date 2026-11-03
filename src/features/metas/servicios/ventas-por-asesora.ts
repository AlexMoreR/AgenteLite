import { limitesDelRango } from "@/features/pauta/servicios/ventas-de-gestion";
import type { VentaDeGestion } from "@/features/metas/dominio/calculo";
import { esMesValido } from "@/features/metas/dominio/metas-guardadas";
import { leerVentasDeLaRespuesta } from "@/features/metas/dominio/panel-visible";
import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";

/**
 * Ventas pagadas del mes, con la vendedora y la ganancia, para el panel "Meta del mes". Solo lee Gestión.
 *
 * Es el mismo pedido de `pedirAGestion` (`GET /api/ventas/pagadas?desde&hasta`, misma llave), pero aquí se leen además
 * `vendedora`, `ganancia` y `ganancia_confiable`, que Gestión puede no mandar todavía. No se cambia `pedirAGestion`:
 * lo usa la pauta y allí esos campos no hacen falta.
 *
 * El resultado se guarda 5 minutos en memoria (por negocio y mes): Mi día se abre muchas veces al día y Gestión no
 * tiene por qué recibir un pedido en cada una. Lo que falla no se guarda, para que el siguiente intento vuelva a probar.
 * Aquí no se usan `headers()` ni `cookies()`: el negocio llega como parámetro.
 */

const CINCO_MINUTOS = 5 * 60 * 1000;
const MAXIMO_EN_MEMORIA = 200;

const enMemoria = new Map<string, { vence: number; ventas: VentaDeGestion[] }>();

/** Último día (AAAA-MM-DD) del mes AAAA-MM. */
function ultimoDia(mes: string): string {
  const [anio, numero] = mes.split("-").map(Number);
  const dia = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
  return `${mes}-${String(dia).padStart(2, "0")}`;
}

/** Ventas pagadas del mes (AAAA-MM). `null` si no hay conexión con Gestión, no respondió o respondió algo raro. */
export async function leerVentasDelMes(workspaceId: string, mes: string): Promise<VentaDeGestion[] | null> {
  if (!esMesValido(mes)) return null;
  const clave = `${workspaceId}:${mes}`;
  const guardado = enMemoria.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.ventas;

  try {
    const conexion = await leerConexionConGestion(workspaceId);
    if (!conexion) return null;
    const desde = `${mes}-01`;
    const hasta = ultimoDia(mes);
    const url = new URL("/api/ventas/pagadas", new URL(conexion.url).origin);
    url.searchParams.set("desde", desde);
    url.searchParams.set("hasta", hasta);
    const respuesta = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${conexion.llave}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    if (!respuesta.ok) return null;
    const ventas = leerVentasDeLaRespuesta(await respuesta.json(), limitesDelRango(desde, hasta));
    if (!ventas) return null;

    if (enMemoria.size >= MAXIMO_EN_MEMORIA) enMemoria.clear();
    enMemoria.set(clave, { vence: Date.now() + CINCO_MINUTOS, ventas });
    return ventas;
  } catch {
    // Sin conexión, sin respuesta a tiempo o JSON dañado: el panel dice "No se pudo leer Gestión".
    return null;
  }
}

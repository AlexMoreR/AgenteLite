import type { VentaDeGestion } from "@/features/metas/dominio/calculo";
import { esMesValido } from "@/features/metas/dominio/metas-guardadas";
import { ventaDesdeGestion } from "@/features/metas/dominio/panel-visible";
import { limitesDelRango } from "@/features/pauta/servicios/ventas-de-gestion";
import { leerConexionConGestion } from "@/lib/sincronizacion-gestion";

/**
 * Las ventas pagadas del mes en Gestión, con la vendedora y la ganancia (solo leer: Gestión no se toca).
 *
 * Es la misma llamada que hace `pedirAGestion` (pauta): `GET /api/ventas/pagadas?desde=…&hasta=…` con la llave
 * de la conexión, pero con 10 s de espera, porque Mi día no puede quedarse colgado esperando a Gestión.
 *
 * El resultado se guarda 5 minutos en memoria por negocio y mes: Mi día se abre muchas veces al día y no hace
 * falta preguntarle a Gestión cada vez. Si falla, el `null` se guarda solo 1 minuto, para no esperar los 10 s
 * en cada recarga mientras Gestión está caída. Nada de esto usa `headers()` ni `cookies()`.
 */

const DURA_LO_LEIDO_MS = 5 * 60_000;
const DURA_LA_FALLA_MS = 60_000;
const ESPERA_A_GESTION_MS = 10_000;

type Guardado = { vence: number; ventas: Promise<VentaDeGestion[] | null> };
const guardadas = new Map<string, Guardado>();

/** 'AAAA-MM' → primer y último día del mes ('AAAA-MM-DD'). */
function diasDelMes(mes: string) {
  const [anio, numero] = mes.split("-").map(Number);
  const ultimo = new Date(Date.UTC(anio, numero, 0)).getUTCDate();
  return { desde: `${mes}-01`, hasta: `${mes}-${String(ultimo).padStart(2, "0")}` };
}

async function pedirVentasDelMes(workspaceId: string, mes: string): Promise<VentaDeGestion[] | null> {
  try {
    const conexion = await leerConexionConGestion(workspaceId);
    if (!conexion) return null;
    const { desde, hasta } = diasDelMes(mes);
    const url = new URL("/api/ventas/pagadas", new URL(conexion.url).origin);
    url.searchParams.set("desde", desde);
    url.searchParams.set("hasta", hasta);
    const respuesta = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${conexion.llave}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(ESPERA_A_GESTION_MS),
    });
    if (!respuesta.ok) return null;
    const datos = (await respuesta.json()) as { ventas?: unknown };
    if (!Array.isArray(datos.ventas)) return null;

    // Por si Gestión manda de más: solo las pagadas dentro del mes (hora de Colombia). Las de fecha dañada pasan
    // y `calcularPanel` las descarta con su aviso.
    const { desdeFecha, hastaFecha } = limitesDelRango(desde, hasta);
    const ventas: VentaDeGestion[] = [];
    for (const cruda of datos.ventas) {
      const venta = ventaDesdeGestion(cruda);
      if (!venta) continue;
      const pagada = new Date(venta.fechaPago).getTime();
      if (Number.isFinite(pagada) && (pagada < desdeFecha.getTime() || pagada >= hastaFecha.getTime())) continue;
      ventas.push(venta);
    }
    return ventas;
  } catch {
    // Sin red, sin base o respuesta dañada: el panel dice "No se pudo leer Gestión" y Mi día carga igual.
    return null;
  }
}

/** Las ventas pagadas del mes ('AAAA-MM'). `null` = sin conexión con Gestión o no respondió. */
export async function leerVentasDelMes(workspaceId: string, mes: string): Promise<VentaDeGestion[] | null> {
  if (!workspaceId || !esMesValido(mes)) return null;
  const ahora = Date.now();
  const clave = `${workspaceId}:${mes}`;
  const guardado = guardadas.get(clave);
  if (guardado && guardado.vence > ahora) return guardado.ventas;

  // Se limpian las vencidas para que el Map no crezca sin fin.
  for (const [otra, valor] of guardadas) if (valor.vence <= ahora) guardadas.delete(otra);

  // Se guarda la promesa: dos pantallas que abren a la vez hacen una sola llamada a Gestión.
  const ventas = pedirVentasDelMes(workspaceId, mes);
  const nuevo: Guardado = { vence: ahora + DURA_LO_LEIDO_MS, ventas };
  guardadas.set(clave, nuevo);
  const resultado = await ventas;
  if (resultado === null && guardadas.get(clave) === nuevo) nuevo.vence = ahora + DURA_LA_FALLA_MS;
  return resultado;
}

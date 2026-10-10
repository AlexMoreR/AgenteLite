import { prisma } from "@/lib/prisma";

import { claveDeProducto, leerConfigEmbudoDeTexto, type ConfigEmbudo } from "../dominio/combo";

/**
 * EL INTERRUPTOR y la configuración del embudo, con un minuto de memoria.
 *
 * Se consultan en cada evento (decenas por minuto en hora pico): leerlos de la base cada vez
 * sería trabajo al vicio. Un minuto de memoria alcanza para que apagar el registro tarde a lo
 * sumo un minuto en hacer efecto en cada proceso.
 *
 * - `embudo:activo:<workspaceId>`: si vale "false", NO se registra nada. Sin fila = activo.
 * - `embudo:config:<workspaceId>`: JSON con qué es el Combo de Camilla (ver dominio/combo.ts).
 */

const MEMORIA_MS = 60_000;

export const claveInterruptorEmbudo = (workspaceId: string) => `embudo:activo:${workspaceId}`;
export const claveConfigEmbudo = (workspaceId: string) => `embudo:config:${workspaceId}`;

const activos = new Map<string, { valor: boolean; vence: number }>();
const configs = new Map<string, { valor: ConfigEmbudo; vence: number }>();
const nombresDeProducto = new Map<string, { valor: string | null; vence: number }>();

/** ¿Se registra el embudo en este negocio? Ante cualquier duda (base caída), NO. */
export async function embudoActivo(workspaceId: string): Promise<boolean> {
  if (!workspaceId) return false;
  const guardado = activos.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveInterruptorEmbudo(workspaceId) } });
    const valor = (fila?.value ?? "").trim().toLowerCase() !== "false";
    activos.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
    return valor;
  } catch {
    return false;
  }
}

export async function leerConfigEmbudo(workspaceId: string): Promise<ConfigEmbudo> {
  const guardado = configs.get(workspaceId);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: ConfigEmbudo;
  try {
    const fila = await prisma.appSetting.findUnique({ where: { key: claveConfigEmbudo(workspaceId) } });
    valor = leerConfigEmbudoDeTexto(fila?.value);
  } catch {
    valor = leerConfigEmbudoDeTexto(null);
  }
  configs.set(workspaceId, { valor, vence: Date.now() + MEMORIA_MS });
  return valor;
}

/** El nombre del producto (para reconocer el combo por nombre). Null si no existe. */
async function nombreDelProducto(workspaceId: string, productoId: string): Promise<string | null> {
  const clave = `${workspaceId}:${productoId}`;
  const guardado = nombresDeProducto.get(clave);
  if (guardado && guardado.vence > Date.now()) return guardado.valor;
  let valor: string | null = null;
  try {
    const producto = await prisma.product.findFirst({
      where: { id: productoId, workspaceId },
      select: { name: true },
    });
    valor = producto?.name ?? null;
  } catch {
    valor = null;
  }
  nombresDeProducto.set(clave, { valor, vence: Date.now() + 10 * MEMORIA_MS });
  return valor;
}

/** La clave de producto del embudo para un id del V3: "combo-camilla" o el mismo id. */
export async function claveDeProductoDelV3(workspaceId: string, productoId: string | null | undefined): Promise<string | null> {
  if (!productoId) return null;
  const config = await leerConfigEmbudo(workspaceId);
  const nombre = await nombreDelProducto(workspaceId, productoId);
  return claveDeProducto({ id: productoId, nombre }, config);
}

import {
  claveEnvioContraentrega,
  leerEnvioContraentregaGuardado,
  type EnvioContraentregaGuardado,
} from "@/lib/contraentrega";
import { prisma } from "@/lib/prisma";

/*
  VALOR DEL ENVÍO DE CONTRAENTREGA POR UBICACIÓN (decisión de Alex, 14-oct-2026).

  El dueño o un administrador lo escribe en el panel de Envío del chat y queda para todas las
  asesoras. Se guarda en la base del CRM (no en Gestión: su API de ubicaciones no se toca), en
  AppSetting, sin migración, igual que las supervisoras o la configuración del reparto.

  Una fila por ubicación (`envio:contraentrega:<workspace>:<ciudad|corregimiento>:<id de Gestión>`)
  y no un solo mapa: así dos admins guardando ubicaciones distintas a la vez no se pisan, y leer
  una ubicación es una sola consulta por clave. El valor es JSON { valor, nombre, actualizadoPor, fecha }.
*/

export type UbicacionGuardable = { tipo: "ciudad" | "corregimiento"; id: string };

export async function leerEnvioContraentrega(
  workspaceId: string,
  ubicacion: UbicacionGuardable,
): Promise<EnvioContraentregaGuardado | null> {
  const fila = await prisma.appSetting.findUnique({
    where: { key: claveEnvioContraentrega(workspaceId, ubicacion.tipo, ubicacion.id) },
    select: { value: true },
  });
  return leerEnvioContraentregaGuardado(fila?.value);
}

export async function guardarEnvioContraentrega(
  workspaceId: string,
  ubicacion: UbicacionGuardable,
  dato: EnvioContraentregaGuardado,
): Promise<void> {
  const key = claveEnvioContraentrega(workspaceId, ubicacion.tipo, ubicacion.id);
  const value = JSON.stringify(dato);
  await prisma.appSetting.upsert({ where: { key }, create: { key, value }, update: { value } });
}

export async function borrarEnvioContraentrega(workspaceId: string, ubicacion: UbicacionGuardable): Promise<void> {
  await prisma.appSetting.deleteMany({
    where: { key: claveEnvioContraentrega(workspaceId, ubicacion.tipo, ubicacion.id) },
  });
}

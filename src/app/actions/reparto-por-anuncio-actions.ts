"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { prisma } from "@/lib/prisma";
import {
  MAXIMO_DE_REGLAS,
  TIPOS_DE_REGLA,
  esIdDeMeta,
  guardarReglas,
  leerReglas,
  type ReglaDeAnuncio,
  type TipoDeRegla,
} from "@/lib/reparto-por-anuncio";

/**
 * Reglas del REPARTO POR ANUNCIO (pantalla Equipo → Reparto por anuncio). Solo el dueño o un
 * administrador, igual que el resto de Equipo. Todo se valida contra el negocio de quien pide: la
 * línea y la asesora tienen que ser de ese negocio.
 */

const RUTA = "/cliente/equipo/reparto-por-anuncio";

type Respuesta = { ok: true } | { error: string };

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export async function crearReglaDeAnuncioAction(input: {
  tipo: string;
  metaId: string;
  nombre: string;
  channelId: string;
  asignarA: string;
  sinBienvenida: boolean;
}): Promise<Respuesta> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });

  const tipo = texto(input?.tipo);
  if (!(TIPOS_DE_REGLA as readonly string[]).includes(tipo)) return { error: "Elige si es una campaña o un anuncio." };
  const metaId = texto(input?.metaId);
  if (!esIdDeMeta(metaId)) return { error: "El número de Meta tiene que ser solo números, de 5 a 25 cifras." };
  const nombre = texto(input?.nombre).slice(0, 80);
  if (!nombre) return { error: "Ponle un nombre para reconocerla." };
  const channelId = texto(input?.channelId);
  const asignarA = texto(input?.asignarA) || null;

  try {
    const [linea, asesora, reglas] = await Promise.all([
      channelId
        ? prisma.whatsAppChannel.findFirst({ where: { id: channelId, workspaceId: access.workspaceId }, select: { id: true } })
        : null,
      asignarA
        ? prisma.workspaceMember.findFirst({
            where: { workspaceId: access.workspaceId, userId: asignarA, isActive: true },
            select: { userId: true },
          })
        : null,
      leerReglas(access.workspaceId),
    ]);
    if (!linea) return { error: "Elige la línea de WhatsApp." };
    if (asignarA && !asesora) return { error: "Esa asesora no está activa en el equipo." };
    if (reglas.some((regla) => regla.tipo === tipo && regla.metaId === metaId && regla.channelId === channelId)) {
      return { error: "Ya hay una regla con ese número en esa línea." };
    }
    if (reglas.length >= MAXIMO_DE_REGLAS) return { error: `Máximo ${MAXIMO_DE_REGLAS} reglas: borra alguna.` };

    const nueva: ReglaDeAnuncio = {
      id: randomUUID(),
      tipo: tipo as TipoDeRegla,
      metaId,
      nombre,
      channelId,
      asignarA,
      sinBienvenida: asignarA !== null && input?.sinBienvenida === true,
      activa: true,
      creadaEn: new Date().toISOString(),
    };
    await guardarReglas(access.workspaceId, [...reglas, nueva]);
  } catch (error) {
    console.error("[reparto-por-anuncio] no se pudo guardar la regla", error);
    return { error: "No se pudo guardar la regla. Intenta de nuevo." };
  }
  revalidatePath(RUTA);
  return { ok: true };
}

export async function cambiarReglaDeAnuncioAction(input: { id: string; activa: boolean }): Promise<Respuesta> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });
  const id = texto(input?.id);
  try {
    const reglas = await leerReglas(access.workspaceId);
    if (!reglas.some((regla) => regla.id === id)) return { error: "Esa regla ya no existe." };
    await guardarReglas(
      access.workspaceId,
      reglas.map((regla) => (regla.id === id ? { ...regla, activa: input?.activa === true } : regla)),
    );
  } catch (error) {
    console.error("[reparto-por-anuncio] no se pudo cambiar la regla", error);
    return { error: "No se pudo cambiar la regla. Intenta de nuevo." };
  }
  revalidatePath(RUTA);
  return { ok: true };
}

export async function borrarReglaDeAnuncioAction(input: { id: string }): Promise<Respuesta> {
  const access = await requireClientWorkspaceAccess("client_team", { ownerOnly: true });
  const id = texto(input?.id);
  try {
    const reglas = await leerReglas(access.workspaceId);
    if (!reglas.some((regla) => regla.id === id)) return { error: "Esa regla ya no existe." };
    await guardarReglas(
      access.workspaceId,
      reglas.filter((regla) => regla.id !== id),
    );
  } catch (error) {
    console.error("[reparto-por-anuncio] no se pudo borrar la regla", error);
    return { error: "No se pudo borrar la regla. Intenta de nuevo." };
  }
  revalidatePath(RUTA);
  return { ok: true };
}

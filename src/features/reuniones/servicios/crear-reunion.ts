import { randomBytes } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { slugLibre } from "@/features/reuniones/servicios/slug-de-reunion";

/*
  CREAR UNA REUNIÓN: lo usan "Nueva reunión" (reuniones-actions.ts) y las salas fijas (salas.ts).
  Recibe la base (o la transacción) para que la sala fija la cree dentro de su bloqueo.
*/

type Base = PrismaClient | Prisma.TransactionClient;

/**
 * ¿El link ya está tomado? Mira las reuniones y las salas fijas, porque los dos van en /reunion/<codigo>.
 */
export async function codigoOcupado(db: Base, codigo: string): Promise<boolean> {
  const [reuniones, salas] = await Promise.all([
    db.reunion.count({ where: { codigo } }),
    db.salaDeReuniones.count({ where: { codigo } }),
  ]);
  return reuniones + salas > 0;
}

/** El título por defecto: "Reunión 30 oct 2026, 3:15 p. m." (hora de Bogotá). */
export function fechaParaTitulo(fecha = new Date()): string {
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(fecha);
}

export async function crearReunion(
  db: Base,
  datos: { workspaceId: string; creadaPorId: string | null; titulo?: string; sinGrabar?: boolean; salaFijaId?: string | null },
): Promise<{ id: string; codigo: string }> {
  const limpio = datos.titulo?.replace(/\s+/g, " ").trim().slice(0, 120);
  const tituloFinal = limpio || `Reunión ${fechaParaTitulo()}`;
  // El link sale del título (reunion-de-ventas, -2, -3 si ya existe); los viejos, al azar, siguen valiendo.
  const codigo = await slugLibre(tituloFinal, (c) => codigoOcupado(db, c));
  return db.reunion.create({
    data: {
      workspaceId: datos.workspaceId,
      creadaPorId: datos.creadaPorId,
      titulo: tituloFinal,
      codigo,
      sala: `reunion_${randomBytes(9).toString("hex")}`,
      sinGrabar: datos.sinGrabar === true,
      salaFijaId: datos.salaFijaId ?? null,
    },
    select: { id: true, codigo: true },
  });
}

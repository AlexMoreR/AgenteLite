import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/prisma";

import { textoDeLaAlerta, type Incidente } from "../dominio/alertas";
import type { Hallazgo, Severidad } from "../dominio/tipos";

/**
 * DÓNDE VIVEN LAS ALERTAS: la tabla SupervisorAlerta (una fila por incidente).
 *
 * `claveAbierta` = "<workspaceId>:<clave>" mientras el incidente está ABIERTO (único), y null
 * cuando se resuelve: así hay un solo incidente abierto por clave y el historial queda.
 */

function aFecha(valor: unknown): Date {
  return valor instanceof Date ? valor : new Date(String(valor));
}

/** Los hallazgos guardados en JSON vuelven con sus fechas como Date. */
function revivirHallazgos(valor: unknown): Hallazgo[] {
  if (!Array.isArray(valor)) return [];
  return (valor as Array<Record<string, unknown>>).map((h) => ({ ...(h as unknown as Hallazgo), desde: aFecha(h.desde) }));
}

type FilaDeAlerta = {
  clave: string;
  familia: string;
  severidad: string;
  estado: string;
  titulo: string;
  producto: string | null;
  desde: Date;
  primeraVezEn: Date;
  ultimaVezEn: Date;
  vecesVista: number;
  hallazgos: Prisma.JsonValue;
  notificadaEn: Date | null;
  severidadNotificada: string | null;
  resueltaEn: Date | null;
};

export function filaAIncidente(fila: FilaDeAlerta): Incidente {
  return {
    clave: fila.clave,
    familia: fila.familia as Incidente["familia"],
    severidad: fila.severidad as Severidad,
    titulo: fila.titulo,
    producto: fila.producto,
    desde: fila.desde,
    primeraVezEn: fila.primeraVezEn,
    ultimaVezEn: fila.ultimaVezEn,
    vecesVista: fila.vecesVista,
    estado: fila.estado === "RESUELTA" ? "RESUELTA" : "ABIERTA",
    resueltaEn: fila.resueltaEn,
    notificadaEn: fila.notificadaEn,
    severidadNotificada: (fila.severidadNotificada as Severidad | null) ?? null,
    hallazgos: revivirHallazgos(fila.hallazgos),
  };
}

export async function leerIncidentesAbiertos(workspaceId: string): Promise<Incidente[]> {
  const filas = await prisma.supervisorAlerta.findMany({ where: { workspaceId, estado: "ABIERTA" } });
  return filas.map(filaAIncidente);
}

export async function leerAlertasRecientes(workspaceId: string, dias = 14) {
  const filas = await prisma.supervisorAlerta.findMany({
    where: { workspaceId, OR: [{ estado: "ABIERTA" }, { ultimaVezEn: { gte: new Date(Date.now() - dias * 24 * 3_600_000) } }] },
    orderBy: [{ estado: "asc" }, { ultimaVezEn: "desc" }],
    take: 100,
  });
  return filas.map((fila) => ({ ...filaAIncidente(fila), texto: fila.texto, id: fila.id }));
}

/** Guarda solo lo que cambió en esta vuelta (visto ahora, resuelto ahora o avisado ahora). */
export async function guardarIncidentes(workspaceId: string, incidentes: Incidente[], ahora: Date): Promise<number> {
  let guardados = 0;
  for (const inc of incidentes) {
    const tocado =
      inc.ultimaVezEn.getTime() === ahora.getTime() ||
      inc.resueltaEn?.getTime() === ahora.getTime() ||
      inc.notificadaEn?.getTime() === ahora.getTime();
    if (!tocado) continue;
    const abierta = `${workspaceId}:${inc.clave}`;
    const datos = {
      familia: inc.familia,
      severidad: inc.severidad,
      estado: inc.estado,
      titulo: inc.titulo.slice(0, 300),
      producto: inc.producto,
      desde: inc.desde,
      primeraVezEn: inc.primeraVezEn,
      ultimaVezEn: inc.ultimaVezEn,
      vecesVista: inc.vecesVista,
      hallazgos: JSON.parse(JSON.stringify(inc.hallazgos)) as Prisma.InputJsonValue,
      texto: textoDeLaAlerta(inc, ahora),
      notificadaEn: inc.notificadaEn,
      severidadNotificada: inc.severidadNotificada,
      resueltaEn: inc.resueltaEn,
      claveAbierta: inc.estado === "ABIERTA" ? abierta : null,
    };
    const existente = await prisma.supervisorAlerta.findUnique({ where: { claveAbierta: abierta } });
    if (existente) {
      await prisma.supervisorAlerta.update({ where: { id: existente.id }, data: datos });
    } else if (inc.estado === "ABIERTA") {
      await prisma.supervisorAlerta.create({ data: { ...datos, workspaceId, clave: inc.clave } });
    }
    guardados += 1;
  }
  return guardados;
}

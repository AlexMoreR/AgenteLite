import { prisma } from "@/lib/prisma";

import { moverDia } from "../dominio/acciones-de-hoy";
import { diasDeLosInformes, type DiaDeAsesora, type InformeParaLinea } from "../dominio/linea-de-tiempo";
import { rangoDelDia } from "../reglas";
import type { ResumenDelEquipo } from "../tipos";
import { aParte, completarHabilidades } from "./leer-coach";

/**
 * Los dias del Coach de un rango, una fila por asesora y dia (ver dominio/linea-de-tiempo.ts).
 *
 * UNA consulta acotada por negocio y fechas (con las asesoras incluidas: sin N+1). Trae un dia mas
 * al final para saber si se cumplio la meta del ultimo dia. Solo informes LISTO. No escribe nada.
 *
 * Con `soloUserId` devuelve solo las filas de esa asesora; las demas partes se leen solo para
 * calcular la habilidad de informes viejos (igual que leer-coach.ts) y no salen de aca.
 */
export async function leerDiasDelCoach(
  workspaceId: string,
  desde: string,
  hasta: string,
  opciones: { soloUserId?: string } = {},
): Promise<DiaDeAsesora[]> {
  const filas = await prisma.coachInforme.findMany({
    where: {
      workspaceId,
      estado: "LISTO",
      fecha: { gte: rangoDelDia(desde).clave, lte: rangoDelDia(moverDia(hasta, 1)).clave },
    },
    orderBy: { fecha: "asc" },
    select: {
      fecha: true,
      resumenEquipo: true,
      asesoras: {
        orderBy: { nombre: "asc" },
        select: { userId: true, nombre: true, chats: true, puntaje: true, puntajes: true, errores: true, pendientes: true, resumen: true },
      },
    },
  });
  const informes: InformeParaLinea[] = filas.map((fila) => {
    const dia = fila.fecha.toISOString().slice(0, 10);
    const partes = fila.asesoras.map((a) => aParte({ ...a, aciertos: [] }));
    const calculados = completarHabilidades(partes, dia);
    const guardados = (fila.resumenEquipo as ResumenDelEquipo | null)?.problemasDelEquipo;
    return { dia, problemasDelEquipo: guardados ?? calculados, asesoras: partes };
  });
  return diasDeLosInformes(informes).filter(
    (d) => d.dia >= desde && d.dia <= hasta && (!opciones.soloUserId || d.userId === opciones.soloUserId),
  );
}

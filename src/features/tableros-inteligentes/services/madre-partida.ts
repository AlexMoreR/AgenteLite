/*
  CERRAR UNA MADRE PARTIDA (26-oct-2026). Una tarjeta que el Coordinador partió (/partir) se queda en su etapa
  (PLANEANDO o EN_CURSO) sin candado mientras sus partes avanzan, y se cierra sola cuando todas terminaron:
  HECHO si todas quedaron HECHO, FALLIDO si alguna quedó FALLIDO (cierreDeLaMadre, reglas-trabajador.ts).

  Lo llaman todos los caminos por los que una parte termina (la subida del Coordinador, el HECHO a mano, el
  FALLIDO de la pantalla o del MCP, "Cerrar como fallida") y /tomar en cada vuelta (las madres que quedaron
  colgadas de antes). Quien llama anota el historial con su origen (TRABAJADOR, PANTALLA o MCP).
*/

import type { Prisma } from "@prisma/client";

import { cierreDeLaMadre, notaDelCierreDeLaMadre, partidaDelResultado } from "./reglas-trabajador";
import { SQL_ES_PARTE } from "./sql-trabajador";

type Tx = Prisma.TransactionClient;

export type MadreCerrada = {
  id: string;
  tableroId: string;
  antes: "PLANEANDO" | "EN_CURSO";
  estado: "HECHO" | "FALLIDO";
  nota: string;
};

/** Si la madre partida `madreId` ya no espera a ninguna parte, la cierra (HECHO o FALLIDO). null si no tocaba. */
export async function cerrarLaMadreSiToca(tx: Tx, madreId: string): Promise<MadreCerrada | null> {
  const madre = await tx.tarjetaTablero.findUnique({
    where: { id: madreId },
    select: { id: true, tableroId: true, estado: true, resultado: true, borradoEn: true },
  });
  const partida = partidaDelResultado(madre?.resultado);
  if (!madre || !partida || madre.borradoEn || (madre.estado !== "EN_CURSO" && madre.estado !== "PLANEANDO")) return null;
  const hijas = await tx.tarjetaTablero.findMany({ where: { id: { in: partida.hijas }, borradoEn: null }, select: { estado: true } });
  const cierre = cierreDeLaMadre(hijas);
  if (!cierre) return null;
  const hecho = await tx.tarjetaTablero.updateMany({
    // Condicionado al estado y a que nadie le haya puesto candado un instante antes.
    where: { id: madre.id, estado: madre.estado, trabajoVenceEn: null, borradoEn: null },
    data: { estado: cierre, trabajoVenceEn: null },
  });
  if (hecho.count !== 1) return null;
  return { id: madre.id, tableroId: madre.tableroId, antes: madre.estado, estado: cierre, nota: notaDelCierreDeLaMadre(hijas, cierre) };
}

/** Si `hija` es una parte de una tarjeta partida, cierra a la madre cuando ya no espera a ninguna parte. */
export async function cerrarLaMadreDeLaParte(tx: Tx, hija: { id: string; tableroId: string }): Promise<MadreCerrada | null> {
  const [fila] = await tx.$queryRawUnsafe<{ id: string }[]>(SQL_ES_PARTE, hija.tableroId, hija.id);
  return fila ? cerrarLaMadreSiToca(tx, fila.id) : null;
}

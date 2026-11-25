"use client";

import { use } from "react";
import { lineasDeLaPersona } from "@/features/actividad/services/lineas-de-la-persona";

/**
 * userId → "Última acción: …" ya armado en el servidor con `lineasDeLaPersona`.
 * Es un objeto plano (nada de Map ni Date) porque viaja del servidor al navegador.
 */
export type UltimasAccionesEnTexto = Record<string, string>;

/** Las clases de la línea "Última acción" debajo del nombre; las usa también el "Buscando…". */
export const CLASES_DE_LA_ULTIMA_ACCION = "max-w-64 text-[11px] leading-snug text-muted-foreground";

/**
 * La línea "Última acción" de una persona en Equipo. La consulta llega después que el resto de la
 * pantalla: mientras tanto el `<Suspense>` de afuera muestra "Buscando última acción…".
 */
export function UltimaAccionDePersona({
  promesa,
  userId,
}: {
  promesa: Promise<UltimasAccionesEnTexto>;
  userId: string;
}) {
  const textos = use(promesa);
  // Si la persona no vino en el objeto, el mismo texto de siempre: "Sin acciones en 30 días".
  const texto = textos[userId] ?? lineasDeLaPersona({ latido: null, ultimaAccion: null }).accion;
  return <span className={CLASES_DE_LA_ULTIMA_ACCION}>{texto}</span>;
}

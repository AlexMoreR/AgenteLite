/*
  EL AVANCE DE UN FLUJO PARA LA PANTALLA (parte 3 de «Flujos: que se envíen completos aunque la asesora
  cambie de chat, y al instante»).

  Lo que lee la franja «Enviando «flujo»: N de M» que sale arriba de la caja de escribir. Funciones
  puras: no importan Prisma ni gateways, no mandan nada. La ruta /api/cliente/chats/avance-de-flujo
  lee las filas EnvioDeFlujo y las pasa por aquí.

  De cada paso sale SOLO su estado, su tipo y su error: nunca el contenido (el texto o la dirección
  del archivo), que la franja no necesita.
*/
import { calcularAvance, type EstadoDeEnvio, type EstadoDePaso, type PasoDeEnvio, type TipoDePaso } from "@/lib/flujos/envio-de-flujo";

/** Un envío que terminó con fallas se sigue mostrando este rato, para que la asesora lo vea. */
export const MOSTRAR_FALLAS_POR_MS = 10 * 60_000;
/**
 * Un envío EN_CURSO más viejo que esto ya no se muestra: el cron lo cierra (solo retoma la última
 * media hora) y la franja no debe quedar pegada para siempre si algo no lo cerró.
 */
export const MOSTRAR_EN_CURSO_POR_MS = 60 * 60_000;
/** Cuántos envíos se devuelven como mucho por chat (los más nuevos). */
export const MAXIMO_DE_ENVIOS = 3;

export type PasoDelAvance = {
  indice: number;
  tipo: TipoDePaso;
  estado: EstadoDePaso;
  error: string | null;
};

export type AvanceDeFlujo = {
  envioId: string;
  titulo: string;
  enviados: number;
  total: number;
  /** Cuántos pasos no salieron (fallidos). Los omitidos (el audio) no cuentan. */
  fallidos: number;
  estado: EstadoDeEnvio;
  pasos: PasoDelAvance[];
};

export type FilaDeEnvio = {
  id: string;
  estado: string;
  startedAt: Date;
  finishedAt: Date | null;
};

function esEstadoDeEnvio(valor: string): valor is EstadoDeEnvio {
  return valor === "EN_CURSO" || valor === "TERMINADO" || valor === "CON_FALLAS";
}

/** EN_CURSO de la última hora, o CON_FALLAS que terminó hace poco. TERMINADO nunca: ya no hay nada que avisar. */
export function debeMostrarse(fila: FilaDeEnvio, ahora: number): boolean {
  if (fila.estado === "EN_CURSO") {
    return ahora - fila.startedAt.getTime() <= MOSTRAR_EN_CURSO_POR_MS;
  }
  if (fila.estado === "CON_FALLAS") {
    const fin = (fila.finishedAt ?? fila.startedAt).getTime();
    return ahora - fin <= MOSTRAR_FALLAS_POR_MS;
  }
  return false;
}

/** Arma lo que ve la franja. Los números salen de los pasos (calcularAvance), no de las columnas. */
export function armarAvance(fila: FilaDeEnvio, pasos: readonly PasoDeEnvio[], titulo: string): AvanceDeFlujo {
  const { enviados, total } = calcularAvance(pasos);
  return {
    envioId: fila.id,
    titulo: titulo.trim() || "Flujo sin nombre",
    enviados,
    total,
    fallidos: pasos.filter((paso) => paso.estado === "fallido").length,
    estado: esEstadoDeEnvio(fila.estado) ? fila.estado : "EN_CURSO",
    pasos: pasos.map((paso) => ({ indice: paso.indice, tipo: paso.tipo, estado: paso.estado, error: paso.error })),
  };
}

/** El texto de la franja. */
export function textoDeLaFranja(avance: Pick<AvanceDeFlujo, "titulo" | "enviados" | "total" | "fallidos" | "estado">): string {
  if (avance.estado === "EN_CURSO") {
    return `Enviando «${avance.titulo}»: ${avance.enviados} de ${avance.total}`;
  }
  const noSalieron = avance.fallidos === 1 ? "1 no salió" : `${avance.fallidos} no salieron`;
  return `«${avance.titulo}»: salieron ${avance.enviados} de ${avance.total}, ${noSalieron}`;
}

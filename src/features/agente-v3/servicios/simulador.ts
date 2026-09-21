import { prisma } from "@/lib/prisma";

import { decidir, siguienteEstado, type EstadoDeLaCharla } from "../motor/decidir";
import type { LibroDeReglas } from "../domain/reglas";

/**
 * EL SIMULADOR: qué habría hecho el V3 en una conversación que YA pasó.
 *
 * Es la condición con la que se construye el V3 (Alex, 21-sep-2026): nada toca a un cliente hasta
 * que esto muestre, sobre charlas reales, que contesta mejor que el V2.
 *
 * Lee los mensajes del cliente de una conversación real y los pasa por el motor, mensaje por
 * mensaje, arrastrando el estado igual que en la vida real. Al lado deja lo que el V2 contestó de
 * verdad, para poder comparar sin tener que abrir el chat.
 *
 * Lo que NO hace: no llama a la IA ni envía nada. Las reglas por intención se marcan como "habría
 * que preguntarle a la IA", y se puede correr mil veces sin gastar un peso ni molestar a nadie.
 */

export type TurnoSimulado = {
  cliente: string;
  cuando: string;
  /** Lo que el V2 contestó de verdad, junta la ráfaga de mensajes salientes. */
  v2Contesto: string[];
  /** Lo que haría el V3, en palabras del negocio. */
  v3Haria: string[];
  porque: string;
  /** Reglas de intención que habría que evaluar con IA para estar seguros. */
  necesitaIa: boolean;
};

function enPalabras(accionTipo: string, detalle: string): string {
  switch (accionTipo) {
    case "mensaje":
      return `Responde: "${detalle}"`;
    case "flujo":
      return `Envía el flujo ${detalle}`;
    case "responder_con_ia":
      return `Deja que la IA conteste, guiada por: ${detalle}`;
    case "activar_producto":
      return `Toma como producto de la charla: ${detalle}`;
    case "ir_al_paso":
      return `Pasa al paso ${detalle}`;
    case "cambiar_etapa_crm":
      return `Mueve la etapa a ${detalle}`;
    case "avisar_asesor":
      return `Avisa a un asesor: ${detalle}`;
    case "pausar_ia":
      return "Pausa la IA en esa conversación";
    default:
      return accionTipo;
  }
}

export async function simularConversacion(input: {
  workspaceId: string;
  conversationId: string;
  libro: LibroDeReglas;
  /** Cuántos mensajes del cliente mirar, del más viejo al más nuevo. */
  tope?: number;
}): Promise<{ turnos: TurnoSimulado[]; error?: string }> {
  const conversacion = await prisma.conversation.findFirst({
    where: { id: input.conversationId, workspaceId: input.workspaceId },
    select: { id: true },
  });
  if (!conversacion) {
    return { turnos: [], error: "Esa conversación no existe en este negocio" };
  }

  const mensajes = await prisma.message.findMany({
    where: { conversationId: conversacion.id },
    orderBy: { createdAt: "asc" },
    select: { content: true, direction: true, type: true, createdAt: true },
    take: 200,
  });

  let estado: EstadoDeLaCharla = {
    productoActivo: null,
    pasoActual: null,
    flujosEnviados: [],
    esPrimerMensaje: true,
  };

  const turnos: TurnoSimulado[] = [];
  const tope = input.tope ?? 12;

  for (let i = 0; i < mensajes.length && turnos.length < tope; i += 1) {
    const mensaje = mensajes[i];
    // Los del sistema ("El agente movió la etapa a...") no son cosas que el cliente dijo.
    if (mensaje.direction !== "INBOUND" || mensaje.type === "SYSTEM" || !mensaje.content?.trim()) {
      continue;
    }

    // Lo que el V2 contestó: todo lo saliente hasta el próximo mensaje del cliente.
    const respuestas: string[] = [];
    for (let j = i + 1; j < mensajes.length; j += 1) {
      const siguiente = mensajes[j];
      if (siguiente.direction === "INBOUND") {
        break;
      }
      if (siguiente.type !== "SYSTEM" && siguiente.content?.trim()) {
        respuestas.push(siguiente.content.trim().slice(0, 200));
      }
    }

    const decision = decidir({ libro: input.libro, mensaje: mensaje.content, estado });
    turnos.push({
      cliente: mensaje.content.trim().slice(0, 200),
      cuando: mensaje.createdAt.toISOString(),
      v2Contesto: respuestas.slice(0, 4),
      v3Haria: [...decision.saludo, ...decision.acciones].map((accion) =>
        enPalabras(
          accion.tipo,
          "texto" in accion
            ? accion.texto
            : "titulo" in accion && accion.titulo
              ? accion.titulo
              : "flujoId" in accion
                ? accion.flujoId
                : "guia" in accion
                  ? accion.guia
                  : "nombre" in accion && accion.nombre
                    ? accion.nombre
                    : "productoId" in accion
                      ? accion.productoId
                      : "paso" in accion
                        ? accion.paso
                        : "etapa" in accion
                          ? accion.etapa
                          : "motivo" in accion
                            ? accion.motivo
                            : "",
        ),
      ),
      porque: decision.porque,
      // Sin IA no se pueden evaluar las reglas por intención: se avisa en vez de fingir que sí.
      necesitaIa: input.libro.reglas.some((regla) => regla.activa && regla.cuando.tipo === "intencion"),
    });

    estado = siguienteEstado(estado, [...decision.saludo, ...decision.acciones]);
  }

  return { turnos };
}

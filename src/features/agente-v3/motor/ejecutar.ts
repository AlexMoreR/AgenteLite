import { getFlowReply } from "@/lib/agent-product-flow";
import type { FlowStep } from "@/lib/agent-product-flow";

import { leerLibro } from "../servicios/almacen";
import { clasificarIntenciones } from "./clasificar";
import { decidir, siguienteEstado } from "./decidir";
import { guardarEstado, leerEstado } from "./estado";
import type { Accion } from "../domain/reglas";

/**
 * EL EJECUTOR: convierte la decisión del motor en cosas que pasan.
 *
 * El motor decide y esto ejecuta; están separados a propósito. El motor es una función pura que se
 * puede probar mil veces sin enviar nada, y todo lo que toca el mundo real —mandar un WhatsApp,
 * avisar a una asesora, mover una etapa— pasa por acá, en un solo lugar donde se puede mirar.
 *
 * Quien lo llama le pasa CÓMO hacer cada cosa (enviarPaso, avisarAsesor, cambiarEtapa...). Así
 * este archivo no sabe nada de WhatsApp ni de Prisma, y el día que haya otro canal —Instagram, la
 * API oficial— se reusa entero.
 */

export type Herramientas = {
  enviarPaso: (paso: FlowStep) => Promise<boolean>;
  avisarAsesor: (motivo: string) => Promise<void>;
  cambiarEtapa: (etapa: string) => Promise<void>;
  pausarIa: () => Promise<void>;
  /** Cuando la regla dice "que conteste la IA": recibe la guía escrita en el libro. */
  responderConIa: (guia: string) => Promise<void>;
};

export type ResultadoV3 = {
  /** Si el V3 se hizo cargo de este mensaje. false = que siga el camino de siempre. */
  atendido: boolean;
  regla: string | null;
  porque: string;
  acciones: number;
};

export async function atenderConAgenteV3(input: {
  workspaceId: string;
  conversationId: string;
  /** Lo que acaba de escribir el cliente. */
  mensaje: string;
  /** Últimos mensajes para que la IA entienda un "si" suelto. */
  historial?: Array<{ de: "cliente" | "negocio"; texto: string }>;
  /** A qué mensaje nuestro le respondió, si usó "responder" de WhatsApp. */
  citado?: string;
  incluirApiOficial?: boolean;
  herramientas: Herramientas;
}): Promise<ResultadoV3> {
  const libro = await leerLibro(input.workspaceId);
  if (libro.reglas.length === 0) {
    return { atendido: false, regla: null, porque: "El libro de reglas está vacío.", acciones: 0 };
  }

  const estado = await leerEstado(input.conversationId);

  /*
    La IA solo se llama si hay reglas de intención que puedan aplicar AHORA.

    Filtrar antes por las condiciones (producto activo, paso) evita pagar una llamada para preguntar
    por intenciones que el estado ya descartó. En una charla dentro del embudo suelen quedar una o
    dos candidatas, no las veinte del libro.
  */
  const intencionesReconocidas = await clasificarIntenciones({
    mensaje: input.mensaje,
    reglas: libro.reglas,
    historial: input.historial,
    citado: input.citado,
  });

  const decision = decidir({ libro, mensaje: input.mensaje, estado, intencionesReconocidas });
  const acciones = [...decision.saludo, ...decision.acciones];

  if (acciones.length === 0) {
    // Nada que hacer no es un error: el cliente dijo algo que no le toca a ninguna regla.
    await guardarEstado(input.conversationId, siguienteEstado(estado, []));
    return { atendido: false, regla: null, porque: decision.porque, acciones: 0 };
  }

  for (const accion of acciones) {
    await ejecutarUna(accion, input);
  }

  await guardarEstado(input.conversationId, siguienteEstado(estado, acciones));

  return {
    atendido: true,
    regla: decision.regla?.nombre ?? "Saludo",
    porque: decision.porque,
    acciones: acciones.length,
  };
}

async function ejecutarUna(
  accion: Accion,
  input: {
    workspaceId: string;
    incluirApiOficial?: boolean;
    herramientas: Herramientas;
  },
): Promise<void> {
  const { herramientas } = input;

  switch (accion.tipo) {
    case "mensaje":
      await herramientas.enviarPaso({ kind: "text", content: accion.texto });
      return;

    case "flujo": {
      /*
        Un flujo se manda con SUS pasos, igual que en el V2.

        Se reusa `getFlowReply` a propósito: es el mismo camino por el que hoy salen los catálogos,
        con sus fotos, PDFs y textos en orden. Escribir un envío aparte era garantizar que con el
        tiempo el V3 mandara las cosas distinto que el V2 y nadie supiera cuál era la buena.
      */
      const flujo = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: accion.flujoId,
        includeOfficialApi: input.incluirApiOficial !== false,
      }).catch(() => null);
      for (const paso of flujo?.steps ?? []) {
        await herramientas.enviarPaso(paso);
      }
      return;
    }

    case "responder_con_ia":
      await herramientas.responderConIa(accion.guia);
      return;

    case "avisar_asesor":
      await herramientas.avisarAsesor(accion.motivo);
      return;

    case "cambiar_etapa_crm":
      await herramientas.cambiarEtapa(accion.etapa);
      return;

    case "pausar_ia":
      await herramientas.pausarIa();
      return;

    // activar_producto e ir_al_paso no mandan nada: solo mueven el estado, y eso lo hace
    // `siguienteEstado` con la lista completa de acciones.
    default:
      return;
  }
}

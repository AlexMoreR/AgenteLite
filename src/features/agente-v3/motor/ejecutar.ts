import { getFlowReply } from "@/lib/agent-product-flow";
import type { FlowStep } from "@/lib/agent-product-flow";

import { leerLibro } from "../servicios/almacen";
import { anotarDecision } from "../servicios/decisiones";
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
  /**
   * ¿Este mismo texto ya salió en esta conversación hace poco?
   *
   * Vive acá y no dentro del motor porque es una pregunta a la base, y el motor es una función
   * pura. Quien no la implemente puede devolver false: se comporta como antes.
   */
  yaLoDijimos: (texto: string) => Promise<boolean>;
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
  /*
    La hora se toma ANTES de evaluar, no despues.

    Si un mensaje entra mientras el motor esta pensando, esa vuelta no lo vio. Marcando el inicio,
    ese mensaje sigue contando como "sin decidir" y el rescate lo puede levantar; marcando el
    final, quedaria tapado por una decision que nunca lo miro.
  */
  const inicio = new Date();
  const resultado = await evaluar(input);

  /*
    Queda huella de TODA vuelta, haya respondido o no.

    Va en el envoltorio y no adentro a proposito: el motor tiene varias salidas -libro vacio,
    ninguna regla, se callo para no repetirse- y si la marca viviera en cada una, la proxima
    salida que alguien agregue se olvidaria de dejarla. Y una vuelta sin huella es, para el
    rescate, un mensaje que nadie miro.
  */
  await anotarDecision(input.conversationId, {
    cuando: inicio.toISOString(),
    atendido: resultado.atendido,
    regla: resultado.regla,
  });

  return resultado;
}

async function evaluar(input: {
  workspaceId: string;
  conversationId: string;
  mensaje: string;
  historial?: Array<{ de: "cliente" | "negocio"; texto: string }>;
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

  /*
    NO REPETIR: un texto que ya salió no vuelve a salir.

    Una clienta escribió dos mensajes seguidos —"No me gusta esa varilla" y "Otro modelo por fa"—
    y ninguno encajaba con una regla, así que la red del paso contestó las dos veces con el MISMO
    texto palabra por palabra, uno detrás del otro (Alex, 28-09-2026). Las reglas red son
    justamente las que más se repiten: contestan cuando no se entendió, y cuando no se entiende
    una vez se suele no entender la siguiente.

    La regla de Alex no se negocia: el agente nunca repite un mensaje ya enviado, y si no tiene
    nada nuevo que decir no se traba ni insiste — avisa a un asesor y se calla. Es la misma idea
    que ya estaba escrita para el V2; al V3 le faltaba.
  */
  const filtradas: Accion[] = [];
  let seCallo = false;
  for (const accion of acciones) {
    if (accion.tipo === "mensaje" && (await input.herramientas.yaLoDijimos(accion.texto))) {
      seCallo = true;
      continue;
    }
    filtradas.push(accion);
  }

  const leDiceAlgo = filtradas.some(
    (accion) => accion.tipo === "mensaje" || accion.tipo === "flujo" || accion.tipo === "responder_con_ia",
  );

  /*
    Lo que NO es un mensaje se hace igual: mover la etapa, pausar la IA, avisar.

    Se ejecuta antes de decidir si hay que escalar, y no con un retorno temprano, porque si no una
    regla del tipo [mensaje + cambiar_etapa] perdería la etapa solo porque el texto se repetía.
  */
  for (const accion of filtradas) {
    await ejecutarUna(accion, input);
  }

  /*
    Se calló y no le queda nada que decirle: que siga una persona.

    Callarse a secas dejaría al cliente esperando, y repetir es lo que estamos evitando. No se
    avisa dos veces si la regla ya pedía un asesor por su cuenta, y el aviso tiene además su propia
    antirrepetición, así que esto no le llena el teléfono a nadie.
  */
  const laReglaYaPidioAsesor = filtradas.some((accion) => accion.tipo === "avisar_asesor");
  if (seCallo && !leDiceAlgo && !laReglaYaPidioAsesor) {
    await input.herramientas.avisarAsesor(
      "El agente iba a repetir un mensaje que ya envió y no tiene nada nuevo que decir",
    );
  }

  await guardarEstado(input.conversationId, siguienteEstado(estado, acciones));

  const porque = !seCallo
    ? decision.porque
    : leDiceAlgo
      ? `${decision.porque} (No se repitió un texto que ya había salido.)`
      : `${decision.porque} Pero ese mensaje ya se había enviado en esta conversación, así que se avisó a un asesor en vez de repetirlo.`;

  return {
    atendido: true,
    regla: decision.regla?.nombre ?? "Saludo",
    porque,
    acciones: filtradas.length,
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

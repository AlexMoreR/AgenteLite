import { getFlowReply } from "@/lib/agent-product-flow";

import type { LibroDeReglas } from "../domain/reglas";
import type { EstadoDeLaCharla } from "./decidir";
import type { Herramientas } from "./ejecutar";

/**
 * EL RESPALDO: lo que se le manda a la clienta cuando la IA no logró redactar nada.
 *
 * Hoy, si el redactor falla (se pasa del tiempo, devuelve vacío...), la clienta se queda sin
 * respuesta y solo se avisa a una asesora. El aviso y la pausa los sigue haciendo el redactor; esto
 * solo le manda algo corto a ella. Nunca repite un mensaje y nunca rompe el turno: si la ficha falla,
 * sale el texto.
 */

export const TEXTO_DE_RESPALDO =
  "Te leo 🙌 ¿Qué te gustaría saber del combo: *precio*, *materiales*, *garantía* o *envío*?";

/** Título exacto del flujo de la ficha de camillas. */
export const TITULO_FICHA_CAMILLA = "Ficha Camilla Divan";

export type TipoDeRespaldo = "ficha" | "texto" | "nada";

export type ResultadoDelRespaldo = {
  estado: EstadoDeLaCharla;
  tipo: TipoDeRespaldo;
  /** Pasos que de verdad salieron por enviarPaso. */
  enviados: number;
  /** Nota para el chat: qué se mandó de respaldo. */
  nota: string;
};

function sinTildes(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * ¿La charla es de camillas? Sí si todavía no hay producto elegido, o si el producto activo (su id,
 * o el nombre que el libro le puso al activarlo) dice "camilla".
 */
function esDeCamillas(estado: EstadoDeLaCharla, libro: LibroDeReglas): boolean {
  const id = estado.productoActivo;
  if (!id) return true;
  if (sinTildes(id).includes("camilla")) return true;
  for (const regla of libro.reglas) {
    for (const accion of regla.entonces) {
      if (accion.tipo === "activar_producto" && accion.productoId === id && accion.nombre) {
        if (sinTildes(accion.nombre).includes("camilla")) return true;
      }
    }
  }
  return false;
}

export async function mandarRespaldo(input: {
  workspaceId: string;
  estado: EstadoDeLaCharla;
  libro: LibroDeReglas;
  incluirApiOficial?: boolean;
  causa: string | null;
  herramientas: Pick<Herramientas, "enviarPaso" | "yaLoDijimos" | "buscarFlujo">;
}): Promise<ResultadoDelRespaldo> {
  const { estado, herramientas } = input;
  const registrar = (tipo: TipoDeRespaldo, enviados: number) =>
    console.log("[agente-v3] respaldo", {
      tipo,
      enviados,
      causa: input.causa,
      pasoActual: estado.pasoActual,
      producto: estado.productoActivo,
    });

  // 1) La ficha: solo en PRESENTACION y si es de camillas.
  if (estado.pasoActual === "PRESENTACION" && esDeCamillas(estado, input.libro) && herramientas.buscarFlujo) {
    try {
      const flowId = await herramientas.buscarFlujo(TITULO_FICHA_CAMILLA);
      if (flowId && !estado.flujosEnviados.includes(flowId)) {
        const flujo = await getFlowReply({
          workspaceId: input.workspaceId,
          flowId,
          includeOfficialApi: input.incluirApiOficial !== false,
        });
        let enviados = 0;
        for (const paso of flujo?.steps ?? []) {
          if ((await herramientas.enviarPaso(paso)) !== false) enviados += 1;
        }
        if (enviados > 0) {
          registrar("ficha", enviados);
          return {
            estado: { ...estado, flujosEnviados: [...estado.flujosEnviados, flowId], pasoActual: "PRODUCTO" },
            tipo: "ficha",
            enviados,
            nota: `Como la IA no pudo redactar, se le mandó la ${TITULO_FICHA_CAMILLA} de respaldo y la charla pasó a PRODUCTO.`,
          };
        }
      }
    } catch (error) {
      console.error("[agente-v3] respaldo: la ficha falló, va el texto", error instanceof Error ? error.message : error);
    }
  }

  // 2) El texto fijo, si no salió ya.
  if (await herramientas.yaLoDijimos(TEXTO_DE_RESPALDO)) {
    registrar("nada", 0);
    return {
      estado,
      tipo: "nada",
      enviados: 0,
      nota: "El mensaje de respaldo ya se le había mandado: no se repitió.",
    };
  }
  const salio = (await herramientas.enviarPaso({ kind: "text", content: TEXTO_DE_RESPALDO })) !== false;
  registrar("texto", salio ? 1 : 0);
  return {
    estado,
    tipo: "texto",
    enviados: salio ? 1 : 0,
    nota: salio
      ? "Como la IA no pudo redactar, se le mandó un mensaje corto de respaldo."
      : "El mensaje de respaldo no salió.",
  };
}

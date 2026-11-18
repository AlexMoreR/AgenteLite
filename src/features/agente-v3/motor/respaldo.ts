import { getFlowReply } from "@/lib/agent-product-flow";
import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";

import { catalogoActivo } from "../servicios/catalogo";
import type { EstadoDeLaCharla } from "./decidir";
import type { Herramientas } from "./ejecutar";

/**
 * EL MENSAJE DE RESPALDO: lo que recibe la clienta cuando la IA no logra redactar.
 *
 * Pedido de Alex (12-11-2026): cuando ninguna regla encaja (o la red del paso usa "responder con
 * IA") y la IA falla, el agente dejaba la nota "no pudo redactar" y la clienta se quedaba sin
 * respuesta. Pasó con "Soy lashita camilla etc" y con "Las 3". Ahora:
 *  - En PRESENTACION (o sin paso todavía), si la charla es de camillas o aún no tiene producto, va el
 *    flujo "Ficha Camilla Divan" y la charla pasa a PRODUCTO. A quien viene por sillas o lavacabezas
 *    no se le manda la ficha de una camilla.
 *  - En los demás pasos, o si la ficha ya salió, va TEXTO_DE_RESPALDO.
 *  - Nunca repite: si la ficha ya salió y el texto también (últimas 24 h), no manda nada.
 * La asesora se avisa igual que siempre: eso lo hace quien llama, después de esto.
 */

export const TEXTO_DE_RESPALDO = "Te leo 🙌 ¿Qué te gustaría saber del combo: *precio*, *materiales*, *garantía* o *envío*?";
export const FLUJO_DE_RESPALDO = "Ficha Camilla Divan";

export type RespaldoEnviado = {
  /** Qué salió: la ficha, el texto, o nada (todo se había mandado ya, o falló el envío). */
  envio: "ficha" | "texto" | null;
  /** El estado de la charla después del respaldo (con la ficha: paso PRODUCTO y el flujo anotado). */
  estado: EstadoDeLaCharla;
};

/** ¿El producto de la charla es una camilla (o un combo de camillas)? */
async function esDeCamillas(workspaceId: string, productoId: string): Promise<boolean> {
  if (/camill/i.test(productoId)) return true;
  const catalogo = await catalogoActivo(workspaceId).catch(() => []);
  const producto = catalogo.find((item) => item.id === productoId);
  if (!producto) return false;
  return /camill/i.test([producto.nombre, producto.categoria ?? "", producto.codigo ?? ""].join(" "));
}

export async function mandarRespaldo(input: {
  workspaceId: string;
  incluirApiOficial?: boolean;
  estado: EstadoDeLaCharla;
  herramientas: Herramientas;
}): Promise<RespaldoEnviado> {
  const { estado, herramientas } = input;

  const enPresentacion = estado.pasoActual === null || estado.pasoActual === "PRESENTACION";
  const productoQueSirve = !estado.productoActivo || (await esDeCamillas(input.workspaceId, estado.productoActivo));
  if (enPresentacion && productoQueSirve && herramientas.buscarFlujo) {
    const flujoId = await herramientas.buscarFlujo(FLUJO_DE_RESPALDO).catch(() => null);
    if (flujoId && !estado.flujosEnviados.includes(flujoId)) {
      const flujo = await getFlowReply({
        workspaceId: input.workspaceId,
        flowId: flujoId,
        includeOfficialApi: input.incluirApiOficial !== false,
      }).catch(() => null);
      let salieron = 0;
      for (const paso of flujo?.steps ?? []) {
        if ((await herramientas.enviarPaso(paso)) !== false) salieron += 1;
      }
      if (salieron > 0) {
        return {
          envio: "ficha",
          estado: { ...estado, pasoActual: "PRODUCTO", flujosEnviados: [...estado.flujosEnviados, flujoId] },
        };
      }
    }
  }

  // La regla de siempre: un texto que ya salió no vuelve a salir.
  if (await herramientas.yaLoDijimos(TEXTO_DE_RESPALDO)) {
    return { envio: null, estado };
  }
  const salio = await herramientas.enviarPaso({ kind: "text", content: TEXTO_DE_RESPALDO });
  return { envio: salio !== false ? "texto" : null, estado };
}

/**
 * Lo que le pasa a la asesora después del respaldo: el mismo aviso de siempre, con la causa y
 * diciendo si la clienta ya recibió algo.
 */
export function motivoDelAviso(motivoBase: string, envio: RespaldoEnviado["envio"]): string {
  return envio
    ? `${motivoBase}; se le mandó un mensaje de respaldo: que conteste una persona`
    : `${motivoBase}: que conteste una persona`;
}

/**
 * Busca un flujo por su nombre dentro de UNA línea de WhatsApp: cada línea tiene sus propios
 * flujos, y uno de otra línea no se puede mandar desde este chat. Devuelve su id o null.
 */
export async function buscarFlujoDeLaLinea(input: {
  workspaceId: string;
  channelId: string;
  titulo: string;
}): Promise<string | null> {
  const normalizar = (texto: string) =>
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const buscado = normalizar(input.titulo);
  const items = await getCreatedFlowItems({ workspaceId: input.workspaceId, includeOfficialApi: false });
  const flujo = items.find(
    (item) =>
      item.sourceType === "evolution" &&
      item.sourceId === input.channelId &&
      !item.isChildFlow &&
      normalizar(item.title) === buscado,
  );
  return flujo?.id ?? null;
}

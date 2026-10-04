import { getCreatedFlowItems } from "@/features/flows/services/getCreatedFlowItems";
import { getFlowReply } from "@/lib/agent-product-flow";

/**
 * Los flujos que la estrella puede sugerir, con los archivos que lleva cada uno.
 *
 * Los mensajes no guardan de que flujo salieron, asi que "ya se envio" se sabe por los ARCHIVOS:
 * si en el chat hay una foto, un video o un PDF con la misma direccion que un paso del flujo, ese
 * flujo ya le llego (lo haya mandado el agente o una asesora a mano).
 *
 * Se guarda 5 minutos por negocio: los flujos casi no cambian y armarlos lee el constructor de
 * cada canal.
 */

export type FlujoParaSugerir = {
  id: string;
  titulo: string;
  /** Para que sirve, en una linea (descripcion o intencion del flujo). */
  paraQue: string;
  /** "evolution:<canal>" u "official-api:<config>": de donde es el flujo. */
  origen: string;
  archivos: string[];
  tipos: string[];
};

const VIDA_MS = 5 * 60_000;
const TOPE_DE_FLUJOS = 60;
const enCache = new Map<string, { en: number; flujos: Promise<FlujoParaSugerir[]> }>();

export function flujosParaSugerir(workspaceId: string): Promise<FlujoParaSugerir[]> {
  const guardado = enCache.get(workspaceId);
  if (guardado && Date.now() - guardado.en < VIDA_MS) {
    return guardado.flujos;
  }
  const flujos = cargar(workspaceId).catch((error) => {
    console.warn("[flujos-para-sugerir] no se pudieron leer", error instanceof Error ? error.message : String(error));
    enCache.delete(workspaceId);
    return [];
  });
  enCache.set(workspaceId, { en: Date.now(), flujos });
  return flujos;
}

async function cargar(workspaceId: string): Promise<FlujoParaSugerir[]> {
  const items = (await getCreatedFlowItems({ workspaceId, includeOfficialApi: true }))
    .filter((item) => !item.isChildFlow)
    .slice(0, TOPE_DE_FLUJOS);

  const flujos = await Promise.all(
    items.map(async (item) => {
      const respuesta = await getFlowReply({ workspaceId, flowId: item.id, includeOfficialApi: true }).catch(() => null);
      const pasos = respuesta?.steps ?? [];
      if (pasos.length === 0) return null;
      const paraQue = [item.description, item.intent, item.keywords.slice(0, 6).join(", ")]
        .map((parte) => parte?.trim())
        .find(Boolean);
      return {
        id: item.id,
        titulo: item.title,
        paraQue: (paraQue ?? "").replace(/\s+/g, " ").slice(0, 140),
        origen: `${item.sourceType}:${item.sourceId}`,
        archivos: pasos.flatMap((paso) => (paso.kind === "text" ? [] : [paso.url])).filter(Boolean),
        tipos: [...new Set(pasos.map((paso) => paso.kind as string))],
      } satisfies FlujoParaSugerir;
    }),
  );

  return flujos.filter((flujo) => flujo !== null) as FlujoParaSugerir[];
}

/** Compara direcciones sin el dominio ni la consulta: el mismo archivo puede guardarse con o sin dominio. */
export function mismaDireccion(a: string, b: string) {
  const limpiar = (url: string) => {
    const sinConsulta = url.split("?")[0];
    let decodificada = sinConsulta;
    try {
      decodificada = decodeURIComponent(sinConsulta);
    } catch {
      // Una direccion mal codificada se compara tal cual.
    }
    return decodificada.replace(/^https?:\/\/[^/]+/, "");
  };
  return limpiar(a) === limpiar(b);
}

import { createHash } from "node:crypto";

import { PRODUCT_FUNNEL_STAGES } from "@/lib/product-funnel-stages";

import { CLAVE_COMBO, esProductoDelCombo, type ConfigEmbudo } from "./combo";

/**
 * VERSIONES DEL EMBUDO (Embudo 3). Lógica pura: sin base ni red, se prueba con
 * `npm run test:embudo-versiones`.
 *
 * Una versión es la FOTO COMPLETA del embudo de un producto: la bienvenida (el paso PRESENTACION),
 * el objetivo y el guion de cada paso, los seguimientos de cada paso y los pasos quitados. La foto
 * se arma siempre igual (mismo orden, mismos campos) para que su huella sirva de comparación: el
 * mismo contenido da la misma huella y no crea otra versión.
 */

export type SeguimientoFoto = {
  timeType: string;
  timeValue: number;
  content: string | null;
  flowId: string | null;
  cancelOnActivity: boolean;
  isActive: boolean;
};

export type PasoFoto = {
  stage: string;
  goal: string | null;
  script: string | null;
  stuckAfterMessages: number | null;
  seguimientos: SeguimientoFoto[];
};

export type FotoEmbudo = {
  pasos: PasoFoto[];
  /** Los pasos que este producto no usa, en el orden del embudo. */
  quitadas: string[];
};

export const NOTA_VERSION_INICIAL = "V1 - embudo inicial";

const ORDEN = new Map<string, number>(PRODUCT_FUNNEL_STAGES.map((etapa, indice) => [etapa.stage as string, indice]));
const ordenDe = (stage: string) => ORDEN.get(stage) ?? ORDEN.size;

const limpio = (valor: string | null | undefined) => (valor?.trim() ? valor.trim() : null);

/** Arma la foto con los datos tal como salen de la base. Mismo contenido, misma foto. */
export function armarFoto(input: {
  pasos: Array<{
    stage: string;
    goal?: string | null;
    script?: string | null;
    stuckAfterMessages?: number | null;
    followUps?: Array<{
      sortOrder?: number | null;
      timeType: string;
      timeValue: number;
      content?: string | null;
      flowId?: string | null;
      cancelOnActivity?: boolean | null;
      isActive?: boolean | null;
    }>;
  }>;
  quitadas?: string[];
}): FotoEmbudo {
  const pasos = [...input.pasos]
    .sort((a, b) => ordenDe(a.stage) - ordenDe(b.stage))
    .map((paso) => ({
      stage: paso.stage,
      goal: limpio(paso.goal),
      script: limpio(paso.script),
      stuckAfterMessages: paso.stuckAfterMessages ?? null,
      // El orden de la lista es el orden en que salen los mensajes (sortOrder, y luego la espera).
      seguimientos: [...(paso.followUps ?? [])]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((seguimiento) => ({
          timeType: seguimiento.timeType,
          timeValue: seguimiento.timeValue,
          content: limpio(seguimiento.content),
          flowId: limpio(seguimiento.flowId),
          cancelOnActivity: seguimiento.cancelOnActivity !== false,
          isActive: seguimiento.isActive !== false,
        })),
    }));
  const quitadas = Array.from(new Set(input.quitadas ?? [])).sort((a, b) => ordenDe(a) - ordenDe(b));
  return { pasos, quitadas };
}

/** Texto estable de la foto: las llaves siempre en el mismo orden. */
export function textoDeFoto(foto: FotoEmbudo): string {
  return JSON.stringify({
    pasos: foto.pasos.map((paso) => ({
      stage: paso.stage,
      goal: paso.goal,
      script: paso.script,
      stuckAfterMessages: paso.stuckAfterMessages,
      seguimientos: paso.seguimientos.map((s) => ({
        timeType: s.timeType,
        timeValue: s.timeValue,
        content: s.content,
        flowId: s.flowId,
        cancelOnActivity: s.cancelOnActivity,
        isActive: s.isActive,
      })),
    })),
    quitadas: foto.quitadas,
  });
}

export function huellaDeFoto(foto: FotoEmbudo): string {
  return createHash("sha256").update(textoDeFoto(foto)).digest("hex");
}

/** ¿Hace falta una versión nueva? Solo si el contenido cambió respecto de la última. */
export function hayVersionNueva(huellaUltima: string | null | undefined, huellaNueva: string): boolean {
  return !huellaUltima || huellaUltima !== huellaNueva;
}

/** Lee la foto guardada (JSON) con cuidado: lo que no tenga la forma esperada da null. */
export function leerFotoGuardada(valor: unknown): FotoEmbudo | null {
  if (!valor || typeof valor !== "object") return null;
  const guardada = valor as { pasos?: unknown; quitadas?: unknown };
  if (!Array.isArray(guardada.pasos)) return null;
  return {
    pasos: guardada.pasos as PasoFoto[],
    quitadas: Array.isArray(guardada.quitadas) ? (guardada.quitadas as string[]) : [],
  };
}

/** La nota que se guarda: recortada, y sin nada si viene vacía. */
export function limpiarNota(nota: unknown): string | null {
  if (typeof nota !== "string") return null;
  const recortada = nota.trim().slice(0, 300);
  return recortada || null;
}

/**
 * De la clave de producto del embudo al id del producto con embudo.
 *
 * Los chats guardan el producto como `combo-camilla` (el combo) o como el id. El combo se traduce
 * con la misma configuración del embudo que ya existe. Si hay más de un candidato y no se puede
 * decidir cuál es, devuelve null: un chat sin versión es mejor que uno con la versión equivocada.
 */
export function productoIdDeClave(
  clave: string | null | undefined,
  candidatos: Array<{ id: string; nombre?: string | null }>,
  config: ConfigEmbudo,
): string | null {
  if (!clave) return null;
  if (clave !== CLAVE_COMBO) {
    return candidatos.some((producto) => producto.id === clave) ? clave : null;
  }
  const delCombo = candidatos.filter((producto) => esProductoDelCombo({ id: producto.id, nombre: producto.nombre }, config));
  if (delCombo.length === 1) return delCombo[0].id;
  const configurados = delCombo.filter((producto) => config.comboProductoIds.includes(producto.id));
  return configurados.length === 1 ? configurados[0].id : null;
}

/** Qué producto del chat cuenta para la versión: el actual, y si no hay, el de entrada. */
export function claveDelChat(lead: { productoActual?: string | null; productoEntrada?: string | null } | null | undefined): string | null {
  return lead?.productoActual || lead?.productoEntrada || null;
}

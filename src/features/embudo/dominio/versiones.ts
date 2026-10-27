import { createHash } from "node:crypto";

import { CLAVE_COMBO, esProductoDelCombo, type ConfigEmbudo } from "./combo";

/**
 * VERSIONES DEL EMBUDO (Embudo 3). Código puro: se prueba con `npm run test:embudo-versiones`.
 *
 * Una versión es una FOTO completa del embudo de un producto: la bienvenida (el paso PRESENTACION),
 * el objetivo y el guion de cada paso, los pasos quitados y todos los seguimientos. Solo se
 * registra; nada de esto cambia lo que el bot responde.
 */

export type SeguimientoDeLaFoto = {
  orden: number;
  esperar: number;
  unidad: string;
  texto: string | null;
  flujoId: string | null;
  activo: boolean;
  cancelarSiEscribe: boolean;
};

export type PasoDeLaFoto = {
  paso: string;
  objetivo: string | null;
  guion: string | null;
  avisarTrasMensajes: number | null;
  seguimientos: SeguimientoDeLaFoto[];
};

export type FotoDelEmbudo = {
  /** El guion del paso PRESENTACION (lo primero que ve el cliente); null si el paso no existe. */
  bienvenida: string | null;
  pasos: PasoDeLaFoto[];
  quitadas: string[];
};

/** Las filas tal como salen de la base (etapas con sus seguimientos). */
export type EtapaDeLaBase = {
  stage: string;
  goal: string | null;
  script: string | null;
  stuckAfterMessages: number | null;
  sortOrder: number;
  followUps: Array<{
    sortOrder: number;
    timeType: string;
    timeValue: number;
    content: string | null;
    flowId: string | null;
    isActive: boolean;
    cancelOnActivity: boolean;
  }>;
};

const vacioANull = (valor: string | null | undefined) => (valor && valor.trim() ? valor : null);

/** Arma la foto con un orden estable: dos lecturas del mismo embudo dan exactamente la misma foto. */
export function armarFoto(etapas: EtapaDeLaBase[], quitadas: string[]): FotoDelEmbudo {
  const pasos = [...etapas]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.stage.localeCompare(b.stage))
    .map((etapa) => ({
      paso: etapa.stage,
      objetivo: vacioANull(etapa.goal),
      guion: vacioANull(etapa.script),
      avisarTrasMensajes: etapa.stuckAfterMessages ?? null,
      seguimientos: [...etapa.followUps]
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((seguimiento, indice) => ({
          orden: indice,
          esperar: seguimiento.timeValue,
          unidad: seguimiento.timeType,
          texto: seguimiento.flowId ? null : vacioANull(seguimiento.content),
          flujoId: seguimiento.flowId ?? null,
          activo: seguimiento.isActive,
          cancelarSiEscribe: seguimiento.cancelOnActivity,
        })),
    }));
  return {
    bienvenida: pasos.find((paso) => paso.paso === "PRESENTACION")?.guion ?? null,
    pasos,
    quitadas: [...new Set(quitadas)].sort(),
  };
}

/** Huella del contenido: igual contenido, igual huella. */
export function huellaDeFoto(foto: FotoDelEmbudo): string {
  return createHash("sha256").update(JSON.stringify(foto)).digest("hex");
}

/** ¿Hace falta una versión nueva? Solo si el contenido cambió respecto de la última. */
export function haceFaltaVersionNueva(huellaUltima: string | null | undefined, huellaNueva: string): boolean {
  return !huellaUltima || huellaUltima !== huellaNueva;
}

/**
 * Traduce la clave de producto del embudo (EmbudoLead.productoActual) al id real del producto.
 * El combo se guarda con la clave "combo-camilla"; el resto, con el id. Si no se puede traducir
 * con seguridad devuelve null: el chat queda "sin versión", nunca con una equivocada.
 * `productos` son los productos del negocio que tienen embudo armado.
 */
export function productoIdDeClave(
  clave: string | null | undefined,
  config: ConfigEmbudo,
  productos: Array<{ id: string; nombre: string | null }>,
): string | null {
  const limpia = (clave ?? "").trim();
  if (!limpia) return null;
  if (limpia !== CLAVE_COMBO) {
    return productos.some((producto) => producto.id === limpia) ? limpia : null;
  }
  // Los ids que el dueño marcó en la configuración mandan sobre el parecido por nombre.
  const marcados = productos.filter((producto) => config.comboProductoIds.includes(producto.id));
  if (marcados.length === 1) return marcados[0].id;
  const combos = productos.filter((producto) => esProductoDelCombo({ id: producto.id, nombre: producto.nombre }, config));
  // Dos candidatos = no se sabe cuál: sin versión antes que una equivocada.
  return combos.length === 1 ? combos[0].id : null;
}

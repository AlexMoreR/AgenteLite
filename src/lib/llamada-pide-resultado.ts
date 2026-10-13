/**
 * ¿Hace falta que una asesora diga "cómo quedó" la llamada con este contacto?
 *
 * Pedido de Alex (13-oct-2026): a proveedores, gente del equipo y clientes que ya compraron se los
 * llama por otras razones (un pedido, una entrega, una duda del taller). Esas llamadas no mueven
 * ningún lead, así que el aviso "falta decir cómo quedó", el botón "¿Cómo quedó?" y la lista
 * "Sin registrar" de Mi Día no tienen que pedírselas a nadie.
 *
 * No piden resultado:
 *  - contactos con la etiqueta PROVEEDOR o EQUIPO (modelo Tag, vía ContactTag; se compara el nombre
 *    y el slug sin mayúsculas ni tildes, así "Proveedor", "proveedores" o "EQUIPO" cuentan igual),
 *  - contactos en etapa GANADO.
 *
 * Función pura, sin Prisma ni Next: la usan el aviso del chat (ultima-llamada.ts), el detalle de
 * la llamada, la lista de llamadas del equipo y Mi Día. La prueba es scripts/check-como-quedo.mjs.
 */

/** Nombres de etiqueta (ya normalizados) que sacan al contacto de "falta decir cómo quedó". */
export const ETIQUETAS_SIN_RESULTADO: readonly string[] = ["proveedor", "proveedores", "equipo"];

/** Etapas en las que una llamada ya no mueve el lead. */
export const ETAPAS_SIN_RESULTADO: readonly string[] = ["GANADO"];

export type EtiquetaDelContacto = string | { name?: string | null; slug?: string | null } | null | undefined;

export type ContactoDeLaLlamada = {
  crmStage?: string | null;
  etiquetas?: ReadonlyArray<EtiquetaDelContacto> | null;
};

/** "Proveedór " → "proveedor". Sin tildes, sin mayúsculas, sin espacios ni guiones de sobra. */
export function normalizarEtiqueta(texto: string | null | undefined): string {
  return (texto ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[\s_-]+/g, " ")
    .trim();
}

function esEtiquetaSinResultado(etiqueta: EtiquetaDelContacto): boolean {
  if (!etiqueta) {
    return false;
  }
  const textos = typeof etiqueta === "string" ? [etiqueta] : [etiqueta.name, etiqueta.slug];
  return textos.some((texto) => ETIQUETAS_SIN_RESULTADO.includes(normalizarEtiqueta(texto)));
}

/** true = la llamada sin clasificar se le pide a la asesora ("¿Cómo quedó?"). */
export function llamadaPideResultado(contacto: ContactoDeLaLlamada | null | undefined): boolean {
  if (!contacto) {
    return true;
  }
  if (contacto.crmStage && ETAPAS_SIN_RESULTADO.includes(contacto.crmStage.trim().toUpperCase())) {
    return false;
  }
  return !(contacto.etiquetas ?? []).some(esEtiquetaSinResultado);
}

/**
 * Lo que hay que pedirle a Prisma del contacto para decidir. Se usa como `select` del contacto:
 * `contact: { select: { ...SELECCION_PIDE_RESULTADO, name: true } }`.
 */
export const SELECCION_PIDE_RESULTADO = {
  crmStage: true,
  ContactTag: { select: { Tag: { select: { name: true, slug: true } } } },
} as const;

/** Pasa el contacto tal como lo devuelve Prisma (con SELECCION_PIDE_RESULTADO) a la forma de la función. */
export function contactoDesdePrisma(contacto: {
  crmStage?: string | null;
  ContactTag?: ReadonlyArray<{ Tag: { name: string | null; slug: string | null } | null }> | null;
} | null | undefined): ContactoDeLaLlamada | null {
  if (!contacto) {
    return null;
  }
  return {
    crmStage: contacto.crmStage ?? null,
    etiquetas: (contacto.ContactTag ?? []).map((fila) => fila.Tag),
  };
}

import { CLAVE_COMBO, esProductoDelCombo, type ConfigEmbudo } from "./combo";

/**
 * VERSIONES DEL EMBUDO (Embudo 3): lógica pura, sin base.
 *
 * Una versión es una FOTO completa del embudo de un producto en un momento: la bienvenida (el paso
 * PRESENTACION), el objetivo y el guion de cada paso, los pasos que el producto no usa y todos los
 * seguimientos. Cada cambio guardado crea una versión nueva, salvo que el contenido haya quedado
 * idéntico al de la anterior. Se prueba con `npm run test:embudo-versiones`.
 */

/** El orden en que se dibujan los pasos del embudo. */
export const ORDEN_DE_PASOS = ["PRESENTACION", "IDENTIFICACION", "PRODUCTO", "OBJECIONES", "CIERRE"] as const;

export type SeguimientoDeLaFoto = {
  espera: number;
  unidad: string;
  texto: string | null;
  flujoId: string | null;
  cancelaSiEscribe: boolean;
  activo: boolean;
};

export type PasoDeLaFoto = {
  paso: string;
  objetivo: string | null;
  guion: string | null;
  avisarTrasMensajes: number | null;
  seguimientos: SeguimientoDeLaFoto[];
};

export type FotoDelEmbudo = {
  /** El guion de la bienvenida (paso PRESENTACION), repetido aquí para leerlo de un vistazo. */
  bienvenida: string | null;
  pasos: PasoDeLaFoto[];
  pasosQuitados: string[];
};

export type EtapaGuardada = {
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
};

function limpio(valor: string | null | undefined): string | null {
  const texto = (valor ?? "").trim();
  return texto ? texto : null;
}

function posicion(paso: string): number {
  const indice = (ORDEN_DE_PASOS as readonly string[]).indexOf(paso);
  return indice === -1 ? ORDEN_DE_PASOS.length : indice;
}

/** Arma la foto con lo que hay guardado. El orden de los pasos y de los seguimientos es fijo. */
export function armarFoto(etapas: EtapaGuardada[], quitadas: string[] = []): FotoDelEmbudo {
  const pasos = [...etapas]
    .sort((a, b) => posicion(a.stage) - posicion(b.stage) || a.stage.localeCompare(b.stage))
    .map<PasoDeLaFoto>((etapa) => ({
      paso: etapa.stage,
      objetivo: limpio(etapa.goal),
      guion: limpio(etapa.script),
      avisarTrasMensajes: etapa.stuckAfterMessages ?? null,
      seguimientos: [...(etapa.followUps ?? [])]
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((seguimiento) => ({
          espera: seguimiento.timeValue,
          unidad: seguimiento.timeType,
          texto: seguimiento.flowId ? null : limpio(seguimiento.content),
          flujoId: seguimiento.flowId ?? null,
          cancelaSiEscribe: seguimiento.cancelOnActivity !== false,
          activo: seguimiento.isActive !== false,
        })),
    }));
  return {
    bienvenida: pasos.find((paso) => paso.paso === "PRESENTACION")?.guion ?? null,
    pasos,
    pasosQuitados: [...new Set(quitadas)].sort((a, b) => posicion(a) - posicion(b)),
  };
}

/** Un texto corto que cambia si cambia cualquier cosa de la foto (hash FNV-1a de 32 bits, dos pasadas). */
export function huellaDeFoto(foto: FotoDelEmbudo): string {
  const texto = JSON.stringify(foto);
  let a = 0x811c9dc5;
  let b = 0x01000193;
  for (let i = 0; i < texto.length; i += 1) {
    const codigo = texto.charCodeAt(i);
    a = Math.imul(a ^ codigo, 0x01000193) >>> 0;
    b = Math.imul(b + codigo, 0x85ebca6b) >>> 0;
  }
  return `${a.toString(16).padStart(8, "0")}${b.toString(16).padStart(8, "0")}${texto.length.toString(16)}`;
}

/** ¿Hace falta una versión nueva? Sí si es la primera o si el contenido cambió. */
export function haceFaltaVersionNueva(huellaNueva: string, huellaUltima: string | null | undefined): boolean {
  return !huellaUltima || huellaUltima !== huellaNueva;
}

/** "V1 - embudo inicial", "V2". */
export function nombreDeVersion(numero: number, origen?: string | null): string {
  return numero === 1 && origen === "inicial" ? "V1 - embudo inicial" : `V${numero}`;
}

/** Lee el contenido guardado en la base como foto (lo que no tenga forma queda vacío, sin lanzar). */
export function fotoDeContenido(contenido: unknown): FotoDelEmbudo {
  const base = contenido && typeof contenido === "object" && !Array.isArray(contenido) ? (contenido as Partial<FotoDelEmbudo>) : {};
  return {
    bienvenida: typeof base.bienvenida === "string" ? base.bienvenida : null,
    pasos: Array.isArray(base.pasos) ? base.pasos : [],
    pasosQuitados: Array.isArray(base.pasosQuitados) ? base.pasosQuitados : [],
  };
}

/**
 * Traduce la clave de producto del embudo al id del producto.
 *
 * El combo se guarda con la clave especial "combo-camilla" y no con un id. Se resuelve con la
 * configuración del embudo (ids del combo) o, si no, con el nombre. Si hay duda -ninguno o varios
 * productos posibles- devuelve null: un chat sin versión es mejor que uno con la versión de otro
 * producto.
 */
export function productoIdDeClave(
  clave: string | null | undefined,
  productos: Array<{ id: string; nombre?: string | null }>,
  config: ConfigEmbudo,
): string | null {
  if (!clave) return null;
  if (clave !== CLAVE_COMBO) {
    return productos.some((producto) => producto.id === clave) ? clave : null;
  }
  const delConfig = productos.filter((producto) => config.comboProductoIds.includes(producto.id));
  if (delConfig.length === 1) return delConfig[0].id;
  if (delConfig.length > 1) return null;
  const porNombre = productos.filter((producto) => esProductoDelCombo({ id: producto.id, nombre: producto.nombre }, { ...config, comboProductoIds: [] }));
  return porNombre.length === 1 ? porNombre[0].id : null;
}

export type ElegidaParaElChat = { versionId: string; numero: number; asignadaPor: "vigente" | "ab" };

/**
 * Qué versión le toca a un chat nuevo. Hoy: siempre la vigente (la última), marcada "vigente".
 * Embudo 5 (prueba A/B) solo cambia esta función para elegir al azar y marcar "ab".
 */
export function elegirVersion(versiones: Array<{ id: string; numero: number }>): ElegidaParaElChat | null {
  if (!versiones.length) return null;
  const vigente = versiones.reduce((a, b) => (b.numero > a.numero ? b : a));
  return { versionId: vigente.id, numero: vigente.numero, asignadaPor: "vigente" };
}

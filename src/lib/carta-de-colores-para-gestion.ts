import { coloresVisibles, type ColorParaCarta, type TipoMaterialDeColor } from "./carta-de-colores";
import { llaveDelHeader } from "./origen-de-venta";

/*
  CARTA DE COLORES → GESTIÓN (solo lectura). Decisión del dueño (4-nov-2026): hay una sola carta de colores,
  la del CRM. Gestión la lee por GET /api/gestion/carta-de-colores para cotizar y mandar a producir.

  Aquí van solo las reglas, sin Prisma ni Next (igual que responderConsultaDeOrigen), para poder probarlas
  sin base: revisar la llave, quitar los colores ocultos, ordenar y armar la dirección completa de cada foto.
  La lectura de la base va en la ruta y no crea ni cambia nada.
*/

/** Un material como sale de la base (lo que lee la ruta). */
export type MaterialLeido = {
  nombre: string;
  tipo: TipoMaterialDeColor;
  orden: number;
  colores: ColorParaCarta[];
};

/** Un color como lo recibe Gestión: sin `oculto` (los ocultos no salen). */
export type ColorParaGestion = {
  id: string;
  codigo: string;
  nombre: string;
  fotoUrl: string | null;
  orden: number;
};

export type MaterialParaGestion = {
  nombre: string;
  tipo: TipoMaterialDeColor;
  orden: number;
  colores: ColorParaGestion[];
};

export type RespuestaDeCartaParaGestion =
  | { status: 200; body: { materiales: MaterialParaGestion[] } }
  | { status: 401; body: { error: "no_autorizado" } };

/**
  Dirección completa de la foto: la dirección pública del CRM más la ruta guardada (`/uploads/...`).
  Si ya viene completa (http o https) se deja igual. Sin foto, `null`.
*/
export function fotoConDireccionCompleta(fotoUrl: string | null | undefined, base: string): string | null {
  const ruta = String(fotoUrl ?? "").trim();
  if (!ruta) return null;
  if (/^https?:\/\//i.test(ruta)) return ruta;
  const raiz = base.trim().replace(/\/+$/, "");
  return `${raiz}${ruta.startsWith("/") ? "" : "/"}${ruta}`;
}

/** Los materiales en el orden de la pantalla (orden y luego nombre) con sus colores visibles. */
export function armarCartaParaGestion(materiales: readonly MaterialLeido[], base: string): MaterialParaGestion[] {
  return [...materiales]
    .sort((a, b) => a.orden - b.orden || a.nombre.localeCompare(b.nombre, "es"))
    .map((material) => ({
      nombre: material.nombre,
      tipo: material.tipo,
      orden: material.orden,
      colores: coloresVisibles(material.colores).map((color) => ({
        id: color.id,
        codigo: color.codigo,
        nombre: color.nombre,
        fotoUrl: fotoConDireccionCompleta(color.fotoUrl, base),
        orden: color.orden,
      })),
    }));
}

/**
  Responde el pedido de Gestión. La llave va en `Authorization: Bearer <llave>` y es la de la conexión con
  Gestión: dice de qué negocio es la carta. Sin llave o con llave mala, 401 (y no se lee la carta).
*/
export async function responderCartaParaGestion(
  input: { autorizacion: string | null; base: string },
  deps: {
    workspacePorLlave: (llave: string) => Promise<string | null>;
    leerCarta: (workspaceId: string) => Promise<MaterialLeido[]>;
  },
): Promise<RespuestaDeCartaParaGestion> {
  const llave = llaveDelHeader(input.autorizacion);
  const workspaceId = llave ? await deps.workspacePorLlave(llave) : null;
  if (!workspaceId) {
    return { status: 401, body: { error: "no_autorizado" } };
  }
  const materiales = await deps.leerCarta(workspaceId);
  return { status: 200, body: { materiales: armarCartaParaGestion(materiales, input.base) } };
}

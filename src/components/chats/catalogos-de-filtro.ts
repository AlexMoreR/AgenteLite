"use client";

import * as React from "react";

import { getCanalesParaFiltroAction, type EtiquetaItem } from "@/app/actions/chats-actions";
import { pedirMiembros } from "@/components/chats/assign-chat-control";
import { pedirEtiquetas } from "@/components/chats/chat-tags-control";
import { CRM_STAGE_META } from "@/features/crm/domain/crm-config";
import type { NombresDeBandeja } from "@/features/chats/domain/filtros-de-bandeja";

/**
 * Lo que el filtro de la bandeja necesita para mostrar nombres: etiquetas, equipo y líneas.
 * Se piden una vez (un minuto en memoria, como las etiquetas y el equipo de los chats) y solo
 * cuando hacen falta.
 */

export type OpcionDeCatalogo = { id: string; nombre: string };
export type CatalogosDeFiltro = {
  etiquetas: EtiquetaItem[];
  miembros: OpcionDeCatalogo[];
  canales: OpcionDeCatalogo[];
};

type ResultadoCanales = Awaited<ReturnType<typeof getCanalesParaFiltroAction>>;
let canalesEnCache: { cuando: number; pedido: Promise<ResultadoCanales> } | null = null;

export function pedirCanalesDeFiltro() {
  if (!canalesEnCache || Date.now() - canalesEnCache.cuando > 60_000) {
    const pedido = getCanalesParaFiltroAction().catch(() => ({ error: "No se pudieron cargar las líneas" }) as ResultadoCanales);
    canalesEnCache = { cuando: Date.now(), pedido };
  }
  return canalesEnCache.pedido;
}

export const CATALOGOS_VACIOS: CatalogosDeFiltro = { etiquetas: [], miembros: [], canales: [] };

/** Los catálogos, pedidos al activarse (`activo`). `conEquipo`: solo quien ve al equipo pide la lista. */
export function useCatalogosDeFiltro(activo: boolean, conEquipo: boolean): CatalogosDeFiltro & { cargando: boolean } {
  const [catalogos, setCatalogos] = React.useState<CatalogosDeFiltro>(CATALOGOS_VACIOS);
  const [cargando, setCargando] = React.useState(false);

  React.useEffect(() => {
    if (!activo) return;
    let vigente = true;
    setCargando(true);
    void Promise.all([
      pedirEtiquetas().catch(() => ({ items: [] as EtiquetaItem[] })),
      conEquipo ? pedirMiembros() : Promise.resolve({ members: [] }),
      pedirCanalesDeFiltro(),
    ]).then(([etiquetas, miembros, canales]) => {
      if (!vigente) return;
      setCatalogos({
        etiquetas: etiquetas.items ?? [],
        miembros: (("members" in miembros ? miembros.members : null) ?? []).map((m) => ({ id: m.id, nombre: m.name?.trim() || m.email })),
        canales: canales.items ?? [],
      });
      setCargando(false);
    });
    return () => {
      vigente = false;
    };
  }, [activo, conEquipo]);

  return { ...catalogos, cargando };
}

/** Los nombres para el resumen y las chapitas (un id sin nombre todavía sale como "1 etiqueta"). */
export function nombresDeLosCatalogos(catalogos: CatalogosDeFiltro): NombresDeBandeja {
  return {
    etapa: (etapa) => CRM_STAGE_META[etapa]?.label ?? etapa,
    etiqueta: (id) => catalogos.etiquetas.find((e) => e.id === id)?.name ?? null,
    asesora: (id) => catalogos.miembros.find((m) => m.id === id)?.nombre ?? null,
    canal: (id) => catalogos.canales.find((c) => c.id === id)?.nombre ?? null,
  };
}

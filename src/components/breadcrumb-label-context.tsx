"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { createPortal } from "react-dom";

type BreadcrumbLabelContextValue = {
  label: string | null;
  setLabel: (label: string | null) => void;
  /** Donde va el titulo de la barra superior (lo registra el AppShell con <RanuraDelTitulo>). */
  slot: HTMLElement | null;
  setSlot: (slot: HTMLElement | null) => void;
  /** Cuantas paginas estan dibujando su propio titulo ahi (normalmente 0 o 1). */
  titulosPropios: number;
  setTitulosPropios: (cambio: (actual: number) => number) => void;
};

const BreadcrumbLabelContext = createContext<BreadcrumbLabelContextValue | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  const [titulosPropios, setTitulosPropios] = useState(0);

  return (
    <BreadcrumbLabelContext.Provider value={{ label, setLabel, slot, setSlot, titulosPropios, setTitulosPropios }}>
      {children}
    </BreadcrumbLabelContext.Provider>
  );
}

export function useBreadcrumbLabel() {
  return useContext(BreadcrumbLabelContext)?.label ?? null;
}

/**
 * Permite que una pagina de detalle sobreescriba la etiqueta del ultimo segmento
 * del breadcrumb (ej. mostrar el nombre del flujo en vez del id de la URL).
 * Pasa null/undefined para limpiar el override.
 */
export function useSetBreadcrumbLabel(label: string | null | undefined) {
  const context = useContext(BreadcrumbLabelContext);

  useEffect(() => {
    if (!context) {
      return;
    }

    context.setLabel(label && label.trim() ? label.trim() : null);

    return () => {
      context.setLabel(null);
    };
  }, [context, label]);
}

/**
 * El lugar del titulo en la barra superior. Muestra `fallback` (el breadcrumb de siempre) salvo
 * que la pagina abierta ponga el suyo con <TituloDeLaBarra>. Las demas paginas no cambian.
 */
export function RanuraDelTitulo({ fallback }: { fallback: React.ReactNode }) {
  const context = useContext(BreadcrumbLabelContext);
  const propio = (context?.titulosPropios ?? 0) > 0;
  return (
    <>
      <div ref={context?.setSlot} className={propio ? "flex min-w-0 items-center" : "hidden"} />
      {propio ? null : fallback}
    </>
  );
}

/**
 * Una pagina dibuja su propio titulo en la barra superior (por ejemplo el selector de tableros de
 * Tablero IA). Al salir de la pagina vuelve el breadcrumb.
 */
export function TituloDeLaBarra({ children }: { children: React.ReactNode }) {
  const context = useContext(BreadcrumbLabelContext);
  const setTitulosPropios = context?.setTitulosPropios;

  useEffect(() => {
    if (!setTitulosPropios) return;
    setTitulosPropios((actual) => actual + 1);
    return () => setTitulosPropios((actual) => actual - 1);
  }, [setTitulosPropios]);

  return context?.slot ? createPortal(children, context.slot) : null;
}

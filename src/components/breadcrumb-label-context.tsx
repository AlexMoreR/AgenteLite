"use client";

import { createContext, useContext, useEffect, useState } from "react";

type BreadcrumbLabelContextValue = {
  label: string | null;
  setLabel: (label: string | null) => void;
};

const BreadcrumbLabelContext = createContext<BreadcrumbLabelContextValue | null>(null);

export function BreadcrumbLabelProvider({ children }: { children: React.ReactNode }) {
  const [label, setLabel] = useState<string | null>(null);

  return (
    <BreadcrumbLabelContext.Provider value={{ label, setLabel }}>
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

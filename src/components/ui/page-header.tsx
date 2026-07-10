import type { ComponentType } from "react";

// Encabezado unificado de los módulos: ícono (cada módulo el suyo) + título a 20px,
// con color y tamaño consistentes en toda la app. Sin párrafo descriptivo.
export function PageHeader({
  icon: Icon,
  title,
  className = "",
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  className?: string;
}) {
  return (
    <div className={`inline-flex items-center gap-2 ${className}`}>
      <Icon className="h-5 w-5 shrink-0 text-foreground" />
      <h1 className="text-[20px] font-semibold leading-none tracking-[-0.03em] text-foreground">{title}</h1>
    </div>
  );
}

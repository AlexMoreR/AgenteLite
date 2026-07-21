import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveCrmView(value: string | string[] | undefined) {
  // Por defecto abre en "Mi día": es la vista que dispara la adopcion de la vendedora (a quien
  // contactar hoy). El dueno tiene "Informe" a un click para sus metricas.
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() || "mi-dia";
  return normalized === "kanban" || normalized === "informe" || normalized === "registro" ? normalized : "mi-dia";
}

export default async function ClienteCrmPage({ searchParams }: PageProps) {
  const params = await searchParams;
  redirect(`/cliente/crm/${resolveCrmView(params.view)}`);
}

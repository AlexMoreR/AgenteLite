import { redirect } from "next/navigation";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function resolveCrmView(value: string | string[] | undefined) {
  const normalized = (Array.isArray(value) ? value[0] : value)?.trim().toLowerCase() || "registro";
  return normalized === "kanban" || normalized === "informe" ? normalized : "registro";
}

export default async function ClienteCrmPage({ searchParams }: PageProps) {
  const params = await searchParams;
  redirect(`/cliente/crm/${resolveCrmView(params.view)}`);
}

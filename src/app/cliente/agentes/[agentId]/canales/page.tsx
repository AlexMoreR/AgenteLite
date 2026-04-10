import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ agentId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function ClienteAgenteCanalesPage({ params, searchParams }: PageProps) {
  const [{ agentId }, paramsData] = await Promise.all([params, searchParams]);
  const query = new URLSearchParams();

  if (typeof paramsData.ok === "string") {
    query.set("ok", paramsData.ok);
  }

  if (typeof paramsData.error === "string") {
    query.set("error", paramsData.error);
  }

  redirect(`/cliente/conexion/whatsapp-business/${agentId}${query.size ? `?${query.toString()}` : ""}`);
}

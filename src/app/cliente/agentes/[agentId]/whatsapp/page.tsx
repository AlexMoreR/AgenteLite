import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ agentId: string }>;
};

export default async function ClienteAgenteWhatsappPage({ params }: PageProps) {
  const { agentId } = await params;
  redirect(`/cliente/agentes/${agentId}/canales`);
}

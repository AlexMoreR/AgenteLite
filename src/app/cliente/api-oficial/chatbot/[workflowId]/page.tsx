import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ workflowId: string }>;
};

export default async function OfficialApiChatbotWorkflowPage({ params }: PageProps) {
  const { workflowId } = await params;
  redirect(`/cliente/flujos/${workflowId}?sourceType=official-api`);
}

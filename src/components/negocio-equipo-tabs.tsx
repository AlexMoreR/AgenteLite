import { auth } from "@/auth";
import { NegocioEquipoTabsLista } from "@/components/negocio-equipo-tabs-lista";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";

/*
  Pestañas Negocio | Equipo | Reporte | Claude. Claude solo aparece para el dueño o un
  administrador del negocio: la clave MCP ve todas las conversaciones.
*/
export async function NegocioEquipoTabs() {
  const session = await auth();
  const access = session?.user?.id ? await getClientWorkspaceAccessForUser(session.user.id) : null;
  const verClaude = Boolean(
    access && (access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN"),
  );

  return <NegocioEquipoTabsLista verClaude={verClaude} />;
}

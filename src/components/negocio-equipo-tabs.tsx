import { auth } from "@/auth";
import { NegocioEquipoTabsLista } from "@/components/negocio-equipo-tabs-lista";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { permisosDelCerebro } from "@/features/cerebro/services/permisos";

/*
  Pestañas Negocio | Equipo | Reporte | Claude | Cerebro. Cerebro: el dueño y quien él autorice. Claude solo aparece para el dueño o un
  administrador del negocio: la clave MCP ve todas las conversaciones.
*/
export async function NegocioEquipoTabs() {
  const session = await auth();
  const access = session?.user?.id ? await getClientWorkspaceAccessForUser(session.user.id) : null;
  const verClaude = Boolean(
    access && (access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN"),
  );

  // Si la lectura de los autorizados falla, la pestaña simplemente no se muestra (no se cae la pantalla).
  const verCerebro = access ? await permisosDelCerebro(access).then((permisos) => permisos.ver).catch(() => false) : false;

  return <NegocioEquipoTabsLista verClaude={verClaude} verCerebro={verCerebro} />;
}

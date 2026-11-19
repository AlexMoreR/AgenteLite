import { auth } from "@/auth";
import { NegocioEquipoTabsLista } from "@/components/negocio-equipo-tabs-lista";
import { getClientWorkspaceAccessForUser } from "@/lib/client-workspace-access";
import { permisosDelCerebro } from "@/features/cerebro/services/permisos";

/*
  Pestañas Negocio | Equipo | Asignación | Reporte | Claude | Cerebro. Cerebro: el dueño y quien él autorice. Claude solo aparece para el dueño o un
  administrador del negocio: la clave MCP ve todas las conversaciones. Asignación, el dueño o un ADMIN: el mismo
  candado (`ownerOnly`) que su página y que Reparto por anuncio.
*/
export async function NegocioEquipoTabs() {
  const session = await auth();
  const access = session?.user?.id ? await getClientWorkspaceAccessForUser(session.user.id) : null;
  const verClaude = Boolean(
    access && (access.isOwner || access.membershipRole === "OWNER" || access.membershipRole === "ADMIN"),
  );

  const verAsignacion = Boolean(access && (access.isOwner || access.role === "ADMIN"));

  // Si la lectura de los autorizados falla, la pestaña simplemente no se muestra (no se cae la pantalla).
  const verCerebro = access ? await permisosDelCerebro(access).then((permisos) => permisos.ver).catch(() => false) : false;

  return <NegocioEquipoTabsLista verClaude={verClaude} verCerebro={verCerebro} verAsignacion={verAsignacion} />;
}

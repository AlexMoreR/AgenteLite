import type { Metadata } from "next";

import { requireClientWorkspaceAccess } from "@/lib/client-workspace-access";
import { NotificacionesWorkspace } from "@/components/notificaciones/notificaciones-workspace";

export const metadata: Metadata = {
  title: "Notificaciones",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

/**
 * Notificaciones, en su propia pantalla.
 *
 * Antes esto era un menu colgado de la campanita: mostraba 8 y en el celular tapaba la lista y se
 * cerraba solo al desplazar. Alex lo pidio como pagina.
 *
 * La pantalla NO guarda nada nuevo: pregunta por los chats con mensajes sin leer, que es lo mismo
 * que hacia el menu. Un historial de verdad -llamadas, cambios de etapa, asignaciones- necesita
 * una tabla propia y escribir en cada evento; eso quedo para despues, a propósito.
 *
 * Va con el permiso de chats: son los chats de uno, mirados de otra forma.
 */
export default async function ClienteNotificacionesPage() {
  await requireClientWorkspaceAccess("chats");

  return <NotificacionesWorkspace />;
}

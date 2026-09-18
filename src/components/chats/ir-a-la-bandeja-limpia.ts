import type { useRouter } from "next/navigation";

/**
 * Despues de resolver, cerrar el chat y dejar la bandeja limpia (Alex, 18-sep-2026).
 *
 * Antes se refrescaba la pagina con el chat todavia abierto, y la pagina mete SIEMPRE el chat
 * abierto en la lista -para poder mostrarlo aunque no venga en la tanda-. Resultado: el chat
 * resuelto salia de la lista y volvia a entrar al segundo, y las asesoras creian que "Resolver" no
 * funcionaba.
 *
 * Solo se cierra si el chat resuelto es el que esta abierto y se esta mirando la bandeja de
 * abiertas (sin `status` en la direccion). En "Resueltas" o "Todas" el chat sigue correspondiendo y
 * se deja donde esta. Reabrir tampoco cierra nada.
 */
export function irALaBandejaLimpia(
  router: ReturnType<typeof useRouter>,
  resolvio: boolean,
  conversationId: string,
) {
  const params = new URLSearchParams(window.location.search);
  const chatAbierto = params.get("chatKey") ?? "";
  const esElAbierto = chatAbierto.endsWith(`:${conversationId}`);

  if (!resolvio || params.get("status") || !esElAbierto) {
    router.refresh();
    return;
  }

  params.delete("chatKey");
  params.delete("messagePage");
  const consulta = params.toString();
  router.replace(`${window.location.pathname}${consulta ? `?${consulta}` : ""}`, { scroll: false });
}

"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, UserCheck, UserPlus } from "lucide-react";
import {
  assignChatAction,
  getAssignableMembersAction,
  type AssignableMember,
} from "@/app/actions/chats-actions";
import {
  olvidarSiYaLlego,
  recordarAsignacion,
  useAsignadoMostrado,
} from "@/components/chats/asignacion-optimista";

type AssignChatControlProps = {
  conversationId: string;
  assignee: { id: string; name: string | null; email: string } | null;
  // De que canal es el chat: los de la API oficial se guardan en otra tabla.
  source?: "agent" | "official";
  /** Barra del celular: solo el icono (verde si tiene asesora); el nombre va en el title. */
  compacto?: boolean;
};

/*
  La lista del equipo, UNA vez para toda la pantalla (Alex, 16-sep-2026: "se demora en cargar a
  quien asignar").

  Se pedia al abrir el menu y en CADA chat: el control se vuelve a montar al cambiar de chat, asi que
  cada apertura era una consulta nueva, y ademas esperaba en fila detras de las que dispara el chat al
  abrirse. El equipo cambia muy poco: se guarda un minuto y se comparte entre chats.
*/
type ResultadoMiembros = Awaited<ReturnType<typeof getAssignableMembersAction>>;
let miembrosEnCache: { cuando: number; pedido: Promise<ResultadoMiembros> } | null = null;

export function pedirMiembros() {
  const ahora = Date.now();
  if (!miembrosEnCache || ahora - miembrosEnCache.cuando > 60_000) {
    const pedido = getAssignableMembersAction().catch(() => ({ error: "No se pudo cargar el equipo" }) as ResultadoMiembros);
    miembrosEnCache = { cuando: ahora, pedido };
    // Un error no se guarda: el proximo intento vuelve a preguntar.
    void pedido.then((resultado) => {
      if (resultado.error && miembrosEnCache?.pedido === pedido) {
        miembrosEnCache = null;
      }
    });
  }
  return miembrosEnCache.pedido;
}

function memberLabel(member: { name: string | null; email: string }) {
  return member.name?.trim() || member.email;
}

export function AssignChatControl({
  conversationId,
  assignee: asignadoDelServidor,
  source = "agent",
  compacto = false,
}: AssignChatControlProps) {
  /*
    Quien lo tiene AHORA, sin esperar al servidor.

    Antes el chip solo cambiaba cuando terminaba `router.refresh()`, que vuelve a renderizar la
    pantalla entera de chats -mil y pico conversaciones-. Asignar era instantaneo en la base y
    tardaba segundos en verse, asi que parecia que no habia pasado nada (Alex, 25-09-2026).

    `undefined` significa "todavia no toque nada, mostra lo que dice el servidor".
  */
  /*
    La marca vive FUERA del componente (ver asignacion-optimista).

    Estaba en `useState`, y el `router.refresh()` que sale justo despues de asignar puede
    desmontar este control: ahi la marca se perdia y la ficha volvia a mostrar lo viejo. La
    asesora ve que su toque "no hizo nada" y vuelve a tocar — el 29-09-2026 quedaron dos tomas del
    mismo chat con 12 segundos de diferencia, y con el menu abierto un segundo toque puede caer en
    otra opcion.
  */
  const assignee = useAsignadoMostrado(conversationId, asignadoDelServidor);

  // Cuando el servidor por fin dice lo mismo, se suelta la marca: si no, una asignacion hecha
  // desde otro lado -el menu de la lista, otra pestaña, un jefe- no se veria nunca aca.
  useEffect(() => {
    olvidarSiYaLlego(conversationId, asignadoDelServidor);
  }, [conversationId, asignadoDelServidor]);
  const router = useRouter();
  const containerRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [members, setMembers] = useState<AssignableMember[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [isManager, setIsManager] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  // Mientras no llego la lista, el menu muestra "Cargando…".
  const loading = !loaded && !error;

  // Se pide apenas se abre el chat, no al tocar el menu: cuando la asesora lo abre, ya esta.
  useEffect(() => {
    let vigente = true;
    void pedirMiembros().then((result) => {
      if (!vigente) return;
      if (result.error) {
        setError(result.error);
        return;
      }
      setMembers(result.members ?? []);
      setCurrentUserId(result.currentUserId ?? null);
      setIsManager(Boolean(result.isManager));
      setLoaded(true);
    });
    return () => {
      vigente = false;
    };
  }, []);

  const handleToggle = useCallback(() => {
    setOpen((value) => !value);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const handleAssign = useCallback(
    (targetUserId: string | null) => {
      /*
        Asignarle el chat a quien YA lo tiene no es una asignación: es un toque de más.

        En producción quedaron tres notas seguidas en el mismo chat, al mismo destino, en dos
        segundos (07:37:13, :14 y :15 del 28-09-2026), y varias parejas iguales con doce segundos
        de diferencia. Los botones ya se deshabilitan mientras la acción viaja, así que no son
        llamadas simultáneas: son toques repetidos porque en el celular no se ve que haya pasado
        algo. Cada uno dejaba su nota, y el historial del chat terminaba pareciendo que el sistema
        reasigna solo — que es justo lo que nos vino a preguntar Alex (28-09-2026).

        Cortarlo acá, además de limpiar el historial, evita mover la rueda del reparto por turnos.
      */
      if (targetUserId && assignee?.id === targetUserId) {
        setOpen(false);
        return;
      }
      setError(null);
      startTransition(async () => {
        const result = await assignChatAction({ conversationId, assignToUserId: targetUserId, source, origen: "ficha-del-chat" });
        if (result?.error) {
          setError(result.error);
          return;
        }

        /*
          Se ve el cambio de una: el servidor ya lo guardo, no hay nada que esperar.

          El nombre se toma de la lista del equipo, que ya esta cargada, y no de la respuesta:
          asi el chip nunca queda en blanco si al usuario le falta el nombre y solo tiene correo.
        */
        const elegido = targetUserId ? (members.find((miembro) => miembro.id === targetUserId) ?? null) : null;
        recordarAsignacion(
          conversationId,
          elegido
            ? { id: elegido.id, name: elegido.name, email: elegido.email }
            : result.assignedTo
              ? { id: result.assignedTo.id, name: result.assignedTo.name, email: "" }
              : null,
        );
        setOpen(false);
      });

      /*
        El refresco va por FUERA de la transicion y sin esperarlo: sirve para que el resto de la
        pantalla (la fila de la bandeja) se entere, pero nadie tiene que quedarse mirando mientras
        se rehacen mil conversaciones.
      */
      router.refresh();
    },
    [assignee?.id, conversationId, members, router, source],
  );

  const assignedToMe = Boolean(assignee && currentUserId && assignee.id === currentUserId);
  const buttonLabel = assignee ? memberLabel(assignee) : "Sin asignar";
  // Un chat se puede traspasar cuando es propio o no tiene dueno. El servidor vuelve a
  // comprobarlo: esto es solo para no ofrecer algo que va a ser rechazado.
  const puedeTraspasar = !assignee || assignedToMe;
  const companeras = members.filter((member) => member.id !== currentUserId);

  return (
    <div ref={containerRef} className="relative">
      {compacto ? (
        <button
          type="button"
          onClick={handleToggle}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card transition hover:bg-muted disabled:opacity-60"
          title={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
          aria-label={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
          aria-haspopup="menu"
          aria-expanded={open}
        >
          {assignee ? (
            <UserCheck className="size-4 text-emerald-600" />
          ) : (
            <UserPlus className="size-4 text-foreground/80" />
          )}
        </button>
      ) : (
      <button
        type="button"
        onClick={handleToggle}
        className={`inline-flex h-7 max-w-[160px] items-center gap-1.5 rounded-md border px-2 text-[12px] font-medium transition ${
          assignee
            ? "border-emerald-500/20 bg-emerald-500/10 text-emerald-600 hover:bg-emerald-500/20"
            : "border-border bg-card text-muted-foreground hover:bg-muted"
        }`}
        title={assignee ? `Asignado a ${buttonLabel}` : "Asignar chat"}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {assignee ? <UserCheck className="h-3.5 w-3.5 shrink-0" /> : <UserPlus className="h-3.5 w-3.5 shrink-0" />}
        <span className="truncate">{buttonLabel}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </button>
      )}

      {open ? (
        <div className="absolute right-0 z-50 mt-1 w-60 overflow-hidden rounded-xl border border-border bg-popover shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
          <div className="border-b border-border px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Asignar chat
          </div>

          {loading ? (
            <div className="px-3 py-3 text-[12px] text-muted-foreground">Cargando equipo…</div>
          ) : error ? (
            <div className="px-3 py-3 text-[12px] text-red-500">{error}</div>
          ) : (
            <div className="max-h-72 overflow-y-auto py-1">
              {/* Tomar / soltar / pasar a una companera, para quien no es jefe */}
              {!isManager ? (
                <>
                  {!assignedToMe ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => currentUserId && handleAssign(currentUserId)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      <UserPlus className="h-3.5 w-3.5 text-emerald-500" />
                      Tomar este chat
                    </button>
                  ) : null}
                  {assignedToMe ? (
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => handleAssign(null)}
                      className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                    >
                      Soltar chat
                    </button>
                  ) : null}

                  {/*
                    Pasar el chat a otra persona: es lo que hace falta cuando el cliente pregunta
                    algo que se le responde mejor desde otra experiencia. Solo sale si el chat es
                    propio o no tiene dueno; el de otra companera no se toca (eso es de jefes).
                  */}
                  {puedeTraspasar ? (
                    <>
                      <div className="mt-1 border-t border-border px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Pasar a
                      </div>
                      {companeras.length === 0 ? (
                        <div className="px-3 py-2 text-[12px] text-muted-foreground">
                          No hay nadie mas en el equipo.
                        </div>
                      ) : (
                        companeras.map((member) => (
                          <button
                            key={member.id}
                            type="button"
                            disabled={isPending}
                            onClick={() => handleAssign(member.id)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                          >
                            <span className="min-w-0 truncate">{memberLabel(member)}</span>
                          </button>
                        ))
                      )}
                    </>
                  ) : null}

                  {assignee && !assignedToMe ? (
                    <div className="px-3 py-2 text-[12px] text-muted-foreground">
                      Asignado a {memberLabel(assignee)}
                    </div>
                  ) : null}
                </>
              ) : (
                <>
                  <button
                    type="button"
                    disabled={isPending}
                    onClick={() => handleAssign(null)}
                    className="flex w-full items-center justify-between px-3 py-2 text-left text-[13px] text-muted-foreground transition hover:bg-muted disabled:opacity-50"
                  >
                    <span>Sin asignar</span>
                    {!assignee ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : null}
                  </button>
                  {members.map((member) => {
                    const selected = assignee?.id === member.id;
                    return (
                      <button
                        key={member.id}
                        type="button"
                        disabled={isPending}
                        onClick={() => handleAssign(member.id)}
                        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-foreground transition hover:bg-muted disabled:opacity-50"
                      >
                        <span className="min-w-0 truncate">
                          {memberLabel(member)}
                          {member.id === currentUserId ? " (tú)" : ""}
                        </span>
                        {selected ? <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" /> : null}
                      </button>
                    );
                  })}
                </>
              )}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

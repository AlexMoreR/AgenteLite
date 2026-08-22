"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { updateChannelCollaboratorsAction } from "@/app/actions/chats-actions";

type CollaboratorMember = { id: string; name: string | null; email: string };

function memberLabel(member: CollaboratorMember) {
  return member.name?.trim() || member.email;
}

export function ChannelCollaboratorsForm({
  channelId,
  members,
  collaboratorIds,
  pausedAssignmentIds = [],
}: {
  channelId: string;
  members: CollaboratorMember[];
  collaboratorIds: string[];
  pausedAssignmentIds?: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(() =>
    collaboratorIds.filter((id) => members.some((m) => m.id === id)),
  );
  const [paused, setPaused] = useState<string[]>(() =>
    pausedAssignmentIds.filter((id) => collaboratorIds.includes(id)),
  );
  const [isPending, startTransition] = useTransition();

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const available = useMemo(() => members.filter((m) => !selected.includes(m.id)), [members, selected]);

  const addMember = (id: string) => {
    if (id && !selected.includes(id)) {
      setSelected((current) => [...current, id]);
    }
  };
  // Al sacar a alguien del canal se le limpia la pausa: si mañana vuelve, vuelve recibiendo.
  const removeMember = (id: string) => {
    setSelected((current) => current.filter((x) => x !== id));
    setPaused((current) => current.filter((x) => x !== id));
  };
  const togglePaused = (id: string) =>
    setPaused((current) => (current.includes(id) ? current.filter((x) => x !== id) : [...current, id]));

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateChannelCollaboratorsAction({
        channelId,
        collaboratorIds: selected,
        pausedAssignmentIds: paused,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success("Colaboradores actualizados");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Colaboradores</p>
        <p className="text-xs text-muted-foreground">
          Quiénes atienden este canal. Solo ellos ven sus chats.
        </p>
      </div>

      <div className="min-h-[44px] rounded-lg border border-input p-2">
        {selected.length ? (
          <div className="space-y-1">
            {selected.map((id) => {
              const member = memberById.get(id);
              if (!member) return null;
              const enPausa = paused.includes(id);
              return (
                <div
                  key={id}
                  className="flex items-center gap-2 rounded-md bg-muted/60 px-2 py-1.5 text-[13px]"
                >
                  <span className="min-w-0 flex-1 truncate text-foreground">{memberLabel(member)}</span>
                  {/*
                    El interruptor dice lo que PASA, no lo que hay que hacer para cambiarlo: quien
                    mira la lista quiere saber de un vistazo a quién le está entrando trabajo.
                  */}
                  <button
                    type="button"
                    onClick={() => togglePaused(id)}
                    aria-pressed={!enPausa}
                    title={
                      enPausa
                        ? "No le entran leads nuevos. Sigue viendo el canal y sus chats."
                        : "Le entran leads nuevos por turno."
                    }
                    className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium transition ${
                      enPausa
                        ? "border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-300"
                        : "border-emerald-300 bg-emerald-50 text-emerald-700 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-300"
                    }`}
                  >
                    {enPausa ? "En pausa" : "Recibe leads"}
                  </button>
                  <button
                    type="button"
                    onClick={() => removeMember(id)}
                    aria-label={`Quitar ${memberLabel(member)} del canal`}
                    title="Quitar del canal (deja de ver estos chats)"
                    className="shrink-0 text-muted-foreground transition hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-1 text-sm text-muted-foreground">
            Sin colaboradores: este canal lo ve todo el equipo.
          </p>
        )}
      </div>

      {/*
        La diferencia entre las dos acciones no es obvia y equivocarse sale caro: sacar del canal a
        una asesora le vacía la bandeja sin avisarle. Se explica acá, al lado de los botones.
      */}
      <p className="text-[11px] leading-relaxed text-muted-foreground">
        <strong className="font-medium text-foreground">En pausa</strong> = deja de recibir leads
        nuevos, pero sigue viendo el canal y atendiendo los suyos. La{" "}
        <strong className="font-medium text-foreground">✕</strong> lo saca del canal y le esconde
        todos estos chats.
      </p>

      {available.length ? (
        <NativeSelect
          className="w-full"
          value=""
          onChange={(event) => addMember(event.target.value)}
          aria-label="Añadir colaborador"
        >
          <NativeSelectOption value="">+ Añadir colaborador…</NativeSelectOption>
          {available.map((member) => (
            <NativeSelectOption key={member.id} value={member.id}>
              {memberLabel(member)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      ) : (
        <p className="text-xs text-muted-foreground">Todos los miembros del equipo ya están agregados.</p>
      )}

      <Button type="button" onClick={handleSave} disabled={isPending}>
        {isPending ? "Guardando…" : "Actualizar"}
      </Button>
    </div>
  );
}

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
}: {
  channelId: string;
  members: CollaboratorMember[];
  collaboratorIds: string[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>(() =>
    collaboratorIds.filter((id) => members.some((m) => m.id === id)),
  );
  const [isPending, startTransition] = useTransition();

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const available = useMemo(() => members.filter((m) => !selected.includes(m.id)), [members, selected]);

  const addMember = (id: string) => {
    if (id && !selected.includes(id)) {
      setSelected((current) => [...current, id]);
    }
  };
  const removeMember = (id: string) => setSelected((current) => current.filter((x) => x !== id));

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateChannelCollaboratorsAction({ channelId, collaboratorIds: selected });
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
        <p className="text-xs text-muted-foreground">Añade o quita personas del equipo que atienden este canal.</p>
      </div>

      <div className="min-h-[44px] rounded-lg border border-input p-2">
        {selected.length ? (
          <div className="flex flex-wrap gap-1.5">
            {selected.map((id) => {
              const member = memberById.get(id);
              if (!member) return null;
              return (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[13px] text-foreground"
                >
                  {memberLabel(member)}
                  <button
                    type="button"
                    onClick={() => removeMember(id)}
                    aria-label={`Quitar ${memberLabel(member)}`}
                    className="text-muted-foreground transition hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              );
            })}
          </div>
        ) : (
          <p className="px-1 py-1 text-sm text-muted-foreground">Aún no hay colaboradores para este canal.</p>
        )}
      </div>

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

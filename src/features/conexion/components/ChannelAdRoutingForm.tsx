"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { updateChannelAdRoutingAction } from "@/app/actions/chats-actions";
import { describeAdCampaignRouting } from "@/lib/ad-campaign-routing";

type CollaboratorMember = { id: string; name: string | null; email: string };

function memberLabel(member: CollaboratorMember) {
  return member.name?.trim() || member.email;
}

/**
 * "Los leads de esta campana son para tal persona".
 *
 * El reparto normal es por turnos, y para la pauta a veces no sirve: una campana puede necesitar
 * a quien mas sabe de ese producto. Se decide con lo que llega en el PRIMER mensaje (el anuncio y
 * la frase del cliente) y no con la etiqueta del producto: esa la pone el agente despues, cuando
 * el lead ya se repartio.
 */
export function ChannelAdRoutingForm({
  channelId,
  members,
  keywords,
  userId,
}: {
  channelId: string;
  members: CollaboratorMember[];
  keywords: string[];
  userId: string;
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(() => keywords.join(", "));
  const [persona, setPersona] = useState(() => (members.some((m) => m.id === userId) ? userId : ""));
  const [isPending, startTransition] = useTransition();

  const palabras = useMemo(
    () =>
      texto
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [texto],
  );

  const personaElegida = members.find((member) => member.id === persona);
  const resumen =
    persona && palabras.length > 0
      ? `${describeAdCampaignRouting(palabras)} van a ${personaElegida ? memberLabel(personaElegida) : "esa persona"}.`
      : "Sin regla: todos los leads se reparten por turnos entre los colaboradores.";

  const handleSave = () => {
    startTransition(async () => {
      const result = await updateChannelAdRoutingAction({
        channelId,
        keywords: persona ? palabras : [],
        userId: persona,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      toast.success(persona ? "Regla de campaña guardada" : "Regla de campaña quitada");
      router.refresh();
    });
  };

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-foreground">Leads de anuncios</p>
        <p className="text-xs text-muted-foreground">
          Manda los leads de una campaña a una persona fija, en vez de repartirlos por turnos. Se
          decide apenas entra el primer mensaje, mirando el anuncio y la frase con la que llega el
          cliente.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="adRoutingKeywords" className="text-xs font-medium text-foreground">
          Si el anuncio o la frase del cliente contienen
        </label>
        <Input
          id="adRoutingKeywords"
          value={texto}
          onChange={(event) => setTexto(event.target.value)}
          placeholder="camilla, combo"
        />
        <p className="text-[11px] text-muted-foreground">
          Separadas por comas. Alcanza con que una aparezca en el título del anuncio, en su
          descripción o en el primer mensaje. No distingue mayúsculas ni tildes.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="adRoutingUser" className="text-xs font-medium text-foreground">
          Asignar a
        </label>
        <NativeSelect
          id="adRoutingUser"
          className="w-full"
          value={persona}
          onChange={(event) => setPersona(event.target.value)}
        >
          <NativeSelectOption value="">Nadie (repartir por turnos)</NativeSelectOption>
          {members.map((member) => (
            <NativeSelectOption key={member.id} value={member.id}>
              {memberLabel(member)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>

      <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">{resumen}</p>

      <Button type="button" onClick={handleSave} disabled={isPending}>
        {isPending ? "Guardando…" : "Guardar regla"}
      </Button>
    </div>
  );
}

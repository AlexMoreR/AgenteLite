"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Check, TriangleAlert, X } from "lucide-react";

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
  userIds,
}: {
  channelId: string;
  members: CollaboratorMember[];
  keywords: string[];
  userIds: string[];
}) {
  const router = useRouter();
  const [texto, setTexto] = useState(() => keywords.join(", "));
  const [personas, setPersonas] = useState<string[]>(() =>
    userIds.filter((id) => members.some((member) => member.id === id)),
  );
  // Estado propio en vez de useTransition: con la transicion, el boton seguia diciendo
  // "Guardando..." mientras el refresco de la pantalla estuviera pendiente. Si justo se despliega
  // una version nueva, ese refresco no termina nunca y parece que no se guardo, cuando en la base
  // ya estaba guardado.
  const [isPending, setIsPending] = useState(false);

  const palabras = useMemo(
    () =>
      texto
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    [texto],
  );

  const elegidas = personas
    .map((id) => members.find((member) => member.id === id))
    .filter((member): member is CollaboratorMember => Boolean(member));
  const disponibles = members.filter((member) => !personas.includes(member.id));
  const nombres = elegidas.map(memberLabel);
  const destino =
    nombres.length <= 1
      ? nombres[0] ?? ""
      : `${nombres.slice(0, -1).join(", ")} y ${nombres[nombres.length - 1]} (se turnan entre ellas)`;
  const resumen =
    personas.length > 0 && palabras.length > 0
      ? `${describeAdCampaignRouting(palabras)} van a ${destino}.`
      : "Sin regla: todos los leads se reparten por turnos entre los colaboradores.";

  // Lo que hay guardado en el servidor, para poder decir si lo de la pantalla ya quedo guardado
  // o son cambios sin guardar. Antes no habia forma de saberlo.
  const [guardado, setGuardado] = useState(() => ({
    keywords,
    userIds: userIds.filter((id) => members.some((member) => member.id === id)),
  }));
  const hayCambiosSinGuardar =
    guardado.userIds.join("|") !== personas.join("|") ||
    guardado.keywords.join("|") !== palabras.join("|");
  const hayReglaGuardada = guardado.userIds.length > 0 && guardado.keywords.length > 0;

  /**
   * Palabras que aparecen en casi cualquier mensaje. Si una se cuela, la regla deja de ser "esta
   * campana" y se lleva TODOS los leads de anuncios sin que se note. Paso de verdad: al pegar la
   * frase entera del anuncio, la primera palabra separada por comas quedo siendo «Hola».
   */
  const COMUNES = ["hola", "buenas", "buenos dias", "buenas tardes", "buenas noches", "gracias", "si", "ok", "info"];
  const palabrasPeligrosas = palabras.filter((palabra) =>
    COMUNES.includes(
      palabra
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .trim(),
    ),
  );

  const guardar = async (destinatarios: string[], palabrasAGuardar: string[]) => {
    setIsPending(true);
    try {
      const result = await updateChannelAdRoutingAction({
        channelId,
        keywords: destinatarios.length > 0 ? palabrasAGuardar : [],
        userIds: destinatarios,
      });
      if (result?.error) {
        toast.error(result.error);
        return;
      }
      setGuardado({
        keywords: destinatarios.length > 0 ? palabrasAGuardar : [],
        userIds: destinatarios,
      });
      toast.success(destinatarios.length > 0 ? "Regla guardada" : "Regla eliminada");
      router.refresh();
    } catch {
      toast.error("No se pudo guardar. Recargá la página e intentá de nuevo.");
    } finally {
      setIsPending(false);
    }
  };

  const handleSave = () => guardar(personas, palabras);

  // Eliminar es guardar la regla vacia: los leads de anuncios vuelven al reparto por turnos.
  const handleDelete = async () => {
    setPersonas([]);
    setTexto("");
    await guardar([], []);
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

        <div className="min-h-[44px] rounded-lg border border-input p-2">
          {elegidas.length ? (
            <div className="flex flex-wrap gap-1.5">
              {elegidas.map((member) => (
                <span
                  key={member.id}
                  className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[13px] text-foreground"
                >
                  {memberLabel(member)}
                  <button
                    type="button"
                    onClick={() => setPersonas((actual) => actual.filter((id) => id !== member.id))}
                    aria-label={`Quitar ${memberLabel(member)}`}
                    className="text-muted-foreground transition hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="px-1 py-1 text-sm text-muted-foreground">
              Nadie: estos leads se reparten por turnos como los demás.
            </p>
          )}
        </div>

        {disponibles.length ? (
          <NativeSelect
            id="adRoutingUser"
            className="w-full"
            value=""
            onChange={(event) => {
              const id = event.target.value;
              if (id) {
                setPersonas((actual) => (actual.includes(id) ? actual : [...actual, id]));
              }
            }}
          >
            <NativeSelectOption value="">+ Añadir persona…</NativeSelectOption>
            {disponibles.map((member) => (
              <NativeSelectOption key={member.id} value={member.id}>
                {memberLabel(member)}
              </NativeSelectOption>
            ))}
          </NativeSelect>
        ) : null}

        {personas.length > 1 ? (
          <p className="text-[11px] text-muted-foreground">
            Con varias personas, los leads de esta campaña se turnan entre ellas.
          </p>
        ) : null}
      </div>

      {palabras.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {palabras.map((palabra) => (
            <span
              key={palabra}
              className={`inline-flex items-center rounded-md px-2 py-1 text-[12px] ${
                palabrasPeligrosas.includes(palabra)
                  ? "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200"
                  : "bg-muted text-foreground"
              }`}
            >
              {palabra}
            </span>
          ))}
        </div>
      ) : null}

      {palabrasPeligrosas.length > 0 ? (
        <p className="flex gap-2 rounded-lg bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:bg-amber-950 dark:text-amber-200">
          <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>
            {palabrasPeligrosas.map((palabra) => `«${palabra}»`).join(", ")} aparece en casi
            cualquier mensaje: con esa palabra la regla se lleva todos los leads de anuncios, no
            solo los de esta campaña.
          </span>
        </p>
      ) : null}

      <p className="rounded-lg bg-muted px-3 py-2 text-[12px] text-muted-foreground">{resumen}</p>

      <div className="flex items-center gap-3">
        <Button type="button" onClick={() => void handleSave()} disabled={isPending}>
          {isPending ? "Guardando…" : "Guardar regla"}
        </Button>
        {hayReglaGuardada ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void handleDelete()}
            disabled={isPending}
          >
            Eliminar regla
          </Button>
        ) : null}
        {hayCambiosSinGuardar ? (
          <span className="text-[12px] text-amber-700 dark:text-amber-300">Sin guardar</span>
        ) : (
          <span className="inline-flex items-center gap-1 text-[12px] text-emerald-700 dark:text-emerald-400">
            <Check className="h-3.5 w-3.5" />
            Guardada
          </span>
        )}
      </div>
    </div>
  );
}

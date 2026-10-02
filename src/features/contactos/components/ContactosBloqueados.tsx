"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban } from "lucide-react";
import { toast } from "sonner";

import { desbloquearContactoAction } from "@/app/actions/bloqueo-actions";
import { ContactAvatar } from "@/components/chats/contact-avatar";

export type ContactoBloqueado = {
  id: string;
  nombre: string;
  telefono: string;
  avatarUrl: string | null;
  /** Ya formateada en hora de Colombia, desde el servidor. */
  bloqueadoEl: string;
  bloqueadoPor: string | null;
};

/**
 * Los contactos bloqueados desde la bandeja, con el botón para desbloquearlos (ver
 * lib/bloqueo-de-contactos). Solo la ven dueño y admin.
 *
 * Desbloquear lo desbloquea en WhatsApp, lo devuelve a la bandeja y al CRM, y reanuda el agente en
 * los chats que se habían pausado al bloquearlo.
 */
export function ContactosBloqueados({ contactos }: { contactos: ContactoBloqueado[] }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [enCurso, setEnCurso] = useState<string | null>(null);

  const desbloquear = (contacto: ContactoBloqueado) => {
    setEnCurso(contacto.id);
    startTransition(async () => {
      const resultado = await desbloquearContactoAction({ contactId: contacto.id }).catch(() => ({
        error: "No se pudo desbloquear",
      }));
      setEnCurso(null);
      if ("error" in resultado) {
        toast.error(resultado.error);
        return;
      }
      if (resultado.lineasConError.length > 0) {
        toast.warning(
          `Desbloqueado en el CRM, pero en WhatsApp no se pudo en: ${resultado.lineasConError
            .map((fila) => fila.linea)
            .join(", ")}.`,
        );
      } else {
        toast.success(`${contacto.nombre} desbloqueado`);
      }
      router.refresh();
    });
  };

  if (contactos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
        No hay contactos bloqueados.
      </div>
    );
  }

  return (
    <ul className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-card">
      {contactos.map((contacto) => (
        <li key={contacto.id} className="flex items-center gap-3 px-3 py-2.5">
          <ContactAvatar
            avatarUrl={contacto.avatarUrl}
            label={contacto.nombre}
            className="h-10 w-10 shrink-0 rounded-full border border-border bg-muted text-muted-foreground"
            fallbackClassName="rounded-full bg-muted text-muted-foreground"
          />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-foreground">{contacto.nombre}</p>
            <p className="truncate text-xs text-muted-foreground">
              <span className="tabular-nums">{contacto.telefono}</span>
              {" · "}
              <Ban className="mb-px inline size-3 text-rose-500" aria-hidden="true" /> {contacto.bloqueadoEl}
              {contacto.bloqueadoPor ? ` por ${contacto.bloqueadoPor}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={() => desbloquear(contacto)}
            disabled={isPending}
            className="shrink-0 rounded-lg border border-border px-3 py-1.5 text-[12.5px] font-medium text-foreground transition hover:bg-muted disabled:opacity-60"
          >
            {enCurso === contacto.id ? "Desbloqueando…" : "Desbloquear"}
          </button>
        </li>
      ))}
    </ul>
  );
}

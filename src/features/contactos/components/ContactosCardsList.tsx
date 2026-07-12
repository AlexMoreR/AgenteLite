"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { Activity, AlarmClock, BarChart3, Facebook, Instagram, Loader2, Music2, Plus, SquarePen, StickyNote, Trash2 } from "lucide-react";
import { deleteContactAction } from "@/app/actions/chats-actions";
import { updateContactDetailsAction } from "@/app/actions/contactos-actions";
import { ContactAvatar } from "@/components/chats/contact-avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TAG_BADGE_CLASS } from "@/lib/tag-badge";
import { cn } from "@/lib/utils";

export type ContactosCardProfile = {
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  country: string | null;
  tiktok: string | null;
  facebook: string | null;
  instagram: string | null;
};

export type ContactosCardItem = {
  id: string;
  name: string | null;
  phoneNumber: string;
  email: string | null;
  avatarUrl: string | null;
  profile: ContactosCardProfile;
  createdAt: string;
  lastActivityAt: string | null;
  tags: Array<{
    label: string;
    color: string;
  }>;
};

function getDisplayName(contact: ContactosCardItem) {
  return contact.name?.trim() || contact.phoneNumber;
}

const DETAIL_TABS = [
  { key: "editar", label: "Editar", icon: SquarePen },
  { key: "estadisticas", label: "Estadísticas", icon: BarChart3 },
  { key: "seguimientos", label: "Seguimientos", icon: AlarmClock },
  { key: "notas", label: "Notas", icon: StickyNote },
] as const;

type DetailTabKey = (typeof DETAIL_TABS)[number]["key"];

// Botón de submit del borrado: se deshabilita mientras corre la acción para
// evitar clicks repetidos (disparaban varias eliminaciones).
function DeleteContactSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" variant="destructive" disabled={pending} aria-busy={pending}>
      {pending ? "Eliminando..." : "Eliminar contacto"}
    </Button>
  );
}

const COUNTRY_OPTIONS = [
  "Colombia",
  "México",
  "Argentina",
  "Bolivia",
  "Chile",
  "Costa Rica",
  "Ecuador",
  "El Salvador",
  "España",
  "Estados Unidos",
  "Guatemala",
  "Honduras",
  "Nicaragua",
  "Panamá",
  "Paraguay",
  "Perú",
  "República Dominicana",
  "Uruguay",
  "Venezuela",
];

// Formulario de la pestaña Editar: nombre/apellido/correo/ciudad/país + redes.
// El teléfono es solo lectura (es la identidad de WhatsApp del contacto).
function ContactEditForm({ contact }: { contact: ContactosCardItem }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    setFeedback(null);
    startTransition(async () => {
      const result = await updateContactDetailsAction(formData);
      if (!result.ok) {
        setFeedback({ ok: false, message: result.error });
        return;
      }
      setFeedback({ ok: true, message: "Cambios guardados" });
      router.refresh();
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <input type="hidden" name="contactId" value={contact.id} />

      <div className="space-y-2.5">
        <Label className="text-sm font-semibold text-foreground">Editar detalles del contacto</Label>
        <div className="grid gap-2.5 sm:grid-cols-2">
          <Input
            name="firstName"
            defaultValue={contact.profile.firstName ?? contact.name ?? ""}
            placeholder="Ingrese el nombre"
            aria-label="Nombre"
          />
          <Input
            name="lastName"
            defaultValue={contact.profile.lastName ?? ""}
            placeholder="Ingrese el apellido"
            aria-label="Apellido"
          />
          <Input
            name="email"
            type="email"
            defaultValue={contact.email ?? ""}
            placeholder="Ingrese el correo electrónico"
            aria-label="Correo electrónico"
          />
          <Input
            value={`+${contact.phoneNumber}`}
            readOnly
            disabled
            aria-label="Teléfono (WhatsApp)"
            title="El teléfono es la identidad de WhatsApp del contacto y no se puede editar"
            className="tabular-nums"
          />
          <Input
            name="city"
            defaultValue={contact.profile.city ?? ""}
            placeholder="Introduzca el nombre de la ciudad"
            aria-label="Ciudad"
          />
          <select
            name="country"
            defaultValue={contact.profile.country ?? ""}
            aria-label="País"
            className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground"
          >
            <option value="">Seleccione el país</option>
            {COUNTRY_OPTIONS.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="space-y-2.5">
        <Label className="text-sm font-semibold text-foreground">Editar enlaces de redes sociales</Label>
        <div className="grid gap-2.5 sm:grid-cols-3">
          <div className="relative">
            <Music2 className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="tiktok"
              defaultValue={contact.profile.tiktok ?? ""}
              placeholder="Agregar TikTok"
              aria-label="TikTok"
              className="pl-9"
            />
          </div>
          <div className="relative">
            <Facebook className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="facebook"
              defaultValue={contact.profile.facebook ?? ""}
              placeholder="Agregar Facebook"
              aria-label="Facebook"
              className="pl-9"
            />
          </div>
          <div className="relative">
            <Instagram className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              name="instagram"
              defaultValue={contact.profile.instagram ?? ""}
              placeholder="Agregar Instagram"
              aria-label="Instagram"
              className="pl-9"
            />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-end gap-3">
        {feedback ? (
          <p className={cn("text-xs", feedback.ok ? "text-emerald-600" : "text-destructive")}>{feedback.message}</p>
        ) : null}
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Guardar cambios
        </Button>
      </div>
    </form>
  );
}

const relativeFormatter = new Intl.RelativeTimeFormat("es", { numeric: "auto" });

function formatRelative(value: string | null) {
  if (!value) return null;

  const diffMinutes = Math.round((Date.now() - new Date(value).getTime()) / 60_000);
  if (diffMinutes < 60) return relativeFormatter.format(-Math.max(1, diffMinutes), "minute");

  const diffHours = Math.round(diffMinutes / 60);
  if (diffHours < 24) return relativeFormatter.format(-diffHours, "hour");

  const diffDays = Math.round(diffHours / 24);
  if (diffDays < 30) return relativeFormatter.format(-diffDays, "day");

  const diffMonths = Math.round(diffDays / 30);
  if (diffMonths < 12) return relativeFormatter.format(-diffMonths, "month");

  return relativeFormatter.format(-Math.round(diffMonths / 12), "year");
}

// Lista de cards de contactos (v2). Al hacer clic en una card se abre el modal de
// detalle: header y footer fijos, cuerpo scrolleable (por ahora solo avatar,
// nombre y numero; el detalle crecera aqui pieza por pieza).
export function ContactosCardsList({ contacts }: { contacts: ContactosCardItem[] }) {
  const [selected, setSelected] = useState<ContactosCardItem | null>(null);
  const [activeTab, setActiveTab] = useState<DetailTabKey>("editar");
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  function openContact(contact: ContactosCardItem) {
    setSelected(contact);
    setActiveTab("editar");
    setConfirmDeleteOpen(false);
  }

  return (
    <>
      <div className="flex flex-col gap-3">
        {contacts.map((contact) => {
          const displayName = getDisplayName(contact);

          return (
            <Card
              key={contact.id}
              role="button"
              tabIndex={0}
              onClick={() => openContact(contact)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openContact(contact);
                }
              }}
              className="cursor-pointer py-0 transition hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <CardContent className="flex items-center gap-3 py-3.5">
                <ContactAvatar
                  avatarUrl={contact.avatarUrl}
                  label={displayName}
                  className="h-11 w-11 shrink-0 rounded-full"
                  fallbackClassName="rounded-full"
                />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                  <p className="truncate text-xs tabular-nums text-muted-foreground">{contact.phoneNumber}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Dialog open={Boolean(selected)} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent className="flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg">
          <DialogTitle className="sr-only">Detalle del contacto</DialogTitle>
          {selected ? (
            <>
              <div className="flex shrink-0 items-center gap-3 border-b p-4">
                <ContactAvatar
                  avatarUrl={selected.avatarUrl}
                  label={getDisplayName(selected)}
                  className="h-12 w-12 shrink-0 rounded-full"
                  fallbackClassName="rounded-full"
                />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div>
                    <h2 className="truncate text-base font-semibold tracking-[-0.02em] text-foreground">
                      {getDisplayName(selected)}
                    </h2>
                    <p className="truncate text-sm tabular-nums text-muted-foreground">{selected.phoneNumber}</p>
                  </div>

                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Activity className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate">
                      Creado {formatRelative(selected.createdAt)} · Última actividad{" "}
                      {formatRelative(selected.lastActivityAt) ?? "sin registro"}
                    </span>
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    {selected.tags.map((tag) => (
                      <Badge
                        key={`${selected.id}:${tag.label}`}
                        className={`max-w-full border-transparent text-white shadow-none ${TAG_BADGE_CLASS}`}
                        style={{ backgroundColor: tag.color?.trim() || "var(--primary)" }}
                        title={tag.label}
                      >
                        <span className="truncate">{tag.label}</span>
                      </Badge>
                    ))}
                    <button
                      type="button"
                      className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border px-2.5 text-xs text-muted-foreground transition hover:border-primary/40 hover:text-primary"
                    >
                      <Plus className="h-3 w-3" />
                      etiqueta
                    </button>
                  </div>
                </div>
              </div>

              <div className="min-h-32 flex-1 space-y-4 overflow-y-auto p-4">
                <div className="inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full bg-muted p-1">
                  {DETAIL_TABS.map((tab) => {
                    const Icon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        type="button"
                        onClick={() => setActiveTab(tab.key)}
                        className={cn(
                          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition",
                          activeTab === tab.key
                            ? "border border-border bg-background text-foreground shadow-sm"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                {activeTab === "editar" ? <ContactEditForm key={selected.id} contact={selected} /> : null}
              </div>

              <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t p-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setConfirmDeleteOpen(true)}
                  className="border-destructive/30 text-destructive hover:bg-destructive/5 hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  Eliminar permanentemente
                </Button>
                <Button type="button" variant="outline" onClick={() => setSelected(null)}>
                  Cerrar
                </Button>
              </div>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(selected) && confirmDeleteOpen} onOpenChange={(open) => setConfirmDeleteOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogTitle className="text-lg font-semibold tracking-[-0.03em]">Eliminar contacto</DialogTitle>
          {selected ? (
            <form action={deleteContactAction} className="space-y-4">
              <input type="hidden" name="contactId" value={selected.id} />
              <input type="hidden" name="returnTo" value="/cliente/contactos" />
              <p className="text-sm leading-6 text-muted-foreground">
                Se eliminará permanentemente{" "}
                <span className="font-medium text-foreground">{getDisplayName(selected)}</span> y todo su historial:
                conversaciones, mensajes, etiquetas y registros asociados. Esta acción no se puede deshacer.
              </p>
              <div className="flex flex-wrap justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setConfirmDeleteOpen(false)}>
                  Cancelar
                </Button>
                <DeleteContactSubmitButton />
              </div>
            </form>
          ) : null}
        </DialogContent>
      </Dialog>
    </>
  );
}

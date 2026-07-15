"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { User, Phone, MapPin, Home, Heart } from "lucide-react";
import { getContactDetailsAction, updateContactAction, type ContactDetails } from "@/app/actions/chats-actions";
import { Badge } from "@/components/ui/badge";
import { TAG_BADGE_CLASS } from "@/lib/tag-badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type Props = {
  open: boolean;
  onClose: () => void;
  contactId: string;
  contactName: string;
};

type EditContactActionState =
  | { error: string; success?: false }
  | {
      success: true;
      contactId: string;
      name: string;
      tags: Array<{
        label: string;
        color: string;
      }>;
    };

const initialState: EditContactActionState = { error: "" };

export function EditContactModal({ open, onClose, contactId, contactName }: Props) {
  const [state, formAction, isPending] = useActionState(updateContactAction, initialState);
  const [details, setDetails] = useState<ContactDetails | null>(null);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  // Al abrir, cargamos los datos actuales del contacto y sus etiquetas.
  useEffect(() => {
    if (!open) {
      return;
    }

    let cancelled = false;
    getContactDetailsAction(contactId)
      .then((result) => {
        if (cancelled) return;
        if ("details" in result) {
          setDetails(result.details);
          setSelectedTagIds(new Set(result.details.tagIds));
        }
      });

    return () => {
      cancelled = true;
    };
  }, [open, contactId]);

  useEffect(() => {
    if (state.success && state.contactId) {
      window.dispatchEvent(
        new CustomEvent("chat-contact-updated", {
          detail: {
            contactId: state.contactId,
            name: state.name,
          },
        }),
      );
      window.dispatchEvent(
        new CustomEvent("chat-tags-updated", {
          detail: {
            contactId: state.contactId,
            tags: state.tags,
          },
        }),
      );
      onClose();
    }
  }, [state, onClose]);

  // key estable para reinicializar defaultValues cuando llegan los datos cargados.
  const loadedDetails = details?.contactId === contactId ? details : null;
  const loadingDetails = open && !loadedDetails;
  const fieldsKey = loadedDetails ? `${contactId}:loaded` : `${contactId}:empty`;
  const availableTags = useMemo(() => loadedDetails?.availableTags ?? [], [loadedDetails?.availableTags]);
  const selectedTags = useMemo(
    () => availableTags.filter((tag) => selectedTagIds.has(tag.id)),
    [availableTags, selectedTagIds],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Editar contacto</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="contactId" value={contactId} />
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="edit-contact-name" className="flex items-center gap-1.5">
                <User className="h-3.5 w-3.5 text-muted-foreground" /> Nombre
              </Label>
              <Input
                id="edit-contact-name"
                key={`name:${fieldsKey}`}
                name="name"
                defaultValue={loadedDetails?.name ?? contactName}
                placeholder="Nombre del contacto"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contact-phone" className="flex items-center gap-1.5">
                <Phone className="h-3.5 w-3.5 text-muted-foreground" /> Teléfono
              </Label>
              <Input
                id="edit-contact-phone"
                key={`phone:${fieldsKey}`}
                name="phoneNumber"
                type="tel"
                defaultValue={loadedDetails?.phoneNumber ?? ""}
                placeholder="Número de teléfono"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contact-city" className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-muted-foreground" /> Ciudad
              </Label>
              <Input
                id="edit-contact-city"
                key={`city:${fieldsKey}`}
                name="city"
                defaultValue={loadedDetails?.city ?? ""}
                placeholder="Ciudad"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-contact-address" className="flex items-center gap-1.5">
                <Home className="h-3.5 w-3.5 text-muted-foreground" /> Dirección
              </Label>
              <Input
                id="edit-contact-address"
                key={`address:${fieldsKey}`}
                name="address"
                defaultValue={loadedDetails?.address ?? ""}
                placeholder="Dirección"
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label className="flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 text-muted-foreground" /> Interesado en
            </Label>
            {(loadingDetails ? [] : Array.from(selectedTagIds)).map((tagId) => (
              <input key={tagId} type="hidden" name="tagIds" value={tagId} />
            ))}
            <div className="flex min-h-10 flex-wrap items-center gap-1.5 rounded-lg border border-input bg-background px-2 py-2 text-sm">
              {loadingDetails ? (
                <p className="px-1 text-sm text-muted-foreground">Cargando etiquetas...</p>
              ) : selectedTags.length ? (
                selectedTags.map((tag) => (
                  <Badge
                    key={tag.id}
                    className={`max-w-full justify-start border-transparent text-white shadow-none ${TAG_BADGE_CLASS}`}
                    style={{ backgroundColor: tag.color }}
                    title={tag.name}
                  >
                    <span className="truncate">{tag.name}</span>
                  </Badge>
                ))
              ) : (
                <p className="px-1 text-sm text-muted-foreground">Sin etiquetas</p>
              )}
            </div>
          </div>
          {"error" in state && state.error ? (
            <p className="text-sm text-destructive">{state.error}</p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancelar
            </Button>
            <Button type="submit" disabled={isPending || loadingDetails}>
              {isPending ? "Guardando..." : "Guardar"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

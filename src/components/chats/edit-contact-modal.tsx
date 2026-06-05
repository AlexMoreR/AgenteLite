"use client";

import { useEffect, useMemo, useState, useActionState } from "react";
import { getContactDetailsAction, updateContactAction, type ContactDetails } from "@/app/actions/chats-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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

  const handleToggleTag = (tagId: string, checked: boolean) => {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(tagId);
      } else {
        next.delete(tagId);
      }
      return next;
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) {
          onClose();
        }
      }}
    >
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Editar contacto</DialogTitle>
        </DialogHeader>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="contactId" value={contactId} />
          <div className="space-y-2">
            <Label htmlFor="edit-contact-name">Nombre</Label>
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
            <Label htmlFor="edit-contact-phone">Teléfono</Label>
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
            <Label htmlFor="edit-contact-city">Ciudad</Label>
            <Input
              id="edit-contact-city"
              key={`city:${fieldsKey}`}
              name="city"
              defaultValue={loadedDetails?.city ?? ""}
              placeholder="Ciudad"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="edit-contact-address">Dirección</Label>
            <Input
              id="edit-contact-address"
              key={`address:${fieldsKey}`}
              name="address"
              defaultValue={loadedDetails?.address ?? ""}
              placeholder="Dirección"
            />
          </div>
          <div className="space-y-2">
            <Label>Interesado en</Label>
            {(loadingDetails ? [] : Array.from(selectedTagIds)).map((tagId) => (
              <input key={tagId} type="hidden" name="tagIds" value={tagId} />
            ))}
            <div className="flex min-h-10 flex-col gap-2 rounded-lg border border-input bg-background px-2 py-2 text-sm">
              {selectedTags.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {selectedTags.map((tag) => (
                    <Badge
                      key={tag.id}
                      variant="outline"
                      className="max-w-full justify-start"
                      style={{ borderColor: tag.color, color: tag.color }}
                      title={tag.name}
                    >
                      <span className="truncate">{tag.name}</span>
                    </Badge>
                  ))}
                </div>
              ) : null}

              {loadingDetails ? (
                <p className="px-1 py-1 text-sm text-muted-foreground">Cargando etiquetas...</p>
              ) : availableTags.length ? (
                <div className="flex max-h-32 flex-col gap-1 overflow-y-auto pr-1">
                  {availableTags.map((tag) => {
                    const checked = selectedTagIds.has(tag.id);
                    return (
                      <label
                        key={tag.id}
                        htmlFor={`edit-contact-tag-${tag.id}`}
                        className="flex min-h-8 cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 transition hover:bg-muted"
                      >
                        <Checkbox
                          id={`edit-contact-tag-${tag.id}`}
                          checked={checked}
                          onCheckedChange={(nextChecked) => handleToggleTag(tag.id, nextChecked)}
                        />
                        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: tag.color }} />
                        <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                      </label>
                    );
                  })}
                </div>
              ) : (
                <p className="px-1 py-1 text-sm text-muted-foreground">Sin etiquetas creadas</p>
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

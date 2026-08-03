"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus } from "lucide-react";
import { toast } from "sonner";

import { createContactAction } from "@/app/actions/contactos-actions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Alta manual de un contacto.
 *
 * Hasta ahora la ficha solo nacia cuando el cliente escribia por WhatsApp. El lead que llega por
 * fuera (una feria, una llamada, un referido) no se podia cargar: habia que esperar a que
 * escribiera para recien ahi poder trabajarlo en el CRM.
 */
export function NewContactDialog() {
  const router = useRouter();
  const [abierto, setAbierto] = React.useState(false);
  const [guardando, setGuardando] = React.useState(false);

  const guardar = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (guardando) {
      return;
    }

    const form = event.currentTarget;
    setGuardando(true);
    try {
      const resultado = await createContactAction(new FormData(form));
      if (!resultado.ok) {
        toast.error(resultado.error);
        return;
      }
      toast.success("Contacto creado");
      form.reset();
      setAbierto(false);
      router.refresh();
    } catch {
      toast.error("No se pudo crear el contacto. Probá de nuevo.");
    } finally {
      setGuardando(false);
    }
  };

  return (
    <>
      <Button type="button" onClick={() => setAbierto(true)} className="shrink-0 gap-1.5">
        <Plus className="size-4" />
        <span className="hidden sm:inline">Nuevo contacto</span>
      </Button>

      <Dialog open={abierto} onOpenChange={(valor) => !guardando && setAbierto(valor)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Nuevo contacto</DialogTitle>
          </DialogHeader>

          <form onSubmit={guardar} className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="nuevo-contacto-nombre">Nombre</Label>
              <Input id="nuevo-contacto-nombre" name="name" placeholder="Ej. Marcela Ortiz" autoFocus required />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nuevo-contacto-telefono">WhatsApp</Label>
              <Input
                id="nuevo-contacto-telefono"
                name="phoneNumber"
                inputMode="tel"
                placeholder="3001234567"
                required
              />
              <p className="text-[12px] text-muted-foreground">
                Si es de Colombia alcanza con los 10 dígitos. De otro país, con el indicativo.
              </p>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="nuevo-contacto-correo">Correo (opcional)</Label>
              <Input id="nuevo-contacto-correo" name="email" type="email" placeholder="correo@ejemplo.com" />
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="outline" onClick={() => setAbierto(false)} disabled={guardando}>
                Cancelar
              </Button>
              <Button type="submit" disabled={guardando} className="gap-1.5">
                {guardando ? <Loader2 className="size-4 animate-spin" /> : null}
                Crear
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

"use client";

import * as React from "react";
import { Command as CommandPrimitive } from "cmdk";
import { SearchIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

function Command({ className, ...props }: React.ComponentProps<typeof CommandPrimitive>) {
  return (
    <CommandPrimitive
      data-slot="command"
      className={cn(
        "flex h-full w-full flex-col overflow-hidden rounded-xl bg-popover text-popover-foreground",
        className,
      )}
      {...props}
    />
  );
}

/**
 * El modal de busqueda, sobre el Dialog de la app.
 *
 * Antes envolvia el Dialog CRUDO de cmdk, que no trae un solo estilo: ni overlay, ni centrado, ni
 * z-index. Abria de verdad —quedaba en data-state="open"— pero se dibujaba como una tira dentro
 * del flujo de la pagina, asi que parecia que el boton no hacia nada. Como el componente estaba
 * instalado y sin usar, nadie lo habia notado.
 *
 * `shouldFilter` llega hasta el Command de adentro: con resultados que ya vienen filtrados del
 * servidor, el filtro propio de cmdk esconde aciertos —un chat que coincidio por el CONTENIDO de
 * un mensaje no lleva ese texto en el item, asi que lo descartaba.
 */
function CommandDialog({
  className,
  children,
  shouldFilter,
  title = "Buscar",
  description = "Busca chats, contactos y productos",
  open,
  onOpenChange,
}: React.ComponentProps<typeof CommandPrimitive> & {
  title?: string;
  description?: string;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/*
        En el celular va ARRIBA, no centrado.
        Centrado, al abrirse el teclado la mitad de abajo del modal queda tapada: se veia el campo
        y nada mas. Anclado arriba, el teclado se come el espacio de la lista —que es scrolleable—
        en vez del modal. El alto se mide con `--app-viewport-height`, que es lo unico que sabe
        cuanto se ve DE VERDAD con el teclado encima (ver MobileKeyboardViewport).
      */}
      <DialogContent
        showCloseButton={false}
        className="overflow-hidden p-0 max-h-[calc(var(--app-viewport-height,100dvh)-2rem)] max-sm:top-4 max-sm:translate-y-0 sm:max-w-xl"
      >
        {/* El titulo va oculto: el lector de pantalla lo necesita, la vista no. */}
        <DialogHeader className="sr-only">
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Command shouldFilter={shouldFilter} className={cn("rounded-lg", className)}>
          {children}
        </Command>
      </DialogContent>
    </Dialog>
  );
}

function CommandInput({
  className,
  ...props
}: React.ComponentProps<typeof CommandPrimitive.Input>) {
  return (
    <div className="flex items-center border-b px-3" data-slot="command-input-wrapper">
      <SearchIcon className="mr-2 size-4 shrink-0 opacity-50" />
      <CommandPrimitive.Input
        data-slot="command-input"
        className={cn(
          "flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
          className,
        )}
        {...props}
      />
    </div>
  );
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return (
    <CommandPrimitive.List
      data-slot="command-list"
      className={cn("max-h-[320px] overflow-y-auto overflow-x-hidden", className)}
      {...props}
    />
  );
}

function CommandEmpty(props: React.ComponentProps<typeof CommandPrimitive.Empty>) {
  return (
    <CommandPrimitive.Empty
      data-slot="command-empty"
      className="py-6 text-center text-sm text-muted-foreground"
      {...props}
    />
  );
}

function CommandGroup({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Group>) {
  return (
    <CommandPrimitive.Group
      data-slot="command-group"
      className={cn(
        // El titulo del grupo en negrita y en color pleno: es lo que separa "Chats" de
        // "Contactos" en una lista donde todo se parece, y en gris claro se perdia entre los
        // resultados en vez de ordenarlos.
        "overflow-hidden p-1 text-foreground [&_[data-slot=command-group-heading]]:px-2 [&_[data-slot=command-group-heading]]:py-1.5 [&_[data-slot=command-group-heading]]:text-xs [&_[data-slot=command-group-heading]]:font-semibold [&_[data-slot=command-group-heading]]:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function CommandSeparator({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Separator>) {
  return (
    <CommandPrimitive.Separator
      data-slot="command-separator"
      className={cn("-mx-1 h-px bg-border", className)}
      {...props}
    />
  );
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return (
    <CommandPrimitive.Item
      data-slot="command-item"
      className={cn(
        "relative flex cursor-default select-none items-center gap-2 rounded-lg px-2 py-2 text-sm outline-none aria-selected:bg-accent aria-selected:text-accent-foreground data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    >
      {props.children}
    </CommandPrimitive.Item>
  );
}

function CommandShortcut({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="command-shortcut"
      className={cn("ml-auto text-xs tracking-widest text-muted-foreground", className)}
      {...props}
    />
  );
}

export {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
};

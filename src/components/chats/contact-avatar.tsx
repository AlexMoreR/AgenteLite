"use client";

import { useState } from "react";
import { User } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

import { miniaturaDeFoto } from "./miniatura-de-foto";

type ContactAvatarProps = {
  avatarUrl?: string | null;
  label?: string | null;
  className?: string;
  fallbackClassName?: string;
  /** Solo la lista de chats: la foto achicada (96 px) y pedida cuando la fila se va a ver. */
  miniatura?: boolean;
};

/*
  SIN LETRAS NI NUMEROS EN EL CIRCULO (Alex, 10-11-2026: "lista de chats sin brincos"). Antes el
  circulo mostraba las iniciales de color mientras la foto cargaba —o hasta que la foto llegaba
  despues, porque avatarUrl se llena de a poco—, y al aparecer la foto el circulo cambiaba de golpe.
  Ahora, como en WhatsApp: la silueta gris de siempre y la foto encima cuando esta.
*/

/*
  La foto en miniatura de la lista (07-11-2026). Es un <img> comun, encima de la silueta, porque
  el AvatarImage de Base UI descarga la foto ANTES de mostrarla (la precarga en un Image() suelto)
  y con eso su loading="lazy" no sirve: se pedian todas las de la primera pagina juntas.

  Primero la miniatura; si falla, la original; si esa tambien falla, se oculta y quedan las
  silueta. Se monta con key={avatarUrl}: la lista reutiliza filas, y al cambiar la foto de la
  fila el fallo anterior se olvida.
*/
function FotoEnMiniatura({ avatarUrl, alt }: { avatarUrl: string; alt: string }) {
  const chica = miniaturaDeFoto(avatarUrl);
  const [fase, setFase] = useState<"miniatura" | "original" | "rota">("miniatura");

  if (fase === "rota") {
    return null;
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={fase === "miniatura" ? chica : avatarUrl}
      alt={alt}
      loading="lazy"
      decoding="async"
      data-slot="avatar-image"
      className="absolute inset-0 aspect-square size-full rounded-full object-cover"
      // Si la miniatura es la misma direccion (WhatsApp, data:), no se pide dos veces.
      onError={() => setFase(fase === "miniatura" && chica !== avatarUrl ? "original" : "rota")}
    />
  );
}

export function ContactAvatar({
  avatarUrl,
  label,
  className,
  fallbackClassName,
  miniatura = false,
}: ContactAvatarProps) {
  const safeLabel = label?.trim() || "Contacto";

  return (
    <Avatar className={className}>
      {/*
        Ojo (corregido 07-11-2026): el AvatarImage de Base UI descarga la foto antes de mostrarla,
        asi que su loading="lazy" no la deja para despues; solo decoding="async" ayuda. La lista de
        chats usa `miniatura` (FotoEnMiniatura, mas abajo), que si se pide cuando se va a ver.
      */}
      {avatarUrl && !miniatura ? (
        <AvatarImage src={avatarUrl} alt={safeLabel} loading="lazy" decoding="async" />
      ) : null}
      <AvatarFallback className={cn("bg-muted text-muted-foreground", fallbackClassName)}>
        <User className="h-1/2 w-1/2" aria-hidden />
      </AvatarFallback>
      {avatarUrl && miniatura ? <FotoEnMiniatura key={avatarUrl} avatarUrl={avatarUrl} alt={safeLabel} /> : null}
    </Avatar>
  );
}

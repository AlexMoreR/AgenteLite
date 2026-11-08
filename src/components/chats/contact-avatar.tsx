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

// Iniciales del nombre (1-2 letras). Vacío si no hay texto alfabético (p. ej. solo un número).
function getInitials(label?: string | null): string {
  const trimmed = (label ?? "").trim();
  if (!trimmed || !/[a-zA-ZÀ-ÿ]/.test(trimmed)) {
    return "";
  }
  const parts = trimmed.split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? "";
  const second = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return (first + second).toUpperCase();
}

// Color determinístico a partir del nombre: el mismo contacto siempre tiene el mismo color.
function getAvatarColor(label?: string | null): string {
  const key = (label ?? "").trim() || "?";
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) | 0;
  }
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 45%)`;
}

/*
  La foto en miniatura de la lista (07-11-2026). Es un <img> comun, encima de las iniciales, porque
  el AvatarImage de Base UI descarga la foto ANTES de mostrarla (la precarga en un Image() suelto)
  y con eso su loading="lazy" no sirve: se pedian todas las de la primera pagina juntas.

  Primero la miniatura; si falla, la original; si esa tambien falla, se oculta y quedan las
  iniciales. Se monta con key={avatarUrl}: la lista reutiliza filas, y al cambiar la foto de la
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
  const initials = getInitials(label);

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
      <AvatarFallback
        className={cn(
          initials ? "font-semibold text-white" : "bg-muted text-muted-foreground",
          fallbackClassName,
        )}
        style={initials ? { backgroundColor: getAvatarColor(label), color: "#fff" } : undefined}
      >
        {initials ? initials : <User className="h-1/2 w-1/2" aria-hidden />}
      </AvatarFallback>
      {avatarUrl && miniatura ? <FotoEnMiniatura key={avatarUrl} avatarUrl={avatarUrl} alt={safeLabel} /> : null}
    </Avatar>
  );
}

"use client";

import { User } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

type ContactAvatarProps = {
  avatarUrl?: string | null;
  label?: string | null;
  className?: string;
  fallbackClassName?: string;
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

export function ContactAvatar({
  avatarUrl,
  label,
  className,
  fallbackClassName,
}: ContactAvatarProps) {
  const safeLabel = label?.trim() || "Contacto";
  const initials = getInitials(label);

  return (
    <Avatar className={className}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={safeLabel} /> : null}
      <AvatarFallback
        className={cn(
          initials ? "font-semibold text-white" : "bg-muted text-muted-foreground",
          fallbackClassName,
        )}
        style={initials ? { backgroundColor: getAvatarColor(label), color: "#fff" } : undefined}
      >
        {initials ? initials : <User className="h-1/2 w-1/2" aria-hidden />}
      </AvatarFallback>
    </Avatar>
  );
}

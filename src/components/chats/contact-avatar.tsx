"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function getAvatarInitials(label?: string | null) {
  const parts = (label ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
}

type ContactAvatarProps = {
  avatarUrl?: string | null;
  label?: string | null;
  className?: string;
  fallbackClassName?: string;
};

export function ContactAvatar({
  avatarUrl,
  label,
  className,
  fallbackClassName,
}: ContactAvatarProps) {
  const safeLabel = label?.trim() || "Contacto";

  return (
    <Avatar className={className}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={safeLabel} /> : null}
      <AvatarFallback className={fallbackClassName}>{getAvatarInitials(safeLabel)}</AvatarFallback>
    </Avatar>
  );
}

"use client";

import { User } from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

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
      <AvatarFallback className={fallbackClassName ?? "bg-muted text-muted-foreground"}>
        <User className="h-1/2 w-1/2" aria-hidden />
      </AvatarFallback>
    </Avatar>
  );
}

"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

function getAvatarInitials(label: string) {
  const parts = label
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  const initials = parts.map((part) => part.charAt(0).toUpperCase()).join("");
  return initials || "CT";
}

type ContactAvatarProps = {
  avatarUrl?: string | null;
  label: string;
  className?: string;
  fallbackClassName?: string;
};

export function ContactAvatar({
  avatarUrl,
  label,
  className,
  fallbackClassName,
}: ContactAvatarProps) {
  return (
    <Avatar className={className}>
      {avatarUrl ? <AvatarImage src={avatarUrl} alt={label} /> : null}
      <AvatarFallback className={fallbackClassName}>{getAvatarInitials(label)}</AvatarFallback>
    </Avatar>
  );
}

import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

export function BaseNode({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-slate-200 bg-white shadow-[0_18px_40px_-28px_rgba(15,23,42,0.35)]",
        className,
      )}
      {...props}
    />
  );
}

export function BaseNodeHeader({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 border-b border-slate-200 px-4 py-3", className)}
      {...props}
    />
  );
}

export function BaseNodeHeaderTitle({
  className,
  ...props
}: ComponentPropsWithoutRef<"h4">) {
  return (
    <h4
      className={cn("text-sm font-semibold leading-5 text-slate-900", className)}
      {...props}
    />
  );
}

export function BaseNodeContent({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("space-y-2 px-4 py-3", className)}
      {...props}
    />
  );
}

export function BaseNodeFooter({
  className,
  ...props
}: ComponentPropsWithoutRef<"div">) {
  return (
    <div
      className={cn("border-t border-slate-200 px-4 py-2.5", className)}
      {...props}
    />
  );
}

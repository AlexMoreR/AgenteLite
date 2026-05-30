"use client";

import * as React from "react";
import { Combobox as ComboboxPrimitive } from "@base-ui/react/combobox";
import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type ComboboxProps<Item> = React.ComponentProps<typeof ComboboxPrimitive.Root<Item, false>> & {
  items: Item[];
};

function Combobox<Item>({ items, children, ...props }: ComboboxProps<Item>) {
  return (
    <ComboboxPrimitive.Root items={items} {...props}>
      {children}
    </ComboboxPrimitive.Root>
  );
}

function ComboboxContent({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Popup>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner className="z-[60]">
        <ComboboxPrimitive.Popup
          className={cn(
            "pointer-events-auto w-(--anchor-width) max-h-(--available-height) overflow-hidden rounded-xl border border-slate-200 bg-white shadow-[0_24px_60px_-36px_rgba(15,23,42,0.25)] outline-none",
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxEmpty({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Empty>) {
  return <ComboboxPrimitive.Empty className={cn("sr-only", className)} {...props} />;
}

function ComboboxInput({ className, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Input>) {
  return (
    <ComboboxPrimitive.Input
      className={cn(
        "h-11 w-full rounded-xl border border-slate-200 bg-white px-3.5 text-sm text-slate-900 outline-none placeholder:text-slate-400",
        className,
      )}
      {...props}
    />
  );
}

type ComboboxListProps = React.ComponentProps<typeof ComboboxPrimitive.List>;

function ComboboxList({ className, ...props }: ComboboxListProps) {
  return <ComboboxPrimitive.List className={cn("max-h-72 overflow-y-auto p-0", className)} {...props} />;
}

function ComboboxItem({ className, children, ...props }: React.ComponentProps<typeof ComboboxPrimitive.Item>) {
  return (
    <ComboboxPrimitive.Item
      className={cn(
        "flex cursor-default items-center gap-2 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none aria-selected:bg-slate-50 aria-selected:text-slate-950 data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50",
        className,
      )}
      {...props}
    >
      <span className="flex-1">{children}</span>
      <ComboboxPrimitive.ItemIndicator>
        <CheckIcon className="size-4 text-[var(--primary)]" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

export { Combobox, ComboboxContent, ComboboxEmpty, ComboboxInput, ComboboxItem, ComboboxList };

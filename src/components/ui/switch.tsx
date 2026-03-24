"use client";

import * as React from "react";
import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/utils";

const Switch = React.forwardRef<
  React.ElementRef<typeof SwitchPrimitive.Root>,
  React.ComponentPropsWithoutRef<typeof SwitchPrimitive.Root>
>(({ className, ...props }, ref) => (
  <SwitchPrimitive.Root
    ref={ref}
    className={cn(
      "peer inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent bg-slate-300 shadow-[inset_0_1px_2px_rgba(15,23,42,0.12)] outline-none transition-[background-color,box-shadow,transform] duration-200 ease-out data-[state=checked]:bg-[var(--primary)] data-[state=checked]:shadow-[0_10px_20px_-16px_color-mix(in_srgb,var(--primary)_85%,black)] focus-visible:ring-4 focus-visible:ring-[color-mix(in_srgb,var(--primary)_18%,white)] disabled:cursor-not-allowed disabled:opacity-50 group-active:scale-[0.96]",
      className,
    )}
    {...props}
  >
    <SwitchPrimitive.Thumb
      className={cn(
        "pointer-events-none block h-6 w-6 translate-x-0.5 rounded-full bg-white shadow-[0_4px_14px_-6px_rgba(15,23,42,0.45)] transition-[transform,scale,box-shadow] duration-200 [transition-timing-function:cubic-bezier(0.22,1,0.36,1)] will-change-transform data-[state=checked]:translate-x-5 group-active:scale-90 data-[state=checked]:shadow-[0_6px_18px_-8px_rgba(15,23,42,0.38)]"
      )}
    />
  </SwitchPrimitive.Root>
));
Switch.displayName = SwitchPrimitive.Root.displayName;

export { Switch };

"use client";

import { useState } from "react";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import { Switch } from "@/components/ui/switch";
import { buildDefaultNewCustomerWelcomeMessage } from "@/lib/agent-training";
import { Field } from "@base-ui/react/field";
import { FieldLabel } from "../ui/field";

type NewCustomerWelcomeFieldProps = {
  businessName: string;
  defaultChecked: boolean;
  defaultMessage: string;
};

export function NewCustomerWelcomeField({
  businessName,
  defaultChecked,
  defaultMessage,
}: NewCustomerWelcomeFieldProps) {
  const [enabled, setEnabled] = useState(defaultChecked);
  const [message, setMessage] = useState(
    defaultMessage.trim() || buildDefaultNewCustomerWelcomeMessage(businessName),
  );

  return (
    <div className="space-y-3.5">
      <label
        data-autosave-trigger="true"
        className="group flex cursor-pointer px-2 items-center justify-between"
      >
        <span className="">
          <span className="inline-flex items-center gap-1.5 text-[13px]">
            Saludar
            <TrainingHelpPopover
              title="Saludar a cliente nuevo"
              description="Si lo activas, el primer mensaje para cada cliente nuevo usara este saludo de bienvenida antes de continuar la conversacion."
            />
          </span>
        </span>
        <span className="relative shrink-0">
          <Switch
            name="greetNewCustomers"
            checked={enabled}
            onCheckedChange={setEnabled}
            aria-label="Saludar a cliente nuevo"
            className=""
          />
        </span>
      </label>

      {enabled ? (
        <label className="block space-y-2">
          <textarea
            name="customWelcomeMessage"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={buildDefaultNewCustomerWelcomeMessage(businessName)}
            className="flex min-h-20 w-full rounded-xl border border-border bg-background px-3.5 py-3 text-[13px] leading-4 text-foreground outline-none transition placeholder:text-muted-foreground focus:border-primary"
          />
        </label>
      ) : (
        <input type="hidden" name="customWelcomeMessage" value="" />
      )}
    </div>
  );
}

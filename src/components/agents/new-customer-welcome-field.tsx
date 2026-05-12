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
            className="flex min-h-[80px] w-full rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white px-3.5 py-3 text-[13px] leading-4 text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)] outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
          />
        </label>
      ) : (
        <input type="hidden" name="customWelcomeMessage" value="" />
      )}
    </div>
  );
}

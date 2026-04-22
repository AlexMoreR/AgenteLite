"use client";

import { useState } from "react";
import { TrainingHelpPopover } from "@/components/agents/training-help-popover";
import { Switch } from "@/components/ui/switch";
import { buildDefaultNewCustomerWelcomeMessage } from "@/lib/agent-training";

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
        className="group flex min-h-14 cursor-pointer items-center justify-between gap-3 rounded-[18px] border border-[rgba(148,163,184,0.14)] bg-[linear-gradient(180deg,#ffffff_0%,#fbfcfd_100%)] px-3.5 py-3 transition-[border-color,box-shadow,transform] duration-200 ease-out hover:border-[color-mix(in_srgb,var(--primary)_34%,white)] hover:shadow-[0_18px_32px_-28px_rgba(15,23,42,0.26)] active:scale-[0.997]"
      >
        <span className="min-w-0 space-y-0.5">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold leading-5 text-slate-900">
            <span>Saludar a cliente nuevo</span>
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
            className="h-6 w-11 bg-slate-200 data-[state=checked]:bg-[var(--primary)] data-[state=checked]:shadow-[0_8px_18px_-14px_color-mix(in_srgb,var(--primary)_88%,black)]"
          />
        </span>
      </label>

      {enabled ? (
        <label className="block space-y-2">
          <span className="inline-flex items-center gap-1.5 text-[13px] font-medium text-slate-700">
            <span>Mensaje de bienvenida</span>
            <TrainingHelpPopover
              title="Mensaje de bienvenida"
              description="Este texto se enviara al primer mensaje del cliente nuevo. Puedes editarlo libremente o usar [nombre del negocio] para reemplazarlo automaticamente."
            />
          </span>
          <textarea
            name="customWelcomeMessage"
            rows={4}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder={buildDefaultNewCustomerWelcomeMessage(businessName)}
            className="flex min-h-[126px] w-full rounded-[20px] border border-[rgba(148,163,184,0.14)] bg-white px-3.5 py-3 text-[13px] leading-6 text-slate-800 shadow-[0_18px_32px_-34px_rgba(15,23,42,0.18)] outline-none transition placeholder:text-slate-400 focus:border-[var(--primary)]"
          />
        </label>
      ) : (
        <input type="hidden" name="customWelcomeMessage" value="" />
      )}
    </div>
  );
}

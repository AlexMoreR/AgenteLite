"use client";

import { useEffect, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type FormActionSwitchProps = {
  action: (formData: FormData) => void | Promise<void>;
  checked: boolean;
  ariaLabel: string;
  hiddenFields: Array<{
    name: string;
    value: string;
  }>;
  switchClassName?: string;
  wrapperClassName?: string;
};

export function FormActionSwitch({
  action,
  checked,
  ariaLabel,
  hiddenFields,
  switchClassName,
  wrapperClassName,
}: FormActionSwitchProps) {
  const [optimisticChecked, setOptimisticChecked] = useState(checked);

  useEffect(() => {
    setOptimisticChecked(checked);
  }, [checked]);

  const submitToggle = async () => {
    const formData = new FormData();
    for (const field of hiddenFields) {
      formData.append(field.name, field.value);
    }

    await action(formData);
  };

  return (
    <div className={cn("inline-flex", wrapperClassName)}>
      <Switch
        checked={optimisticChecked}
        onCheckedChange={() => {
          setOptimisticChecked((current) => !current);
          void submitToggle();
        }}
        aria-label={ariaLabel}
        className={switchClassName}
      />
    </div>
  );
}

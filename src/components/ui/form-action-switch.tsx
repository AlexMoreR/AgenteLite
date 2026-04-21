"use client";

import { useEffect, useRef, useState } from "react";
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
  const formRef = useRef<HTMLFormElement>(null);
  const [optimisticChecked, setOptimisticChecked] = useState(checked);

  useEffect(() => {
    setOptimisticChecked(checked);
  }, [checked]);

  return (
    <form ref={formRef} action={action} className={cn("inline-flex", wrapperClassName)}>
      {hiddenFields.map((field) => (
        <input key={field.name} type="hidden" name={field.name} value={field.value} />
      ))}
      <Switch
        checked={optimisticChecked}
        onCheckedChange={() => {
          setOptimisticChecked((current) => !current);
          formRef.current?.requestSubmit();
        }}
        aria-label={ariaLabel}
        className={switchClassName}
      />
    </form>
  );
}

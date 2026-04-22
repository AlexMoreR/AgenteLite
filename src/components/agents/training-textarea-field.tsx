"use client";

import { useState } from "react";

type TrainingTextareaFieldProps = {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  minLength?: number;
  required?: boolean;
};

export function TrainingTextareaField({
  name,
  defaultValue = "",
  placeholder,
  rows = 4,
  className,
  minLength,
  required,
}: TrainingTextareaFieldProps) {
  const [value, setValue] = useState(defaultValue);

  return (
    <textarea
      name={name}
      rows={rows}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      placeholder={placeholder}
      minLength={minLength}
      required={required}
      className={className}
    />
  );
}

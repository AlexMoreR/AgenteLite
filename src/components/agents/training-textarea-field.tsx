"use client";

type TrainingTextareaFieldProps = {
  name: string;
  defaultValue?: string;
  placeholder?: string;
  rows?: number;
  className?: string;
  minLength?: number;
  maxLength?: number;
  required?: boolean;
};

export function TrainingTextareaField({
  name,
  defaultValue = "",
  placeholder,
  rows = 4,
  className,
  minLength,
  maxLength,
  required,
}: TrainingTextareaFieldProps) {
  return (
    <textarea
      name={name}
      rows={rows}
      defaultValue={defaultValue}
      placeholder={placeholder}
      minLength={minLength}
      maxLength={maxLength}
      required={required}
      className={className}
    />
  );
}

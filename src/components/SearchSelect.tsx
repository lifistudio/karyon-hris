"use client";

import React, { useId } from "react";
import { Combobox } from "@/components/ui/Combobox";

interface SearchSelectProps {
  label: string;
  value: string;
  onChange: (val: string) => void;
  options: { label: string; value: string; hint?: string }[];
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
}

/**
 * Labelled dropdown for the older admin forms.
 *
 * Once its own implementation — with a text "▼" for an arrow, a panel that a
 * modal could clip, and no keyboard support. It now delegates to the shared
 * `Combobox`, so these forms behave exactly like every other dropdown; only
 * the label above it is added here.
 */
export default function SearchSelect({
  label,
  value,
  onChange,
  options,
  placeholder = "Pilih…",
  disabled = false,
  required,
}: SearchSelectProps) {
  const id = useId();
  return (
    <div className="w-full space-y-2">
      <label htmlFor={id} className="block text-body-sm font-medium text-foreground">
        {label}
        {required && <span className="text-danger"> *</span>}
      </label>
      <Combobox
        id={id}
        value={value}
        onChange={onChange}
        options={options}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        sheetTitle={label}
      />
    </div>
  );
}

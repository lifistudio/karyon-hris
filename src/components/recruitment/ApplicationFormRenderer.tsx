"use client";

import React from "react";
import { Check } from "@/components/icons";
import { Field, Input, Textarea, cn } from "@/components/ui";
import { Combobox } from "@/components/ui/Combobox";
import { DatePicker } from "@/components/ui/DatePicker";
import {
  FileOrLinkInput,
  attachmentProblem,
  toAttachmentInputs,
  type AttachmentItem,
} from "@/components/ui/FileOrLinkInput";
import type { AddressValue, FieldOption, FieldType } from "@/lib/hr/application-form";

/** A field as the renderer needs it — the public shape from the API. */
export interface RenderField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
  section: string;
  placeholder: string;
  helpText: string;
  options: FieldOption[];
  maxFiles: number;
  allowLink: boolean;
}

export type FormValues = Record<string, unknown>;
export type FormErrors = Record<string, string>;

export const PROVINCES = [
  "Aceh", "Sumatera Utara", "Sumatera Barat", "Riau", "Kepulauan Riau", "Jambi", "Sumatera Selatan",
  "Kepulauan Bangka Belitung", "Bengkulu", "Lampung", "DKI Jakarta", "Jawa Barat", "Banten", "Jawa Tengah",
  "DI Yogyakarta", "Jawa Timur", "Bali", "Nusa Tenggara Barat", "Nusa Tenggara Timur", "Kalimantan Barat",
  "Kalimantan Tengah", "Kalimantan Selatan", "Kalimantan Timur", "Kalimantan Utara", "Sulawesi Utara",
  "Gorontalo", "Sulawesi Tengah", "Sulawesi Barat", "Sulawesi Selatan", "Sulawesi Tenggara", "Maluku",
  "Maluku Utara", "Papua", "Papua Barat", "Papua Barat Daya", "Papua Selatan", "Papua Tengah", "Papua Pegunungan",
].map((p) => ({ value: p, label: p }));

const EMPTY_ADDRESS: AddressValue = { street: "", city: "", province: "", postalCode: "" };

/** Starting value for every field, so inputs are controlled from the first render. */
export function initialValues(fields: RenderField[]): FormValues {
  const values: FormValues = {};
  for (const f of fields) {
    switch (f.type) {
      case "file":
      case "multi_select":
        values[f.key] = [];
        break;
      case "number":
      case "currency":
      case "yes_no":
        values[f.key] = null;
        break;
      case "address":
        values[f.key] = { ...EMPTY_ADDRESS };
        break;
      default:
        values[f.key] = "";
    }
  }
  return values;
}

/**
 * Checks what can be checked in the browser and builds the payload.
 *
 * The server validates again against the stored definition; this pass exists so
 * the candidate sees every problem at once, next to the field, instead of one
 * toast at a time.
 */
export function prepareAnswers(fields: RenderField[], values: FormValues) {
  const errors: FormErrors = {};
  const answers: Record<string, unknown> = {};

  for (const f of fields) {
    const v = values[f.key];
    switch (f.type) {
      case "file": {
        const items = (v as AttachmentItem[]) ?? [];
        const problem = attachmentProblem(items);
        if (problem) errors[f.key] = problem;
        else if (f.required && !items.length) errors[f.key] = `${f.label} wajib dilampirkan.`;
        answers[f.key] = toAttachmentInputs(items);
        break;
      }
      case "multi_select": {
        const arr = (v as string[]) ?? [];
        if (f.required && !arr.length) errors[f.key] = `Pilih minimal satu untuk ${f.label}.`;
        answers[f.key] = arr;
        break;
      }
      case "number":
      case "currency":
      case "yes_no": {
        if (f.required && (v === null || v === undefined)) errors[f.key] = `${f.label} wajib diisi.`;
        answers[f.key] = v ?? null;
        break;
      }
      case "address": {
        const a = (v as AddressValue) ?? EMPTY_ADDRESS;
        if (f.required && (!a.street.trim() || !a.city.trim())) errors[f.key] = `${f.label}: isi minimal jalan dan kota.`;
        if (a.postalCode && !/^\d{5}$/.test(a.postalCode)) errors[f.key] = "Kode pos terdiri dari 5 angka.";
        answers[f.key] = a;
        break;
      }
      default: {
        const s = String(v ?? "").trim();
        if (f.required && !s) {
          errors[f.key] = `${f.label} wajib diisi.`;
        } else if (s && f.type === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) {
          errors[f.key] = `${f.label} tidak valid.`;
        } else if (s && f.type === "phone" && !/^[0-9+()\-\s]{8,20}$/.test(s)) {
          errors[f.key] = `${f.label} tidak valid. Gunakan angka, contoh 0812 3456 7890.`;
        } else if (s && f.type === "url" && !/^https?:\/\/\S+\.\S+/.test(s)) {
          errors[f.key] = `${f.label} harus diawali https://`;
        }
        answers[f.key] = s;
      }
    }
  }
  return { answers, errors };
}

/** Groups fields by section, keeping the order HR arranged them in. */
function sections(fields: RenderField[]) {
  const groups: Array<{ title: string; fields: RenderField[] }> = [];
  for (const f of fields) {
    const title = f.section || "Lainnya";
    const last = groups[groups.length - 1];
    if (last && last.title === title) last.fields.push(f);
    else groups.push({ title, fields: [f] });
  }
  return groups;
}

/** Fields that read better at half width on larger screens. */
const HALF: FieldType[] = ["email", "phone", "number", "currency", "date", "select", "yes_no"];

export function ApplicationFormRenderer({
  fields,
  values,
  onChange,
  errors,
  vacancySlug,
  disabled,
  idPrefix = "af",
}: {
  fields: RenderField[];
  values: FormValues;
  onChange: (key: string, value: unknown) => void;
  errors: FormErrors;
  /** Public page: uploads go to the anonymous endpoint for this vacancy. */
  vacancySlug?: string;
  disabled?: boolean;
  idPrefix?: string;
}) {
  return (
    <div className="space-y-8">
      {sections(fields).map((group, gi) => (
        <fieldset key={`${group.title}-${gi}`} className="space-y-5" disabled={disabled}>
          <legend className="eyebrow mb-4">{group.title}</legend>
          <div className="grid sm:grid-cols-2 gap-x-4 gap-y-5">
            {group.fields.map((f) => (
              <div key={f.key} className={HALF.includes(f.type) ? "" : "sm:col-span-2"} data-field={f.key}>
                <FieldControl
                  field={f}
                  value={values[f.key]}
                  onChange={(v) => onChange(f.key, v)}
                  error={errors[f.key]}
                  id={`${idPrefix}-${f.key}`}
                  vacancySlug={vacancySlug}
                  disabled={disabled}
                />
              </div>
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  );
}

function FieldControl({
  field: f,
  value,
  onChange,
  error,
  id,
  vacancySlug,
  disabled,
}: {
  field: RenderField;
  value: unknown;
  onChange: (value: unknown) => void;
  error?: string;
  id: string;
  vacancySlug?: string;
  disabled?: boolean;
}) {
  const invalid = Boolean(error);
  const common = { label: f.label, required: f.required, error, hint: f.helpText || undefined };
  const invalidCls = invalid ? "border-danger focus:border-danger" : "";

  switch (f.type) {
    case "long_text":
      return (
        <Field {...common} htmlFor={id}>
          <Textarea
            id={id}
            value={String(value ?? "")}
            maxLength={5000}
            placeholder={f.placeholder}
            aria-invalid={invalid}
            className={invalidCls}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    case "number":
    case "currency": {
      const n = typeof value === "number" ? value : null;
      return (
        <Field {...common} htmlFor={id}>
          <div className="relative">
            {f.type === "currency" && (
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-body-sm text-subtle pointer-events-none">Rp</span>
            )}
            <Input
              id={id}
              inputMode="numeric"
              placeholder={f.placeholder}
              aria-invalid={invalid}
              className={cn(invalidCls, f.type === "currency" && "pl-10 tabular-nums")}
              value={n === null ? "" : f.type === "currency" ? n.toLocaleString("id-ID") : String(n)}
              onChange={(e) => {
                const digits = e.target.value.replace(/\D/g, "").slice(0, 13);
                onChange(digits ? Number(digits) : null);
              }}
            />
          </div>
        </Field>
      );
    }

    case "date":
      return (
        <Field {...common} htmlFor={id}>
          <DatePicker id={id} value={String(value ?? "")} onChange={onChange} clearable={!f.required} disabled={disabled} />
        </Field>
      );

    case "select":
      return (
        <Field {...common} htmlFor={id}>
          <Combobox
            id={id}
            value={String(value ?? "")}
            onChange={onChange}
            options={f.options}
            placeholder={f.placeholder || "Pilih…"}
            clearable={!f.required}
            disabled={disabled}
            sheetTitle={f.label}
          />
        </Field>
      );

    case "radio":
    case "multi_select": {
      const multi = f.type === "multi_select";
      const selected = multi ? ((value as string[]) ?? []) : [String(value ?? "")];
      return (
        <Field {...common}>
          <div role={multi ? "group" : "radiogroup"} aria-label={f.label} className="grid sm:grid-cols-2 gap-2">
            {f.options.map((o) => {
              const on = selected.includes(o.value);
              return (
                <button
                  key={o.value}
                  type="button"
                  role={multi ? "checkbox" : "radio"}
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() =>
                    onChange(
                      multi
                        ? on
                          ? selected.filter((x) => x !== o.value)
                          : [...selected, o.value]
                        : on && !f.required
                          ? ""
                          : o.value
                    )
                  }
                  className={cn(
                    "flex items-center gap-3 min-h-11 px-3.5 py-2.5 rounded-[var(--radius-control)] border text-left text-body-sm transition-colors cursor-pointer",
                    on ? "border-primary bg-primary-soft text-foreground" : "border-line hover:bg-surface-2 text-foreground/90",
                    invalid && !on && "border-danger/60"
                  )}
                >
                  <span
                    className={cn(
                      "grid place-items-center w-[18px] h-[18px] shrink-0 border transition-colors",
                      multi ? "rounded-[5px]" : "rounded-full",
                      on ? "border-primary bg-primary text-primary-foreground" : "border-line-strong bg-surface"
                    )}
                    aria-hidden
                  >
                    {on && (multi ? <Check className="w-3 h-3" strokeWidth={3} /> : <span className="w-1.5 h-1.5 rounded-full bg-current" />)}
                  </span>
                  {o.label}
                </button>
              );
            })}
          </div>
        </Field>
      );
    }

    case "yes_no":
      return (
        <Field {...common}>
          <div role="radiogroup" aria-label={f.label} className="grid grid-cols-2 gap-2">
            {[
              { v: true, label: "Ya" },
              { v: false, label: "Tidak" },
            ].map((o) => {
              const on = value === o.v;
              return (
                <button
                  key={o.label}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={disabled}
                  onClick={() => onChange(on && !f.required ? null : o.v)}
                  className={cn(
                    "h-11 rounded-[var(--radius-control)] border text-body-sm font-medium transition-colors cursor-pointer",
                    on ? "border-primary bg-primary-soft text-primary" : "border-line hover:bg-surface-2",
                    invalid && !on && "border-danger/60"
                  )}
                >
                  {o.label}
                </button>
              );
            })}
          </div>
        </Field>
      );

    case "file":
      return (
        <Field {...common} htmlFor={id}>
          <FileOrLinkInput
            id={id}
            value={(value as AttachmentItem[]) ?? []}
            onChange={onChange}
            context="application"
            multiple={f.maxFiles > 1}
            maxFiles={f.maxFiles}
            allowLink={f.allowLink}
            vacancySlug={vacancySlug}
            disabled={disabled}
            invalid={invalid}
          />
        </Field>
      );

    case "address": {
      const a = { ...EMPTY_ADDRESS, ...((value as AddressValue) ?? {}) };
      const set = (patch: Partial<AddressValue>) => onChange({ ...a, ...patch });
      return (
        <Field {...common} htmlFor={`${id}-street`}>
          <div className="space-y-3">
            <Textarea
              id={`${id}-street`}
              rows={2}
              maxLength={300}
              placeholder="Nama jalan, nomor rumah, RT/RW, kelurahan, kecamatan"
              aria-invalid={invalid}
              className={cn("min-h-0", invalidCls)}
              value={a.street}
              onChange={(e) => set({ street: e.target.value })}
            />
            <div className="grid sm:grid-cols-[1fr_1fr_120px] gap-3">
              <Input
                aria-label="Kota / kabupaten"
                placeholder="Kota / kabupaten"
                maxLength={100}
                value={a.city}
                className={invalid && !a.city ? "border-danger" : ""}
                onChange={(e) => set({ city: e.target.value })}
              />
              <Combobox
                aria-label="Provinsi"
                value={a.province}
                onChange={(province) => set({ province })}
                options={PROVINCES}
                placeholder="Provinsi"
                clearable
                disabled={disabled}
              />
              <Input
                aria-label="Kode pos"
                placeholder="Kode pos"
                inputMode="numeric"
                maxLength={5}
                value={a.postalCode}
                onChange={(e) => set({ postalCode: e.target.value.replace(/\D/g, "") })}
              />
            </div>
          </div>
        </Field>
      );
    }

    default: {
      const inputType = f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "url" ? "url" : "text";
      const autoComplete =
        f.key === "name" ? "name" : f.type === "email" ? "email" : f.type === "phone" ? "tel" : f.type === "url" ? "url" : undefined;
      return (
        <Field {...common} htmlFor={id}>
          <Input
            id={id}
            type={inputType}
            inputMode={f.type === "phone" ? "tel" : f.type === "email" ? "email" : undefined}
            autoComplete={autoComplete}
            maxLength={200}
            placeholder={f.placeholder || (f.type === "url" ? "https://" : undefined)}
            aria-invalid={invalid}
            className={invalidCls}
            value={String(value ?? "")}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );
    }
  }
}

/** Scrolls to and focuses the first field with an error. */
export function focusFirstError(errors: FormErrors, fields: RenderField[]) {
  const first = fields.find((f) => errors[f.key]);
  if (!first) return;
  const el = document.querySelector<HTMLElement>(`[data-field="${first.key}"]`);
  el?.scrollIntoView({ behavior: "smooth", block: "center" });
  const focusable = el?.querySelector<HTMLElement>("input:not([type=hidden]), textarea, button");
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 250);
}

/** Server-side field errors from a 400 response, keyed like `FormErrors`. */
export function serverFieldErrors(details: unknown): FormErrors {
  const list = (details as { fields?: Array<{ field: string; message: string }> } | null)?.fields ?? [];
  const errors: FormErrors = {};
  for (const e of list) if (e.field && !errors[e.field]) errors[e.field] = e.message;
  return errors;
}

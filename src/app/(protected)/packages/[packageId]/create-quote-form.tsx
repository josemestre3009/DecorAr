"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { MAX_CONDITIONS_LENGTH, MAX_QUOTE_CLIENT_NAME_LENGTH } from "@/modules/quotes/domain/quote-terms";

import { parsePercentToBp, todayInBogota } from "../../quotes/_lib/quote-format";
import { createHttpQuotesClient, type QuotesClient } from "../../quotes/_lib/quotes-client";

type CreateQuoteFormProps = {
  readonly packageId: string;
  /** Cliente del evento, como valor inicial editable. */
  readonly clientName: string | null;
  /** Inyectable para las pruebas. */
  readonly client?: QuotesClient;
  /** Inyectable para las pruebas; por defecto la fecha de hoy en Colombia. */
  readonly today?: string;
  /**
   * Sin elementos no hay nada que cotizar (el servidor respondería
   * `quote.empty_package`): se muestra el aviso en lugar del formulario (DECOR-49).
   */
  readonly hasItems?: boolean;
};

type FieldErrors = Partial<Record<"validUntil" | "taxRate" | "discountRate" | "depositRate", string>>;

/** Propuesta DECOR-51 (a confirmar): IVA general de Colombia como valor inicial. */
const DEFAULT_TAX_PERCENT = "19";

/**
 * "Generar cotización" (DECOR-51): formulario mínimo con los términos
 * comerciales que pide la API de DECOR-50. El servidor congela precios y
 * calcula totales; al crearla se abre su vista previa.
 */
export function CreateQuoteForm({ packageId, clientName, client, today, hasItems = true }: CreateQuoteFormProps) {
  const router = useRouter();
  const quotes = useMemo(() => client ?? createHttpQuotesClient(), [client]);
  const minDate = today ?? todayInBogota();
  const [open, setOpen] = useState(false);
  const [clientInput, setClientInput] = useState(clientName ?? "");
  const [validUntil, setValidUntil] = useState("");
  const [taxRate, setTaxRate] = useState(DEFAULT_TAX_PERCENT);
  const [discountRate, setDiscountRate] = useState("0");
  const [depositRate, setDepositRate] = useState("0");
  const [conditions, setConditions] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) firstFieldRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    setErrors({});
    setFormError(undefined);
    toggleRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;

    const nextErrors: FieldErrors = {};
    if (!validUntil) nextErrors.validUntil = "La vigencia es obligatoria.";
    else if (validUntil < minDate) nextErrors.validUntil = "La vigencia no puede ser una fecha pasada.";

    const tax = parsePercentToBp(taxRate, "El impuesto", null);
    if (!tax.ok) nextErrors.taxRate = tax.error;
    const discount = parsePercentToBp(discountRate, "El descuento", 0);
    if (!discount.ok) nextErrors.discountRate = discount.error;
    const deposit = parsePercentToBp(depositRate, "El anticipo", 0);
    if (!deposit.ok) nextErrors.depositRate = deposit.error;

    setErrors(nextErrors);
    setFormError(undefined);
    if (Object.keys(nextErrors).length > 0 || !tax.ok || !discount.ok || !deposit.ok) return;

    setPending(true);

    const result = await quotes.createQuote(packageId, {
      clientName: clientInput.trim() || null,
      conditions: conditions.trim() || null,
      depositRateBp: deposit.value,
      discountRateBp: discount.value,
      taxRateBp: tax.value,
      validUntil,
    });

    if (result.ok) {
      router.push(`/quotes/${encodeURIComponent(result.value.id)}`);
      return;
    }

    setPending(false);

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setFormError(result.error.message);
  }

  const describedBy = (field: keyof FieldErrors) => (errors[field] ? `quote-${field}-error` : undefined);

  return (
    <section aria-labelledby="create-quote-title" className="configurator-card">
      <div className="section-header">
        <h2 className="section-title" id="create-quote-title">
          Cotización
        </h2>
        {hasItems ? (
          <button
            aria-expanded={open}
            className="secondary-button"
            onClick={() => (open ? close() : setOpen(true))}
            ref={toggleRef}
            type="button"
          >
            {open ? "Cerrar" : "Generar cotización"}
          </button>
        ) : null}
      </div>

      {hasItems ? (
        <p className="content-hint">
          Congela los precios actuales del evento y abre una vista previa para revisarla antes del PDF.
        </p>
      ) : (
        <p className="content-hint">
          Agrega al menos un elemento del catálogo para poder cotizar.{" "}
          <a className="secondary-link" href="#catalogo">
            Ir al catálogo
          </a>
        </p>
      )}

      {open && hasItems ? (
        <form aria-label="Generar cotización" className="auth-form" noValidate onSubmit={handleSubmit}>
          <div className="quote-form-grid">
            <div className="auth-field">
              <label className="auth-label" htmlFor="quote-client-name">
                Cliente (opcional)
              </label>
              <input
                className="auth-input"
                id="quote-client-name"
                maxLength={MAX_QUOTE_CLIENT_NAME_LENGTH}
                onChange={(change) => setClientInput(change.target.value)}
                ref={firstFieldRef}
                type="text"
                value={clientInput}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="quote-valid-until">
                Válida hasta
              </label>
              <input
                aria-describedby={describedBy("validUntil")}
                aria-invalid={errors.validUntil ? true : undefined}
                className="auth-input"
                id="quote-valid-until"
                min={minDate}
                onChange={(change) => setValidUntil(change.target.value)}
                required
                type="date"
                value={validUntil}
              />
              {errors.validUntil ? (
                <p className="auth-error" id="quote-validUntil-error" role="alert">
                  {errors.validUntil}
                </p>
              ) : null}
            </div>

            <PercentField
              error={errors.taxRate}
              id="taxRate"
              label="Impuestos (IVA) %"
              onChange={setTaxRate}
              required
              value={taxRate}
            />
            <PercentField
              error={errors.discountRate}
              id="discountRate"
              label="Descuento %"
              onChange={setDiscountRate}
              value={discountRate}
            />
            <PercentField
              error={errors.depositRate}
              id="depositRate"
              label="Anticipo % (sobre el total)"
              onChange={setDepositRate}
              value={depositRate}
            />
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor="quote-conditions">
              Condiciones (opcional)
            </label>
            <textarea
              className="auth-input"
              id="quote-conditions"
              maxLength={MAX_CONDITIONS_LENGTH}
              onChange={(change) => setConditions(change.target.value)}
              rows={3}
              value={conditions}
            />
          </div>

          {formError ? (
            <p className="auth-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="metadata-actions">
            <button aria-busy={pending} className="auth-submit" disabled={pending} type="submit">
              {pending ? "Generando…" : "Generar y revisar"}
            </button>
            <button className="secondary-button" onClick={close} type="button">
              Cancelar
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

type PercentFieldProps = {
  readonly id: string;
  readonly label: string;
  readonly value: string;
  readonly error?: string;
  readonly required?: boolean;
  readonly onChange: (value: string) => void;
};

function PercentField({ id, label, value, error, required, onChange }: PercentFieldProps) {
  const inputId = `quote-${id}`;
  const errorId = `quote-${id}-error`;

  return (
    <div className="auth-field">
      <label className="auth-label" htmlFor={inputId}>
        {label}
      </label>
      <input
        aria-describedby={error ? errorId : undefined}
        aria-invalid={error ? true : undefined}
        className="auth-input"
        id={inputId}
        inputMode="decimal"
        onChange={(change) => onChange(change.target.value)}
        required={required}
        type="text"
        value={value}
      />
      {error ? (
        <p className="auth-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

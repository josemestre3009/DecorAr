"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  getEventTemplatesClient,
  type EventTemplatesClient,
} from "../_lib/event-templates-client";
import { validateTemplateName } from "../_lib/space-definition";

type SaveTemplateButtonProps = {
  readonly packageId: string;
  readonly eventName: string;
  /** Inyectable para las pruebas. */
  readonly client?: EventTemplatesClient;
};

/**
 * "Guardar como plantilla" (DECOR-44): formulario progresivo en línea. Copia la
 * configuración del evento en una plantilla privada sin cliente, fecha ni lugar
 * (la copia la hace la RPC del servidor). Anuncia el resultado y no navega.
 */
export function SaveTemplateButton({ packageId, eventName, client }: SaveTemplateButtonProps) {
  const router = useRouter();
  const templates = client ?? getEventTemplatesClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(`${eventName} (plantilla)`);
  const [error, setError] = useState<string>();
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [open]);

  function close() {
    setOpen(false);
    setError(undefined);
    setFormError(undefined);
    toggleRef.current?.focus();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) return;

    const valid = validateTemplateName(name);
    if (!valid.ok) {
      setError(valid.error);
      setFormError(undefined);
      return;
    }

    setError(undefined);
    setFormError(undefined);
    setPending(true);

    let result: Awaited<ReturnType<EventTemplatesClient["createFromEvent"]>>;

    try {
      result = await templates.createFromEvent(packageId, valid.value);
    } catch {
      setPending(false);
      setFormError("No pudimos guardar la plantilla. Inténtalo de nuevo.");
      return;
    }

    setPending(false);

    if (result.ok) {
      setAnnouncement(`Plantilla "${result.value.name}" guardada.`);
      setOpen(false);
      setName(`${eventName} (plantilla)`);
      // La sección "Plantillas" de /packages se relee al volver a ella; aquí
      // basta con anunciar el resultado.
      router.refresh();
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setFormError(result.error.message);
  }

  return (
    <section aria-labelledby="save-template-title" className="configurator-card">
      <div className="section-header">
        <h2 className="section-title" id="save-template-title">
          Plantilla
        </h2>
        <button
          aria-expanded={open}
          className="secondary-button"
          onClick={() => (open ? close() : setOpen(true))}
          ref={toggleRef}
          type="button"
        >
          {open ? "Cerrar" : "Guardar como plantilla"}
        </button>
      </div>

      <p className="content-hint">
        La plantilla guarda módulos, cantidades, zonas y preferencias. No copia cliente, fecha ni lugar.
      </p>

      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>

      {open ? (
        <form aria-label="Guardar como plantilla" className="auth-form" noValidate onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="template-name">
              Nombre de la plantilla
            </label>
            <input
              aria-describedby={error ? "template-name-error" : undefined}
              aria-invalid={error ? true : undefined}
              className="auth-input"
              id="template-name"
              onChange={(event) => setName(event.target.value)}
              ref={inputRef}
              required
              type="text"
              value={name}
            />
            {error ? (
              <p className="auth-error" id="template-name-error" role="alert">
                {error}
              </p>
            ) : null}
          </div>

          {formError ? (
            <p className="auth-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="metadata-actions">
            <button className="auth-submit" disabled={pending} type="submit">
              {pending ? "Guardando…" : "Guardar plantilla"}
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

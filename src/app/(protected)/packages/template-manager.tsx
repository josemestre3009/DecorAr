"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  getEventTemplatesClient,
  type EventTemplateSummary,
  type EventTemplatesClient,
} from "./_lib/event-templates-client";
import { validateEventName, validateTemplateName } from "./_lib/space-definition";

type TemplateManagerProps = {
  /** Inyectable para las pruebas. */
  readonly client?: EventTemplatesClient;
};

type ListState =
  | { readonly status: "loading" }
  | { readonly status: "error"; readonly message: string }
  | { readonly status: "ready"; readonly templates: readonly EventTemplateSummary[] };

type CardAction = "use" | "rename" | "delete" | null;

/**
 * Plantillas privadas del evento (DECOR-44): usar, renombrar y eliminar con
 * formularios progresivos en línea y anuncios accesibles. Carga la lista desde
 * `/api/event-templates` (o la simulación local).
 */
export function TemplateManager({ client }: TemplateManagerProps) {
  const router = useRouter();
  const templates = client ?? getEventTemplatesClient();
  const [state, setState] = useState<ListState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [announcement, setAnnouncement] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    templates
      .list()
      .then((result) => {
        if (controller.signal.aborted) return;

        if (result.ok) {
          setState({ status: "ready", templates: result.value });
          return;
        }

        if (result.error.kind === "unauthorized") {
          router.push("/login");
          return;
        }

        setState({ message: result.error.message, status: "error" });
      })
      .catch(() => {
        // Una petición cancelada al desmontar o reintentar no cambia la vista.
      });

    return () => controller.abort();
  }, [attempt, router, templates]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }

  return (
    <section aria-labelledby="templates-title" className="package-history templates-history">
      <div className="section-header">
        <h2 className="section-title" id="templates-title">
          Plantillas
        </h2>
        {state.status === "error" ? (
          <button className="secondary-button" onClick={retry} type="button">
            Reintentar
          </button>
        ) : null}
      </div>

      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>

      {state.status === "loading" ? (
        <p className="catalog-state" role="status">
          <span aria-hidden="true" className="spinner" />
          Cargando plantillas…
        </p>
      ) : null}

      {state.status === "error" ? (
        <p className="auth-error" role="alert">
          No pudimos cargar tus plantillas. {state.message}
        </p>
      ) : null}

      {state.status === "ready" && state.templates.length === 0 ? (
        <div className="package-history-empty">
          <p>Aún no tienes plantillas.</p>
          <p>Guarda la configuración de un evento para reutilizarla.</p>
        </div>
      ) : null}

      {state.status === "ready" && state.templates.length > 0 ? (
        <ul className="template-list" role="list">
          {state.templates.map((template) => (
            <li key={template.id}>
              <TemplateCard
                announce={setAnnouncement}
                client={templates}
                onRemoved={(id) =>
                  setState((current) =>
                    current.status === "ready"
                      ? { status: "ready", templates: current.templates.filter((item) => item.id !== id) }
                      : current,
                  )
                }
                onRenamed={(renamed) =>
                  setState((current) =>
                    current.status === "ready"
                      ? {
                          status: "ready",
                          templates: current.templates.map((item) => (item.id === renamed.id ? renamed : item)),
                        }
                      : current,
                  )
                }
                template={template}
              />
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

type TemplateCardProps = {
  readonly template: EventTemplateSummary;
  readonly client: EventTemplatesClient;
  readonly announce: (message: string) => void;
  readonly onRenamed: (template: EventTemplateSummary) => void;
  readonly onRemoved: (id: string) => void;
};

function TemplateCard({ template, client, announce, onRenamed, onRemoved }: TemplateCardProps) {
  const router = useRouter();
  const [action, setAction] = useState<CardAction>(null);
  const [name, setName] = useState(template.name);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const inputRef = useRef<HTMLInputElement>(null);
  const actionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (action === "use" || action === "rename") {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [action]);

  function open(next: Exclude<CardAction, null>, trigger: HTMLButtonElement) {
    actionRef.current = trigger;
    setName(next === "use" ? `${template.name} (evento)` : template.name);
    setError(undefined);
    setAction(next);
  }

  function close() {
    setAction(null);
    setError(undefined);
    actionRef.current?.focus();
  }

  async function submitUse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || action !== "use") return;

    const valid = validateEventName(name);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }

    setError(undefined);
    setPending(true);
    const result = await client.instantiate(template.id, valid.value);
    setPending(false);

    if (result.ok) {
      announce(`Evento "${result.value.name}" creado desde la plantilla "${template.name}".`);
      router.push(`/packages/${encodeURIComponent(result.value.id)}`);
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setError(result.error.message);
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || action !== "rename") return;

    const valid = validateTemplateName(name);
    if (!valid.ok) {
      setError(valid.error);
      return;
    }

    setError(undefined);
    setPending(true);
    const result = await client.rename(template.id, valid.value);
    setPending(false);

    if (result.ok) {
      announce(`Plantilla renombrada a "${result.value.name}".`);
      onRenamed(result.value);
      close();
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setError(result.error.message);
  }

  async function confirmRemove() {
    if (pending) return;

    setPending(true);
    const result = await client.remove(template.id);
    setPending(false);

    if (result.ok) {
      announce(`Plantilla "${template.name}" eliminada.`);
      onRemoved(template.id);
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setError(result.error.message);
  }

  const errorId = `template-${template.id}-error`;

  return (
    <article aria-labelledby={`template-${template.id}-name`} className="template-card">
      <h3 className="template-name" id={`template-${template.id}-name`}>
        {template.name}
      </h3>
      {template.itemCount !== undefined ? (
        <p className="template-meta">
          {template.itemCount === 1 ? "1 elemento" : `${template.itemCount} elementos`}
        </p>
      ) : null}

      {action === null ? (
        <div className="template-actions">
          <button aria-label={`Usar plantilla ${template.name}`} className="auth-submit" onClick={(event) => open("use", event.currentTarget)} type="button">
            Usar
          </button>
          <button
            aria-label={`Renombrar plantilla ${template.name}`}
            className="secondary-button"
            onClick={(event) => open("rename", event.currentTarget)}
            type="button"
          >
            Renombrar
          </button>
          <button
            aria-describedby={error ? errorId : undefined}
            aria-label={`Eliminar plantilla ${template.name}`}
            className="secondary-button template-delete"
            onClick={(event) => open("delete", event.currentTarget)}
            type="button"
          >
            Eliminar
          </button>
        </div>
      ) : null}

      {action === "use" ? (
        <form aria-label={`Crear evento desde ${template.name}`} className="auth-form" noValidate onSubmit={submitUse}>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`template-${template.id}-use-name`}>
              Nombre del evento
            </label>
            <input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              className="auth-input"
              id={`template-${template.id}-use-name`}
              onChange={(event) => setName(event.target.value)}
              ref={inputRef}
              required
              type="text"
              value={name}
            />
          </div>
          <div className="metadata-actions">
            <button className="auth-submit" disabled={pending} type="submit">
              {pending ? "Creando…" : "Crear evento"}
            </button>
            <button className="secondary-button" onClick={close} type="button">
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {action === "rename" ? (
        <form aria-label={`Renombrar ${template.name}`} className="auth-form" noValidate onSubmit={submitRename}>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`template-${template.id}-rename`}>
              Nuevo nombre
            </label>
            <input
              aria-describedby={error ? errorId : undefined}
              aria-invalid={error ? true : undefined}
              className="auth-input"
              id={`template-${template.id}-rename`}
              onChange={(event) => setName(event.target.value)}
              ref={inputRef}
              required
              type="text"
              value={name}
            />
          </div>
          <div className="metadata-actions">
            <button className="auth-submit" disabled={pending} type="submit">
              {pending ? "Guardando…" : "Guardar nombre"}
            </button>
            <button className="secondary-button" onClick={close} type="button">
              Cancelar
            </button>
          </div>
        </form>
      ) : null}

      {action === "delete" ? (
        <div className="template-confirm">
          <p>¿Eliminar la plantilla &quot;{template.name}&quot;? Los eventos creados desde ella no cambian.</p>
          <div className="metadata-actions">
            <button className="auth-submit" disabled={pending} onClick={confirmRemove} type="button">
              {pending ? "Eliminando…" : "Sí, eliminar"}
            </button>
            <button className="secondary-button" onClick={close} type="button">
              Cancelar
            </button>
          </div>
        </div>
      ) : null}

      {error ? (
        <p className="auth-error" id={errorId} role="alert">
          {error}
        </p>
      ) : null}
    </article>
  );
}

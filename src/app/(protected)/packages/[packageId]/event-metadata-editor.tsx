"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import type { PackageDetailView } from "@/modules/packages/application/dtos/package-detail.dto";

import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";
import {
  parseCapacity,
  SPACE_TYPES,
  validateEventName,
  type SpaceType,
} from "../_lib/space-definition";

type EventMetadataEditorProps = {
  readonly packageId: string;
  readonly detail: Pick<
    PackageDetailView,
    "name" | "clientName" | "eventDate" | "venue" | "eventType" | "spaceType" | "capacityM2"
  >;
  /** Inyectable para las pruebas. */
  readonly client?: PackagesClient;
};

type FieldErrors = {
  name?: string;
  capacityM2?: string;
};

/**
 * Edición progresiva de los metadatos del evento (DECOR-44): el formulario se
 * despliega en línea, sin modal. Al guardar hace PATCH y vuelve a leer la
 * página; los errores quedan junto a su campo y el resultado se anuncia.
 */
export function EventMetadataEditor({ packageId, detail, client }: EventMetadataEditorProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(detail.name);
  const [clientName, setClientName] = useState(detail.clientName ?? "");
  const [eventDate, setEventDate] = useState(detail.eventDate ?? "");
  const [venue, setVenue] = useState(detail.venue ?? "");
  const [eventType, setEventType] = useState(detail.eventType ?? "");
  const [spaceType, setSpaceType] = useState<string>(detail.spaceType ?? "");
  const [capacityM2, setCapacityM2] = useState(detail.capacityM2 === null ? "" : String(detail.capacityM2));
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) {
      nameRef.current?.focus();
    }
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

    const validName = validateEventName(name);
    const capacity = capacityM2.trim() === "" ? { ok: true as const, value: null } : parseCapacity(capacityM2);
    const nextErrors: FieldErrors = {};

    if (!validName.ok) nextErrors.name = validName.error;
    if (!capacity.ok) nextErrors.capacityM2 = capacity.error;

    if (Object.keys(nextErrors).length > 0) {
      setErrors(nextErrors);
      setFormError(undefined);
      return;
    }

    if (!validName.ok || !capacity.ok) return;

    setErrors({});
    setFormError(undefined);
    setPending(true);

    let result: Awaited<ReturnType<PackagesClient["updateMetadata"]>>;

    try {
      result = await packages.updateMetadata(packageId, {
        capacityM2: capacity.value,
        clientName: clientName.trim() === "" ? null : clientName.trim(),
        eventDate: eventDate.trim() === "" ? null : eventDate.trim(),
        eventType: eventType.trim() === "" ? null : eventType.trim(),
        name: validName.value,
        spaceType: spaceType === "" ? null : (spaceType as SpaceType),
        venue: venue.trim() === "" ? null : venue.trim(),
      });
    } catch {
      setPending(false);
      setFormError("No pudimos guardar los datos del evento. Inténtalo de nuevo.");
      return;
    }

    setPending(false);

    if (result.ok) {
      setAnnouncement("Datos del evento actualizados.");
      setOpen(false);
      toggleRef.current?.focus();
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
    <section aria-labelledby="event-metadata-title" className="configurator-card">
      <div className="section-header">
        <h2 className="section-title" id="event-metadata-title">
          Editar datos
        </h2>
        <button
          aria-expanded={open}
          className="secondary-button"
          onClick={() => (open ? close() : setOpen(true))}
          ref={toggleRef}
          type="button"
        >
          {open ? "Cerrar" : "Editar datos"}
        </button>
      </div>

      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>

      {open ? (
        <form aria-label="Editar datos del evento" className="auth-form metadata-form" noValidate onSubmit={handleSubmit}>
          <div className="auth-field">
            <label className="auth-label" htmlFor="event-name">
              Nombre
            </label>
            <input
              aria-describedby={errors.name ? "event-name-error" : undefined}
              aria-invalid={errors.name ? true : undefined}
              className="auth-input"
              id="event-name"
              onChange={(event) => setName(event.target.value)}
              ref={nameRef}
              required
              type="text"
              value={name}
            />
            {errors.name ? (
              <p className="auth-error" id="event-name-error" role="alert">
                {errors.name}
              </p>
            ) : null}
          </div>

          <div className="metadata-grid">
            <div className="auth-field">
              <label className="auth-label" htmlFor="event-client">
                Cliente
              </label>
              <input
                className="auth-input"
                id="event-client"
                onChange={(event) => setClientName(event.target.value)}
                type="text"
                value={clientName}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="event-date">
                Fecha
              </label>
              <input
                className="auth-input"
                id="event-date"
                onChange={(event) => setEventDate(event.target.value)}
                type="date"
                value={eventDate}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="event-venue">
                Lugar
              </label>
              <input
                className="auth-input"
                id="event-venue"
                onChange={(event) => setVenue(event.target.value)}
                type="text"
                value={venue}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="event-type">
                Tipo de evento
              </label>
              <input
                className="auth-input"
                id="event-type"
                onChange={(event) => setEventType(event.target.value)}
                type="text"
                value={eventType}
              />
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="event-space">
                Tipo de espacio
              </label>
              <select
                className="auth-input"
                id="event-space"
                onChange={(event) => setSpaceType(event.target.value)}
                value={spaceType}
              >
                <option value="">Sin definir</option>
                {SPACE_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="auth-field">
              <label className="auth-label" htmlFor="event-capacity">
                Área disponible (m²)
              </label>
              <input
                aria-describedby={errors.capacityM2 ? "event-capacity-error" : undefined}
                aria-invalid={errors.capacityM2 ? true : undefined}
                className="auth-input"
                id="event-capacity"
                inputMode="decimal"
                onChange={(event) => setCapacityM2(event.target.value)}
                type="text"
                value={capacityM2}
              />
              {errors.capacityM2 ? (
                <p className="auth-error" id="event-capacity-error" role="alert">
                  {errors.capacityM2}
                </p>
              ) : null}
            </div>
          </div>

          {formError ? (
            <p className="auth-error" role="alert">
              {formError}
            </p>
          ) : null}

          <div className="metadata-actions">
            <button className="auth-submit" disabled={pending} type="submit">
              {pending ? "Guardando…" : "Guardar datos"}
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

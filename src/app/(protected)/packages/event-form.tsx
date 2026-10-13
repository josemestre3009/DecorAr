"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { getPackagesClient, type PackagesClient } from "./_lib/packages-client";
import {
  parseCapacity,
  SPACE_TYPES,
  validateEventName,
  type SpaceType,
} from "./_lib/space-definition";

type EventFormProps = {
  /** Inyectable para las pruebas; en la aplicación se elige según el entorno. */
  readonly client?: PackagesClient;
};

type FieldErrors = {
  name?: string;
  capacityM2?: string;
};

/**
 * Creación rápida de eventos (DECOR-44): solo el nombre es obligatorio. Los
 * datos opcionales (cliente, fecha, lugar, tipo y área) se despliegan en línea y
 * pueden completarse después desde el configurador.
 */
export function EventForm({ client }: EventFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [clientName, setClientName] = useState("");
  const [eventDate, setEventDate] = useState("");
  const [venue, setVenue] = useState("");
  const [eventType, setEventType] = useState("");
  const [spaceType, setSpaceType] = useState<string>("");
  const [capacityM2, setCapacityM2] = useState("");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

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

    let result: Awaited<ReturnType<PackagesClient["createPackage"]>>;

    try {
      result = await (client ?? getPackagesClient()).createPackage({
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
      setFormError("No pudimos crear el evento. Inténtalo de nuevo.");
      return;
    }

    if (result.ok) {
      // El botón sigue deshabilitado mientras se navega para evitar un doble envío.
      router.push(`/packages/${encodeURIComponent(result.value.id)}`);
      return;
    }

    setPending(false);

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setFormError(result.error.message);
  }

  return (
    <form aria-label="Crear evento" className="auth-form" noValidate onSubmit={handleSubmit}>
      <div className="auth-field">
        <label className="auth-label" htmlFor="event-name">
          Nombre del evento
        </label>
        <p className="field-hint" id="event-name-hint">
          Es lo único obligatorio; el resto puede completarse después.
        </p>
        <input
          aria-describedby={errors.name ? "event-name-hint event-name-error" : "event-name-hint"}
          aria-invalid={errors.name ? true : undefined}
          autoComplete="off"
          className="auth-input"
          id="event-name"
          maxLength={120}
          name="name"
          onChange={(event) => setName(event.target.value)}
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

      <details
        className="event-details"
        onToggle={(event) => setDetailsOpen(event.currentTarget.open)}
        open={detailsOpen}
      >
        <summary className="event-details-summary">Agregar detalles (opcional)</summary>

        <div className="metadata-grid">
          <div className="auth-field">
            <label className="auth-label" htmlFor="event-client">
              Cliente
            </label>
            <input
              autoComplete="off"
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
              autoComplete="off"
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
              autoComplete="off"
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
              autoComplete="off"
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
      </details>

      {formError ? (
        <p className="auth-error" role="alert">
          {formError}
        </p>
      ) : null}

      <button className="auth-submit" disabled={pending} type="submit">
        {pending ? "Creando tu evento…" : "Crear evento"}
      </button>
    </form>
  );
}

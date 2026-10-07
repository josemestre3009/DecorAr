"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { getPackagesClient, type PackagesClient } from "./_lib/packages-client";
import {
  SPACE_TYPES,
  validateSpaceDefinition,
  type SpaceDefinitionErrors,
} from "./_lib/space-definition";

type SpaceFormProps = {
  /** Inyectable para las pruebas; en la aplicación se elige según el entorno. */
  readonly client?: PackagesClient;
};

export function SpaceForm({ client }: SpaceFormProps) {
  const router = useRouter();
  // Valores controlados: a diferencia de un <form action>, un onSubmit no deja
  // que React vacíe los campos, así que lo escrito se conserva tras un error.
  const [spaceType, setSpaceType] = useState("");
  const [capacityM2, setCapacityM2] = useState("");
  const [errors, setErrors] = useState<SpaceDefinitionErrors>({});
  const [formError, setFormError] = useState<string>();
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (pending) return;

    const validation = validateSpaceDefinition({ capacityM2, spaceType });

    if (!validation.ok) {
      setErrors(validation.error);
      setFormError(undefined);
      return;
    }

    setErrors({});
    setFormError(undefined);
    setPending(true);

    const result = await (client ?? getPackagesClient()).createPackage(validation.value);

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

  const spaceTypeError = errors.spaceType;
  const capacityError = errors.capacityM2;

  return (
    <form className="auth-form" noValidate onSubmit={handleSubmit}>
      <fieldset
        aria-describedby={spaceTypeError ? "spaceType-error" : undefined}
        aria-invalid={spaceTypeError ? true : undefined}
        className="space-options"
      >
        <legend className="auth-label">Tipo de espacio</legend>

        {SPACE_TYPES.map((type) => (
          <label className="space-option" key={type.value}>
            <input
              checked={spaceType === type.value}
              name="spaceType"
              onChange={() => setSpaceType(type.value)}
              type="radio"
              value={type.value}
            />
            <span>{type.label}</span>
          </label>
        ))}

        {/* role="alert": el error aparece tras el envío y el foco sigue en el botón. */}
        {spaceTypeError ? (
          <p className="auth-error" id="spaceType-error" role="alert">
            {spaceTypeError}
          </p>
        ) : null}
      </fieldset>

      <div className="auth-field">
        <label className="auth-label" htmlFor="capacityM2">
          Capacidad del espacio (m²)
        </label>
        <p className="field-hint" id="capacityM2-hint">
          Escribe los metros cuadrados disponibles, por ejemplo 30.
        </p>
        <input
          aria-describedby={
            capacityError ? "capacityM2-hint capacityM2-error" : "capacityM2-hint"
          }
          aria-invalid={capacityError ? true : undefined}
          autoComplete="off"
          className="auth-input"
          id="capacityM2"
          inputMode="decimal"
          name="capacityM2"
          onChange={(event) => setCapacityM2(event.target.value)}
          required
          type="text"
          value={capacityM2}
        />
        {capacityError ? (
          <p className="auth-error" id="capacityM2-error" role="alert">
            {capacityError}
          </p>
        ) : null}
      </div>

      {formError ? (
        <p className="auth-error" role="alert">
          {formError}
        </p>
      ) : null}

      <button className="auth-submit" disabled={pending} type="submit">
        {pending ? "Creando tu paquete…" : "Crear paquete"}
      </button>
    </form>
  );
}

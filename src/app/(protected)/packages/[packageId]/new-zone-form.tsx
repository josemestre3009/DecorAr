"use client";

import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";

import {
  getPackageGroupsClient,
  type CreatedGroup,
  type PackageGroupsClient,
} from "../_lib/package-groups-client";
import { creatableParentZones, zoneLabel, zoneNameError, type ZoneOption } from "../_lib/zone-tree";

type NewZoneFormProps = {
  readonly packageId: string;
  /** Zonas del evento; se usan para el selector de padre y su sangría. */
  readonly zones: readonly ZoneOption[];
  readonly expectedVersion?: number;
  /** Padre fijo al crear una subzona desde la fila de su zona. */
  readonly parentGroupId?: string | null;
  readonly parentName?: string;
  /** En el alta de raíz se elige el padre; desde una fila ya viene fijado. */
  readonly allowParentSelect?: boolean;
  readonly submitLabel?: string;
  /** Bloquea el envío mientras otra mutación global está en curso. */
  readonly disabled?: boolean;
  readonly autoFocus?: boolean;
  /** Inyectables para las pruebas. */
  readonly client?: PackageGroupsClient;
  readonly onCreated?: (group: CreatedGroup) => void;
  readonly onCancel?: () => void;
};

/**
 * Alta inline de zonas (reemplaza la demostración fija de DECOR-25). Nombre
 * obligatorio (recorte 1..80), padre opcional y una única acción activa por
 * formulario: sin modales y con el foco de vuelta en el campo tras crear.
 */
export function NewZoneForm({
  packageId,
  zones,
  expectedVersion,
  parentGroupId = null,
  parentName,
  allowParentSelect = false,
  submitLabel = "Crear zona",
  disabled = false,
  autoFocus = false,
  client,
  onCreated,
  onCancel,
}: NewZoneFormProps) {
  const router = useRouter();
  const groups = client ?? getPackageGroupsClient();
  const baseId = useId();
  const nameId = `${baseId}-name`;
  const parentId = `${baseId}-parent`;
  const errorId = `${baseId}-error`;
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [parent, setParent] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const parents = allowParentSelect ? creatableParentZones(zones) : [];

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isPending || disabled) {
      return;
    }

    const invalid = zoneNameError(name);
    if (invalid) {
      setErrorMessage(invalid);
      nameRef.current?.focus();
      return;
    }

    setIsPending(true);
    setErrorMessage(null);

    const result = await groups.createGroup(packageId, {
      expectedVersion,
      name: name.trim(),
      parentGroupId: allowParentSelect ? (parent === "" ? null : parent) : parentGroupId,
    });

    setIsPending(false);

    if (result.ok) {
      setName("");
      setParent("");
      onCreated?.(result.value);
      nameRef.current?.focus();
      return;
    }

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setErrorMessage(result.error.message);
    nameRef.current?.focus();
  }

  return (
    <form className="zone-form" noValidate onSubmit={handleSubmit}>
      <div className="zone-field">
        <label htmlFor={nameId}>Nombre de la zona</label>
        <input
          aria-describedby={errorMessage ? errorId : undefined}
          aria-invalid={errorMessage ? true : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          id={nameId}
          onChange={(event) => setName(event.target.value)}
          ref={nameRef}
          type="text"
          value={name}
        />
      </div>

      {allowParentSelect ? (
        <div className="zone-field">
          <label htmlFor={parentId}>Zona padre (opcional)</label>
          <select id={parentId} onChange={(event) => setParent(event.target.value)} value={parent}>
            <option value="">Sin zona (raíz)</option>
            {parents.map((zone) => (
              <option key={zone.groupId} value={zone.groupId}>
                {zoneLabel(zone)}
              </option>
            ))}
          </select>
        </div>
      ) : parentName ? (
        <p className="zone-parent">Dentro de {parentName}.</p>
      ) : null}

      <div className="zone-actions">
        <button
          aria-busy={isPending ? true : undefined}
          aria-disabled={isPending || disabled ? true : undefined}
          className="secondary-button zone-submit"
          type="submit"
        >
          {isPending ? "Creando…" : submitLabel}
        </button>
        {onCancel ? (
          <button className="text-button" onClick={onCancel} type="button">
            Cancelar
          </button>
        ) : null}
      </div>

      {errorMessage ? (
        <p className="auth-error zone-error" id={errorId} role="alert">
          {errorMessage}
        </p>
      ) : null}
    </form>
  );
}

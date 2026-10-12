"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition, type FormEvent } from "react";

import { MAX_NIVELES_GRUPO } from "@/modules/packages/domain/decorative-component";

import type { GroupOption } from "../../../_lib/configurator-view";
import {
  getPackageGroupsClient,
  type PackageGroupsClient,
} from "../../../_lib/package-groups-client";

type GroupManagerProps = {
  readonly packageId: string;
  /** Zonas leídas del servidor en preorden (`toGroupOptions`); son la fuente de verdad. */
  readonly groups: readonly GroupOption[];
  /** Inyectable para las pruebas. */
  readonly client?: PackageGroupsClient;
};

/** Qué está haciendo cada fila: nada, editando el nombre o confirmando la eliminación. */
type RowMode =
  | { readonly kind: "idle" }
  | { readonly kind: "renaming"; readonly draft: string; readonly error?: string }
  | { readonly kind: "confirming"; readonly error?: string };

const IDLE: RowMode = { kind: "idle" };
const ROOT = "";

/** "a Sala" o "al nivel principal": a dónde sube el contenido de una zona eliminada. */
function destinationOf(group: GroupOption): string {
  return group.parentLabel ? `a ${group.parentLabel}` : "al nivel principal";
}

/** "3 elementos y 1 subzona" — lo que se moverá al eliminar una zona. */
function contentSummary(group: GroupOption): string | null {
  const parts: string[] = [];
  if (group.directLeafCount > 0) {
    parts.push(`${group.directLeafCount} ${group.directLeafCount === 1 ? "elemento" : "elementos"}`);
  }
  if (group.directGroupCount > 0) {
    parts.push(`${group.directGroupCount} ${group.directGroupCount === 1 ? "subzona" : "subzonas"}`);
  }
  return parts.length > 0 ? parts.join(" y ") : null;
}

/**
 * Organización de zonas (DECOR-43): crea, renombra y elimina grupos. Todas las
 * reglas (nombre, niveles, propiedad, integridad) las valida el servidor; tras
 * cada cambio se vuelve a leer el detalle con `router.refresh()`, nunca se
 * modifica el árbol de forma optimista.
 */
export function GroupManager({ packageId, groups, client }: GroupManagerProps) {
  const router = useRouter();
  const api = client ?? getPackageGroupsClient();
  const [, startRefresh] = useTransition();
  const formId = useId();

  const [name, setName] = useState("");
  const [parentGroupId, setParentGroupId] = useState(ROOT);
  const [createError, setCreateError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [rowModes, setRowModes] = useState<Readonly<Record<string, RowMode>>>({});
  const [busyGroupId, setBusyGroupId] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const inFlight = useRef(false);
  const listHeading = useRef<HTMLHeadingElement>(null);
  const renameButtons = useRef(new Map<string, HTMLButtonElement>());
  // A dónde mover el foco cuando una fila cambia de modo o desaparece; se
  // aplica tras el siguiente render, que ya contiene el botón de destino.
  const pendingFocus = useRef<{ readonly kind: "list" } | { readonly kind: "row"; readonly groupId: string } | null>(
    null,
  );

  // Una zona de nivel 3 no admite subzonas: se ofrece solo lo que el servidor aceptaría.
  const parentOptions = groups.filter((group) => group.depth < MAX_NIVELES_GRUPO);
  // Si la zona elegida como padre desapareció tras un refresco, se vuelve al nivel principal.
  const selectedParent = parentOptions.some((group) => group.groupId === parentGroupId) ? parentGroupId : ROOT;

  useEffect(() => {
    const target = pendingFocus.current;
    if (!target) return;
    if (target.kind === "list") {
      listHeading.current?.focus();
    } else {
      renameButtons.current.get(target.groupId)?.focus();
    }
    pendingFocus.current = null;
  });

  function setFocusTarget(target: NonNullable<typeof pendingFocus.current>) {
    pendingFocus.current = target;
  }

  function modeOf(groupId: string): RowMode {
    return rowModes[groupId] ?? IDLE;
  }

  function setMode(groupId: string, mode: RowMode) {
    setRowModes((modes) => ({ ...modes, [groupId]: mode }));
  }

  function refresh() {
    startRefresh(() => router.refresh());
  }

  /** Evita doble envío: una sola operación de zonas a la vez. */
  async function exclusive<T>(run: () => Promise<T>): Promise<T | undefined> {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    try {
      return await run();
    } finally {
      inFlight.current = false;
    }
  }

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await exclusive(async () => {
      setCreating(true);
      setCreateError(null);
      setAnnouncement("Creando zona…");

      const result = await api.createGroup(packageId, {
        moduleIds: [],
        name,
        parentGroupId: selectedParent === ROOT ? null : selectedParent,
      });
      setCreating(false);

      if (result.ok) {
        const parent = groups.find((group) => group.groupId === result.value.parentGroupId);
        setName("");
        setAnnouncement(
          parent ? `Zona «${result.value.name}» creada dentro de ${parent.label}.` : `Zona «${result.value.name}» creada.`,
        );
        refresh();
        return;
      }

      if (result.error.kind === "unauthorized") {
        router.push("/login");
        return;
      }
      setAnnouncement("");
      setCreateError(result.error.message);
    });
  }

  async function rename(group: GroupOption, draft: string) {
    await exclusive(async () => {
      setBusyGroupId(group.groupId);
      setAnnouncement(`Renombrando «${group.name}»…`);

      const result = await api.renameGroup(packageId, group.groupId, draft);
      setBusyGroupId(null);

      if (result.ok) {
        setMode(group.groupId, IDLE);
        setAnnouncement(`Zona renombrada a «${result.value.name}».`);
        setFocusTarget({ groupId: group.groupId, kind: "row" });
        refresh();
        return;
      }

      if (result.error.kind === "unauthorized") {
        router.push("/login");
        return;
      }
      setAnnouncement("");
      setMode(group.groupId, { draft, error: result.error.message, kind: "renaming" });
    });
  }

  async function remove(group: GroupOption) {
    await exclusive(async () => {
      setBusyGroupId(group.groupId);
      setAnnouncement(`Eliminando «${group.name}»…`);

      const result = await api.deleteGroup(packageId, group.groupId);
      setBusyGroupId(null);

      if (result.ok) {
        setMode(group.groupId, IDLE);
        setAnnouncement(
          contentSummary(group)
            ? `Se eliminó «${group.name}». Su contenido pasó ${destinationOf(group)}.`
            : `Se eliminó «${group.name}».`,
        );
        setFocusTarget({ kind: "list" });
        refresh();
        return;
      }

      if (result.error.kind === "unauthorized") {
        router.push("/login");
        return;
      }
      setAnnouncement("");
      setMode(group.groupId, { error: result.error.message, kind: "confirming" });
    });
  }

  const nameErrorId = `${formId}-name-error`;
  const busy = creating || busyGroupId !== null;

  return (
    <div aria-busy={busy} className="group-manager">
      {/* Una sola región viva para anunciar el resultado de cada operación. */}
      <p aria-live="polite" className="visually-hidden" role="status">
        {announcement}
      </p>

      <section aria-labelledby={`${formId}-create-title`} className="configurator-card">
        <h2 className="section-title" id={`${formId}-create-title`}>
          Nueva zona
        </h2>
        <form className="group-form" noValidate onSubmit={create}>
          <div className="auth-field">
            <label className="auth-label" htmlFor={`${formId}-name`}>
              Nombre de la zona
            </label>
            <input
              aria-describedby={createError ? `${formId}-name-hint ${nameErrorId}` : `${formId}-name-hint`}
              aria-invalid={createError ? true : undefined}
              autoComplete="off"
              className="auth-input"
              id={`${formId}-name`}
              onChange={(event) => setName(event.target.value)}
              value={name}
            />
            <p className="field-hint" id={`${formId}-name-hint`}>
              Por ejemplo: Sala, Mesa principal o Entrada. Entre 1 y 80 caracteres.
            </p>
          </div>

          <div className="auth-field">
            <label className="auth-label" htmlFor={`${formId}-parent`}>
              Ubicación
            </label>
            <select
              className="auth-input"
              id={`${formId}-parent`}
              onChange={(event) => setParentGroupId(event.target.value)}
              value={selectedParent}
            >
              <option value={ROOT}>Nivel principal</option>
              {parentOptions.map((group) => (
                <option key={group.groupId} value={group.groupId}>
                  Dentro de {group.label}
                </option>
              ))}
            </select>
          </div>

          {createError ? (
            <p className="auth-error" id={nameErrorId} role="alert">
              {createError}
            </p>
          ) : null}

          <button
            aria-busy={creating ? true : undefined}
            aria-disabled={busy ? true : undefined}
            className="auth-submit group-submit"
            type="submit"
          >
            {creating ? "Creando zona…" : "Crear zona"}
          </button>
        </form>
      </section>

      <section aria-labelledby={`${formId}-list-title`} className="configurator-card">
        <h2 className="section-title" id={`${formId}-list-title`} ref={listHeading} tabIndex={-1}>
          Tus zonas
        </h2>

        {groups.length === 0 ? (
          <p className="content-empty">
            Todavía no tienes zonas. Puedes crearlas ahora u omitir este paso y organizar después.
          </p>
        ) : (
          <ul className="group-list">
            {groups.map((group) => {
              const mode = modeOf(group.groupId);
              const rowBusy = busyGroupId === group.groupId;
              const summary = contentSummary(group);
              const inputId = `${formId}-rename-${group.groupId}`;
              const errorId = `${formId}-error-${group.groupId}`;

              return (
                <li
                  className="group-row"
                  key={group.groupId}
                  style={{ ["--group-depth" as string]: group.depth - 1 }}
                >
                  {mode.kind === "renaming" ? (
                    <form
                      className="group-rename"
                      noValidate
                      onSubmit={(event) => {
                        event.preventDefault();
                        void rename(group, mode.draft);
                      }}
                    >
                      <label className="auth-label" htmlFor={inputId}>
                        Nuevo nombre para «{group.name}»
                      </label>
                      <input
                        aria-describedby={mode.error ? errorId : undefined}
                        aria-invalid={mode.error ? true : undefined}
                        autoComplete="off"
                        autoFocus
                        className="auth-input"
                        id={inputId}
                        onChange={(event) =>
                          setMode(group.groupId, { draft: event.target.value, error: mode.error, kind: "renaming" })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Escape") {
                            setMode(group.groupId, IDLE);
                            setFocusTarget({ groupId: group.groupId, kind: "row" });
                          }
                        }}
                        value={mode.draft}
                      />
                      {mode.error ? (
                        <p className="auth-error" id={errorId} role="alert">
                          {mode.error}
                        </p>
                      ) : null}
                      <div className="group-actions">
                        <button
                          aria-busy={rowBusy ? true : undefined}
                          aria-disabled={busy ? true : undefined}
                          className="auth-submit group-action"
                          type="submit"
                        >
                          {rowBusy ? "Guardando…" : "Guardar"}
                        </button>
                        <button
                          className="secondary-button group-action"
                          onClick={() => {
                            setMode(group.groupId, IDLE);
                            setFocusTarget({ groupId: group.groupId, kind: "row" });
                          }}
                          type="button"
                        >
                          Cancelar
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className="group-summary">
                      <p className="group-name">
                        <span className="content-name">{group.name}</span>
                        {group.parentLabel ? <span className="group-path">en {group.parentLabel}</span> : null}
                        <span className="content-qty">{summary ?? "Vacía"}</span>
                      </p>
                      {mode.kind === "idle" ? (
                        <div className="group-actions">
                          <button
                            aria-disabled={busy ? true : undefined}
                            aria-label={`Renombrar ${group.label}`}
                            className="secondary-button group-action"
                            onClick={() => {
                              if (!busy) setMode(group.groupId, { draft: group.name, kind: "renaming" });
                            }}
                            ref={(element) => {
                              if (element) renameButtons.current.set(group.groupId, element);
                              else renameButtons.current.delete(group.groupId);
                            }}
                            type="button"
                          >
                            Renombrar
                          </button>
                          <button
                            aria-disabled={busy ? true : undefined}
                            aria-label={`Eliminar ${group.label}`}
                            className="secondary-button group-action group-delete"
                            onClick={() => {
                              if (!busy) setMode(group.groupId, { kind: "confirming" });
                            }}
                            type="button"
                          >
                            Eliminar
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )}

                  {mode.kind === "confirming" ? (
                    <div aria-labelledby={`${errorId}-question`} className="group-confirm" role="group">
                      <p id={`${errorId}-question`}>
                        ¿Eliminar «{group.name}»?{" "}
                        {summary
                          ? `Su contenido (${summary}) pasará ${destinationOf(group)}. No se borra ningún elemento.`
                          : "La zona está vacía."}
                      </p>
                      {mode.error ? (
                        <p className="auth-error" role="alert">
                          {mode.error}
                        </p>
                      ) : null}
                      <div className="group-actions">
                        <button
                          aria-busy={rowBusy ? true : undefined}
                          aria-disabled={busy ? true : undefined}
                          autoFocus
                          className="auth-submit group-action group-delete-confirm"
                          onClick={() => void remove(group)}
                          type="button"
                        >
                          {rowBusy ? "Eliminando…" : "Sí, eliminar zona"}
                        </button>
                        <button
                          className="secondary-button group-action"
                          onClick={() => {
                            setMode(group.groupId, IDLE);
                            setFocusTarget({ groupId: group.groupId, kind: "row" });
                          }}
                          type="button"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <nav aria-label="Siguiente paso" className="group-next">
        {groups.length > 0 ? (
          <Link className="auth-submit group-continue" href={`/packages/${encodeURIComponent(packageId)}`}>
            Continuar al catálogo
          </Link>
        ) : (
          <Link className="secondary-link group-continue" href={`/packages/${encodeURIComponent(packageId)}`}>
            Omitir por ahora
          </Link>
        )}
      </nav>
    </div>
  );
}

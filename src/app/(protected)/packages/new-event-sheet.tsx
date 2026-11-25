"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "../_ui/icon";
import type { PackagesClient } from "./_lib/packages-client";
import { EventForm } from "./event-form";

type NewEventSheetProps = {
  /** Texto del botón que abre la hoja. */
  readonly label?: string;
  readonly variant?: "primary" | "secondary";
  /** Inyectable para las pruebas. */
  readonly client?: PackagesClient;
};

/** Coincide con la animación de cierre de `.add-sheet` en el CSS. */
const SHEET_CLOSE_MS = 180;

/**
 * Crear evento en una hoja inferior (rediseño visual): la lista de eventos es
 * lo primero que se ve y el formulario (DECOR-44, sin cambios) aparece al
 * tocar el botón. Es un `<dialog>` modal nativo: atrapa el foco, se cierra con
 * Escape o tocando el fondo, y devuelve el foco al botón que lo abrió.
 */
export function NewEventSheet({ label = "Nuevo evento", variant = "primary", client }: NewEventSheetProps) {
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !open) return;

    if (!dialog.open) {
      // jsdom (pruebas) no implementa showModal.
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    }
    // El nombre es lo único obligatorio: el foco empieza ahí.
    dialog.querySelector<HTMLInputElement>("#event-name")?.focus();

    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  useEffect(() => () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  }, []);

  function close() {
    if (!open || closing) return;
    setClosing(true);
    closeTimer.current = setTimeout(() => {
      const dialog = dialogRef.current;
      if (dialog?.open) {
        if (typeof dialog.close === "function") dialog.close();
        else dialog.removeAttribute("open");
      }
      setOpen(false);
      setClosing(false);
      triggerRef.current?.focus();
    }, SHEET_CLOSE_MS);
  }

  return (
    <>
      <button
        aria-haspopup="dialog"
        className={variant === "primary" ? "auth-submit new-event-trigger" : "secondary-button new-event-trigger"}
        onClick={() => {
          setClosing(false);
          setOpen(true);
        }}
        ref={triggerRef}
        type="button"
      >
        <Icon name="plus" />
        {label}
      </button>

      {open ? (
        <dialog
          aria-labelledby="new-event-title"
          className={closing ? "add-sheet event-sheet add-sheet-closing" : "add-sheet event-sheet"}
          onCancel={(event) => {
            event.preventDefault();
            close();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) close();
          }}
          ref={dialogRef}
        >
          <div className="add-sheet-panel">
            <span aria-hidden="true" className="add-sheet-handle" />
            <div className="event-sheet-head">
              <span aria-hidden="true" className="event-sheet-icon">
                <Icon name="calendar" />
              </span>
              <h2 className="add-sheet-title" id="new-event-title">
                Nuevo evento
              </h2>
              <button aria-label="Cerrar" className="icon-button" onClick={close} type="button">
                <Icon name="x" />
              </button>
            </div>
            <EventForm client={client} />
          </div>
        </dialog>
      ) : null}
    </>
  );
}

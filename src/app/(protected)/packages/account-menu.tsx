"use client";

import { useEffect, useRef, useState } from "react";

import { Icon } from "../_ui/icon";

/**
 * Menú de cuenta (rediseño visual): el correo de la sesión y "Cerrar sesión"
 * quedan a mano arriba a la derecha sin ocupar la pantalla. Es un disclosure
 * (aria-expanded) que se cierra con Escape o al tocar fuera. La acción de
 * cerrar sesión llega por prop desde la página del servidor: así este módulo
 * cliente no importa nada que alcance el cliente admin.
 */
export function AccountMenu({
  email,
  signOutAction,
}: {
  readonly email: string;
  readonly signOutAction: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const initial = email.trim().charAt(0).toUpperCase() || "?";

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="account-menu" ref={rootRef}>
      <button
        aria-controls="account-panel"
        aria-expanded={open}
        className="account-trigger"
        onClick={() => setOpen((value) => !value)}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="account-avatar">
          {initial}
        </span>
        <span className="visually-hidden">Tu cuenta</span>
      </button>

      <div className="account-panel" hidden={!open} id="account-panel">
        <p className="account-session">Sesión activa: {email}</p>
        <form action={signOutAction}>
          <button className="account-signout" type="submit">
            <Icon name="logout" size={18} />
            Cerrar sesión
          </button>
        </form>
      </div>
    </div>
  );
}

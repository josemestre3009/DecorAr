"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type RefreshButtonProps = {
  readonly label: string;
  readonly onAction?: () => void;
};

/** Vuelve a pedir la página al servidor (Server Component) sin recargar el navegador. */
export function RefreshButton({ label, onAction }: RefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-busy={isPending}
      className="secondary-button"
      disabled={isPending}
      onClick={() => {
        onAction?.();
        startTransition(() => router.refresh());
      }}
      type="button"
    >
      {isPending ? "Actualizando…" : label}
    </button>
  );
}

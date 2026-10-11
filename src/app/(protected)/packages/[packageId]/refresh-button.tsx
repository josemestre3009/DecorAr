"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

type RefreshButtonProps = {
  readonly label: string;
};

/** Vuelve a pedir la página al servidor (Server Component) sin recargar el navegador. */
export function RefreshButton({ label }: RefreshButtonProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      aria-busy={isPending}
      className="secondary-button"
      disabled={isPending}
      onClick={() => startTransition(() => router.refresh())}
      type="button"
    >
      {isPending ? "Actualizando…" : label}
    </button>
  );
}

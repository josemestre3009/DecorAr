"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";

import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";

type DuplicatePackageButtonProps = {
  readonly packageId: string;
  readonly client?: PackagesClient;
};

/** Parámetro con el que el configurador de la copia muestra la confirmación (DECOR-43). */
export const DUPLICATED_PARAM = "duplicated";

export function DuplicatePackageButton({ packageId, client }: DuplicatePackageButtonProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Guarda síncrona contra el doble envío: el estado de React llega un render tarde.
  const inFlight = useRef(false);

  async function handleDuplicate() {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsPending(true);
    setErrorMessage(null);

    const result = await packages.clonePackage(packageId);

    if (result.ok) {
      // Sigue ocupado mientras navega a la copia: un segundo clic no crea otra.
      router.push(`/packages/${encodeURIComponent(result.value.id)}?${DUPLICATED_PARAM}=1`);
      return;
    }

    inFlight.current = false;
    setIsPending(false);

    if (result.error.kind === "unauthorized") {
      router.push("/login");
      return;
    }

    setErrorMessage(result.error.message);
  }

  return (
    <div className="duplicate-package-wrapper">
      <button
        aria-busy={isPending}
        className="secondary-button"
        disabled={isPending}
        onClick={handleDuplicate}
        type="button"
      >
        {isPending ? "Duplicando paquete…" : "Duplicar paquete"}
      </button>
      <p aria-live="polite" className="visually-hidden" role="status">
        {isPending ? "Duplicando paquete con sus zonas y elementos…" : ""}
      </p>
      {errorMessage ? (
        <p className="auth-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

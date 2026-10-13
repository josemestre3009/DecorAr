"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { getPackagesClient, type PackagesClient } from "../_lib/packages-client";

type DuplicatePackageButtonProps = {
  readonly packageId: string;
  readonly client?: PackagesClient;
};

export function DuplicatePackageButton({ packageId, client }: DuplicatePackageButtonProps) {
  const router = useRouter();
  const packages = client ?? getPackagesClient();
  const [isPending, setIsPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function handleDuplicate() {
    setIsPending(true);
    setErrorMessage(null);

    const result = await packages.clonePackage(packageId);

    if (result.ok) {
      router.push(`/packages/${encodeURIComponent(result.value.id)}`);
      return;
    }

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
        {isPending ? "Duplicando evento…" : "Duplicar evento"}
      </button>
      {errorMessage ? (
        <p className="auth-error" role="alert">
          {errorMessage}
        </p>
      ) : null}
    </div>
  );
}

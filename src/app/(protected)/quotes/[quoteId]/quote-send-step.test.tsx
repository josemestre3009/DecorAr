import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { err, ok } from "@/shared/domain/result";

import type { QuotesClient } from "../_lib/quotes-client";
import { QuoteSendStep } from "./quote-send-step";

const push = vi.fn();
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push, refresh }) }));

const TODAY = "2026-11-24";

function setup(
  changeStatus: QuotesClient["changeStatus"] = vi.fn().mockResolvedValue(ok(undefined)),
  props: Partial<{ status: "draft" | "sent" | "accepted" | "expired"; validUntil: string }> = {},
) {
  render(
    <QuoteSendStep
      client={{ changeStatus }}
      quoteId="q-1"
      status={props.status ?? "draft"}
      today={TODAY}
      validUntil={props.validUntil ?? "2026-12-01"}
    />,
  );
  return changeStatus;
}

beforeEach(() => {
  push.mockReset();
  refresh.mockReset();
});

describe("QuoteSendStep (DECOR-49)", () => {
  it("un borrador vigente se marca como enviada y la página se recarga", async () => {
    const changeStatus = setup();

    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviada" }));

    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));
    // DECOR-55: envía el estado que vio para que el servidor detecte un cambio concurrente.
    expect(changeStatus).toHaveBeenCalledWith("q-1", "sent", "draft");
  });

  it("mientras guarda no permite un segundo envío", async () => {
    let resolve: (value: Awaited<ReturnType<QuotesClient["changeStatus"]>>) => void = () => {};
    const changeStatus = vi.fn<QuotesClient["changeStatus"]>(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    setup(changeStatus);

    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviada" }));
    const busy = screen.getByRole("button", { name: "Marcando…" });
    expect(busy).toBeDisabled();
    fireEvent.click(busy);
    resolve(ok(undefined));

    await waitFor(() => expect(refresh).toHaveBeenCalled());
    expect(changeStatus).toHaveBeenCalledTimes(1);
  });

  it("muestra el error del servidor y permite reintentar", async () => {
    setup(vi.fn().mockResolvedValue(err({ kind: "invalid", message: "No se puede pasar." })));

    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviada" }));

    expect(await screen.findByText("No pudimos marcarla como enviada. No se puede pasar.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Marcar como enviada" })).toBeEnabled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it("sin sesión manda a iniciar sesión", async () => {
    setup(vi.fn().mockResolvedValue(err({ kind: "unauthorized", message: "x" })));

    fireEvent.click(screen.getByRole("button", { name: "Marcar como enviada" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("con la vigencia vencida pide actualizarla en lugar de enviarla", () => {
    setup(undefined, { validUntil: "2026-11-20" });

    expect(screen.getByText(/La vigencia de esta cotización ya pasó/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Marcar como enviada" })).toBeNull();
  });

  it.each(["sent", "accepted", "expired"] as const)("no se muestra si la cotización está %s", (status) => {
    setup(undefined, { status });

    expect(screen.queryByRole("heading", { name: "Compartir con tu cliente" })).toBeNull();
  });
});

import { describe, expect, it } from "vitest";

import { DomainError } from "./domain-error";
import { err, ok } from "./result";

describe("shared domain contracts", () => {
  it("representa éxito sin excepciones", () => {
    expect(ok(42)).toEqual({ ok: true, value: 42 });
  });

  it("conserva código y causa del error", () => {
    const cause = new Error("database unavailable");
    const error = new DomainError("budget.unavailable", "No se pudo calcular", { cause });

    expect(err(error)).toEqual({ ok: false, error });
    expect(error.cause).toBe(cause);
  });
});

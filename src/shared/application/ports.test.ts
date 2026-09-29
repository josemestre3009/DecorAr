import { describe, expectTypeOf, it } from "vitest";

import type { Clock, IdGenerator, Logger } from "./ports";

describe("shared application ports", () => {
  it("mantiene contratos independientes de infraestructura", () => {
    expectTypeOf<Clock["now"]>().returns.toEqualTypeOf<Date>();
    expectTypeOf<IdGenerator["generate"]>().returns.toBeString();
    expectTypeOf<Logger["error"]>().parameters.toMatchTypeOf<
      [message: string, context?: Readonly<Record<string, unknown>>]
    >();
  });
});

import { describe, expect, it } from "vitest";

import { createIntentKeys } from "./intent-keys";

describe("createIntentKeys (DECOR-55)", () => {
  it("reutiliza la clave mientras se reintenta la misma solicitud", () => {
    let n = 0;
    const keys = createIntentKeys(() => `key-${++n}`);

    expect(keys.keyFor("a")).toBe("key-1");
    expect(keys.keyFor("a")).toBe("key-1");
  });

  it("genera otra clave cuando cambia la solicitud", () => {
    let n = 0;
    const keys = createIntentKeys(() => `key-${++n}`);

    expect(keys.keyFor("a")).toBe("key-1");
    expect(keys.keyFor("b")).toBe("key-2");
    expect(keys.keyFor("a")).toBe("key-3");
  });

  it("por defecto genera un UUID", () => {
    expect(createIntentKeys().keyFor("a")).toMatch(/^[0-9a-f-]{36}$/);
  });
});

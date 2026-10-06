import { describe, expect, it } from "vitest";

import { formatAreaM2, formatCop } from "./format";

// Intl separa el símbolo con un espacio no separable; se normaliza para que la
// prueba describa el texto que ve la persona.
const visible = (text: string) => text.replace(/\s/g, " ");

describe("formatCop", () => {
  it.each([
    [250000, "$ 250.000"],
    [1200000, "$ 1.200.000"],
    [0, "$ 0"],
  ])("formatea %d como %s", (value, expected) => {
    expect(visible(formatCop(value))).toBe(expected);
  });

  it("no muestra decimales", () => {
    expect(formatCop(199999)).not.toMatch(/,\d/);
  });
});

describe("formatAreaM2", () => {
  it.each([
    [4, "4 m²"],
    [2.5, "2,5 m²"],
    [16.25, "16,25 m²"],
  ])("formatea %d como %s", (value, expected) => {
    expect(formatAreaM2(value)).toBe(expected);
  });
});

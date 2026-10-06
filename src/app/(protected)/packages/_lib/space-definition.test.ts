import { describe, expect, it } from "vitest";

import {
  CAPACITY_MESSAGES,
  parseCapacity,
  SPACE_TYPES,
  validateSpaceDefinition,
} from "./space-definition";

describe("validateSpaceDefinition", () => {
  it("expone los tres tipos de espacio de docs/DecorAR.md", () => {
    expect(SPACE_TYPES.map((type) => type.value)).toEqual(["casa", "aireLibre", "salonSocial"]);
  });

  it("acepta un tipo válido y una capacidad numérica", () => {
    expect(validateSpaceDefinition({ spaceType: "casa", capacityM2: "30,5" })).toEqual({
      ok: true,
      value: { spaceType: "casa", capacityM2: 30.5 },
    });
  });

  it("rechaza un tipo de espacio fuera de la lista", () => {
    expect(validateSpaceDefinition({ spaceType: "oficina", capacityM2: "30" })).toEqual({
      ok: false,
      error: { spaceType: "Elige el tipo de espacio." },
    });
  });

  it("informa los dos errores a la vez", () => {
    const result = validateSpaceDefinition({ spaceType: "", capacityM2: "" });

    expect(result).toEqual({
      ok: false,
      error: { spaceType: "Elige el tipo de espacio.", capacityM2: CAPACITY_MESSAGES.empty },
    });
  });
});

describe("parseCapacity", () => {
  it.each([
    ["30", 30],
    ["0.5", 0.5],
    ["30,5", 30.5],
    [" 120 ", 120],
    ["+45", 45],
    ["007", 7],
  ])("acepta %j como %d", (raw, expected) => {
    expect(parseCapacity(raw)).toEqual({ ok: true, value: expected });
  });

  it.each(["", "   "])("pide la capacidad cuando está vacía (%j)", (raw) => {
    expect(parseCapacity(raw)).toEqual({ ok: false, error: CAPACITY_MESSAGES.empty });
  });

  it.each(["abc", "treinta", "Infinity", "NaN", "m²", "-", ","])(
    "pide números cuando solo hay letras o símbolos (%j)",
    (raw) => {
      expect(parseCapacity(raw)).toEqual({ ok: false, error: CAPACITY_MESSAGES.letters });
    },
  );

  it.each(["30m2", "30 m²", "3a0", "abc30", "1e3", "30,5,2", "30.", ",5", "30 5", "1.000,5"])(
    "no acepta números mezclados con otros caracteres (%j)",
    (raw) => {
      expect(parseCapacity(raw)).toEqual({ ok: false, error: CAPACITY_MESSAGES.notNumeric });
    },
  );

  it.each(["0", "0,0", "-5", "-0.5"])("exige un número mayor que 0 (%j)", (raw) => {
    expect(parseCapacity(raw)).toEqual({ ok: false, error: CAPACITY_MESSAGES.notPositive });
  });

  it("rechaza un número tan grande que deja de ser finito", () => {
    expect(parseCapacity("9".repeat(400))).toEqual({
      ok: false,
      error: CAPACITY_MESSAGES.tooLarge,
    });
  });
});

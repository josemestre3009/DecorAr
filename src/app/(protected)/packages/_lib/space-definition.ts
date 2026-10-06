import { err, ok, type Result } from "@/shared/domain/result";

/**
 * Validación del formulario "Define tu espacio" (DECOR-20).
 *
 * Es validación de experiencia de usuario: evita una petición que el servidor
 * rechazaría. La regla de negocio vive en el Builder de DECOR-27, que vuelve a
 * validar el paquete en el servidor.
 */

/** Valores canónicos de `docs/DecorAR.md` (TipoEspacio). */
export const SPACE_TYPES = [
  { value: "casa", label: "Casa" },
  { value: "aireLibre", label: "Aire libre (parque o playa)" },
  { value: "salonSocial", label: "Salón social" },
] as const;

export type SpaceType = (typeof SPACE_TYPES)[number]["value"];

export type SpaceDefinition = {
  readonly spaceType: SpaceType;
  readonly capacityM2: number;
};

export type SpaceDefinitionField = "spaceType" | "capacityM2";

export type SpaceDefinitionErrors = Partial<Record<SpaceDefinitionField, string>>;

export type SpaceDefinitionResult = Result<SpaceDefinition, SpaceDefinitionErrors>;

export function isSpaceType(value: unknown): value is SpaceType {
  return SPACE_TYPES.some((type) => type.value === value);
}

export function isValidCapacity(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

export const CAPACITY_MESSAGES = {
  empty: "Escribe cuántos metros cuadrados tiene el espacio.",
  letters: "La capacidad debe escribirse con números, por ejemplo 30.",
  notNumeric: "No aceptamos este valor. Escribe solo números, por ejemplo 30 o 30,5.",
  notPositive: "La capacidad debe ser mayor que 0.",
  tooLarge: "Ese número es demasiado grande. Revisa la capacidad.",
} as const;

/**
 * Solo dígitos, con signo opcional y una parte decimal con punto o coma
 * ("30", "30,5", "-5"). Deja fuera notación científica ("1e3"), "Infinity",
 * espacios internos y unidades ("30m2"): la capacidad es un valor numérico.
 * El signo se admite para poder responder "debe ser mayor que 0".
 */
const NUMERIC_CAPACITY = /^[+-]?\d+(?:[.,]\d+)?$/;
const HAS_DIGIT = /\d/;

/**
 * Interpreta lo escrito en el campo de capacidad y explica por qué se rechaza:
 * vacío, solo letras, mezcla de números con otros caracteres, o un número que
 * no es mayor que 0.
 */
export function parseCapacity(raw: string): Result<number, string> {
  const text = raw.trim();

  if (text === "") {
    return err(CAPACITY_MESSAGES.empty);
  }

  if (!NUMERIC_CAPACITY.test(text)) {
    return err(HAS_DIGIT.test(text) ? CAPACITY_MESSAGES.notNumeric : CAPACITY_MESSAGES.letters);
  }

  const value = Number(text.replace(",", "."));

  // Cientos de dígitos se convierten en Infinity al pasar a número.
  if (!Number.isFinite(value)) {
    return err(CAPACITY_MESSAGES.tooLarge);
  }

  return value > 0 ? ok(value) : err(CAPACITY_MESSAGES.notPositive);
}

export function validateSpaceDefinition(input: {
  readonly spaceType: string;
  readonly capacityM2: string;
}): SpaceDefinitionResult {
  const errors: SpaceDefinitionErrors = {};
  const capacity = parseCapacity(input.capacityM2);

  if (!isSpaceType(input.spaceType)) {
    errors.spaceType = "Elige el tipo de espacio.";
  }

  if (!capacity.ok) {
    errors.capacityM2 = capacity.error;
  }

  if (!capacity.ok || !isSpaceType(input.spaceType)) {
    return err(errors);
  }

  return ok({ spaceType: input.spaceType, capacityM2: capacity.value });
}

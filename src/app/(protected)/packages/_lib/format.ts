const copFormatter = new Intl.NumberFormat("es-CO", {
  currency: "COP",
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
  style: "currency",
});

const areaFormatter = new Intl.NumberFormat("es-CO", {
  maximumFractionDigits: 2,
});

/** Precio entero en pesos colombianos, p. ej. 250000 → "$ 250.000". */
export function formatCop(value: number): string {
  return copFormatter.format(value);
}

/** Área en metros cuadrados, p. ej. 2.5 → "2,5 m²"; `null` → "Sin definir". */
export function formatAreaM2(value: number | null): string {
  if (value === null) {
    return "Sin definir";
  }

  return `${areaFormatter.format(value)} m²`;
}

const dateFormatter = new Intl.DateTimeFormat("es-CO", { dateStyle: "medium" });

/**
 * Fecha ISO `YYYY-MM-DD` (o ISO completo) como fecha legible; `null` cuando no
 * hay fecha o no es interpretable.
 */
export function formatEventDate(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);

  return Number.isNaN(parsed.getTime()) ? null : dateFormatter.format(parsed);
}

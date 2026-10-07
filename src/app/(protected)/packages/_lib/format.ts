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

/** Área en metros cuadrados, p. ej. 2.5 → "2,5 m²". */
export function formatAreaM2(value: number): string {
  return `${areaFormatter.format(value)} m²`;
}

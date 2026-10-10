import { DomainError } from "../../../shared/domain/domain-error";
import { err, ok, type Result } from "../../../shared/domain/result";

/**
 * Composite node of a package's priced structure. A leaf is an individual
 * decorative element with its own `priceCop`; a group never carries a price
 * of its own, it only aggregates the total of its children. This mirrors
 * `ComponenteDecorativo`/`ElementoDecorativo`/`ModuloCompuesto` from
 * `docs/DecorAR.md` §4.3: the same calculation treats simple elements and
 * groups uniformly, recursively.
 */
export type BudgetNode =
  | { readonly kind: "leaf"; readonly priceCop: number }
  | { readonly kind: "group"; readonly children: readonly BudgetNode[] };

export type PackageSnapshot = {
  readonly packageId: string;
  /** Package aggregate version read alongside the nodes (concurrency control). */
  readonly packageVersion: number;
  readonly nodes: readonly BudgetNode[];
};

const invalidPrice = (priceCop: number): Result<never, DomainError> =>
  err(
    new DomainError(
      "budget.invalid_leaf_price",
      `El precio de una hoja debe ser un entero COP no negativo, se recibió ${priceCop}`,
    ),
  );

function sumNode(node: BudgetNode): Result<number, DomainError> {
  if (node.kind === "leaf") {
    if (!Number.isInteger(node.priceCop) || node.priceCop < 0) {
      return invalidPrice(node.priceCop);
    }

    return ok(node.priceCop);
  }

  let total = 0;

  for (const child of node.children) {
    const childTotal = sumNode(child);

    if (!childTotal.ok) {
      return childTotal;
    }

    total += childTotal.value;
  }

  return ok(total);
}

/**
 * Sums the `priceCop` of every leaf in the package's Composite structure.
 * Groups never add an amount of their own; only an empty package sums to
 * zero. Pure domain logic: no Supabase, no I/O.
 */
export function calculateBudget(snapshot: PackageSnapshot): Result<number, DomainError> {
  let total = 0;

  for (const node of snapshot.nodes) {
    const nodeTotal = sumNode(node);

    if (!nodeTotal.ok) {
      return nodeTotal;
    }

    total += nodeTotal.value;
  }

  if (!Number.isSafeInteger(total)) {
    return err(
      new DomainError(
        "budget.total_overflow",
        "El total calculado excede el rango seguro de enteros",
      ),
    );
  }

  return ok(total);
}

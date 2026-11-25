import Link from "next/link";

/**
 * Recorrido V2 (DECOR-49): Evento → Objetos → Montaje 3D → Cotización →
 * Compartir. Se muestra arriba de cada pantalla del recorrido para que siempre
 * se vea en qué paso se está y cuál sigue. Los pasos del evento llevan a su
 * sección del configurador; "Compartir" vive en la cotización.
 *
 * "Montaje 3D" es el visor individual de cada elemento ("Ver en 3D" en el
 * catálogo): la vista multiobjeto y WebXR se cancelaron (DECOR-47/48).
 */

export type FlowStepId = "evento" | "objetos" | "montaje" | "cotizacion" | "compartir";

export const FLOW_STEPS: readonly { readonly id: FlowStepId; readonly label: string }[] = [
  { id: "evento", label: "Evento" },
  { id: "objetos", label: "Objetos" },
  { id: "montaje", label: "Montaje 3D" },
  { id: "cotizacion", label: "Cotización" },
  { id: "compartir", label: "Compartir" },
];

type FlowStepsProps = {
  readonly current: FlowStepId;
  /** Sin evento (lista de eventos) los pasos se muestran sin enlaces. */
  readonly packageId?: string | null;
  /** Con una cotización abierta, "Compartir" lleva a su sección. */
  readonly quoteId?: string | null;
};

export function flowStepHref(
  step: FlowStepId,
  packageId: string | null | undefined,
  quoteId: string | null | undefined,
): string | null {
  if (step === "compartir") {
    return quoteId ? `/quotes/${encodeURIComponent(quoteId)}#compartir` : null;
  }

  return packageId ? `/packages/${encodeURIComponent(packageId)}#${step}` : null;
}

export function FlowSteps({ current, packageId = null, quoteId = null }: FlowStepsProps) {
  const currentIndex = FLOW_STEPS.findIndex((step) => step.id === current);
  const currentStep = FLOW_STEPS[currentIndex];

  return (
    <nav aria-label="Pasos para preparar tu evento" className="flow-steps">
      <ol>
        {FLOW_STEPS.map((step, index) => {
          const state = index < currentIndex ? "done" : index === currentIndex ? "current" : "upcoming";
          const href = flowStepHref(step.id, packageId, quoteId);
          const content = (
            <>
              <span aria-hidden="true" className="flow-step-number">
                {index + 1}
              </span>
              <span className="flow-step-label">{step.label}</span>
            </>
          );

          return (
            <li className={`flow-step flow-step-${state}`} key={step.id}>
              {state === "current" ? (
                <span aria-current="step" className="flow-step-target">
                  {content}
                </span>
              ) : href ? (
                <Link className="flow-step-target" href={href}>
                  {content}
                </Link>
              ) : (
                <span className="flow-step-target">{content}</span>
              )}
            </li>
          );
        })}
      </ol>
      {/*
        En pantallas angostas solo se ven los números (los nombres siguen
        disponibles para lectores de pantalla) y esta línea dice el paso actual.
        Es redundante con aria-current, por eso se oculta a tecnologías de asistencia.
      */}
      {currentStep ? (
        <p aria-hidden="true" className="flow-steps-caption">
          Paso {currentIndex + 1} de {FLOW_STEPS.length} · {currentStep.label}
        </p>
      ) : null}
    </nav>
  );
}

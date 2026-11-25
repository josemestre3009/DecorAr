/**
 * "Siguiente paso" del configurador (DECOR-49): dice qué hacer ahora según el
 * contenido del evento, para que el recorrido no dependa de instrucciones
 * externas. Sin elementos, lleva al catálogo; con elementos, invita a verlos
 * en 3D y a cotizar.
 */
type NextStepProps = {
  readonly unitCount: number;
};

export function NextStep({ unitCount }: NextStepProps) {
  const empty = unitCount === 0;

  return (
    <aside aria-labelledby="next-step-title" className="configurator-card next-step">
      <p className="next-step-eyebrow">Siguiente paso</p>
      <h2 className="section-title" id="next-step-title">
        {empty ? "Agrega los elementos de tu evento" : "Mira tu montaje y crea la cotización"}
      </h2>
      <p className="next-step-body">
        {empty
          ? "Elige mesas, sillas, arcos o pistas en el catálogo. Antes de agregarlos puedes verlos en 3D a tamaño real."
          : "Toca «Ver en 3D» en cualquier elemento del catálogo para verlo a tamaño real. Cuando todo esté listo, crea la cotización para tu cliente."}
      </p>
      <div className="next-step-actions">
        {empty ? (
          <a className="auth-submit next-step-action" href="#catalogo">
            Ir al catálogo
          </a>
        ) : (
          <>
            <a className="auth-submit next-step-action" href="#cotizacion">
              Crear la cotización
            </a>
            <a className="secondary-button next-step-action" href="#montaje">
              Ver los elementos en 3D
            </a>
          </>
        )}
      </div>
    </aside>
  );
}

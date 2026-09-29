export default function Home() {
  return (
    <main className="home">
      <nav className="nav" aria-label="Navegación principal">
        <a className="brand" href="#inicio" aria-label="DecorAR, inicio">
          <span aria-hidden="true">D</span>
          DecorAR
        </a>
        <span className="status">MVP en construcción</span>
      </nav>

      <section className="hero" id="inicio">
        <div className="hero-copy">
          <h1>Imagina el espacio.<br />Antes de montarlo.</h1>
          <p>
            Diseña paquetes para eventos, conoce el presupuesto y visualiza cada
            elemento a escala real desde tu teléfono.
          </p>
          <a className="primary-link" href="#propuesta">Conocer DecorAR</a>
        </div>

        <div className="scene" aria-label="Vista conceptual de una decoración">
          <div className="arch" aria-hidden="true" />
          <div className="floor" aria-hidden="true" />
          <div className="table table-left" aria-hidden="true" />
          <div className="table table-right" aria-hidden="true" />
          <p>Visualización AR<br /><strong>Escala 1:1</strong></p>
        </div>
      </section>

      <section className="promise" id="propuesta" aria-labelledby="promise-title">
        <h2 id="promise-title">De una idea incierta a una decisión visible.</h2>
        <p>Catálogo, configuración, presupuesto y realidad aumentada en un mismo flujo.</p>
      </section>
    </main>
  );
}

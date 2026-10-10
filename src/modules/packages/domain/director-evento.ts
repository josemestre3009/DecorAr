import type { PaqueteDecoracion } from "./decoration-package";
import type { PaqueteDecoracionBuilder } from "./decoration-package-builder";

export class DirectorEvento {
  public construirPaqueteBasico(builder: PaqueteDecoracionBuilder): PaqueteDecoracion {
    builder.agregarArco();
    builder.agregarMesa();
    builder.agregarMesa();
    return builder.construir();
  }
}

"use client";

import { useEffect, useState } from "react";

type DuplicatedNoticeProps = {
  readonly packageId: string;
};

/**
 * Confirmación al llegar a una copia recién duplicada (DECOR-43). Limpia el
 * parámetro de la URL sin navegar, para que recargar o compartir el enlace
 * no repita el aviso; el mensaje sigue visible hasta salir de la página.
 */
export function DuplicatedNotice({ packageId }: DuplicatedNoticeProps) {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    window.history.replaceState(window.history.state, "", `/packages/${encodeURIComponent(packageId)}`);
  }, [packageId]);

  if (!visible) return null;

  return (
    <div className="duplicated-notice" role="status">
      <p>
        <strong>Copia creada.</strong> Estás editando el paquete duplicado, con sus mismas zonas y
        elementos. El original no cambia.
      </p>
      <button className="secondary-button" onClick={() => setVisible(false)} type="button">
        Entendido
      </button>
    </div>
  );
}

import type { DetailedHTMLProps, HTMLAttributes } from "react";

/**
 * `<model-viewer>` en JSX. El paquete lo registra en `HTMLElementTagNameMap`,
 * pero React necesita conocerlo como elemento intrínseco.
 *
 * Solo se declaran atributos con guion, que React siempre escribe como
 * atributos. `src`, `alt`, `poster`, `ar`, `loading` y `reveal` se aplican con
 * `setAttribute` (ver model-viewer-client.tsx): si el elemento ya está
 * registrado, React los asignaría como propiedades y no quedarían en el DOM.
 */
type ModelViewerJsxProps = DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
  readonly "camera-controls"?: boolean;
  readonly "touch-action"?: "pan-y" | "pan-x" | "none";
  readonly "shadow-intensity"?: string;
};

declare module "react" {
  namespace JSX {
    interface IntrinsicElements {
      "model-viewer": ModelViewerJsxProps;
    }
  }
}

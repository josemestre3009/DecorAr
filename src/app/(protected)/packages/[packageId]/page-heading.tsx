"use client";

import { useEffect, useRef, type ReactNode } from "react";

type PageHeadingProps = {
  readonly children: ReactNode;
};

/**
 * Título que recibe el foco al llegar a la página. Se llega desde el formulario
 * del espacio, que desaparece al navegar; sin esto, el siguiente Tab continúa
 * desde un punto intermedio de la página nueva y se salta el inicio.
 */
export function PageHeading({ children }: PageHeadingProps) {
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  return (
    <h1 className="auth-title page-heading" ref={heading} tabIndex={-1}>
      {children}
    </h1>
  );
}

import { NextResponse } from "next/server";

import { createSessionDependencies } from "@/composition/server";

/**
 * Endpoint protegido de referencia. Su propósito en esta entrega es evidenciar
 * que la autorización no depende del proxy: valida la identidad en el servidor
 * y responde 401 en JSON, nunca una redirección.
 *
 * La ruta es /api/session y no /api/modules a propósito: el catálogo, su
 * envelope de errores y su fixture pertenecen a DECOR-20, DECOR-27 y DECOR-28,
 * y este endpoint no debe ocupar ese contrato. Los datos de catálogo, paquetes
 * y presupuestos tampoco se implementan aquí.
 */
export async function GET() {
  const pendingHeaders: Record<string, string> = {};
  const { auth } = await createSessionDependencies({
    onHeaders: (headers) => {
      Object.assign(pendingHeaders, headers);
    },
  });

  const user = await auth.currentUser();

  if (!user) {
    return NextResponse.json(
      { error: "unauthorized" },
      { status: 401, headers: pendingHeaders },
    );
  }

  return NextResponse.json({ userId: user.id }, { headers: pendingHeaders });
}

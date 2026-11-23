import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { EscenaRecord, EscenaRepository } from "../ports/escena-repository.port";
import { ObtenerEscenaUseCase } from "./obtener-escena.use-case";

describe("ObtenerEscenaUseCase (DECOR-46)", () => {
  it("delega en el repositorio y devuelve la escena", async () => {
    const record: EscenaRecord = { packageId: "pkg-1", sceneVersion: 2, transformaciones: [] };
    const escenas: Pick<EscenaRepository, "leer"> = { leer: vi.fn().mockResolvedValue(ok(record)) };
    const useCase = new ObtenerEscenaUseCase(escenas);

    const result = await useCase.execute("pkg-1");

    expect(result).toEqual(ok(record));
    expect(escenas.leer).toHaveBeenCalledWith("pkg-1");
  });

  it("propaga el error del repositorio", async () => {
    const error = new DomainError("package.not_found", "No encontramos este paquete.");
    const escenas: Pick<EscenaRepository, "leer"> = { leer: vi.fn().mockResolvedValue(err(error)) };
    const useCase = new ObtenerEscenaUseCase(escenas);

    const result = await useCase.execute("pkg-ajeno");

    expect(result).toEqual(err(error));
  });
});

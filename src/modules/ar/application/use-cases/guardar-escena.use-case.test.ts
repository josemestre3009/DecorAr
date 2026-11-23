import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { EscenaRepository } from "../ports/escena-repository.port";
import { GuardarEscenaUseCase } from "./guardar-escena.use-case";

describe("GuardarEscenaUseCase (DECOR-46)", () => {
  it("valida en dominio y guarda las transformaciones normalizadas", async () => {
    const guardar = vi.fn().mockResolvedValue(ok(3));
    const escenas: Pick<EscenaRepository, "guardar"> = { guardar };
    const useCase = new GuardarEscenaUseCase(escenas);

    const result = await useCase.execute({
      expectedSceneVersion: 2,
      packageId: "pkg-1",
      transformaciones: [{ itemId: "item-1", posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 405 }],
      userId: "user-1",
    });

    expect(result).toEqual(ok(3));
    expect(guardar).toHaveBeenCalledWith({
      expectedSceneVersion: 2,
      packageId: "pkg-1",
      transformaciones: [{ itemId: "item-1", posicion: { x: 1, y: 0, z: 1 }, rotacionDeg: 45 }],
      userId: "user-1",
    });
  });

  it("rechaza en dominio antes de llamar al repositorio", async () => {
    const guardar = vi.fn();
    const escenas: Pick<EscenaRepository, "guardar"> = { guardar };
    const useCase = new GuardarEscenaUseCase(escenas);

    const result = await useCase.execute({
      expectedSceneVersion: 0,
      packageId: "pkg-1",
      transformaciones: [{ itemId: "item-1", posicion: { x: 999, y: 0, z: 0 }, rotacionDeg: 0 }],
      userId: "user-1",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("ar.scene_position_out_of_bounds");
    expect(guardar).not.toHaveBeenCalled();
  });

  it("propaga el conflicto de versión del repositorio", async () => {
    const error = new DomainError("scene.version_conflict", "La escena cambió mientras guardabas.");
    const guardar = vi.fn().mockResolvedValue(err(error));
    const escenas: Pick<EscenaRepository, "guardar"> = { guardar };
    const useCase = new GuardarEscenaUseCase(escenas);

    const result = await useCase.execute({
      expectedSceneVersion: 1,
      packageId: "pkg-1",
      transformaciones: [],
      userId: "user-1",
    });

    expect(result).toEqual(err(error));
  });
});

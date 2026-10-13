import { describe, expect, it, vi } from "vitest";

import { ok } from "../../../../shared/domain/result";
import type { EventTemplateDto } from "../dtos/event-template.dto";
import type { EventTemplateReader } from "../ports/event-template-repository.port";
import { ListOwnedEventTemplatesUseCase } from "./list-owned-event-templates.use-case";

const templates: readonly EventTemplateDto[] = [
  {
    capacityM2: 80,
    colors: [],
    eventType: "boda",
    id: "tpl-1",
    name: "Boda base",
    notes: "",
    spaceType: "salonSocial",
    style: null,
    updatedAt: "2026-10-12T15:00:00Z",
  },
];

describe("ListOwnedEventTemplatesUseCase", () => {
  it("lista las plantillas del usuario autenticado", async () => {
    const listByOwner = vi.fn().mockResolvedValue(ok(templates));
    const reader: Pick<EventTemplateReader, "listByOwner"> = { listByOwner };

    const result = await new ListOwnedEventTemplatesUseCase(reader).execute("user-1");

    expect(result).toEqual(ok(templates));
    expect(listByOwner).toHaveBeenCalledWith("user-1");
  });

  it("rechaza un usuario vacío con auth.unauthenticated y no lee nada", async () => {
    const listByOwner = vi.fn().mockResolvedValue(ok(templates));
    const reader: Pick<EventTemplateReader, "listByOwner"> = { listByOwner };

    const result = await new ListOwnedEventTemplatesUseCase(reader).execute("  ");

    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
    expect(listByOwner).not.toHaveBeenCalled();
  });
});

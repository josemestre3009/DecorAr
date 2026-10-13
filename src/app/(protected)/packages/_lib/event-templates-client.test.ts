import { describe, expect, it, vi } from "vitest";

import {
  createHttpEventTemplatesClient,
  createSimulatedEventTemplatesClient,
  EVENT_TEMPLATES_ENDPOINT,
} from "./event-templates-client";

const TEMPLATE = { id: "tpl-1", name: "Boda clásica", itemCount: 4, updatedAt: "2026-10-12T00:00:00Z" };

const CREATED = {
  capacityM2: null,
  eventType: null,
  id: "ev-1",
  name: "Nueva boda",
  spaceType: null,
  version: 1,
};

describe("createHttpEventTemplatesClient", () => {
  it("lista plantillas desde {templates:[...]}", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ templates: [TEMPLATE] }));

    const result = await createHttpEventTemplatesClient(fetcher).list();

    expect(result).toEqual({ ok: true, value: [TEMPLATE] });
    expect(fetcher.mock.calls[0][0]).toBe(EVENT_TEMPLATES_ENDPOINT);
  });

  it("acepta un arreglo directo", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([TEMPLATE]));

    await expect(createHttpEventTemplatesClient(fetcher).list()).resolves.toEqual({ ok: true, value: [TEMPLATE] });
  });

  it("crea una plantilla desde un evento con POST {packageId, name}", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(TEMPLATE, { status: 201 }));

    const result = await createHttpEventTemplatesClient(fetcher).createFromEvent("p 1", "Boda clásica");

    expect(result).toEqual({ ok: true, value: TEMPLATE });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe(EVENT_TEMPLATES_ENDPOINT);
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Boda clásica", packageId: "p 1" });
  });

  it("renombra con PATCH /api/event-templates/{id}", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ ...TEMPLATE, name: "Nueva" }));
    const client = createHttpEventTemplatesClient(fetcher);

    const result = await client.rename("tpl/1", "Nueva");

    expect(result.ok && result.value.name).toBe("Nueva");
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/event-templates/tpl%2F1");
    expect(init?.method).toBe("PATCH");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Nueva" });
  });

  it("elimina con DELETE y acepta 204 sin cuerpo", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 204 }));

    const result = await createHttpEventTemplatesClient(fetcher).remove("tpl-1");

    expect(result).toEqual({ ok: true, value: undefined });
    expect(fetcher.mock.calls[0][0]).toBe("/api/event-templates/tpl-1");
    expect(fetcher.mock.calls[0][1]?.method).toBe("DELETE");
  });

  it("instancia con POST /{id}/instantiate y valida el evento creado", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(CREATED, { status: 201 }));

    const result = await createHttpEventTemplatesClient(fetcher).instantiate("tpl-1", "Nueva boda");

    expect(result).toEqual({ ok: true, value: CREATED });
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("/api/event-templates/tpl-1/instantiate");
    expect(JSON.parse(String(init?.body))).toEqual({ name: "Nueva boda" });
  });

  it("acepta la respuesta real del RPC sin diagnóstico espacial", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({ id: "ev-2", name: "Evento real", version: 1 }, { status: 201 }),
    );

    const result = await createHttpEventTemplatesClient(fetcher).instantiate("tpl-1", "Evento real");

    expect(result).toEqual({ ok: true, value: { id: "ev-2", name: "Evento real", version: 1 } });
  });

  it("traduce el envelope de error en un 404", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ error: { code: "template.not_found", message: "No está." } }, { status: 404 }));

    const result = await createHttpEventTemplatesClient(fetcher).rename("tpl-1", "X");

    expect(!result.ok && result.error).toMatchObject({ code: "template.not_found", kind: "not_found", status: 404 });
  });
});

describe("createSimulatedEventTemplatesClient", () => {
  it("guarda, lista, renombra e instancia eventos desde plantillas", async () => {
    const client = createSimulatedEventTemplatesClient(null, 0);

    const created = await client.createFromEvent("ev-1", "Boda clásica");
    expect(created.ok && created.value.name).toBe("Boda clásica");

    const listed = await client.list();
    expect(listed.ok && listed.value).toHaveLength(1);

    const renamed = await client.rename(created.ok ? created.value.id : "x", "Boda moderna");
    expect(renamed.ok && renamed.value.name).toBe("Boda moderna");

    const event = await client.instantiate(renamed.ok ? renamed.value.id : "x", "Nueva boda");
    expect(event.ok && event.value.name).toBe("Nueva boda");

    const removed = await client.remove(renamed.ok ? renamed.value.id : "x");
    expect(removed).toEqual({ ok: true, value: undefined });
    const after = await client.list();
    expect(after.ok && after.value).toHaveLength(0);
  });

  it("rechaza un nombre inválido al guardar", async () => {
    const result = await createSimulatedEventTemplatesClient(null, 0).createFromEvent("ev-1", "   ");

    expect(!result.ok && result.error.code).toBe("package.invalid_name");
  });

  it("responde 404 al instanciar una plantilla desconocida", async () => {
    const result = await createSimulatedEventTemplatesClient(null, 0).instantiate("nope", "Evento");

    expect(!result.ok && result.error.kind).toBe("not_found");
  });
});

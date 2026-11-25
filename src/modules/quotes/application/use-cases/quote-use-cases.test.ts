import { describe, expect, it, vi } from "vitest";

import { DomainError } from "../../../../shared/domain/domain-error";
import { err, ok } from "../../../../shared/domain/result";
import type { QuoteDto } from "../dtos/quote.dto";
import type { QuoteSource } from "../ports/quote-source-reader.port";
import { todayIso } from "../today";
import { ChangeQuoteStatusUseCase } from "./change-quote-status.use-case";
import { CreateQuoteVersionUseCase } from "./create-quote-version.use-case";
import { CreateQuoteUseCase } from "./create-quote.use-case";
import { ListQuotesUseCase } from "./list-quotes.use-case";

const KEY = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OWNER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PACKAGE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
// 2026-11-18 21:00 en Bogotá = 2026-11-19 02:00 UTC.
const clock = { now: () => new Date("2026-11-19T02:00:00Z") };

const SOURCE: QuoteSource = {
  lines: [
    { moduleId: "m-arco", name: "Arco floral", quantity: 2, unitPriceCop: 150_000 },
    { moduleId: "m-silla", name: "Silla", quantity: 10, unitPriceCop: 20_000 },
  ],
  packageId: PACKAGE,
  packageVersion: 4,
};

const TERMS = {
  depositRateBp: 5_000,
  discountRateBp: 1_000,
  taxRateBp: 1_900,
  validUntil: "2026-12-01",
};

const QUOTE = {
  id: "q-1",
  packageId: PACKAGE,
  status: "draft",
} as unknown as QuoteDto;

const sourceReader = (value: QuoteSource | null = SOURCE) => ({ read: vi.fn().mockResolvedValue(ok(value)) });

describe("todayIso", () => {
  it("usa la fecha de Colombia, no la de UTC", () => {
    expect(todayIso(clock)).toBe("2026-11-18");
  });
});

describe("CreateQuoteUseCase (DECOR-50)", () => {
  it("lee la instantánea, calcula en servidor y guarda con la versión leída", async () => {
    const source = sourceReader();
    const repository = { create: vi.fn().mockResolvedValue(ok(QUOTE)) };

    const result = await new CreateQuoteUseCase(source, repository, clock).execute({
      idempotencyKey: KEY,
      ownerId: OWNER,
      packageId: PACKAGE,
      terms: { ...TERMS, totalCop: 1 } as never,
    });

    expect(result).toEqual(ok(QUOTE));
    expect(source.read).toHaveBeenCalledWith(PACKAGE, OWNER);
    const params = repository.create.mock.calls[0][0];
    expect(params).toMatchObject({ expectedPackageVersion: 4, ownerId: OWNER, packageId: PACKAGE });
    // Un total enviado por el cliente se ignora: el servidor calcula el suyo.
    expect(params.calculation.totals.totalCop).toBe(535_500);
    expect(params.terms).toMatchObject({ taxRateBp: 1_900, validUntil: "2026-12-01" });
  });

  it("acepta vigencia igual a hoy en Colombia aunque en UTC ya sea mañana", async () => {
    const repository = { create: vi.fn().mockResolvedValue(ok(QUOTE)) };
    const result = await new CreateQuoteUseCase(sourceReader(), repository, clock).execute({
      idempotencyKey: KEY,
      ownerId: OWNER,
      packageId: PACKAGE,
      terms: { ...TERMS, validUntil: "2026-11-18" },
    });
    expect(result.ok).toBe(true);
  });

  it("rechaza términos inválidos sin leer el evento", async () => {
    const source = sourceReader();
    const repository = { create: vi.fn() };

    const result = await new CreateQuoteUseCase(source, repository, clock).execute({
      idempotencyKey: KEY,
      ownerId: OWNER,
      packageId: PACKAGE,
      terms: { ...TERMS, discountRateBp: -1 },
    });

    expect(!result.ok && result.error.code).toBe("quote.invalid_discount");
    expect(source.read).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("evento ajeno o inexistente → package.not_found", async () => {
    const repository = { create: vi.fn() };
    const result = await new CreateQuoteUseCase(sourceReader(null), repository, clock).execute({
      idempotencyKey: KEY,
      ownerId: OWNER,
      packageId: PACKAGE,
      terms: TERMS,
    });
    expect(!result.ok && result.error.code).toBe("package.not_found");
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("evento vacío → quote.empty_package", async () => {
    const repository = { create: vi.fn() };
    const result = await new CreateQuoteUseCase(
      sourceReader({ ...SOURCE, lines: [] }),
      repository,
      clock,
    ).execute({ idempotencyKey: KEY, ownerId: OWNER, packageId: PACKAGE, terms: TERMS });
    expect(!result.ok && result.error.code).toBe("quote.empty_package");
  });

  it("propaga el error de lectura", async () => {
    const failure = new DomainError("quote.persistence_error", "boom");
    const result = await new CreateQuoteUseCase(
      { read: vi.fn().mockResolvedValue(err(failure)) },
      { create: vi.fn() },
      clock,
    ).execute({ idempotencyKey: KEY, ownerId: OWNER, packageId: PACKAGE, terms: TERMS });
    expect(result).toEqual(err(failure));
  });

  it("sin dueño → auth.unauthenticated", async () => {
    const result = await new CreateQuoteUseCase(sourceReader(), { create: vi.fn() }, clock).execute({
      idempotencyKey: KEY,
      ownerId: "",
      packageId: PACKAGE,
      terms: TERMS,
    });
    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
  });
});

describe("CreateQuoteVersionUseCase (DECOR-50)", () => {
  it("relee el evento actual y crea la versión sobre la misma cotización", async () => {
    const source = sourceReader();
    const repository = { createVersion: vi.fn().mockResolvedValue(ok(QUOTE)) };

    await new CreateQuoteVersionUseCase(source, repository, clock).execute({
      expectedVersion: 1,
      idempotencyKey: KEY,
      ownerId: OWNER,
      quote: QUOTE,
      terms: TERMS,
    });

    expect(source.read).toHaveBeenCalledWith(PACKAGE, OWNER);
    expect(repository.createVersion.mock.calls[0][0]).toMatchObject({
      expectedPackageVersion: 4,
      ownerId: OWNER,
      quoteId: "q-1",
    });
  });

  it.each([
    ["sin paquete de origen", { ...QUOTE, packageId: null } as QuoteDto, SOURCE],
    ["paquete ya no visible", QUOTE, null],
  ])("%s → quote.package_missing", async (_label, quote, source) => {
    const repository = { createVersion: vi.fn() };
    const result = await new CreateQuoteVersionUseCase(sourceReader(source), repository, clock).execute({
      expectedVersion: 1,
      idempotencyKey: KEY,
      ownerId: OWNER,
      quote,
      terms: TERMS,
    });
    expect(!result.ok && result.error.code).toBe("quote.package_missing");
    expect(repository.createVersion).not.toHaveBeenCalled();
  });
});

describe("ChangeQuoteStatusUseCase (DECOR-50)", () => {
  it("valida la transición y la delega", async () => {
    const repository = { changeStatus: vi.fn().mockResolvedValue(ok(QUOTE)) };
    await new ChangeQuoteStatusUseCase(repository).execute({ expectedStatus: "draft", ownerId: OWNER, quote: QUOTE, status: "sent" });
    expect(repository.changeStatus).toHaveBeenCalledWith({ expectedStatus: "draft", ownerId: OWNER, quoteId: "q-1", status: "sent" });
  });

  it("rechaza una transición inválida sin escribir", async () => {
    const repository = { changeStatus: vi.fn() };
    const result = await new ChangeQuoteStatusUseCase(repository).execute({
      expectedStatus: "draft",
      ownerId: OWNER,
      quote: QUOTE,
      status: "accepted",
    });
    expect(!result.ok && result.error.code).toBe("quote.invalid_status_transition");
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });
});

describe("Idempotencia y concurrencia (DECOR-55)", () => {
  const created = ok({ quote: QUOTE, replayed: false });

  it.each([null, "", "no-es-uuid"])("crear sin Idempotency-Key válida (%s) → idempotency.key_invalid", async (key) => {
    const source = sourceReader();
    const repository = { create: vi.fn() };
    const result = await new CreateQuoteUseCase(source, repository, clock).execute({
      idempotencyKey: key,
      ownerId: OWNER,
      packageId: PACKAGE,
      terms: TERMS,
    });
    expect(!result.ok && result.error.code).toBe("idempotency.key_invalid");
    expect(source.read).not.toHaveBeenCalled();
    expect(repository.create).not.toHaveBeenCalled();
  });

  it("crear pasa la clave normalizada y una huella estable de la solicitud", async () => {
    const repository = { create: vi.fn().mockResolvedValue(created) };
    const useCase = new CreateQuoteUseCase(sourceReader(), repository, clock);
    const dto = { idempotencyKey: KEY.toUpperCase(), ownerId: OWNER, packageId: PACKAGE, terms: TERMS };

    await useCase.execute(dto);
    await useCase.execute(dto);
    await useCase.execute({ ...dto, terms: { ...TERMS, taxRateBp: 0 } });

    const [first, retry, changed] = repository.create.mock.calls.map(([params]) => params);
    expect(first.idempotencyKey).toBe(KEY);
    expect(retry.requestFingerprint).toBe(first.requestFingerprint);
    expect(changed.requestFingerprint).not.toBe(first.requestFingerprint);
  });

  it.each([undefined, 0, 1.5, "2"])("versión con expectedVersion inválida (%s) → quote.invalid_body", async (expected) => {
    const repository = { createVersion: vi.fn() };
    const result = await new CreateQuoteVersionUseCase(sourceReader(), repository, clock).execute({
      expectedVersion: expected,
      idempotencyKey: KEY,
      ownerId: OWNER,
      quote: QUOTE,
      terms: TERMS,
    });
    expect(!result.ok && result.error.code).toBe("quote.invalid_body");
    expect(repository.createVersion).not.toHaveBeenCalled();
  });

  it("versión pasa expectedVersion al repositorio y la incluye en la huella", async () => {
    const repository = { createVersion: vi.fn().mockResolvedValue(created) };
    const useCase = new CreateQuoteVersionUseCase(sourceReader(), repository, clock);
    const dto = { expectedVersion: 2, idempotencyKey: KEY, ownerId: OWNER, quote: QUOTE, terms: TERMS };

    await useCase.execute(dto);
    await useCase.execute({ ...dto, expectedVersion: 3 });

    const [a, b] = repository.createVersion.mock.calls.map(([params]) => params);
    expect(a).toMatchObject({ expectedVersion: 2, idempotencyKey: KEY, quoteId: "q-1" });
    expect(b.requestFingerprint).not.toBe(a.requestFingerprint);
  });

  it("propaga quote.version_conflict del repositorio sin reintentar", async () => {
    const conflict = new DomainError("quote.version_conflict", "conflicto", undefined, { currentVersion: 3 });
    const repository = { createVersion: vi.fn().mockResolvedValue(err(conflict)) };
    const result = await new CreateQuoteVersionUseCase(sourceReader(), repository, clock).execute({
      expectedVersion: 2,
      idempotencyKey: KEY,
      ownerId: OWNER,
      quote: QUOTE,
      terms: TERMS,
    });
    expect(result).toEqual(err(conflict));
    expect(repository.createVersion).toHaveBeenCalledTimes(1);
  });

  it("estado: si ya está en el estado pedido devuelve la cotización sin escribir", async () => {
    const repository = { changeStatus: vi.fn() };
    const sent = { ...QUOTE, status: "sent" } as QuoteDto;
    const result = await new ChangeQuoteStatusUseCase(repository).execute({
      expectedStatus: "draft",
      ownerId: OWNER,
      quote: sent,
      status: "sent",
    });
    expect(result).toEqual(ok(sent));
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });

  it("estado: si cambió a otro estado → quote.status_conflict con el actual", async () => {
    const repository = { changeStatus: vi.fn() };
    const result = await new ChangeQuoteStatusUseCase(repository).execute({
      expectedStatus: "draft",
      ownerId: OWNER,
      quote: { ...QUOTE, status: "expired" } as QuoteDto,
      status: "sent",
    });
    expect(!result.ok && result.error.code).toBe("quote.status_conflict");
    expect(!result.ok && result.error.metadata).toEqual({ currentStatus: "expired" });
    expect(repository.changeStatus).not.toHaveBeenCalled();
  });

  it("estado: expectedStatus ausente o inválido → quote.invalid_status", async () => {
    const result = await new ChangeQuoteStatusUseCase({ changeStatus: vi.fn() }).execute({
      expectedStatus: undefined,
      ownerId: OWNER,
      quote: QUOTE,
      status: "sent",
    });
    expect(!result.ok && result.error.code).toBe("quote.invalid_status");
  });
});

describe("ListQuotesUseCase (DECOR-50)", () => {
  it("lista por dueño", async () => {
    const reader = { listQuotes: vi.fn().mockResolvedValue(ok([])) };
    expect(await new ListQuotesUseCase(reader).execute(OWNER)).toEqual(ok([]));
    expect(reader.listQuotes).toHaveBeenCalledWith(OWNER);
  });

  it("sin dueño → auth.unauthenticated", async () => {
    const result = await new ListQuotesUseCase({ listQuotes: vi.fn() }).execute("");
    expect(!result.ok && result.error.code).toBe("auth.unauthenticated");
  });
});

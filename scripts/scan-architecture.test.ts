import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  analyzeFiles,
  collectImports,
  formatViolation,
  isProductionSource,
  layerOf,
  resolveSpecifier,
  scanArchitecture,
  type Violation,
} from "./scan-architecture";

const directories: string[] = [];

afterEach(() => {
  directories.splice(0).forEach((directory) => rmSync(directory, { force: true, recursive: true }));
});

function onlyViolation(path: string, code: string): Violation {
  const violations = analyzeFiles([{ path, code }]);
  expect(violations).toHaveLength(1);
  return violations[0];
}

describe("scan-architecture", () => {
  it("no reporta violaciones en el árbol de producción", async () => {
    await expect(scanArchitecture()).resolves.toEqual([]);
  });

  it("identifica archivos de producción y excluye pruebas", () => {
    expect(isProductionSource("entity.ts")).toBe(true);
    expect(isProductionSource("view.tsx")).toBe(true);
    expect(isProductionSource("entity.test.ts")).toBe(false);
    expect(isProductionSource("view.test.tsx")).toBe(false);
    expect(isProductionSource("types.d.ts")).toBe(false);
    expect(isProductionSource("styles.css")).toBe(false);
  });

  it("formatea archivo y motivo", () => {
    expect(formatViolation({ file: "src/x.ts", rule: "demo", reason: "no permitido" })).toBe(
      "src/x.ts: [demo] no permitido",
    );
  });

  describe("extracción de imports", () => {
    it("recoge declaraciones, reexports, import dinámico y require", () => {
      const code = [
        'import a from "a";',
        'export { b } from "b";',
        'const c = import("c");',
        'const d = require("d");',
        "const e = require(`e`);",
      ].join("\n");

      expect(collectImports(code)).toEqual([
        { specifier: "a", kind: "static" },
        { specifier: "b", kind: "export" },
        { specifier: "c", kind: "dynamic" },
        { specifier: "d", kind: "require" },
        { specifier: "e", kind: "require" },
      ]);
    });

    it("ignora comentarios y ejemplos dentro de strings o templates", () => {
      const path = "src/modules/catalog/domain/entity.ts";
      const code = [
        '// import React from "react";',
        '/* import { createClient } from "@/infrastructure/supabase/admin"; */',
        'const example = "import React from \'react\'";',
        'const other = `import { x } from "@/composition/server"`;',
        'const example3 = \'const x = require("@/infrastructure/supabase/server")\';',
        "export const entity = example + other + example3;",
      ].join("\n");

      expect(analyzeFiles([{ path, code }])).toEqual([]);
    });
  });

  describe("clasificación de capas", () => {
    it("reconoce capas de módulos y shared", () => {
      expect(layerOf("src/modules/catalog/domain/entity.ts")).toBe("domain");
      expect(layerOf("src/modules/catalog/application/use-case.ts")).toBe("application");
      expect(layerOf("src/modules/catalog/infrastructure/repository.ts")).toBe("infrastructure");
      expect(layerOf("src/modules/catalog/interfaces/controller.ts")).toBe("interfaces");
      expect(layerOf("src/shared/domain/result.ts")).toBe("domain");
      expect(layerOf("src/shared/application/ports.ts")).toBe("application");
      expect(layerOf("src/composition/server.ts")).toBe("composition");
      expect(layerOf("src/infrastructure/supabase/server.ts")).toBe("infrastructure");
    });

    it("no clasifica carpetas arbitrarias", () => {
      expect(layerOf("src/app/domain/page.tsx")).toBeNull();
      expect(layerOf("src/features/application/foo.ts")).toBeNull();
      expect(layerOf("src/modules/catalog/utils/domain.ts")).toBeNull();
    });

    it("no trata rutas de app como dominio", () => {
      const violations = analyzeFiles([
        {
          path: "src/app/domain/page.tsx",
          code: 'import Link from "next/link";',
        },
      ]);
      expect(violations).toEqual([]);
    });
  });

  describe("normalización de rutas", () => {
    it("resuelve alias y relativas en Windows", () => {
      expect(
        resolveSpecifier(
          "src\\modules\\catalog\\domain\\entity.ts",
          "..\\..\\..\\interfaces\\catalog",
        ),
      ).toBe("src/interfaces/catalog");
      expect(
        resolveSpecifier("src/modules/catalog/domain/entity.ts", "@/shared/domain/result"),
      ).toBe("src/shared/domain/result");
    });

    it("informa la ruta normalizada del archivo", () => {
      const violation = analyzeFiles([
        {
          path: "src\\modules\\catalog\\domain\\entity.ts",
          code: 'import { createAdminClient } from "@/infrastructure/supabase/admin";',
        },
      ])[0];
      expect(violation.file).toBe("src/modules/catalog/domain/entity.ts");
      expect(violation.rule).toBe("domain-internal-dependency");
    });
  });

  describe("dominio", () => {
    const path = "src/modules/catalog/domain/entity.ts";

    it.each([
      ["React", "react"],
      ["React", "react-dom/client"],
      ["Next.js", "next"],
      ["Next.js", "next/navigation"],
      ["Supabase", "@supabase/supabase-js"],
      ["Supabase", "@supabase/ssr"],
      ["Cloudinary", "cloudinary"],
      ["Cloudinary", "cloudinary-core"],
      ["Cloudinary", "@cloudinary/url-gen"],
      ["Cloudinary", "next-cloudinary"],
    ])("rechaza %s desde %s", (name, specifier) => {
      const violation = onlyViolation(path, `import { x } from "${specifier}";`);
      expect(violation).toMatchObject({ file: path, rule: "domain-external-framework" });
      expect(violation.reason).toContain(name);
    });

    it.each(["application", "infrastructure", "interfaces", "composition"])(
      "rechaza dependencia interna hacia %s",
      (layer) => {
        const specifier = `@/${layer === "composition" ? "composition/server" : `shared/${layer}/thing`}`;
        const violation = onlyViolation(path, `import type { Thing } from "${specifier}";`);
        expect(violation).toMatchObject({ file: path, rule: "domain-internal-dependency" });
        expect(violation.reason).toContain(layer);
      },
    );

    it("rechaza require con literal", () => {
      const violation = onlyViolation(
        path,
        'const admin = require("@/infrastructure/supabase/admin");',
      );
      expect(violation).toMatchObject({ file: path, rule: "domain-internal-dependency" });
      expect(violation.reason).toContain("infrastructure");
    });

    it("rechaza require con template sin sustituciones", () => {
      const violation = onlyViolation(
        path,
        "const admin = require(`@/infrastructure/supabase/admin`);",
      );
      expect(violation).toMatchObject({ file: path, rule: "domain-internal-dependency" });
    });

    it("rechaza require externo prohibido", () => {
      const violation = onlyViolation(path, 'const React = require("react");');
      expect(violation).toMatchObject({ file: path, rule: "domain-external-framework" });
      expect(violation.reason).toContain("React");
    });

    it("detecta export-from", () => {
      const violation = onlyViolation(path, 'export { Catalog } from "@/composition/server";');
      expect(violation).toMatchObject({ file: path, rule: "domain-internal-dependency" });
      expect(violation.reason).toContain("composition");
    });

    it("detecta import dinámico", () => {
      const violation = onlyViolation(
        path,
        'export const load = () => import("@/infrastructure/supabase/admin");',
      );
      expect(violation).toMatchObject({ file: path, rule: "domain-internal-dependency" });
    });
  });

  describe("aplicación", () => {
    const path = "src/modules/budget/application/calculate.ts";

    it.each([
      ["infrastructure", "@/infrastructure/supabase/server"],
      ["interfaces", "@/shared/interfaces/controller"],
      ["composition", "@/composition/server"],
    ])("rechaza dependencia hacia %s", (layer, specifier) => {
      const violation = onlyViolation(path, `import type { Thing } from "${specifier}";`);
      expect(violation).toMatchObject({ file: path, rule: "application-internal-dependency" });
      expect(violation.reason).toContain(layer);
    });

    it("permite puertos compartidos", () => {
      const violations = analyzeFiles([
        { path, code: 'import type { Clock } from "@/shared/application/ports";' },
      ]);
      expect(violations).toEqual([]);
    });
  });

  describe("interfaces", () => {
    it.each([
      "src/interfaces/catalog/controller.ts",
      "src/modules/catalog/interfaces/controller.ts",
      "src/shared/interfaces/controller.ts",
    ])("rechaza infraestructura concreta desde %s", (path) => {
      const violation = onlyViolation(
        path,
        'import { createAdminClient } from "@/infrastructure/supabase/admin";',
      );
      expect(violation).toMatchObject({ file: path, rule: "interfaces-infrastructure-dependency" });
      expect(violation.reason).toContain("infrastructure");
    });

    it("permite application y dominio", () => {
      const violations = analyzeFiles([
        {
          path: "src/interfaces/catalog/controller.ts",
          code: 'import type { Clock } from "@/shared/application/ports";',
        },
      ]);
      expect(violations).toEqual([]);
    });
  });

  describe("entradas server-side de App Router", () => {
    it("rechaza infraestructura concreta desde Route Handlers", () => {
      const path = "src/app/api/packages/route.ts";
      const violation = onlyViolation(
        path,
        'import { createAdminClient } from "@/infrastructure/supabase/admin";',
      );
      expect(violation).toMatchObject({ file: path, rule: "app-infrastructure-dependency" });
      expect(violation.reason).toContain("infrastructure");
    });

    it("permite composition root desde Route Handlers", () => {
      const violations = analyzeFiles([
        {
          path: "src/app/api/packages/route.ts",
          code: 'import { createSessionDependencies } from "@/composition/server";',
        },
      ]);
      expect(violations).toEqual([]);
    });
  });

  describe("módulos cliente", () => {
    const path = "src/app/catalog/catalog-view.tsx";

    it.each([
      ['"use client";\nimport { createClient } from "@/infrastructure/supabase/server";', "server adapter"],
      ['"use client";\nimport { createAdminClient } from "@/infrastructure/supabase/admin";', "admin adapter"],
      ['"use client";\nimport { repository } from "@/modules/catalog/infrastructure/repository";', "infrastructure adapter"],
      ['"use client";\nimport { createClient } from "@/composition/server";', "composition root"],
      ['"use client";\nimport "server-only";', "server-only"],
    ])("rechaza import server-side", (code, label) => {
      const violation = onlyViolation(path, code);
      expect(violation).toMatchObject({ file: path, rule: "client-server-import" });
      expect(violation.reason).toContain(label);
    });

    it("trata la fábrica browser como cliente", () => {
      const violation = onlyViolation(
        "src/infrastructure/supabase/browser.ts",
        'import { createClient } from "@/infrastructure/supabase/server";',
      );
      expect(violation).toMatchObject({
        file: "src/infrastructure/supabase/browser.ts",
        rule: "client-server-import",
      });
      expect(violation.reason).toContain("server adapter");
    });

    it("permite el cliente browser y tablas no de negocio", () => {
      const violations = analyzeFiles([
        {
          path,
          code: '"use client";\nimport { createClient } from "@/infrastructure/supabase/browser";\nexport const load = (supabase) => supabase.from("profiles").select("*");',
        },
      ]);
      expect(violations).toEqual([]);
    });
  });

  describe("CRUD de negocio en cliente", () => {
    const path = "src/app/catalog/catalog-view.tsx";
    const crud = (table: string) =>
      `"use client";\nexport const load = (supabase) => supabase.from("${table}").select("*");`;

    it.each(["Array", "Buffer", "Object"])("ignora %s.from", (receiver) => {
      const violations = analyzeFiles([
        {
          path,
          code: `"use client";\nexport const value = ${receiver}.from("catalog");`,
        },
      ]);
      expect(violations).toEqual([]);
    });

    it.each([
      "catalog",
      "catalogs",
      "catalogo",
      "catalogos",
      "catalog_modules",
      "packages",
      "paquete",
      "paquetes",
      "items",
      "elemento",
      "elementos",
      "budgets",
      "presupuesto",
      "presupuestos",
      "events",
      "evento",
      "eventos",
    ])("detecta la tabla %s", (table) => {
      const violation = onlyViolation(path, crud(table));
      expect(violation).toMatchObject({ file: path, rule: "client-business-crud" });
      expect(violation.reason).toContain(table.split("_")[0]);
    });

    it("detecta cadenas con receptor por propiedad", () => {
      const violation = onlyViolation(
        path,
        '"use client";\nexport const load = (client) => client.data.from("budgets").select();',
      );
      expect(violation).toMatchObject({ file: path, rule: "client-business-crud" });
      expect(violation.reason).toContain("budgets");
    });

    it("no marca tablas ajenas al negocio", () => {
      const violations = analyzeFiles([{ path, code: crud("profiles") }]);
      expect(violations).toEqual([]);
    });

    it("no marca ejemplos dentro de strings", () => {
      const code = ['"use client";', 'export const q = \'supabase.from("catalog")\';'].join("\n");
      expect(analyzeFiles([{ path, code }])).toEqual([]);
    });
  });

  describe("paquetes", () => {
    it("rechaza dependencia hacia budget", () => {
      const path = "src/modules/packages/domain/package.ts";
      const violation = onlyViolation(path, 'import type { Budget } from "@/modules/budget/domain/budget";');
      expect(violation).toMatchObject({ file: path, rule: "packages-budget-coupling" });
      expect(violation.reason).toContain("src/modules/budget");
    });

    it("permite budget importado por otros módulos", () => {
      const violations = analyzeFiles([
        {
          path: "src/modules/events/domain/event.ts",
          code: 'import type { Budget } from "@/modules/budget/domain/budget";',
        },
      ]);
      expect(violations).toEqual([]);
    });
  });

  it("no escanea fixtures ni pruebas como producción", async () => {
    const directory = mkdtempSync(join(tmpdir(), "decorar-architecture-"));
    directories.push(directory);

    writeFileSync(join(directory, "clean.ts"), 'export const value = 1;\nimport "./other";\n');
    writeFileSync(
      join(directory, "violation.test.ts"),
      '"use client";\nimport { createClient } from "@/infrastructure/supabase/server";\n',
    );

    mkdirSync(join(directory, "__fixtures__"));
    writeFileSync(
      join(directory, "__fixtures__", "leak.ts"),
      '"use client";\nimport { createClient } from "@/infrastructure/supabase/server";\n',
    );

    await expect(scanArchitecture(directory)).resolves.toEqual([]);
  });
});

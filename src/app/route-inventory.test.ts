import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const APP_ROOT = resolve("src/app");

/** Grupos de ruta que declaran si sus páginas exigen sesión. */
const ACCESS_GROUPS = ["(public)", "(protected)"];

/** Extensiones que Next.js acepta para `page`. */
const PAGE_FILE = /^page\.(tsx|ts|jsx|js|mdx)$/;

async function findPages(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const full = join(directory, entry.name);

      return entry.isDirectory() ? findPages(full) : PAGE_FILE.test(entry.name) ? [full] : [];
    }),
  );

  return nested.flat();
}

function toRoute(file: string): string {
  return relative(process.cwd(), file).replace(/\\/g, "/");
}

function callsRequiredSessionGuard(source: string): boolean {
  const file = ts.createSourceFile("page.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const guardNames = new Set<string>();
  let found = false;

  for (const statement of file.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== "@/composition/session-guard" ||
      !statement.importClause?.namedBindings ||
      !ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      continue;
    }

    for (const element of statement.importClause.namedBindings.elements) {
      if ((element.propertyName ?? element.name).text === "requireSessionUser") {
        guardNames.add(element.name.text);
      }
    }
  }

  function visit(node: ts.Node) {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      guardNames.has(node.expression.text) &&
      ts.isAwaitExpression(node.parent)
    ) {
      found = true;
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(file);
  return found;
}

describe("inventario de rutas de página", () => {
  it("coloca cada página en el grupo que declara su acceso", async () => {
    const routes = (await findPages(APP_ROOT)).map(toRoute).sort();

    expect(routes.length).toBeGreaterThan(0);

    // La portada cuelga de la raíz y es pública por definición. Cualquier otra
    // página debe declarar su acceso en un grupo: sin grupo, `src/proxy.ts` la
    // protege pero nada la revalida contra el servidor de autenticación.
    const sinGrupo = routes.filter(
      (route) => route !== "src/app/page.tsx" && !ACCESS_GROUPS.some((g) => route.includes(`/${g}/`)),
    );

    expect(sinGrupo).toEqual([]);
  });

  it("exige que cada página protegida valide la sesión por sí misma", async () => {
    // El layout de `(protected)` no basta: en Next 16 los layouts no se vuelven
    // a ejecutar en la navegación del cliente y no impiden que la página se
    // ejecute. Sólo una llamada en la propia página detecta una sesión cerrada
    // en otro dispositivo cuyo token sigue vigente.
    const pages = (await findPages(APP_ROOT)).filter((file) =>
      toRoute(file).includes("/(protected)/"),
    );

    expect(pages.length).toBeGreaterThan(0);

    const sources = await Promise.all(
      pages.map(async (file) => ({ route: toRoute(file), source: await readFile(file, "utf8") })),
    );
    const sinGuard = sources
      .filter(({ source }) => !callsRequiredSessionGuard(source))
      .map(({ route }) => route);

    expect(sinGuard).toEqual([]);
  });

  it("sólo acepta una llamada ejecutable al guard obligatorio", () => {
    const guardImport = 'import { requireSessionUser } from "@/composition/session-guard";\n';

    expect(callsRequiredSessionGuard(`${guardImport}await requireSessionUser();`)).toBe(true);
    expect(
      callsRequiredSessionGuard(
        'import { requireSessionUser as guard } from "@/composition/session-guard";\nawait guard();',
      ),
    ).toBe(true);
    expect(callsRequiredSessionGuard(`${guardImport}requireSessionUser();`)).toBe(false);
    expect(callsRequiredSessionGuard(`${guardImport}void requireSessionUser();`)).toBe(false);
    expect(callsRequiredSessionGuard(`${guardImport}await getCurrentSessionUser();`)).toBe(false);
    expect(callsRequiredSessionGuard("const requireSessionUser = async () => {};\nawait requireSessionUser();")).toBe(
      false,
    );
    expect(
      callsRequiredSessionGuard(
        'import { requireSessionUser } from "other-module";\nawait requireSessionUser();',
      ),
    ).toBe(false);
    expect(callsRequiredSessionGuard("// requireSessionUser()")).toBe(false);
    expect(callsRequiredSessionGuard('const example = "requireSessionUser()";')).toBe(false);
  });
});

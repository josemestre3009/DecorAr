import { readdir, readFile } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import ts from "typescript";

export type Violation = {
  file: string;
  rule: string;
  reason: string;
};

export type SourceFile = {
  path: string;
  code: string;
};

export type ImportKind = "static" | "export" | "dynamic" | "require";

export type ImportRecord = {
  specifier: string;
  kind: ImportKind;
};

export type Layer =
  | "domain"
  | "application"
  | "infrastructure"
  | "interfaces"
  | "composition";

const toPosix = (value: string) => value.replace(/\\/g, "/");

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const MODULE_LAYERS = new Set(["domain", "application", "infrastructure", "interfaces"]);
const SHARED_LAYERS = new Set(["domain", "application", "infrastructure", "interfaces"]);
const PACKAGES_ROOT = "src/modules/packages";
const BUDGET_ROOT = "src/modules/budget";
const BROWSER_FACTORY = "src/infrastructure/supabase/browser";

const BUSINESS_TABLE_TOKENS = new Set([
  "catalog",
  "catalogs",
  "catalogo",
  "catalogos",
  "package",
  "packages",
  "paquete",
  "paquetes",
  "item",
  "items",
  "elemento",
  "elementos",
  "budget",
  "budgets",
  "presupuesto",
  "presupuestos",
  "event",
  "events",
  "evento",
  "eventos",
]);

const BUILTIN_FROM_RECEIVERS = new Set([
  "Array",
  "Buffer",
  "Object",
  "String",
  "Number",
  "Boolean",
  "BigInt",
  "Symbol",
  "Date",
  "RegExp",
  "Set",
  "Map",
  "WeakSet",
  "WeakMap",
  "Promise",
  "Reflect",
  "JSON",
  "Math",
  "Uint8Array",
  "Int8Array",
  "Uint16Array",
  "Int16Array",
  "Uint32Array",
  "Int32Array",
  "Float32Array",
  "Float64Array",
  "BigInt64Array",
  "BigUint64Array",
  "ArrayBuffer",
  "SharedArrayBuffer",
  "DataView",
]);

export function isProductionSource(name: string): boolean {
  if (!SOURCE_EXTENSIONS.has(extname(name))) {
    return false;
  }

  if (/\.(test|spec)\.[cm]?tsx?$/.test(name) || name.endsWith(".d.ts")) {
    return false;
  }

  return true;
}

function scriptKindFor(path: string): ts.ScriptKind {
  return path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
}

function parse(code: string, path: string): ts.SourceFile {
  return ts.createSourceFile(path, code, ts.ScriptTarget.Latest, false, scriptKindFor(path));
}

function literalText(node: ts.Node | undefined): string | null {
  return node && ts.isStringLiteralLike(node) ? node.text : null;
}

function collectImportsFromSource(sourceFile: ts.SourceFile): ImportRecord[] {
  const records: ImportRecord[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      records.push({ specifier: node.moduleSpecifier.text, kind: "static" });
    } else if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      records.push({ specifier: node.moduleSpecifier.text, kind: "export" });
    } else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference) &&
      ts.isStringLiteral(node.moduleReference.expression)
    ) {
      records.push({ specifier: node.moduleReference.expression.text, kind: "static" });
    } else if (ts.isCallExpression(node)) {
      if (node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        const specifier = literalText(node.arguments[0]);
        if (specifier) {
          records.push({ specifier, kind: "dynamic" });
        }
      } else if (ts.isIdentifier(node.expression) && node.expression.text === "require") {
        const specifier = literalText(node.arguments[0]);
        if (specifier) {
          records.push({ specifier, kind: "require" });
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return records;
}

export function collectImports(code: string, path = "module.ts"): ImportRecord[] {
  return collectImportsFromSource(parse(code, path));
}

export function layerOf(path: string): Layer | null {
  const normalized = toPosix(path);

  if (normalized === "src/composition" || normalized.startsWith("src/composition/")) {
    return "composition";
  }

  if (normalized === "src/infrastructure" || normalized.startsWith("src/infrastructure/")) {
    return "infrastructure";
  }

  if (normalized === "src/interfaces" || normalized.startsWith("src/interfaces/")) {
    return "interfaces";
  }

  const moduleMatch = /^src\/modules\/[^/]+\/([^/]+)(?:\/|$)/.exec(normalized);
  if (moduleMatch && MODULE_LAYERS.has(moduleMatch[1])) {
    return moduleMatch[1] as Layer;
  }

  const sharedMatch = /^src\/shared\/([^/]+)(?:\/|$)/.exec(normalized);
  if (sharedMatch && SHARED_LAYERS.has(sharedMatch[1])) {
    return sharedMatch[1] as Layer;
  }

  return null;
}

function normalizePath(path: string): string {
  const posix = toPosix(path);
  const leading = posix.startsWith("/");
  const parts: string[] = [];

  for (const segment of posix.split("/")) {
    if (!segment || segment === ".") {
      continue;
    }

    if (segment === "..") {
      parts.pop();
      continue;
    }

    parts.push(segment);
  }

  return (leading ? "/" : "") + parts.join("/");
}

export function resolveSpecifier(importerPath: string, specifier: string): string | null {
  const importer = toPosix(importerPath);

  if (specifier.startsWith("@/")) {
    return normalizePath(`src/${specifier.slice(2)}`);
  }

  if (specifier.startsWith(".")) {
    const directory = importer.slice(0, importer.lastIndexOf("/"));
    return normalizePath(`${directory}/${specifier}`);
  }

  return null;
}

function isUnder(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function isBrowserFactory(path: string): boolean {
  return path.replace(/\.(ts|tsx)$/, "") === BROWSER_FACTORY;
}

function hasUseClientDirective(sourceFile: ts.SourceFile): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isExpressionStatement(statement) && ts.isStringLiteral(statement.expression)) {
      if (statement.expression.text === "use client") {
        return true;
      }
      continue;
    }

    break;
  }

  return false;
}

function forbiddenDomainExternal(specifier: string): string | null {
  if (
    specifier === "react" ||
    specifier.startsWith("react/") ||
    specifier === "react-dom" ||
    specifier.startsWith("react-dom/")
  ) {
    return "React";
  }

  if (specifier === "next" || specifier.startsWith("next/")) {
    return "Next.js";
  }

  if (specifier.startsWith("@supabase/")) {
    return "Supabase";
  }

  if (/(^|[/@-])cloudinary([/-]|$)/i.test(specifier)) {
    return "Cloudinary";
  }

  return null;
}

function serverAdapterLabel(path: string): string {
  if (/(^|\/)infrastructure\/supabase\/server(\.tsx?)?$/.test(path)) {
    return "server adapter";
  }

  if (/(^|\/)infrastructure\/supabase\/admin(\.tsx?)?$/.test(path)) {
    return "admin adapter";
  }

  return "infrastructure adapter";
}

function normalizeToken(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function businessTablesIn(sourceFile: ts.SourceFile): string[] {
  const found = new Set<string>();

  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "from"
    ) {
      const receiver = node.expression.expression;
      const isBuiltin = ts.isIdentifier(receiver) && BUILTIN_FROM_RECEIVERS.has(receiver.text);

      if (!isBuiltin) {
        const table = literalText(node.arguments[0]);

        if (table) {
          for (const token of normalizeToken(table).split(/[^a-z0-9]+/)) {
            if (BUSINESS_TABLE_TOKENS.has(token)) {
              found.add(token);
            }
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return [...found];
}

const DOMAIN_FORBIDDEN_TARGETS = new Set<Layer>([
  "application",
  "infrastructure",
  "interfaces",
  "composition",
]);

const APPLICATION_FORBIDDEN_TARGETS = new Set<Layer>([
  "infrastructure",
  "interfaces",
  "composition",
]);

export function analyzeFile(file: SourceFile): Violation[] {
  const path = toPosix(file.path);
  const sourceFile = parse(file.code, path);
  const layer = layerOf(path);
  const isClient = hasUseClientDirective(sourceFile) || isBrowserFactory(path);
  const isServerApp = isUnder(path, "src/app") && !isClient;
  const underPackages = isUnder(path, PACKAGES_ROOT);
  const violations: Violation[] = [];

  for (const { specifier } of collectImportsFromSource(sourceFile)) {
    const resolved = resolveSpecifier(path, specifier);
    const targetLayer = resolved ? layerOf(resolved) : null;

    if (layer === "domain") {
      const external = forbiddenDomainExternal(specifier);
      if (external) {
        violations.push({
          file: path,
          rule: "domain-external-framework",
          reason: `domain layer cannot import ${external} (${specifier})`,
        });
      }

      if (targetLayer && DOMAIN_FORBIDDEN_TARGETS.has(targetLayer)) {
        violations.push({
          file: path,
          rule: "domain-internal-dependency",
          reason: `domain layer cannot import ${targetLayer} (${specifier} -> ${resolved})`,
        });
      }
    }

    if (
      layer === "application" &&
      targetLayer &&
      APPLICATION_FORBIDDEN_TARGETS.has(targetLayer)
    ) {
      violations.push({
        file: path,
        rule: "application-internal-dependency",
        reason: `application layer cannot import ${targetLayer} (${specifier} -> ${resolved})`,
      });
    }

    if (layer === "interfaces" && targetLayer === "infrastructure") {
      violations.push({
        file: path,
        rule: "interfaces-infrastructure-dependency",
        reason: `interfaces layer cannot import infrastructure (${specifier} -> ${resolved})`,
      });
    }

    if (isServerApp && targetLayer === "infrastructure") {
      violations.push({
        file: path,
        rule: "app-infrastructure-dependency",
        reason: `server app entry point cannot import infrastructure directly (${specifier} -> ${resolved})`,
      });
    }

    if (isClient) {
      if (specifier === "server-only") {
        violations.push({
          file: path,
          rule: "client-server-import",
          reason: `client module must not import "server-only"`,
        });
      } else if (targetLayer === "composition") {
        violations.push({
          file: path,
          rule: "client-server-import",
          reason: `client module must not import composition root (${specifier} -> ${resolved})`,
        });
      } else if (targetLayer === "infrastructure" && !(resolved && isBrowserFactory(resolved))) {
        violations.push({
          file: path,
          rule: "client-server-import",
          reason: `client module must not import ${serverAdapterLabel(resolved ?? "")} (${specifier} -> ${resolved})`,
        });
      }
    }

    if (underPackages && resolved && isUnder(resolved, BUDGET_ROOT)) {
      violations.push({
        file: path,
        rule: "packages-budget-coupling",
        reason: `packages module must not import budget module (${specifier} -> ${resolved})`,
      });
    }
  }

  if (isClient) {
    for (const table of businessTablesIn(sourceFile)) {
      violations.push({
        file: path,
        rule: "client-business-crud",
        reason: `client module must not execute Supabase CRUD on business table "${table}"`,
      });
    }
  }

  return violations;
}

export function analyzeFiles(files: SourceFile[]): Violation[] {
  return files.flatMap((file) => analyzeFile(file));
}

export function formatViolation(violation: Violation): string {
  return `${violation.file}: [${violation.rule}] ${violation.reason}`;
}

async function collectSourceFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });

  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(directory, entry.name);

      if (entry.isDirectory()) {
        return entry.name === "__fixtures__" ? [] : collectSourceFiles(full);
      }

      return isProductionSource(entry.name) ? [full] : [];
    }),
  );

  return nested.flat();
}

export async function scanArchitecture(root = "src"): Promise<Violation[]> {
  const absoluteRoot = resolve(root);
  const files = await collectSourceFiles(absoluteRoot);
  const sources: SourceFile[] = await Promise.all(
    files.map(async (file) => ({
      path: toPosix(relative(process.cwd(), file)),
      code: await readFile(file, "utf8"),
    })),
  );

  return analyzeFiles(sources);
}

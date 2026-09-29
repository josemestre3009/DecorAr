import { readdir, readFile } from "node:fs/promises";
import { extname, join } from "node:path";

const staticDirectory = process.env.CLIENT_STATIC_DIR ?? join(process.cwd(), ".next", "static");
const secrets = [
  ["SUPABASE_SERVICE_ROLE_KEY", process.env.SUPABASE_SERVICE_ROLE_KEY],
  ["CLOUDINARY_URL", process.env.CLOUDINARY_URL],
].filter(([, value]) => value);

if (secrets.length !== 2) {
  throw new Error(
    "Client secret scan requires SUPABASE_SERVICE_ROLE_KEY and CLOUDINARY_URL.",
  );
}

async function filesIn(directory) {
  const entries = await readdir(directory, { withFileTypes: true });

  return (
    await Promise.all(
      entries.map((entry) => {
        const path = join(directory, entry.name);
        return entry.isDirectory() ? filesIn(path) : [path];
      }),
    )
  ).flat();
}

const clientFiles = (await filesIn(staticDirectory)).filter((path) =>
  [".js", ".json", ".map"].includes(extname(path)),
);

if (clientFiles.length === 0) {
  throw new Error(`Client secret scan found no artifacts in: ${staticDirectory}`);
}

for (const path of clientFiles) {
  const contents = await readFile(path, "utf8");

  for (const [name, value] of secrets) {
    if (contents.includes(value)) {
      throw new Error(`${name} leaked into client artifact: ${path}`);
    }
  }
}

console.log(`Client secret scan passed across ${clientFiles.length} artifacts.`);

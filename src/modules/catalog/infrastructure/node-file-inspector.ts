import "server-only";

import { stat } from "node:fs/promises";
import type { FileInspectorPort, FileMetadata } from "../application/ports/file-inspector.port";

export class NodeFileInspector implements FileInspectorPort {
  async inspect(filePath: string): Promise<FileMetadata> {
    try {
      const stats = await stat(filePath);
      return {
        exists: stats.isFile(),
        byteSize: stats.size,
      };
    } catch {
      return {
        exists: false,
        byteSize: 0,
      };
    }
  }
}

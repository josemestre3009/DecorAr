export interface FileMetadata {
  readonly exists: boolean;
  readonly byteSize: number;
}

export interface FileInspectorPort {
  inspect(filePath: string): Promise<FileMetadata>;
}

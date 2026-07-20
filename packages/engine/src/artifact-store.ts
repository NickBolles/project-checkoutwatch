import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface ArtifactStore {
  write(runId: string, name: string, content: Uint8Array | string): Promise<string>;
}

export class LocalArtifactStore implements ArtifactStore {
  constructor(private readonly root = "var/artifacts") {}
  async write(runId: string, name: string, content: Uint8Array | string): Promise<string> {
    const directory = join(this.root, runId);
    await mkdir(directory, { recursive: true });
    const path = join(directory, name);
    await writeFile(path, content);
    return path;
  }
}

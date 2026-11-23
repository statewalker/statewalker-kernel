import { cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll } from "vitest";

// Copies live inside the package, so a fragment.config.ts resolves
// @statewalker/fragment-build.core and zod from its node_modules, as an author's does.
const TMP = join(import.meta.dirname, ".tmp");
const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A fresh copy of the fixture `name`, removed after the file's tests. */
export async function copyFixture(name: string): Promise<string> {
  await mkdir(TMP, { recursive: true });
  const dir = await mkdtemp(join(TMP, `${name}-`));
  made.push(dir);
  await cp(join(import.meta.dirname, "fixtures", name), dir, { recursive: true });
  return dir;
}

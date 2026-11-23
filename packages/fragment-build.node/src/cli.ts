import { buildFragment, generateFragment } from "./build.js";

export interface CliStreams {
  readonly stdout: (text: string) => void;
  readonly stderr: (text: string) => void;
}

const USAGE = `usage: fragment-build [build] <dir> [--out <dir>]   generate, then pack <dir>/dist/<id>-<version>.fragment.json
       fragment-build generate <dir>                 write the files fragment.config.ts generates
`;

const processStreams: CliStreams = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

/** The `fragment-build` command; resolves to its exit code. */
export async function main(
  args: readonly string[],
  io: CliStreams = processStreams,
): Promise<number> {
  const rest = [...args];
  const command = rest[0] === "build" || rest[0] === "generate" ? rest.shift() : "build";
  let outDir: string | undefined;
  const positional: string[] = [];
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i] ?? "";
    if (arg === "--out" && command === "build" && rest[i + 1]) outDir = rest[++i];
    else if (arg.startsWith("-")) {
      io.stderr(`unknown option ${arg}\n${USAGE}`);
      return 2;
    } else positional.push(arg);
  }
  const dir = positional[0];
  if (!dir || positional.length > 1) {
    io.stderr(USAGE);
    return 2;
  }
  try {
    if (command === "generate") {
      const files = await generateFragment(dir);
      if (!files) throw new Error(`${dir} has no fragment.config.ts`);
      io.stdout(`${Object.keys(files).join("\n")}\n`);
    } else {
      const result = await buildFragment(dir, outDir ? { outDir } : {});
      io.stdout(`${result.hash} ${result.path}\n`);
    }
    return 0;
  } catch (error) {
    io.stderr(`fragment-build: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

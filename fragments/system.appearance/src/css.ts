import { NAME_PATTERN, TOKEN_VALUE_PATTERN } from "./archive.js";

/** One mode's tokens, by name without `--`. */
export type TokenSet = Readonly<Record<string, string>>;

/** The tokens of both modes. */
export interface Palette {
  readonly light: TokenSet;
  readonly dark: TokenSet;
}

const NAME = new RegExp(NAME_PATTERN);
const VALUE = new RegExp(TOKEN_VALUE_PATTERN);

function block(selector: string, tokens: TokenSet): string {
  const lines = Object.entries(tokens)
    // The points' schemas refuse such tokens already; this keeps any other caller safe.
    .filter(([name, value]) => NAME.test(name) && VALUE.test(value))
    .map(([name, value]) => `  --${name}: ${value};\n`);
  return `${selector} {\n${lines.join("")}}\n`;
}

/**
 * The stylesheet setting `palette` as the page's shadcn tokens: the light tokens on the root
 * without `.dark`, the dark ones on the root with it. Its selectors outrank the defaults of
 * system.workbench's `theme.css` (`:root`, `.dark`), so a token the palette leaves out keeps its
 * default.
 */
export function tokensCss(palette: Palette): string {
  return block(":root:not(.dark)", palette.light) + block(":root.dark", palette.dark);
}

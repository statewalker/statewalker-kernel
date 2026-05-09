#!/usr/bin/env bash
# Scaffold the new substrate packages declared in
# openspec/changes/fragmentize-workbench-and-collapse-explorer/tasks.md
# (groups 2.x). Idempotent: existing files are NOT overwritten.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PKG_DIR="$ROOT/packages"

mk_logic_pkg() {
  local name="$1"
  local desc="$2"
  local dir="$PKG_DIR/$name"
  mkdir -p "$dir/src"
  if [ ! -f "$dir/package.json" ]; then
    cat > "$dir/package.json" <<JSON
{
  "name": "@statewalker/$name",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "$desc",
  "homepage": "https://github.com/statewalker/statewalker-workbench",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/statewalker/statewalker-workbench.git"
  },
  "exports": {
    ".": "./src/index.ts",
    "./fragment": "./src/fragment.ts"
  },
  "files": ["src"],
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "lint": "biome check --write .",
    "format": "biome format --write ."
  },
  "dependencies": {
    "@statewalker/shared-baseclass": "catalog:",
    "@statewalker/shared-intents": "catalog:",
    "@statewalker/shared-registry": "catalog:",
    "@statewalker/shared-slots": "catalog:",
    "@statewalker/workspace-api": "workspace:*"
  },
  "devDependencies": {
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "sideEffects": false,
  "publishConfig": {"access": "public"}
}
JSON
  fi
  if [ ! -f "$dir/tsconfig.json" ]; then
    cat > "$dir/tsconfig.json" <<'JSON'
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM"],
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["./src", "./tests"],
  "exclude": ["node_modules", "dist"]
}
JSON
  fi
  if [ ! -f "$dir/vitest.config.ts" ]; then
    cat > "$dir/vitest.config.ts" <<'TS'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
  },
});
TS
  fi
  if [ ! -f "$dir/src/index.ts" ]; then
    cat > "$dir/src/index.ts" <<'TS'
// Public surface — populated as fragments migrate in.
export {};
TS
  fi
  if [ ! -f "$dir/src/fragment.ts" ]; then
    cat > "$dir/src/fragment.ts" <<'TS'
// Default-export `init(ctx) => cleanup` — populated during fragment migration.
import { newRegistry } from "@statewalker/shared-registry";

export default function init(_ctx: Record<string, unknown>): () => Promise<void> {
  const [_register, cleanup] = newRegistry();
  return cleanup;
}
TS
  fi
}

mk_react_pkg() {
  local name="$1"
  local desc="$2"
  local dir="$PKG_DIR/$name"
  mkdir -p "$dir/src"
  if [ ! -f "$dir/package.json" ]; then
    cat > "$dir/package.json" <<JSON
{
  "name": "@statewalker/$name",
  "version": "0.1.0",
  "private": false,
  "type": "module",
  "description": "$desc",
  "homepage": "https://github.com/statewalker/statewalker-workbench",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+ssh://git@github.com/statewalker/statewalker-workbench.git"
  },
  "exports": {
    ".": "./src/index.ts",
    "./fragment": "./src/fragment.ts",
    "./styles": "./src/styles.css"
  },
  "files": ["src"],
  "scripts": {
    "test": "vitest run --passWithNoTests",
    "test:watch": "vitest --passWithNoTests",
    "typecheck": "tsc --noEmit",
    "lint": "biome check --write .",
    "format": "biome format --write ."
  },
  "dependencies": {
    "@statewalker/shared-baseclass": "catalog:",
    "@statewalker/shared-intents": "catalog:",
    "@statewalker/shared-registry": "catalog:",
    "@statewalker/shared-slots": "catalog:",
    "@statewalker/workspace-api": "workspace:*"
  },
  "peerDependencies": {
    "react": ">=18",
    "react-dom": ">=18"
  },
  "devDependencies": {
    "@types/react": "catalog:",
    "@types/react-dom": "catalog:",
    "react": "catalog:",
    "react-dom": "catalog:",
    "typescript": "catalog:",
    "vitest": "catalog:"
  },
  "sideEffects": ["**/*.css"],
  "publishConfig": {"access": "public"}
}
JSON
  fi
  if [ ! -f "$dir/tsconfig.json" ]; then
    cat > "$dir/tsconfig.json" <<'JSON'
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "compilerOptions": {
    "target": "ES2022",
    "module": "Preserve",
    "moduleResolution": "Bundler",
    "lib": ["ESNext", "DOM", "DOM.Iterable"],
    "jsx": "react-jsx",
    "strict": true,
    "skipLibCheck": true,
    "verbatimModuleSyntax": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "forceConsistentCasingInFileNames": true,
    "isolatedModules": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedIndexedAccess": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "noEmit": true
  },
  "include": ["./src", "./tests"],
  "exclude": ["node_modules", "dist"]
}
JSON
  fi
  if [ ! -f "$dir/vitest.config.ts" ]; then
    cat > "$dir/vitest.config.ts" <<'TS'
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx", "tests/**/*.test.ts", "tests/**/*.test.tsx"],
  },
});
TS
  fi
  if [ ! -f "$dir/src/index.ts" ]; then
    cat > "$dir/src/index.ts" <<'TS'
// Public surface — populated as fragments migrate in.
export {};
TS
  fi
  if [ ! -f "$dir/src/fragment.ts" ]; then
    cat > "$dir/src/fragment.ts" <<'TS'
// Default-export `init(ctx) => cleanup` — populated during fragment migration.
import { newRegistry } from "@statewalker/shared-registry";

export default function init(_ctx: Record<string, unknown>): () => Promise<void> {
  const [_register, cleanup] = newRegistry();
  return cleanup;
}
TS
  fi
  if [ ! -f "$dir/src/styles.css" ]; then
    cat > "$dir/src/styles.css" <<'CSS'
/*
 * Tailwind v4 content discovery for this package.
 *
 * The host app's `main.tsx` imports `<package>/styles` once at boot. Tailwind
 * v4 then walks the `@source` glob and picks up class usage inside this
 * package's source so utility classes are emitted into the host's CSS bundle.
 */
@source "./**/*.{ts,tsx}";
CSS
  fi
}

# Group 2 — workbench substrate
mk_react_pkg core-react        "Substrate React fragment: mount, AppRoot, core:views slot, useSlot/useKeyedSlot/useAdapterValue hooks, theme binding."
mk_react_pkg shadcn-react      "Substrate React fragment: shadcn primitives (Button, Card, Dialog, ResizablePanelGroup, Tabs, ...) plus the cn() helper."
mk_logic_pkg dock              "Dock logic fragment: dock:* slot keys, dock state, dock:show-panel/close-panel/focus-panel intents."
mk_react_pkg dock-react        "Dock renderer fragment: dockview-react host, MainShell, ShellHeader, JsonPanel."
mk_logic_pkg files             "Files logic fragment: file-op intents, files:* slots, MimeRenderer type, pickMimeRenderer selector, FilesManager."
mk_react_pkg files-react       "Files renderer fragment: visual surfaces shared between chat-mini.app and explorer.app."
mk_logic_pkg file-explorer     "File-explorer logic fragment: navigation, search controller, tree-state, browser orchestration intents."
mk_react_pkg file-explorer-react "File-explorer renderer fragment: tree, list, drag-and-drop, context menu, navigation breadcrumbs, search panel."
mk_logic_pkg settings          "Settings logic fragment: settings adapter, settings:* slots and intents."
mk_react_pkg settings-react    "Settings renderer fragment: settings dialog and dock:header-items button."
mk_logic_pkg workspace-bridge  "Workspace bridge logic fragment: WorkspaceShellAdapter, workspace:change/reconnect/disconnect intents."
mk_react_pkg workspace-bridge-react "Workspace bridge renderer fragment: AppWorkspaceProvider, DirectoryPickerEmptyState, ReconnectBanner, switch-workspace header item."
mk_logic_pkg inline-content    "Inline-content logic fragment: inline-content:components and inline-content:renderers slot keys."
mk_react_pkg inline-content-react "Inline-content renderer fragment: contributes React renderers via the inline-content:renderers slot."
mk_logic_pkg json-render       "JSON-render fragment: SpecStore adapter, json:catalogs slot key, useCatalogRegistry helper."
mk_react_pkg image-viewer-react   "Image MIME viewer: contributes a MimeRenderer for image/* to files:mime-renderers."
mk_react_pkg markdown-viewer-react "Markdown MIME viewer: contributes a MimeRenderer for text/markdown to files:mime-renderers."
mk_react_pkg pdf-viewer-react     "PDF MIME viewer: contributes a MimeRenderer for application/pdf to files:mime-renderers."
mk_react_pkg video-viewer-react   "Video MIME viewer: contributes a MimeRenderer for video/* to files:mime-renderers."

echo "Scaffold complete."

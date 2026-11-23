# @statewalker/render.view.react

## 0.3.0

### Minor Changes

- 0b4b931: Move to the kernel 0.8 packages (workspace.core, shell.core, explorer.core, mime.core, render.core, settings.core, webapp.browser, workspace.browser), ai-config.core and ai-local-models.core 0.7, `@statewalker/webrun-files` 0.12, and `@json-render/*` 0.22 (the line ai-config.core 0.7 uses, so one copy of json-render is installed). These are breaking lines of their dependencies: `..` path segments are now resolved before any filter or mount sees the path, and a path climbing above the root throws.

## 0.2.2

### Patch Changes

- Release of the changes since the last published version:
  
  - files changed: README.md

## 0.1.1

### Patch Changes

- Initial public release from the statewalker multi-repo ecosystem.

// @statewalker/workspace-vcs.core — public barrel.
//
// GitNature: version control as an opt-in nature of a workbench project. A real
// `.git` per project (native-git compatible, via `@statewalker/vcs-store-files`),
// driven manually — init · add · commit · log · status — plus HTTP remotes.
//
// Surface: config (the `nature.vcs.json` marker) + runtime (VcsNature and its
// project-rooted FilesApi).

export * from "./adapters/index.js";
export * from "./config/index.js";
export * from "./remotes/index.js";
export * from "./runtime/index.js";

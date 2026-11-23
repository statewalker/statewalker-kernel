import type { A2ui } from "./system-a2ui.js";

/** Why the installed model was refused: none installed, or a second host tried to. */
export class A2uiInstallError extends Error {
  override readonly name = "A2uiInstallError";
  constructor(readonly kind: "not-installed" | "already-installed") {
    super(
      kind === "not-installed"
        ? "no A2UI model is installed: the shell installs it at boot"
        : "an A2UI model is installed already: one host at a time",
    );
  }
}

let installed: A2ui | undefined;

/**
 * Install the shell's model, so fragments' client halves reach the surfaces (the shell shares
 * this module through its import map, so every fragment sees the same one). Returns the
 * uninstaller.
 */
export function installA2ui(a2ui: A2ui): () => void {
  if (installed) throw new A2uiInstallError("already-installed");
  installed = a2ui;
  return () => {
    if (installed === a2ui) installed = undefined;
  };
}

/** The installed model. Throws an `A2uiInstallError` before the install. */
export function installedA2ui(): A2ui {
  if (!installed) throw new A2uiInstallError("not-installed");
  return installed;
}

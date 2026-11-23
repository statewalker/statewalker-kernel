import type { Appearance } from "../src/index.js";
import { SYSTEM_APPEARANCE_ID, tokensCss } from "../src/index.js";

export interface ApplyAppearanceOptions {
  /** The page; `globalThis.document` by default. */
  readonly document?: Document;
  /** Where the system's mode comes from; `globalThis.matchMedia` by default, none without it. */
  readonly matchMedia?: (query: string) => MediaQueryList;
}

const DARK_QUERY = "(prefers-color-scheme: dark)";

/**
 * Set the page from the appearance model, and keep it set: the active palette as the shadcn
 * tokens (one `<style data-fragment="system.appearance">`), `.dark` and `color-scheme` on the root
 * for the mode shown, the brand's name as the document's title and its logo as the icon. The
 * system's mode follows `prefers-color-scheme`. Returns the disposer, which takes it all back.
 */
export function applyAppearance(
  appearance: Appearance,
  options: ApplyAppearanceOptions = {},
): () => void {
  const doc = options.document ?? globalThis.document;
  const matchMedia = options.matchMedia ?? globalThis.matchMedia?.bind(globalThis);
  const root = doc.documentElement;
  const style = doc.createElement("style");
  style.dataset.fragment = SYSTEM_APPEARANCE_ID;
  doc.head.append(style);
  let icon: HTMLLinkElement | undefined;
  const title = doc.title;

  const query = matchMedia?.(DARK_QUERY);
  const follow = () => appearance.setSystemMode(query?.matches ? "dark" : "light");
  follow();
  query?.addEventListener("change", follow);

  const stop = appearance.observe((state) => {
    style.textContent = tokensCss(state.palette);
    root.classList.toggle("dark", state.colorMode === "dark");
    root.style.colorScheme = state.colorMode;
    doc.title = state.brand?.name ?? title;
    const logo = state.brand?.logo;
    if (logo) {
      if (!icon) {
        icon = doc.createElement("link");
        icon.rel = "icon";
        icon.dataset.fragment = SYSTEM_APPEARANCE_ID;
        doc.head.append(icon);
      }
      icon.href = logo;
    } else {
      icon?.remove();
      icon = undefined;
    }
  });

  return () => {
    stop();
    query?.removeEventListener("change", follow);
    style.remove();
    icon?.remove();
    root.classList.remove("dark");
    root.style.colorScheme = "";
    doc.title = title;
  };
}

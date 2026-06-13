import { transform } from "sucrase";

export interface SourceResult {
  type: "js" | "css" | "json" | "ts";
  source: string;
}

type DefaultSourceHook = (
  url: string,
  fetchOpts: RequestInit,
  parent: string,
) => Promise<SourceResult>;

/**
 * es-module-shims source hook that handles non-JS module types:
 * - .css  → JS module that injects a <style> element, exports CSS text
 * - .ts/.tsx → Compiled via sucrase (strip types + JSX transform)
 * - .json → JS module with `export default <json>`
 */
export async function sourceHook(
  url: string,
  fetchOpts: RequestInit,
  parent: string,
  defaultSourceHook: DefaultSourceHook,
): Promise<SourceResult> {
  // Strip version query params (e.g., ?v=123 from hot reload)
  const cleanUrl = url.replace(/\?v=\d+$/, "");

  if (cleanUrl.endsWith(".css")) {
    return handleCss(url, fetchOpts);
  }

  if (cleanUrl.endsWith(".ts") || cleanUrl.endsWith(".tsx")) {
    return handleTypeScript(url, fetchOpts, cleanUrl);
  }

  if (cleanUrl.endsWith(".json")) {
    return handleJson(url, fetchOpts);
  }

  return defaultSourceHook(url, fetchOpts, parent);
}

async function handleCss(url: string, fetchOpts: RequestInit): Promise<SourceResult> {
  const res = await fetch(url, fetchOpts);
  const css = await res.text();
  const escaped = JSON.stringify(css);
  const source = `
const css = ${escaped};
const style = document.createElement("style");
style.textContent = css;
document.head.appendChild(style);
export default css;
`.trim();
  return { type: "js", source };
}

async function handleTypeScript(
  url: string,
  fetchOpts: RequestInit,
  cleanUrl: string,
): Promise<SourceResult> {
  const res = await fetch(url, fetchOpts);
  const tsSource = await res.text();
  const transforms: Array<"typescript" | "jsx"> = ["typescript"];
  if (cleanUrl.endsWith(".tsx")) {
    transforms.push("jsx");
  }
  const { code } = transform(tsSource, {
    transforms,
    jsxRuntime: "automatic",
    filePath: cleanUrl,
  });
  return { type: "js", source: code };
}

async function handleJson(url: string, fetchOpts: RequestInit): Promise<SourceResult> {
  const res = await fetch(url, fetchOpts);
  const json = await res.text();
  return { type: "js", source: `export default ${json};` };
}

function commonPrefix(strings: string[]): string {
  if (strings.length === 0 || !strings[0]?.length) return "";
  // Start with the directory part of the first string
  let prefix = strings[0].slice(0, strings[0].lastIndexOf("/") + 1);
  for (let i = 1; i < strings.length; i++) {
    while (prefix && !strings[i]?.startsWith(prefix)) {
      // Remove trailing slash, find previous slash, trim to it
      const trimmed = prefix.slice(0, -1);
      const idx = trimmed.lastIndexOf("/");
      prefix = idx >= 0 ? trimmed.slice(0, idx + 1) : "";
    }
  }
  return prefix;
}

export function formatModulesMap(
  modulesMap: Record<string, string>,
): Record<string, Record<string, string>> {
  // Group URIs by scheme
  const byScheme: Record<string, { name: string; uri: string }[]> = {};
  for (const [name, uri] of Object.entries(modulesMap)) {
    const colonIdx = uri.indexOf("://");
    const scheme = colonIdx >= 0 ? uri.slice(0, colonIdx + 3) : "";
    if (!byScheme[scheme]) byScheme[scheme] = [];
    byScheme[scheme].push({ name, uri });
  }

  const result: Record<string, Record<string, string>> = {};

  for (const entries of Object.values(byScheme)) {
    const uris = entries.map((e) => e.uri);
    const prefix = commonPrefix(uris);
    const key = prefix || "other";
    const group: Record<string, string> = {};
    for (const { name, uri } of entries) {
      group[name] = prefix ? uri.slice(prefix.length) : uri;
    }
    result[key] = group;
  }

  return result;
}

/** Values a text's `{name}` placeholders are filled from. */
export type MessageParams = Readonly<Record<string, unknown>>;

/**
 * `text` with each `{name}` replaced by `params.name`, formatted for `locale` with `Intl`: a
 * number by `Intl.NumberFormat`, a `Date` by `Intl.DateTimeFormat`, an array of strings by
 * `Intl.ListFormat`, anything else as a string. A placeholder without a value stays as written.
 */
export function formatMessage(text: string, params: MessageParams = {}, locale?: string): string {
  return text.replace(/\{([\w.-]+)\}/g, (whole, name: string) => {
    const value = params[name];
    if (value === undefined) return whole;
    return formatValue(value, locale);
  });
}

/** One value as `formatMessage` writes it. */
export function formatValue(value: unknown, locale?: string): string {
  try {
    if (typeof value === "number" || typeof value === "bigint") {
      return new Intl.NumberFormat(locale).format(value);
    }
    if (value instanceof Date) return new Intl.DateTimeFormat(locale).format(value);
    if (Array.isArray(value) && value.every((v) => typeof v === "string")) {
      return new Intl.ListFormat(locale).format(value);
    }
  } catch {
    // A locale Intl refuses: written as a string below.
  }
  return String(value);
}

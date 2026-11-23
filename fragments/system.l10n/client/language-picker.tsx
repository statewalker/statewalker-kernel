import { useEffect, useState } from "react";
import { type L10n, type L10nState, SYSTEM_L10N_ID } from "../src/index.js";

/** A locale's name in its own language (`français`), through `Intl.DisplayNames`. */
export function localeName(locale: string): string {
  try {
    const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale);
    if (name) return name.slice(0, 1).toLocaleUpperCase(locale) + name.slice(1);
  } catch {
    // A tag Intl cannot name: the tag itself.
  }
  return locale;
}

/**
 * The interface language's picker: every locale a bundle is contributed in (the default first),
 * each named in its own language; picking one switches the language live. A native `<select>`
 * labelled "Language" in the interface language (`data-testid="language-picker"`), styled by
 * `client.css`.
 */
export function LanguagePicker({ l10n }: { l10n: L10n }) {
  const [state, setState] = useState<L10nState>(() => l10n.state());
  useEffect(() => l10n.observe(setState), [l10n]);
  const label = l10n.text(SYSTEM_L10N_ID, "picker.label", { fallback: "Language" });
  // The interface language may be a region of a listed one (`en-US`): its language is selected.
  const selected =
    state.locales.find((l) => l.toLowerCase() === state.locale.toLowerCase()) ??
    state.locales.find((l) => state.locale.toLowerCase().startsWith(`${l.toLowerCase()}-`)) ??
    state.locale;
  const options = state.locales.includes(selected) ? state.locales : [selected, ...state.locales];
  return (
    <label className="system-l10n-picker">
      <span>{label}</span>
      <select
        data-testid="language-picker"
        aria-label={label}
        value={selected}
        onChange={(event) => l10n.setLocale(event.target.value)}
      >
        {options.map((locale) => (
          <option key={locale} value={locale} lang={locale}>
            {localeName(locale)}
          </option>
        ))}
      </select>
    </label>
  );
}

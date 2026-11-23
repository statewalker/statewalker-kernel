import { evaluateWhen, type WhenContext } from "./when.js";

/** A keybinding the workbench dispatches: its chord normalized, its command on the bus. */
export interface WorkbenchKeybinding {
  /** The chord, normalized (`ctrl+alt+n`): modifiers in the order ctrl, shift, alt, meta. */
  readonly key: string;
  /** The command's identity, `<fragment-id>/<command-id>`. */
  readonly command: string;
  readonly when?: string;
  /** The contributing fragment. */
  readonly fragment: string;
}

/** The parts of a DOM `KeyboardEvent` a chord is read from. */
export interface KeyEventLike {
  readonly key: string;
  /** The physical key (`KeyN`); letters and digits are read from it, whatever the layout or Alt. */
  readonly code?: string;
  readonly ctrlKey: boolean;
  readonly shiftKey: boolean;
  readonly altKey: boolean;
  readonly metaKey: boolean;
  /** The DOM's modifier state: a key typed with `AltGraph` (AltGr) is text, never a chord. */
  getModifierState?(modifier: string): boolean;
}

const MODIFIERS = ["ctrl", "shift", "alt", "meta"] as const;
const ALIASES: Record<string, string> = {
  control: "ctrl",
  option: "alt",
  cmd: "meta",
  command: "meta",
  super: "meta",
  win: "meta",
  esc: "escape",
  space: " ",
};

/**
 * A chord as the registry compares it: lowercase, aliases resolved (`cmd` is `meta`, `option`
 * is `alt`), modifiers first in the order ctrl, shift, alt, meta, then one key.
 */
export function normalizeChord(chord: string): string {
  const parts = chord
    .split("+")
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== "")
    .map((part) => ALIASES[part] ?? part);
  const modifiers = MODIFIERS.filter((m) => parts.includes(m));
  const keys = parts.filter((p) => !(MODIFIERS as readonly string[]).includes(p));
  return [...modifiers, ...keys].join("+");
}

/**
 * The chord a key event makes; undefined for a modifier pressed alone, and for a key typed with
 * AltGr (which Windows reports as ctrl+alt: `ctrl+alt+n` would otherwise swallow a Polish ń).
 */
export function chordOf(event: KeyEventLike): string | undefined {
  if (event.getModifierState?.("AltGraph")) return undefined;
  const physical = /^Key([A-Z])$|^Digit([0-9])$/.exec(event.code ?? "");
  const key = physical ? (physical[1] ?? physical[2] ?? "").toLowerCase() : event.key.toLowerCase();
  if (["control", "shift", "alt", "meta", "os", ""].includes(key)) return undefined;
  const modifiers = [
    event.ctrlKey && "ctrl",
    event.shiftKey && "shift",
    event.altKey && "alt",
    event.metaKey && "meta",
  ].filter(Boolean);
  return [...modifiers, ALIASES[key] ?? key].join("+");
}

/**
 * Whether a chord may type text in a field: no modifier, shift alone, alt (with or without
 * shift), or ctrl+alt (AltGr on Windows). Only ctrl and meta chords are commands for sure.
 */
export function typesText(chord: string): boolean {
  const parts = chord.split("+");
  const ctrl = parts.includes("ctrl");
  const meta = parts.includes("meta");
  return !(ctrl || meta) || (ctrl && parts.includes("alt") && !meta);
}

/**
 * The command `event` runs among `bindings`: the last one whose chord matches and `when` holds.
 * While a text field has the focus (`context.inputFocus`), a binding without a `when` leaves
 * chords that may type text (`typesText`) to the field; a binding whose `when` is given decides
 * for itself.
 */
export function commandForKey(
  bindings: readonly WorkbenchKeybinding[],
  event: KeyEventLike,
  context: WhenContext = {},
): string | undefined {
  const chord = chordOf(event);
  if (chord === undefined) return undefined;
  for (let i = bindings.length - 1; i >= 0; i--) {
    const binding = bindings[i];
    if (binding?.key !== chord) continue;
    if (binding.when === undefined && context.inputFocus && typesText(chord)) continue;
    if (evaluateWhen(binding.when, context)) return binding.command;
  }
  return undefined;
}

/** A normalized chord as menus and the palette show it: `ctrl+alt+n` → `Ctrl+Alt+N`. */
export function formatChord(chord: string): string {
  return chord
    .split("+")
    .map((part) => (part === " " ? "Space" : part.charAt(0).toUpperCase() + part.slice(1)))
    .join("+");
}

/** The chords that open the command palette (the workbench's own; not on the keybindings point). */
export const PALETTE_CHORDS: readonly string[] = ["ctrl+shift+p", "meta+shift+p", "f1"];

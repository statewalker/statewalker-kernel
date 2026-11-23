/**
 * Common shape of slot values that order themselves with `order` +
 * `id` tiebreaker. Both `SettingsTab` and `ComposerAction` match
 * this — same convention applied to plug-in contributions.
 */
export interface OrderedById {
  id: string;
  order?: number;
}

/**
 * Stable comparator: lower `order` wins (default 100), ties broken
 * lexicographically by `id`. Used across slot consumers so the
 * default ordering is consistent without each consumer coding the
 * comparator inline.
 */
export function compareByOrderAndId(a: OrderedById, b: OrderedById): number {
  return (a.order ?? 100) - (b.order ?? 100) || a.id.localeCompare(b.id);
}

/**
 * Renderer-only fragment that owns the shadcn primitives and the
 * `cn()` helper. Exposes no slots or commands; consumers import
 * components from `@statewalker/shadcn-react`. The init is a no-op —
 * the fragment exists purely to encapsulate the vendor-library
 * substrate as a fragment rather than a free-floating `src/components`
 * directory (per ADR 0002).
 */
export default function initShadcnViews(_ctx: Record<string, unknown>): () => void {
  return () => {
    /* no-op */
  };
}

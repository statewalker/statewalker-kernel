import { useEffect, useState } from "react";
import type { Appearance } from "../src/index.js";

/** The active brand: its logo and its name (styled by `client.css`). */
export function BrandMark({ appearance }: { appearance: Appearance }) {
  const [brand, setBrand] = useState(() => appearance.brand());
  useEffect(() => appearance.observe((state) => setBrand(state.brand)), [appearance]);
  if (!brand) return null;
  return (
    <div className="system-appearance-brand" data-testid="brand">
      {brand.logo && <img src={brand.logo} alt="" width={20} height={20} />}
      <span>{brand.name}</span>
    </div>
  );
}

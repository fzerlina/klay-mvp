import { createContext, useContext, useMemo, useState } from "react";
import { DIMENSIONS as SEED_DIMENSIONS } from "../data/seed/dimensions";

// Configured dimensions (seed + anything added in Settings → Accounting →
// Dimensions), shared so a value added there is offered everywhere that reads
// it live — e.g. mapping a department to its Department value in Users.
const DimensionsContext = createContext(null);

export function DimensionsProvider({ children }) {
  const [dimensions, setDimensions] = useState(() => SEED_DIMENSIONS.map((d) => ({ ...d, values: [...d.values] })));
  const value = useMemo(() => ({
    dimensions,
    setDimensions,
    // Real values of one dimension ("—" is the seed's "not tagged" filler).
    valuesOf: (key) => (dimensions.find((d) => d.key === key)?.values || []).filter((v) => v !== "—"),
  }), [dimensions]);
  return <DimensionsContext.Provider value={value}>{children}</DimensionsContext.Provider>;
}

export function useDimensions() {
  const ctx = useContext(DimensionsContext);
  if (!ctx) throw new Error("useDimensions must be used within DimensionsProvider");
  return ctx;
}

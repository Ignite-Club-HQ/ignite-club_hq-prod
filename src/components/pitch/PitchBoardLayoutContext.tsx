import { createContext, useContext } from "react";

// Loose context bag: PitchBoard provides 300+ state values / refs / callbacks
// to its landscape & portrait layout children. We accept `any` here as a
// pragmatic escape hatch — tightening types is a separate follow-up.
export const PitchBoardLayoutContext = createContext<any>(null);

export const usePitchBoardLayoutContext = (): any => {
  const ctx = useContext(PitchBoardLayoutContext);
  if (!ctx) {
    throw new Error(
      "usePitchBoardLayoutContext must be used within a PitchBoardLayoutContext.Provider"
    );
  }
  return ctx;
};

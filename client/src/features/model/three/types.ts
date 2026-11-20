import type { Model } from "../space";

export type CamView = { v: "top" | "3d" | "fit"; n: number };
export type ColorBy = "steel" | "review" | "sequence";
export type ViewerProps = {
  model: Model;
  sel: string | null;
  selected?: string[];
  colorBy?: ColorBy;
  view: CamView | null;
  onPick: (key: string | null, additive?: boolean) => void;
  onNoGL: () => void;
  label?: string;
};

/** Stable, muted colors based on the complete model's sequence order. */
export const SEQUENCE_COLORS = [
  "#6b8eaa",
  "#a88c65",
  "#829c7c",
  "#a18191",
  "#7d91b3",
  "#b08b7b",
  "#759e9b",
  "#9b9870",
  "#8e83a3",
  "#82909c",
];
export const sequenceColor = (sequence: string, sequences: string[]) =>
  sequence
    ? SEQUENCE_COLORS[
        Math.max(0, sequences.indexOf(sequence)) % SEQUENCE_COLORS.length
      ]
    : "#858c93";

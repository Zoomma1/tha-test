export type PartKind = "blade" | "ratchet" | "bit";

export interface PartSeed {
  kind: PartKind;
  name: string;
}

// Données d'exemple : noms plausibles de pièces Beyblade X, sans prétention d'exhaustivité.
export const SEED_PARTS: readonly PartSeed[] = [
  { kind: "blade", name: "Dran Sword" },
  { kind: "blade", name: "Hells Scythe" },
  { kind: "blade", name: "Wizard Arrow" },
  { kind: "blade", name: "Knight Shield" },
  { kind: "blade", name: "Shark Edge" },
  { kind: "blade", name: "Leon Claw" },
  { kind: "blade", name: "Viper Tail" },
  { kind: "blade", name: "Rhino Horn" },
  { kind: "ratchet", name: "3-60" },
  { kind: "ratchet", name: "4-60" },
  { kind: "ratchet", name: "5-60" },
  { kind: "ratchet", name: "3-80" },
  { kind: "ratchet", name: "4-80" },
  { kind: "ratchet", name: "5-80" },
  { kind: "ratchet", name: "9-60" },
  { kind: "ratchet", name: "1-60" },
  { kind: "bit", name: "Flat" },
  { kind: "bit", name: "Ball" },
  { kind: "bit", name: "Needle" },
  { kind: "bit", name: "Point" },
  { kind: "bit", name: "Taper" },
  { kind: "bit", name: "High Needle" },
  { kind: "bit", name: "Low Flat" },
  { kind: "bit", name: "Rush" },
];

export const SEED_OWNED: readonly { partName: string; quantity: number }[] = [
  { partName: "Dran Sword", quantity: 1 },
  { partName: "3-60", quantity: 2 },
  { partName: "Flat", quantity: 1 },
  { partName: "Hells Scythe", quantity: 1 },
];

export const SEED_BUILD = { name: "Dran Sword 3-60 Flat", partNames: ["Dran Sword", "3-60", "Flat"] } as const;

export const SEED_WISHLIST: readonly { partName: string; note: string }[] = [
  { partName: "Wizard Arrow", note: "Pour une build défensive" },
  { partName: "Rush", note: "À tester en attaque" },
];

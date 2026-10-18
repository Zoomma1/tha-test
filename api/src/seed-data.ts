export type PartKind = "blade" | "ratchet" | "bit";

export interface PartSeed {
  kind: PartKind;
  name: string;
  weightGrams: number;
}

// Données d'exemple : noms plausibles de pièces Beyblade X, sans prétention d'exhaustivité.
export const SEED_PARTS: readonly PartSeed[] = [
  { kind: "blade", name: "Dran Sword", weightGrams: 40 },
  { kind: "blade", name: "Hells Scythe", weightGrams: 38 },
  { kind: "blade", name: "Wizard Arrow", weightGrams: 36 },
  { kind: "blade", name: "Knight Shield", weightGrams: 34 },
  { kind: "blade", name: "Shark Edge", weightGrams: 32 },
  { kind: "blade", name: "Leon Claw", weightGrams: 31 },
  { kind: "blade", name: "Viper Tail", weightGrams: 33 },
  { kind: "blade", name: "Rhino Horn", weightGrams: 35 },
  { kind: "ratchet", name: "3-60", weightGrams: 8 },
  { kind: "ratchet", name: "4-60", weightGrams: 9 },
  { kind: "ratchet", name: "5-60", weightGrams: 10 },
  { kind: "ratchet", name: "3-80", weightGrams: 11 },
  { kind: "ratchet", name: "4-80", weightGrams: 12 },
  { kind: "ratchet", name: "5-80", weightGrams: 13 },
  { kind: "ratchet", name: "9-60", weightGrams: 14 },
  { kind: "ratchet", name: "1-60", weightGrams: 10 },
  { kind: "bit", name: "Flat", weightGrams: 2 },
  { kind: "bit", name: "Ball", weightGrams: 3 },
  { kind: "bit", name: "Needle", weightGrams: 4 },
  { kind: "bit", name: "Point", weightGrams: 5 },
  { kind: "bit", name: "Taper", weightGrams: 6 },
  { kind: "bit", name: "High Needle", weightGrams: 3 },
  { kind: "bit", name: "Low Flat", weightGrams: 4 },
  { kind: "bit", name: "Rush", weightGrams: 5 },
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

import type { PrismaClient } from "./generated/client.js";
import { hashPassword } from "./auth/password.js";
import { DEMO_PASSWORD, SEED_BUILD, SEED_OWNED, SEED_PARTS, SEED_USERS, SEED_WISHLIST } from "./seed-data.js";

export async function seed(db: PrismaClient): Promise<void> {
  for (const u of SEED_USERS) {
    const passwordHash = await hashPassword(DEMO_PASSWORD);
    await db.user.create({ data: { handle: u.handle, displayName: u.displayName, passwordHash } });
  }

  await db.part.createMany({ data: [...SEED_PARTS] });
  const me = await db.user.findUnique({ where: { handle: "me" } });
  if (me === null) throw new Error("utilisateur de seed manquant : me");
  const ownerId = me.id;
  const parts = await db.part.findMany();
  const idOf = (name: string): number => {
    const part = parts.find((p) => p.name === name);
    if (part === undefined) throw new Error(`pièce de seed inconnue : ${name}`);
    return part.id;
  };

  await db.ownedPart.createMany({ data: SEED_OWNED.map((o) => ({ ownerId, partId: idOf(o.partName), quantity: o.quantity })) });
  const build = await db.build.create({ data: { ownerId, name: SEED_BUILD.name } });
  await db.buildPart.createMany({ data: SEED_BUILD.partNames.map((n) => ({ buildId: build.id, partId: idOf(n) })) });
  await db.wishlistItem.createMany({ data: SEED_WISHLIST.map((w) => ({ ownerId, partId: idOf(w.partName), note: w.note })) });
}

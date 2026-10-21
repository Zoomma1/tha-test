-- Les lignes existantes prennent ownerId = 1 (l'utilisateur "me", créé par le seed).
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_OwnedPart" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL DEFAULT 1,
    "partId" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    CONSTRAINT "OwnedPart_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "OwnedPart_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_OwnedPart" ("id", "partId", "quantity") SELECT "id", "partId", "quantity" FROM "OwnedPart";
DROP TABLE "OwnedPart";
ALTER TABLE "new_OwnedPart" RENAME TO "OwnedPart";
CREATE UNIQUE INDEX "OwnedPart_ownerId_partId_key" ON "OwnedPart"("ownerId", "partId");

CREATE TABLE "new_Build" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "ownerId" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    CONSTRAINT "Build_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Build" ("id", "name", "notes") SELECT "id", "name", "notes" FROM "Build";
DROP TABLE "Build";
ALTER TABLE "new_Build" RENAME TO "Build";

CREATE TABLE "new_WishlistItem" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "partId" INTEGER NOT NULL,
    "note" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "ownerId" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "WishlistItem_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "WishlistItem_partId_fkey" FOREIGN KEY ("partId") REFERENCES "Part" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_WishlistItem" ("id", "note", "partId", "priority") SELECT "id", "note", "partId", "priority" FROM "WishlistItem";
DROP TABLE "WishlistItem";
ALTER TABLE "new_WishlistItem" RENAME TO "WishlistItem";

PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

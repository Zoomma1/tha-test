-- Une ligne d'inventaire par pièce : on fusionne d'abord les doublons éventuels
-- (quantités additionnées sur la plus petite id), puis on pose l'unicité.
UPDATE "OwnedPart"
SET "quantity" = (SELECT SUM(o."quantity") FROM "OwnedPart" o WHERE o."partId" = "OwnedPart"."partId")
WHERE "id" IN (SELECT MIN("id") FROM "OwnedPart" GROUP BY "partId");

DELETE FROM "OwnedPart"
WHERE "id" NOT IN (SELECT MIN("id") FROM "OwnedPart" GROUP BY "partId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnedPart_partId_key" ON "OwnedPart"("partId");

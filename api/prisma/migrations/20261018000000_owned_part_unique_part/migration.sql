-- Une ligne d'inventaire par pièce : fusionne d'abord les doublons éventuels.
UPDATE "OwnedPart" SET "quantity" = (
  SELECT SUM(o."quantity") FROM "OwnedPart" o WHERE o."partId" = "OwnedPart"."partId"
) WHERE "id" IN (SELECT MIN("id") FROM "OwnedPart" GROUP BY "partId");

DELETE FROM "OwnedPart" WHERE "id" NOT IN (SELECT MIN("id") FROM "OwnedPart" GROUP BY "partId");

-- CreateIndex
CREATE UNIQUE INDEX "OwnedPart_partId_key" ON "OwnedPart"("partId");

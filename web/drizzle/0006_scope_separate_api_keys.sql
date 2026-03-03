ALTER TABLE "apikey" ADD COLUMN "type" text DEFAULT 'user';
UPDATE "apikey" SET "type" = 'device' WHERE "name" = 'Paired Device';

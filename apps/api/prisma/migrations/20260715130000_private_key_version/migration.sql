-- Encryption metadata is stored separately so private HR data can be re-encrypted during key rotation.
ALTER TABLE "RequestPrivateDetail" ADD COLUMN "keyVersion" INTEGER NOT NULL DEFAULT 1;

-- Additive migration; run once before starting the new backend. Safe to rerun.
BEGIN;
CREATE TABLE IF NOT EXISTS "WebsiteConnection" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "siteUrl" TEXT NOT NULL,
  "credentials" TEXT NOT NULL,
  "reconnectRequired" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "WebsiteConnection_organizationId_siteUrl_key" ON "WebsiteConnection"("organizationId", "siteUrl");
CREATE TABLE IF NOT EXISTS "WebsiteAuthorization" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "organizationId" TEXT NOT NULL REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "userId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX IF NOT EXISTS "WebsiteAuthorization_expiresAt_idx" ON "WebsiteAuthorization"("expiresAt");
COMMIT;

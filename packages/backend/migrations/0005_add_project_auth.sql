-- SaaS auth: per-tenant Project with a publishable key (browser widget, create
-- reports only) and a hashed secret key (runner / review API, scoped read/write).
-- Auth is enforced only when PAIKKO_AUTH=required; with no Project rows the
-- deployment stays single-tenant and unauthenticated (back-compatible).
-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "publishableKey" TEXT NOT NULL,
    "secretKeyHash" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_slug_key" ON "Project"("slug");
CREATE UNIQUE INDEX "Project_publishableKey_key" ON "Project"("publishableKey");
CREATE UNIQUE INDEX "Project_secretKeyHash_key" ON "Project"("secretKeyHash");

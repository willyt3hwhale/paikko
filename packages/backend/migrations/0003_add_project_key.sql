-- SaaS / multi-tenancy seam: persist the project/tenant a ticket belongs to.
-- The reporting widget stamps `projectKey` on the ReportBundle (and/or sends it
-- as the x-paikko-project header); the intake persists it here. Nullable: null in
-- the current single-tenant deployment. List/queries ignore it for now, so making
-- multi-tenancy real is a value flip rather than a schema change.
-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "projectKey" TEXT;

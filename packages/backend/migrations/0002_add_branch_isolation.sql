-- Branch-isolated review: each ticket is fixed in its own git worktree + branch
-- ("ticket/{id}") off main and viewed in its own isolated preview. Persist the
-- branch name and the isolated preview URL on the ticket so "View fix" can link
-- to the right preview and Accept can merge the right branch. Both nullable
-- (null until the agent cuts the branch / brings up the preview). The "rejected"
-- status is app-validated (status stays a free TEXT column), so no schema change
-- is needed for it.
-- AlterTable
ALTER TABLE "Ticket" ADD COLUMN "branch" TEXT;
ALTER TABLE "Ticket" ADD COLUMN "previewUrl" TEXT;

-- Cross-request backend-trace buffer (D1-backed). Replaces the SessionTrace
-- Durable Object as the default trace buffer: D1 is available in every
-- environment (including local `next dev`, where app-defined Durable Objects are
-- not), so the `trace` artifact populates everywhere. The capture seam appends
-- one row per finished request keyed by sessionId; the report intake drains all
-- rows for a session (oldest first, then deletes them) to build the artifact.
-- `payload` is the JSON-serialized TraceRequest, stored as TEXT to match how
-- Artifact payloads are kept for SQLite/D1.
-- CreateTable
CREATE TABLE "TraceEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sessionId" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "TraceEntry_sessionId_idx" ON "TraceEntry"("sessionId");

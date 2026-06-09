-- Speed up the CRM "Registro" query that orders contacts by updatedAt within a workspace.
CREATE INDEX "Contact_workspaceId_updatedAt_idx"
ON "Contact"("workspaceId", "updatedAt");

-- CreateIndex
CREATE INDEX "Interim_projectId_idx" ON "Interim"("projectId");

-- CreateIndex
CREATE INDEX "Intervention_projectId_idx" ON "Intervention"("projectId");

-- CreateIndex
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");

-- CreateIndex
CREATE INDEX "Project_clientId_idx" ON "Project"("clientId");

-- CreateIndex
CREATE INDEX "ProjectFile_projectId_idx" ON "ProjectFile"("projectId");

-- CreateIndex
CREATE INDEX "ProjectFile_folderId_idx" ON "ProjectFile"("folderId");

-- CreateIndex
CREATE INDEX "ProjectFolder_projectId_parentId_idx" ON "ProjectFolder"("projectId", "parentId");

-- CreateIndex
CREATE INDEX "ProjectFolder_parentId_idx" ON "ProjectFolder"("parentId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_projectId_idx" ON "ProjectMaterial"("projectId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_taskId_idx" ON "ProjectMaterial"("taskId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_taskGroupId_idx" ON "ProjectMaterial"("taskGroupId");

-- CreateIndex
CREATE INDEX "ProjectMaterial_taskCategoryId_idx" ON "ProjectMaterial"("taskCategoryId");

-- CreateIndex
CREATE INDEX "ProjectTask_projectId_idx" ON "ProjectTask"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTask_groupId_idx" ON "ProjectTask"("groupId");

-- CreateIndex
CREATE INDEX "ProjectTask_categoryId_idx" ON "ProjectTask"("categoryId");

-- CreateIndex
CREATE INDEX "ProjectTask_assignedCompanyId_idx" ON "ProjectTask"("assignedCompanyId");

-- CreateIndex
CREATE INDEX "ProjectTask_assignedInterimId_idx" ON "ProjectTask"("assignedInterimId");

-- CreateIndex
CREATE INDEX "ProjectTaskCategory_projectId_idx" ON "ProjectTaskCategory"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTaskCategory_assignedCompanyId_idx" ON "ProjectTaskCategory"("assignedCompanyId");

-- CreateIndex
CREATE INDEX "ProjectTaskCategory_assignedInterimId_idx" ON "ProjectTaskCategory"("assignedInterimId");

-- CreateIndex
CREATE INDEX "ProjectTaskGroup_projectId_idx" ON "ProjectTaskGroup"("projectId");

-- CreateIndex
CREATE INDEX "ProjectTaskGroup_categoryId_idx" ON "ProjectTaskGroup"("categoryId");

-- CreateIndex
CREATE INDEX "ProjectTaskGroup_assignedCompanyId_idx" ON "ProjectTaskGroup"("assignedCompanyId");

-- CreateIndex
CREATE INDEX "ProjectTaskGroup_assignedInterimId_idx" ON "ProjectTaskGroup"("assignedInterimId");

-- CreateIndex
CREATE INDEX "SubcontractorCompany_projectId_idx" ON "SubcontractorCompany"("projectId");

-- CreateIndex
CREATE INDEX "SubcontractorPerson_companyId_idx" ON "SubcontractorPerson"("companyId");

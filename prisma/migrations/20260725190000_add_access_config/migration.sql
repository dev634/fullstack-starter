-- RBAC matrix (capability -> min role) stored as JSON on the settings singleton.
ALTER TABLE "AppSettings" ADD COLUMN "accessConfig" JSONB NOT NULL DEFAULT '{}';

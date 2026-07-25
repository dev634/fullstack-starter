-- External client-portal login role (tied to a Contact, confined to /portail).
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'CLIENT';

-- Drop the Client's person-identity columns. These were migrated onto a
-- primary Contact by 20260719201322_add_contacts, so no data is lost: the
-- organisation is now identified by companyName and its people live in Contact.
ALTER TABLE "Client" DROP COLUMN "firstName";
ALTER TABLE "Client" DROP COLUMN "lastName";

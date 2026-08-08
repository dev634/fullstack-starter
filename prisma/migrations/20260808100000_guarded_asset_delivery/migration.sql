-- Guarded delivery of project-scoped Cloudinary assets.
--
-- Until now every ProjectFile / ReservePlan / ReservePhoto lived behind a
-- public Cloudinary URL (type "upload"): whoever had the URL had the bytes,
-- application authorisation included. Delivery moves behind a route that
-- re-checks access on every request, signs the URL server-side and streams the
-- result. The application must therefore be able to REBUILD a delivery URL
-- instead of replaying the stored one.
--
-- publicId alone is not enough for that:
--   * the resource type is not a function of the mime type — a réserve plan is
--     a PDF deliberately uploaded as an IMAGE so Cloudinary can rasterise its
--     pages, and ReservePlan/ReservePhoto carry no mime type at all;
--   * Cloudinary strips the extension out of the public id of image/video
--     resources (and keeps it inside the public id of raw ones), so the
--     delivery format has to be stored next to it;
--   * the version segment only exists inside the URL we are about to drop.
--
-- All three are backfilled here from the stored URL, the only place they exist
-- today. The backfill is kept even though the local database may be empty: it
-- protects production, which has not been inspected.
--
-- "url" is deliberately NOT dropped here — see the note at the bottom.
--
-- Out of scope: AppSettings.logoUrl and Client.photoUrl stay public.

-- CreateEnum
CREATE TYPE "CloudinaryDeliveryType" AS ENUM ('UPLOAD', 'AUTHENTICATED');

-- CreateEnum
CREATE TYPE "CloudinaryResourceType" AS ENUM ('IMAGE', 'VIDEO', 'RAW');


-- ---------------------------------------------------------------------------
-- ProjectFile
-- ---------------------------------------------------------------------------

ALTER TABLE "ProjectFile"
  ADD COLUMN "deliveryType" "CloudinaryDeliveryType" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "resourceType" "CloudinaryResourceType",
  ADD COLUMN "format"       TEXT,
  ADD COLUMN "version"      TEXT;

-- Every existing row is public, by definition: that is the state this change
-- exists to end. The one-shot script flips them to AUTHENTICATED once it has
-- re-typed the asset on Cloudinary's side.

-- Resource type as actually used at upload: read it off the stored URL
-- (".../<image|video|raw>/upload/..."), falling back to the same mime-type
-- derivation the application uses (lib/cloudinary.ts::resourceTypeFromMime)
-- when the value is not a Cloudinary delivery URL.
UPDATE "ProjectFile"
SET "resourceType" = COALESCE(
      UPPER(substring("url" from '/(image|video|raw)/upload/'))::"CloudinaryResourceType",
      (CASE
         WHEN "mimeType" LIKE 'image/%' THEN 'IMAGE'
         WHEN "mimeType" LIKE 'video/%' THEN 'VIDEO'
         ELSE 'RAW'
       END)::"CloudinaryResourceType"
    );

ALTER TABLE "ProjectFile" ALTER COLUMN "resourceType" SET NOT NULL;

-- Format = what must be appended to publicId. RAW rows stay NULL: their public
-- id already ends in the extension, and appending it again would build a URL
-- ending in ".pdf.pdf".
UPDATE "ProjectFile"
SET "format" = substring("url" from '\.([a-zA-Z0-9]{1,10})$')
WHERE "resourceType" <> 'RAW';

UPDATE "ProjectFile"
SET "version" = substring("url" from '/upload/v([0-9]{1,20})/');

-- Drop the transitional default so the column has to be stated on every
-- create: an asset's reachability is never implicit.
ALTER TABLE "ProjectFile" ALTER COLUMN "deliveryType" DROP DEFAULT;

-- format and version are concatenated into a delivery URL. Constrain their
-- shape in the database, not only in the application: a script or a manual
-- UPDATE goes around Zod, never around a CHECK. publicId is NOT NULL but an
-- empty string would build a URL pointing at a folder.
ALTER TABLE "ProjectFile"
  ADD CONSTRAINT "ProjectFile_format_check"   CHECK ("format"  IS NULL OR "format"  ~ '^[a-zA-Z0-9]{1,10}$'),
  ADD CONSTRAINT "ProjectFile_version_check"  CHECK ("version" IS NULL OR "version" ~ '^[0-9]{1,20}$'),
  ADD CONSTRAINT "ProjectFile_publicId_check" CHECK (length(btrim("publicId")) > 0);


-- ---------------------------------------------------------------------------
-- ReservePlan — always uploaded as resource_type "image" (a PDF whose pages
-- Cloudinary rasterises), so the URL fallback is IMAGE rather than a mime type.
-- ---------------------------------------------------------------------------

ALTER TABLE "ReservePlan"
  ADD COLUMN "deliveryType" "CloudinaryDeliveryType" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "resourceType" "CloudinaryResourceType",
  ADD COLUMN "format"       TEXT,
  ADD COLUMN "version"      TEXT;

UPDATE "ReservePlan"
SET "resourceType" = COALESCE(
      UPPER(substring("url" from '/(image|video|raw)/upload/'))::"CloudinaryResourceType",
      'IMAGE'::"CloudinaryResourceType"
    );

ALTER TABLE "ReservePlan" ALTER COLUMN "resourceType" SET NOT NULL;

UPDATE "ReservePlan"
SET "format" = substring("url" from '\.([a-zA-Z0-9]{1,10})$')
WHERE "resourceType" <> 'RAW';

UPDATE "ReservePlan"
SET "version" = substring("url" from '/upload/v([0-9]{1,20})/');

ALTER TABLE "ReservePlan" ALTER COLUMN "deliveryType" DROP DEFAULT;

ALTER TABLE "ReservePlan"
  ADD CONSTRAINT "ReservePlan_format_check"   CHECK ("format"  IS NULL OR "format"  ~ '^[a-zA-Z0-9]{1,10}$'),
  ADD CONSTRAINT "ReservePlan_version_check"  CHECK ("version" IS NULL OR "version" ~ '^[0-9]{1,20}$'),
  ADD CONSTRAINT "ReservePlan_publicId_check" CHECK (length(btrim("publicId")) > 0);


-- ---------------------------------------------------------------------------
-- ReservePhoto — always uploaded as resource_type "image".
-- ---------------------------------------------------------------------------

ALTER TABLE "ReservePhoto"
  ADD COLUMN "deliveryType" "CloudinaryDeliveryType" NOT NULL DEFAULT 'UPLOAD',
  ADD COLUMN "resourceType" "CloudinaryResourceType",
  ADD COLUMN "format"       TEXT,
  ADD COLUMN "version"      TEXT;

UPDATE "ReservePhoto"
SET "resourceType" = COALESCE(
      UPPER(substring("url" from '/(image|video|raw)/upload/'))::"CloudinaryResourceType",
      'IMAGE'::"CloudinaryResourceType"
    );

ALTER TABLE "ReservePhoto" ALTER COLUMN "resourceType" SET NOT NULL;

UPDATE "ReservePhoto"
SET "format" = substring("url" from '\.([a-zA-Z0-9]{1,10})$')
WHERE "resourceType" <> 'RAW';

UPDATE "ReservePhoto"
SET "version" = substring("url" from '/upload/v([0-9]{1,20})/');

ALTER TABLE "ReservePhoto" ALTER COLUMN "deliveryType" DROP DEFAULT;

ALTER TABLE "ReservePhoto"
  ADD CONSTRAINT "ReservePhoto_format_check"   CHECK ("format"  IS NULL OR "format"  ~ '^[a-zA-Z0-9]{1,10}$'),
  ADD CONSTRAINT "ReservePhoto_version_check"  CHECK ("version" IS NULL OR "version" ~ '^[0-9]{1,20}$'),
  ADD CONSTRAINT "ReservePhoto_publicId_check" CHECK (length(btrim("publicId")) > 0);


-- ---------------------------------------------------------------------------
-- No index is added by this migration, on purpose.
--
-- The delivery route resolves "identifier -> asset -> project" by primary key:
--   ProjectFile / ReservePlan  : PK lookup, projectId is on the row itself.
--   ReservePhoto               : PK lookup, then Reserve PK via the already
--                                indexed reserveId — Reserve denormalises
--                                projectId (see repository/reservePhotos.ts
--                                ::findProjectId), so this is one hop, not the
--                                two-hop photo -> reserve -> plan traversal.
-- Every FK on the three tables is already indexed.
--
-- Deliberately NOT indexed: "deliveryType". Two values, read by a one-shot
-- migration script and by an audit count; an index there would be ignored by
-- the planner and taxed on every upload.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- FOLLOW-UP, NOT IN THIS MIGRATION: dropping "url".
--
-- "url" is now fully redundant (publicId + resourceType + format + version
-- rebuild it exactly, signed or not) and must stop being read and serialised.
-- It is kept for one release anyway, because production applies migrations at
-- container start: dropping it in the same release as the code that stops
-- using it would make a rollback to the previous image unrecoverable — that
-- image reads a column that no longer exists.
--
-- Once this release is live AND the one-shot re-typing script has run, the
-- next migration is:
--
--   ALTER TABLE "ProjectFile"  DROP COLUMN "url";
--   ALTER TABLE "ReservePlan"  DROP COLUMN "url";
--   ALTER TABLE "ReservePhoto" DROP COLUMN "url";
--
-- Gate it on: SELECT count(*) FROM "ProjectFile"  WHERE "deliveryType" = 'UPLOAD';
--             (same for "ReservePlan" and "ReservePhoto") — all three must be 0.
-- ---------------------------------------------------------------------------

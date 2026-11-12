-- Migration 008: Add image URL for POIs.
-- Keep existing POI records unchanged.

IF COL_LENGTH(N'dbo.POIs', N'ImageUrl') IS NULL
BEGIN
    ALTER TABLE dbo.POIs
    ADD ImageUrl NVARCHAR(500) NULL;
END;

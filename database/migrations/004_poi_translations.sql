IF OBJECT_ID(N'dbo.POITranslations', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.POITranslations (
    POIId uniqueidentifier NOT NULL,
    Language varchar(2) NOT NULL,
    Name nvarchar(255) NULL,
    Description nvarchar(max) NULL,
    Address nvarchar(500) NULL,
    NameSourceHash char(64) NULL,
    DescriptionSourceHash char(64) NULL,
    AddressSourceHash char(64) NULL,
    NameManual bit NOT NULL CONSTRAINT DF_POITranslations_NameManual DEFAULT 0,
    DescriptionManual bit NOT NULL CONSTRAINT DF_POITranslations_DescriptionManual DEFAULT 0,
    AddressManual bit NOT NULL CONSTRAINT DF_POITranslations_AddressManual DEFAULT 0,
    UpdatedAt datetime2(3) NOT NULL CONSTRAINT DF_POITranslations_UpdatedAt DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_POITranslations PRIMARY KEY (POIId, Language),
    CONSTRAINT FK_POITranslations_POIs FOREIGN KEY (POIId) REFERENCES dbo.POIs(Id) ON DELETE CASCADE,
    CONSTRAINT CK_POITranslations_Language CHECK (Language IN ('en', 'ja', 'ko'))
  );
END;

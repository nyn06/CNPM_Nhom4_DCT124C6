IF OBJECT_ID(N'dbo.POITranslationJobs', N'U') IS NULL
BEGIN
  CREATE TABLE dbo.POITranslationJobs (
    POIId uniqueidentifier NOT NULL,
    Status varchar(10) NOT NULL CONSTRAINT DF_POITranslationJobs_Status DEFAULT 'pending',
    Attempts int NOT NULL CONSTRAINT DF_POITranslationJobs_Attempts DEFAULT 0,
    Revision int NOT NULL CONSTRAINT DF_POITranslationJobs_Revision DEFAULT 1,
    NextAttemptAt datetime2(3) NOT NULL CONSTRAINT DF_POITranslationJobs_Next DEFAULT SYSUTCDATETIME(),
    LeaseUntil datetime2(3) NULL,
    LastErrorCode varchar(32) NULL,
    UpdatedAt datetime2(3) NOT NULL CONSTRAINT DF_POITranslationJobs_Updated DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_POITranslationJobs PRIMARY KEY (POIId),
    CONSTRAINT FK_POITranslationJobs_POIs FOREIGN KEY (POIId) REFERENCES dbo.POIs(Id) ON DELETE CASCADE,
    CONSTRAINT CK_POITranslationJobs_Status CHECK (Status IN ('pending', 'processing', 'done', 'failed')),
    CONSTRAINT CK_POITranslationJobs_Attempts CHECK (Attempts >= 0)
  );
  CREATE INDEX IX_POITranslationJobs_Claim ON dbo.POITranslationJobs(Status, NextAttemptAt, LeaseUntil);
END;

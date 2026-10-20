-- Run in the application database after database/create-database.sql.
-- The migration runner records this version in dbo.SchemaMigrations.
CREATE TABLE dbo.Accounts (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  Username nvarchar(64) NOT NULL UNIQUE,
  PasswordHash varchar(100) NOT NULL,
  Role varchar(16) NOT NULL CHECK (Role IN ('ADMIN', 'POI_MANAGER')),
  IsLocked bit NOT NULL DEFAULT 0,
  Version int NOT NULL DEFAULT 1 CHECK (Version > 0),
  CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_Accounts_ActiveAdmin ON dbo.Accounts(Role, IsLocked);

CREATE TABLE dbo.AdminSessions (
  TokenHash char(64) NOT NULL PRIMARY KEY,
  AccountId uniqueidentifier NOT NULL REFERENCES dbo.Accounts(Id),
  AccountVersion int NOT NULL,
  CsrfToken char(64) NOT NULL,
  ExpiresAt datetime2(3) NOT NULL,
  CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  RevokedAt datetime2(3) NULL
);
CREATE INDEX IX_AdminSessions_AccountId ON dbo.AdminSessions(AccountId);
CREATE INDEX IX_AdminSessions_ExpiresAt ON dbo.AdminSessions(ExpiresAt);

CREATE TABLE dbo.LoginChallenges (
  TokenHash char(64) NOT NULL PRIMARY KEY,
  CsrfToken char(64) NOT NULL,
  ExpiresAt datetime2(3) NOT NULL
);

CREATE TABLE dbo.POIs (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  Name nvarchar(255) NOT NULL,
  Description nvarchar(max) NOT NULL,
  Category nvarchar(100) NOT NULL,
  Address nvarchar(500) NOT NULL,
  Latitude float NOT NULL CHECK (Latitude BETWEEN -90 AND 90),
  Longitude float NOT NULL CHECK (Longitude BETWEEN -180 AND 180),
  GeofenceRadius float NOT NULL CHECK (GeofenceRadius > 0),
  IsActive bit NOT NULL DEFAULT 1,
  CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  UpdatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);
CREATE INDEX IX_POIs_Active ON dbo.POIs(IsActive);

CREATE TABLE dbo.POINarrations (
  POIId uniqueidentifier NOT NULL REFERENCES dbo.POIs(Id) ON DELETE CASCADE,
  Language varchar(2) NOT NULL CHECK (Language IN ('vi', 'en', 'ja', 'ko')),
  Text nvarchar(max) NOT NULL,
  AudioFile nvarchar(255) NULL,
  UpdatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  CONSTRAINT PK_POINarrations PRIMARY KEY (POIId, Language)
);
CREATE INDEX IX_POINarrations_AudioFile ON dbo.POINarrations(AudioFile) WHERE AudioFile IS NOT NULL;

-- Legacy /api/narrations and /api/jobs do not belong to a POI.
CREATE TABLE dbo.Narrations (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  Text nvarchar(max) NOT NULL,
  Language varchar(2) NOT NULL CHECK (Language IN ('vi', 'en', 'ja', 'ko')),
  Status varchar(16) NOT NULL CHECK (Status IN ('processing', 'done', 'failed')),
  AudioFile nvarchar(255) NULL,
  CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Jobs (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  FileName nvarchar(255) NOT NULL,
  TargetLang varchar(2) NOT NULL,
  Status varchar(16) NOT NULL CHECK (Status IN ('processing', 'done', 'failed')),
  ResultText nvarchar(max) NULL,
  ResultAudioFile nvarchar(255) NULL,
  CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
);

CREATE TABLE dbo.Vouchers (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  CodeHash char(64) NOT NULL UNIQUE,
  DurationMinutes int NOT NULL CHECK (DurationMinutes IN (15, 60, 120)),
  Status varchar(8) NOT NULL DEFAULT 'unused' CHECK (Status IN ('unused', 'redeemed')),
  CreatedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME(),
  RedeemedAt datetime2(3) NULL,
  ExpiresAt datetime2(3) NULL,
  SessionId uniqueidentifier NULL
);
CREATE INDEX IX_Vouchers_CreatedAt ON dbo.Vouchers(CreatedAt);

CREATE TABLE dbo.GuestSessions (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  TokenHash char(64) NOT NULL UNIQUE,
  VoucherId uniqueidentifier NOT NULL UNIQUE REFERENCES dbo.Vouchers(Id),
  DurationMinutes int NOT NULL CHECK (DurationMinutes IN (15, 60, 120)),
  StartedAt datetime2(3) NOT NULL,
  ExpiresAt datetime2(3) NOT NULL,
  RevokedAt datetime2(3) NULL
);
CREATE INDEX IX_GuestSessions_ExpiresAt ON dbo.GuestSessions(ExpiresAt);
ALTER TABLE dbo.Vouchers ADD CONSTRAINT FK_Vouchers_SessionId
  FOREIGN KEY (SessionId) REFERENCES dbo.GuestSessions(Id);

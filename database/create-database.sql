-- In SSMS, connect to localhost,14333 as sa and run this once in master.
-- This script does not replace or erase an existing database.
IF DB_ID(N'AutoNarrationDB') IS NULL
  CREATE DATABASE [AutoNarrationDB];
GO
USE [AutoNarrationDB];
GO
IF OBJECT_ID(N'dbo.SchemaMigrations', N'U') IS NULL
  CREATE TABLE dbo.SchemaMigrations (
    Version varchar(100) NOT NULL PRIMARY KEY,
    AppliedAt datetime2(3) NOT NULL DEFAULT SYSUTCDATETIME()
  );
GO

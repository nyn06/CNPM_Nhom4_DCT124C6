-- Apply only after a full, verified backup of the target database.
-- The migration runner executes this batch and records its version in one transaction.
IF EXISTS (
  SELECT 1 FROM sys.foreign_keys AS fk
  WHERE fk.referenced_object_id IN (OBJECT_ID(N'dbo.Narrations', N'U'), OBJECT_ID(N'dbo.Jobs', N'U'))
    AND fk.parent_object_id NOT IN (OBJECT_ID(N'dbo.Narrations', N'U'), OBJECT_ID(N'dbo.Jobs', N'U'))
)
  THROW 51001, 'Legacy tables have dependent foreign keys.', 1;

IF EXISTS (
  SELECT 1 FROM sys.sql_expression_dependencies AS dep
  JOIN sys.objects AS obj ON obj.object_id = dep.referencing_id
  WHERE obj.type IN ('V', 'TR', 'P', 'FN', 'IF', 'TF')
    AND (dep.referenced_id IN (OBJECT_ID(N'dbo.Narrations', N'U'), OBJECT_ID(N'dbo.Jobs', N'U'))
      OR (dep.referenced_schema_name = N'dbo' AND dep.referenced_entity_name IN (N'Narrations', N'Jobs')))
)
  THROW 51002, 'Legacy tables have dependent SQL modules.', 1;

IF OBJECT_ID(N'dbo.Narrations', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.Narrations)
    THROW 51004, 'dbo.Narrations is not empty.', 1;
  DROP TABLE dbo.Narrations;
END;

IF OBJECT_ID(N'dbo.Jobs', N'U') IS NOT NULL
BEGIN
  IF EXISTS (SELECT 1 FROM dbo.Jobs)
    THROW 51005, 'dbo.Jobs is not empty.', 1;
  DROP TABLE dbo.Jobs;
END;

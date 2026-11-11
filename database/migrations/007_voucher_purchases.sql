-- Existing duration-bound vouchers and GuestSessions remain untouched.
-- 001_initial.sql used unnamed inline checks; resolve their generated names from SQL Server metadata.
DECLARE @voucherDurationConstraint sysname;
SELECT @voucherDurationConstraint = cc.name FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.Vouchers')
  AND cc.definition LIKE N'%DurationMinutes%';
IF @voucherDurationConstraint IS NULL
  THROW 51007, 'Expected Vouchers duration check is missing.', 1;
DECLARE @dropConstraintSql nvarchar(max);
SET @dropConstraintSql = N'ALTER TABLE dbo.Vouchers DROP CONSTRAINT ' + QUOTENAME(@voucherDurationConstraint);
EXEC sys.sp_executesql @dropConstraintSql;
ALTER TABLE dbo.Vouchers ALTER COLUMN DurationMinutes int NULL;
ALTER TABLE dbo.Vouchers WITH CHECK ADD CONSTRAINT CK_Vouchers_DurationMinutes
  CHECK (DurationMinutes IN (15, 60, 120));
DECLARE @guestDurationConstraint sysname;
SELECT @guestDurationConstraint = cc.name FROM sys.check_constraints cc
WHERE cc.parent_object_id = OBJECT_ID(N'dbo.GuestSessions')
  AND cc.definition LIKE N'%DurationMinutes%';
IF @guestDurationConstraint IS NULL
  THROW 51008, 'Expected GuestSessions duration check is missing.', 1;
SET @dropConstraintSql = N'ALTER TABLE dbo.GuestSessions DROP CONSTRAINT ' + QUOTENAME(@guestDurationConstraint);
EXEC sys.sp_executesql @dropConstraintSql;
ALTER TABLE dbo.GuestSessions WITH CHECK ADD CONSTRAINT CK_GuestSessions_DurationMinutes
  CHECK (DurationMinutes IN (15, 30, 60, 120));

CREATE TABLE dbo.VoucherPayments (
  Id uniqueidentifier NOT NULL PRIMARY KEY,
  VoucherId uniqueidentifier NOT NULL UNIQUE REFERENCES dbo.Vouchers(Id),
  DurationMinutes int NOT NULL CHECK (DurationMinutes IN (15, 30, 60)),
  AmountVnd int NOT NULL CHECK (AmountVnd > 0),
  Status varchar(8) NOT NULL CHECK (Status IN ('pending', 'paid')),
  CreatedAt datetime2(3) NOT NULL,
  PaidAt datetime2(3) NULL,
  StartedAt datetime2(3) NULL,
  CONSTRAINT CK_VoucherPayments_State CHECK (
    (Status='pending' AND PaidAt IS NULL AND StartedAt IS NULL)
    OR (Status='paid' AND PaidAt IS NOT NULL)
  )
);
CREATE INDEX IX_VoucherPayments_Status ON dbo.VoucherPayments(Status, CreatedAt);

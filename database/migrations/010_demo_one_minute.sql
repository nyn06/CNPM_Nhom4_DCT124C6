ALTER TABLE dbo.GuestSessions
DROP CONSTRAINT CK_GuestSessions_DurationMinutes;

ALTER TABLE dbo.GuestSessions WITH CHECK
ADD CONSTRAINT CK_GuestSessions_DurationMinutes
CHECK (DurationMinutes IN (1, 15, 30, 60));

DECLARE @constraintName sysname;

SELECT @constraintName = name
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID(N'dbo.VoucherPayments')
AND definition LIKE N'%DurationMinutes%';

DECLARE @query nvarchar(max);

SET @query =
    N'ALTER TABLE dbo.VoucherPayments DROP CONSTRAINT '
    + QUOTENAME(@constraintName);

EXEC sys.sp_executesql @query;

ALTER TABLE dbo.VoucherPayments WITH CHECK
ADD CONSTRAINT CK_VoucherPayments_DurationMinutes
CHECK (DurationMinutes IN (1, 15, 30, 60));
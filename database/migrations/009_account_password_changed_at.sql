-- Existing accounts use their creation time as the earliest known password change.
ALTER TABLE dbo.Accounts ADD LastPasswordChangedAt datetime2(3) NULL;
-- Compile this statement only after the new column exists in this batch.
EXEC(N'UPDATE dbo.Accounts SET LastPasswordChangedAt = CreatedAt;
  ALTER TABLE dbo.Accounts ALTER COLUMN LastPasswordChangedAt datetime2(3) NOT NULL;');

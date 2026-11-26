-- Existing accounts use their creation time as the earliest known password change.
ALTER TABLE dbo.Accounts ADD LastPasswordChangedAt datetime2(3) NULL;
UPDATE dbo.Accounts SET LastPasswordChangedAt = CreatedAt;
ALTER TABLE dbo.Accounts ALTER COLUMN LastPasswordChangedAt datetime2(3) NOT NULL;

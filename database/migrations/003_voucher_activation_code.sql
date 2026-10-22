ALTER TABLE dbo.Vouchers ADD ShortCodeHash char(64) NULL;
EXEC(N'CREATE UNIQUE INDEX UX_Vouchers_ShortCodeHash ON dbo.Vouchers(ShortCodeHash)
  WHERE ShortCodeHash IS NOT NULL');

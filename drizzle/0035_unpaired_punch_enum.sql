-- Single NGTeco punch where we cannot tell in vs out — employee supplies the pair.
ALTER TYPE missed_punch_issue ADD VALUE IF NOT EXISTS 'UNPAIRED_PUNCH';

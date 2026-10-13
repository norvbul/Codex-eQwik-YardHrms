-- AlterTable
ALTER TABLE `PayrollAdjustment` ADD COLUMN `reason` TEXT NOT NULL,
    ADD COLUMN `taxRelief` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `PayrollRun` ADD COLUMN `inputDigest` CHAR(64) NULL;


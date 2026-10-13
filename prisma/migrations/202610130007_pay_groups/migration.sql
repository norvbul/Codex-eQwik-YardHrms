-- DropForeignKey
ALTER TABLE `PayrollRun` DROP FOREIGN KEY `PayrollRun_tenantId_fkey`;

-- DropIndex
DROP INDEX `PayrollRun_tenantId_frequency_startDate_endDate_revision_key` ON `PayrollRun`;

-- AlterTable
ALTER TABLE `PayrollRun` ADD COLUMN `employeeSelection` JSON NULL,
    ADD COLUMN `payGroup` VARCHAR(64) NOT NULL DEFAULT 'ALL',
    ADD COLUMN `preparationError` TEXT NULL;

-- CreateIndex
CREATE UNIQUE INDEX `PayrollRun_tenantId_payGroup_frequency_startDate_endDate_rev_key` ON `PayrollRun`(`tenantId`, `payGroup`, `frequency`, `startDate`, `endDate`, `revision`);

-- AddForeignKey
ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `scheduleId` CHAR(36) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `ReferenceData_tenantId_id_key` ON `ReferenceData`(`tenantId`, `id`);

-- AddForeignKey
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_tenantId_scheduleId_fkey` FOREIGN KEY (`tenantId`, `scheduleId`) REFERENCES `ReferenceData`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


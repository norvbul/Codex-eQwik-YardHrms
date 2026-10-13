-- AlterTable
ALTER TABLE `Employee` ADD COLUMN `compensationConfigured` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `PayrollAdjustment` ADD COLUMN `payrollRunId` CHAR(36) NULL,
    ADD COLUMN `recurrence` VARCHAR(16) NOT NULL DEFAULT 'ONE_OFF';

-- AddForeignKey
ALTER TABLE `PayrollAdjustment` ADD CONSTRAINT `PayrollAdjustment_tenantId_payrollRunId_fkey` FOREIGN KEY (`tenantId`, `payrollRunId`) REFERENCES `PayrollRun`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Preserve compensation that was explicitly recorded through the earlier authorized workflow.
UPDATE Employee e SET compensationConfigured = true
WHERE e.basePay > 0 AND EXISTS (SELECT 1 FROM CompensationHistory c WHERE c.tenantId=e.tenantId AND c.employeeId=e.id);

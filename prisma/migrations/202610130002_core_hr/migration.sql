-- AlterTable
ALTER TABLE `LeaveLedger` ADD COLUMN `parentId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `LeaveRequest` ADD COLUMN `paidFraction` DECIMAL(5, 4) NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE `EmployeeBankAccount` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `bankName` VARCHAR(100) NOT NULL,
    `accountCipher` TEXT NOT NULL,
    `createdBy` CHAR(36) NOT NULL,
    `updatedBy` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `EmployeeBankAccount_tenantId_employeeId_key`(`tenantId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `LeaveLedger_tenantId_id_key` ON `LeaveLedger`(`tenantId`, `id`);

-- CreateIndex
CREATE UNIQUE INDEX `Overtime_tenantId_employeeId_workDate_category_key` ON `Overtime`(`tenantId`, `employeeId`, `workDate`, `category`);

-- AddForeignKey
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `LeaveLedger` ADD CONSTRAINT `LeaveLedger_tenantId_parentId_fkey` FOREIGN KEY (`tenantId`, `parentId`) REFERENCES `LeaveLedger`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `EmployeeBankAccount` ADD CONSTRAINT `EmployeeBankAccount_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


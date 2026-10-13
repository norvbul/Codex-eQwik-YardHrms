-- CreateTable
CREATE TABLE `ConfigurationChange` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `targetKey` VARCHAR(191) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `proposal` JSON NOT NULL,
    `previous` JSON NOT NULL,
    `proposedBy` CHAR(36) NOT NULL,
    `reviewedBy` CHAR(36) NULL,
    `reason` TEXT NOT NULL,
    `reviewComment` TEXT NULL,
    `effectiveDate` DATE NOT NULL,
    `appliedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `reviewedAt` DATETIME(3) NULL,

    INDEX `ConfigurationChange_tenantId_status_createdAt_idx`(`tenantId`, `status`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `ConfigurationChange` ADD CONSTRAINT `ConfigurationChange_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;


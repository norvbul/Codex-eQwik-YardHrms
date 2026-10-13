-- AlterTable
ALTER TABLE `PrivateFile` ADD COLUMN `kind` VARCHAR(32) NOT NULL DEFAULT 'DOCUMENT',
    ADD COLUMN `retainUntil` DATE NULL;

-- CreateTable
CREATE TABLE `ReportJob` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `type` VARCHAR(32) NOT NULL,
    `format` VARCHAR(8) NOT NULL,
    `filters` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'QUEUED',
    `fileId` CHAR(36) NULL,
    `error` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,

    INDEX `ReportJob_tenantId_actorId_createdAt_idx`(`tenantId`, `actorId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `PrivateFile_tenantId_id_key` ON `PrivateFile`(`tenantId`, `id`);

-- AddForeignKey
ALTER TABLE `ReportJob` ADD CONSTRAINT `ReportJob_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ReportJob` ADD CONSTRAINT `ReportJob_tenantId_fileId_fkey` FOREIGN KEY (`tenantId`, `fileId`) REFERENCES `PrivateFile`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- DropForeignKey
ALTER TABLE `ActivationCode` DROP FOREIGN KEY `ActivationCode_subscriptionId_fkey`;

-- DropIndex
DROP INDEX `ActivationCode_subscriptionId_idx` ON `ActivationCode`;

-- AlterTable
ALTER TABLE `ManualPayment` ADD COLUMN `applicationKind` VARCHAR(16) NULL,
    ADD COLUMN `subscriptionId` CHAR(36) NULL;

-- AlterTable
ALTER TABLE `Plan` ADD COLUMN `productId` CHAR(36) NULL;

-- CreateTable
CREATE TABLE `Product` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `description` TEXT NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `Product_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Feature` (
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,

    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlanFeature` (
    `planId` CHAR(36) NOT NULL,
    `featureCode` VARCHAR(64) NOT NULL,

    PRIMARY KEY (`planId`, `featureCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `License` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `subscriptionId` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `employeeLimit` INTEGER NOT NULL,
    `userLimit` INTEGER NOT NULL,
    `activatedBy` CHAR(36) NULL,
    `activatedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `License_tenantId_key`(`tenantId`),
    UNIQUE INDEX `License_subscriptionId_key`(`subscriptionId`),
    UNIQUE INDEX `License_tenantId_subscriptionId_key`(`tenantId`, `subscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PlatformSetting` (
    `key` VARCHAR(64) NOT NULL,
    `value` JSON NOT NULL,
    `updatedBy` CHAR(36) NULL,
    `updatedAt` DATETIME(3) NOT NULL,

    PRIMARY KEY (`key`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateIndex
CREATE UNIQUE INDEX `Subscription_tenantId_id_key` ON `Subscription`(`tenantId`, `id`);

-- AddForeignKey
ALTER TABLE `Plan` ADD CONSTRAINT `Plan_productId_fkey` FOREIGN KEY (`productId`) REFERENCES `Product`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ManualPayment` ADD CONSTRAINT `ManualPayment_tenantId_subscriptionId_fkey` FOREIGN KEY (`tenantId`, `subscriptionId`) REFERENCES `Subscription`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `ActivationCode` ADD CONSTRAINT `ActivationCode_tenantId_subscriptionId_fkey` FOREIGN KEY (`tenantId`, `subscriptionId`) REFERENCES `Subscription`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanFeature` ADD CONSTRAINT `PlanFeature_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `PlanFeature` ADD CONSTRAINT `PlanFeature_featureCode_fkey` FOREIGN KEY (`featureCode`) REFERENCES `Feature`(`code`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `License` ADD CONSTRAINT `License_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant`(`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `License` ADD CONSTRAINT `License_tenantId_subscriptionId_fkey` FOREIGN KEY (`tenantId`, `subscriptionId`) REFERENCES `Subscription`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


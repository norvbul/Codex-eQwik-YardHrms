-- CreateTable
CREATE TABLE `StatutoryComponent` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `ruleId` CHAR(36) NOT NULL,
    `code` VARCHAR(64) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `base` VARCHAR(16) NOT NULL,
    `deductComponents` JSON NOT NULL,
    `deductTaxRelief` BOOLEAN NOT NULL,
    `annualCeiling` DECIMAL(24, 6) NULL,
    `employeeMethod` VARCHAR(16) NOT NULL,
    `employeeRate` DECIMAL(10, 8) NULL,
    `employerMethod` VARCHAR(16) NOT NULL,
    `employerRate` DECIMAL(10, 8) NULL,

    UNIQUE INDEX `StatutoryComponent_tenantId_id_key`(`tenantId`, `id`),
    UNIQUE INDEX `StatutoryComponent_tenantId_ruleId_code_key`(`tenantId`, `ruleId`, `code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `TaxBand` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `componentId` CHAR(36) NOT NULL,
    `side` VARCHAR(16) NOT NULL,
    `ordinal` INTEGER NOT NULL,
    `upTo` DECIMAL(24, 6) NULL,
    `rate` DECIMAL(10, 8) NOT NULL,

    UNIQUE INDEX `TaxBand_tenantId_componentId_side_ordinal_key`(`tenantId`, `componentId`, `side`, `ordinal`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `StatutoryComponent` ADD CONSTRAINT `StatutoryComponent_tenantId_ruleId_fkey` FOREIGN KEY (`tenantId`, `ruleId`) REFERENCES `StatutoryRule`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `TaxBand` ADD CONSTRAINT `TaxBand_tenantId_componentId_fkey` FOREIGN KEY (`tenantId`, `componentId`) REFERENCES `StatutoryComponent`(`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;


-- Initial reviewed SQL migration for MySQL 8.4 / InnoDB.

-- CreateTable
CREATE TABLE `User` (
    `id` CHAR(36) NOT NULL,
    `email` VARCHAR(191) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `passwordHash` VARCHAR(255) NOT NULL,
    `verifiedAt` DATETIME(3) NULL,
    `mfaSecret` TEXT NULL,
    `mfaEnabled` BOOLEAN NOT NULL DEFAULT false,
    `platformRole` VARCHAR(32) NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `User_email_key` (`email`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuthToken` (
    `id` CHAR(36) NOT NULL,
    `hash` CHAR(64) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `roleName` VARCHAR(64) NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `usedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `AuthToken_hash_key` (`hash`),
    INDEX `AuthToken_userId_idx` (`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Session` (
    `id` CHAR(36) NOT NULL,
    `tokenHash` CHAR(64) NOT NULL,
    `csrfHash` CHAR(64) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `mfaVerified` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NOT NULL,
    `lastSeenAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Session_tokenHash_key` (`tokenHash`),
    INDEX `Session_userId_expiresAt_idx` (`userId`, `expiresAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Tenant` (
    `id` CHAR(36) NOT NULL,
    `legalName` VARCHAR(191) NOT NULL,
    `displayName` VARCHAR(191) NOT NULL,
    `slug` VARCHAR(100) NOT NULL,
    `timezone` VARCHAR(64) NOT NULL DEFAULT 'America/Jamaica',
    `locale` VARCHAR(16) NOT NULL DEFAULT 'en-JM',
    `logoUrl` VARCHAR(500) NULL,
    `accentColor` VARCHAR(7) NOT NULL DEFAULT '#1b6b58',
    `address` TEXT NULL,
    `contactEmail` VARCHAR(191) NULL,
    `companyIdentifiers` TEXT NULL,
    `monthlyStandardHours` DECIMAL(8,2) NOT NULL DEFAULT 173.33,
    `allowSelfApproval` BOOLEAN NOT NULL DEFAULT false,
    `status` VARCHAR(32) NOT NULL DEFAULT 'ACTIVE',
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Tenant_slug_key` (`slug`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Permission` (
    `code` VARCHAR(100) NOT NULL,
    PRIMARY KEY (`code`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Role` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    UNIQUE INDEX `Role_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `Role_tenantId_name_key` (`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `RolePermission` (
    `roleId` CHAR(36) NOT NULL,
    `permissionCode` VARCHAR(100) NOT NULL,
    INDEX `RolePermission_permissionCode_idx` (`permissionCode`),
    PRIMARY KEY (`roleId`, `permissionCode`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Membership` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `userId` CHAR(36) NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `employeeId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Membership_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `Membership_tenantId_userId_key` (`tenantId`, `userId`),
    INDEX `Membership_userId_idx` (`userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `MembershipRole` (
    `tenantId` CHAR(36) NOT NULL,
    `membershipId` CHAR(36) NOT NULL,
    `roleId` CHAR(36) NOT NULL,
    INDEX `MembershipRole_tenantId_roleId_idx` (`tenantId`, `roleId`),
    PRIMARY KEY (`tenantId`, `membershipId`, `roleId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Department` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    UNIQUE INDEX `Department_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `Department_tenantId_name_key` (`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ReferenceData` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `category` VARCHAR(50) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `configuration` JSON NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    UNIQUE INDEX `ReferenceData_tenantId_category_name_key` (`tenantId`, `category`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Holiday` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `date` DATE NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    UNIQUE INDEX `Holiday_tenantId_date_key` (`tenantId`, `date`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Employee` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeNumber` VARCHAR(64) NOT NULL,
    `firstName` VARCHAR(100) NOT NULL,
    `lastName` VARCHAR(100) NOT NULL,
    `email` VARCHAR(191) NULL,
    `phone` VARCHAR(50) NULL,
    `address` TEXT NULL,
    `parish` VARCHAR(64) NULL,
    `gender` VARCHAR(32) NULL,
    `dateOfBirth` DATE NULL,
    `departmentId` CHAR(36) NULL,
    `position` VARCHAR(100) NULL,
    `branch` VARCHAR(100) NULL,
    `employmentType` VARCHAR(64) NOT NULL DEFAULT 'Permanent',
    `managerId` CHAR(36) NULL,
    `hireDate` DATE NOT NULL,
    `probationDate` DATE NULL,
    `confirmationDate` DATE NULL,
    `terminationDate` DATE NULL,
    `frequency` VARCHAR(16) NOT NULL,
    `payType` VARCHAR(16) NOT NULL DEFAULT 'SALARY',
    `basePay` DECIMAL(18,2) NOT NULL,
    `standardHours` DECIMAL(8,2) NOT NULL,
    `overtimeEligible` BOOLEAN NOT NULL DEFAULT false,
    `sensitiveCipher` TEXT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Employee_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `Employee_tenantId_employeeNumber_key` (`tenantId`, `employeeNumber`),
    INDEX `Employee_tenantId_active_frequency_idx` (`tenantId`, `active`, `frequency`),
    INDEX `Employee_tenantId_departmentId_idx` (`tenantId`, `departmentId`),
    INDEX `Employee_tenantId_managerId_idx` (`tenantId`, `managerId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `EmergencyContact` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `relationship` VARCHAR(64) NOT NULL,
    `phone` VARCHAR(50) NOT NULL,
    INDEX `EmergencyContact_tenantId_employeeId_idx` (`tenantId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `CompensationHistory` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `effectiveDate` DATE NOT NULL,
    `basePay` DECIMAL(18,2) NOT NULL,
    `frequency` VARCHAR(16) NOT NULL,
    `payType` VARCHAR(16) NOT NULL,
    `standardHours` DECIMAL(8,2) NOT NULL,
    `reason` TEXT NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `CompensationHistory_tenantId_employeeId_effectiveDate_idx` (`tenantId`, `employeeId`, `effectiveDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveType` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(64) NOT NULL,
    `paidFraction` DECIMAL(5,4) NOT NULL DEFAULT 1,
    `annualDays` DECIMAL(8,2) NOT NULL DEFAULT 0,
    `carryForwardDays` DECIMAL(8,2) NOT NULL DEFAULT 0,
    UNIQUE INDEX `LeaveType_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `LeaveType_tenantId_name_key` (`tenantId`, `name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveRequest` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `leaveTypeId` CHAR(36) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `days` DECIMAL(8,2) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `submittedBy` CHAR(36) NOT NULL,
    `approvedBy` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `payrollRunId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `LeaveRequest_tenantId_id_key` (`tenantId`, `id`),
    INDEX `LeaveRequest_tenantId_employeeId_status_idx` (`tenantId`, `employeeId`, `status`),
    INDEX `LeaveRequest_tenantId_leaveTypeId_idx` (`tenantId`, `leaveTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LeaveLedger` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `leaveTypeId` CHAR(36) NOT NULL,
    `days` DECIMAL(8,2) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `reason` TEXT NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `sourceId` VARCHAR(100) NULL,
    `effectiveDate` DATE NOT NULL,
    `expiresAt` DATE NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `LeaveLedger_tenantId_sourceId_key` (`tenantId`, `sourceId`),
    INDEX `LeaveLedger_tenantId_employeeId_leaveTypeId_idx` (`tenantId`, `employeeId`, `leaveTypeId`),
    INDEX `LeaveLedger_tenantId_leaveTypeId_idx` (`tenantId`, `leaveTypeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Timesheet` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `workDate` DATE NOT NULL,
    `shift` VARCHAR(64) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL,
    `endsAt` DATETIME(3) NOT NULL,
    `breakHours` DECIMAL(5,2) NOT NULL,
    `hours` DECIMAL(5,2) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `submittedBy` CHAR(36) NOT NULL,
    `approvedBy` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `payrollRunId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Timesheet_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `Timesheet_tenantId_employeeId_workDate_shift_key` (`tenantId`, `employeeId`, `workDate`, `shift`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Overtime` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `workDate` DATE NOT NULL,
    `hours` DECIMAL(5,2) NOT NULL,
    `multiplier` DECIMAL(5,2) NOT NULL,
    `category` VARCHAR(64) NOT NULL,
    `reason` TEXT NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `submittedBy` CHAR(36) NOT NULL,
    `approvedBy` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `comment` TEXT NULL,
    `payrollRunId` CHAR(36) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `Overtime_tenantId_id_key` (`tenantId`, `id`),
    INDEX `Overtime_tenantId_employeeId_workDate_idx` (`tenantId`, `employeeId`, `workDate`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollAdjustment` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `amount` DECIMAL(18,2) NOT NULL,
    `taxable` BOOLEAN NOT NULL DEFAULT true,
    `effectiveDate` DATE NOT NULL,
    `endDate` DATE NULL,
    `createdBy` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `PayrollAdjustment_tenantId_employeeId_idx` (`tenantId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `StatutoryRule` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `effectiveFrom` DATE NOT NULL,
    `effectiveTo` DATE NULL,
    `configuration` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `sourceReference` TEXT NOT NULL,
    `referenceVectors` JSON NULL,
    `createdBy` CHAR(36) NOT NULL,
    `approvedBy` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `StatutoryRule_tenantId_id_key` (`tenantId`, `id`),
    INDEX `StatutoryRule_tenantId_effectiveFrom_status_idx` (`tenantId`, `effectiveFrom`, `status`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollRun` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `frequency` VARCHAR(16) NOT NULL,
    `startDate` DATE NOT NULL,
    `endDate` DATE NOT NULL,
    `payDate` DATE NOT NULL,
    `revision` INTEGER NOT NULL DEFAULT 1,
    `status` VARCHAR(16) NOT NULL DEFAULT 'DRAFT',
    `ruleId` CHAR(36) NULL,
    `createdBy` CHAR(36) NOT NULL,
    `preparedBy` CHAR(36) NULL,
    `reviewedBy` CHAR(36) NULL,
    `approvedBy` CHAR(36) NULL,
    `approvedAt` DATETIME(3) NULL,
    `reversalReason` TEXT NULL,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PayrollRun_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `PayrollRun_tenantId_frequency_startDate_endDate_revision_key` (`tenantId`, `frequency`, `startDate`, `endDate`, `revision`),
    INDEX `PayrollRun_tenantId_ruleId_idx` (`tenantId`, `ruleId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PayrollSnapshot` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `runId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NOT NULL,
    `gross` DECIMAL(18,2) NOT NULL,
    `net` DECIMAL(18,2) NOT NULL,
    `deductions` DECIMAL(18,2) NOT NULL,
    `employerContributions` DECIMAL(18,2) NOT NULL,
    `snapshot` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PayrollSnapshot_tenantId_id_key` (`tenantId`, `id`),
    UNIQUE INDEX `PayrollSnapshot_tenantId_runId_employeeId_key` (`tenantId`, `runId`, `employeeId`),
    INDEX `PayrollSnapshot_tenantId_employeeId_idx` (`tenantId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Plan` (
    `id` CHAR(36) NOT NULL,
    `code` VARCHAR(32) NOT NULL,
    `name` VARCHAR(100) NOT NULL,
    `price` DECIMAL(18,2) NULL,
    `currency` VARCHAR(3) NOT NULL DEFAULT 'JMD',
    `durationDays` INTEGER NULL,
    `employeeLimit` INTEGER NOT NULL,
    `userLimit` INTEGER NOT NULL,
    `graceDays` INTEGER NOT NULL DEFAULT 0,
    `features` JSON NOT NULL,
    `active` BOOLEAN NOT NULL DEFAULT true,
    `version` INTEGER NOT NULL DEFAULT 1,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Plan_code_key` (`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `Subscription` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `planId` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `startsAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `expiresAt` DATETIME(3) NULL,
    `graceEndsAt` DATETIME(3) NULL,
    `employeeLimit` INTEGER NOT NULL,
    `userLimit` INTEGER NOT NULL,
    `features` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,
    UNIQUE INDEX `Subscription_tenantId_key` (`tenantId`),
    INDEX `Subscription_planId_idx` (`planId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ManualPayment` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `amount` DECIMAL(18,2) NOT NULL,
    `currency` VARCHAR(3) NOT NULL,
    `method` VARCHAR(32) NOT NULL,
    `reference` VARCHAR(191) NOT NULL,
    `invoiceNumber` VARCHAR(100) NOT NULL,
    `paymentDate` DATE NOT NULL,
    `periodStart` DATE NOT NULL,
    `periodEnd` DATE NOT NULL,
    `evidenceFileId` CHAR(36) NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `recordedBy` CHAR(36) NOT NULL,
    `verifiedBy` CHAR(36) NULL,
    `verifiedAt` DATETIME(3) NULL,
    `usedAt` DATETIME(3) NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ManualPayment_tenantId_reference_key` (`tenantId`, `reference`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PaymentEvent` (
    `id` CHAR(36) NOT NULL,
    `paymentId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `status` VARCHAR(16) NOT NULL,
    `reason` TEXT NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `PaymentEvent_paymentId_idx` (`paymentId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ActivationCode` (
    `id` CHAR(36) NOT NULL,
    `hash` CHAR(64) NOT NULL,
    `subscriptionId` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `payload` JSON NOT NULL,
    `expiresAt` DATETIME(3) NOT NULL,
    `redeemedAt` DATETIME(3) NULL,
    `issuedBy` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `ActivationCode_hash_key` (`hash`),
    INDEX `ActivationCode_subscriptionId_idx` (`subscriptionId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `SubscriptionEvent` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `actorId` CHAR(36) NOT NULL,
    `kind` VARCHAR(64) NOT NULL,
    `details` JSON NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `SubscriptionEvent_tenantId_idx` (`tenantId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `AuditEvent` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NULL,
    `actorId` CHAR(36) NULL,
    `action` VARCHAR(100) NOT NULL,
    `entityId` VARCHAR(100) NULL,
    `details` JSON NOT NULL,
    `requestId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    INDEX `AuditEvent_tenantId_createdAt_idx` (`tenantId`, `createdAt`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `PrivateFile` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `employeeId` CHAR(36) NULL,
    `objectKey` VARCHAR(255) NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `contentType` VARCHAR(100) NOT NULL,
    `size` INTEGER NOT NULL,
    `scanStatus` VARCHAR(16) NOT NULL DEFAULT 'QUARANTINED',
    `createdBy` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE INDEX `PrivateFile_objectKey_key` (`objectKey`),
    INDEX `PrivateFile_tenantId_idx` (`tenantId`),
    INDEX `PrivateFile_tenantId_employeeId_idx` (`tenantId`, `employeeId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportBatch` (
    `id` CHAR(36) NOT NULL,
    `tenantId` CHAR(36) NOT NULL,
    `kind` VARCHAR(32) NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PREVIEW',
    `actorId` CHAR(36) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `completedAt` DATETIME(3) NULL,
    UNIQUE INDEX `ImportBatch_tenantId_id_key` (`tenantId`, `id`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `ImportRow` (
    `id` CHAR(36) NOT NULL,
    `batchId` CHAR(36) NOT NULL,
    `rowNumber` INTEGER NOT NULL,
    `input` JSON NOT NULL,
    `status` VARCHAR(16) NOT NULL DEFAULT 'PENDING',
    `error` TEXT NULL,
    `entityId` CHAR(36) NULL,
    UNIQUE INDEX `ImportRow_batchId_rowNumber_key` (`batchId`, `rowNumber`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `LegacyMap` (
    `tenantId` CHAR(36) NOT NULL,
    `source` VARCHAR(64) NOT NULL,
    `legacyId` VARCHAR(100) NOT NULL,
    `entityId` CHAR(36) NOT NULL,
    PRIMARY KEY (`tenantId`, `source`, `legacyId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- Tenant-qualified foreign keys
ALTER TABLE `AuthToken` ADD CONSTRAINT `AuthToken_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Session` ADD CONSTRAINT `Session_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Role` ADD CONSTRAINT `Role_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_roleId_fkey` FOREIGN KEY (`roleId`) REFERENCES `Role` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `RolePermission` ADD CONSTRAINT `RolePermission_permissionCode_fkey` FOREIGN KEY (`permissionCode`) REFERENCES `Permission` (`code`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Membership` ADD CONSTRAINT `Membership_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `User` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MembershipRole` ADD CONSTRAINT `MembershipRole_tenantId_membershipId_fkey` FOREIGN KEY (`tenantId`, `membershipId`) REFERENCES `Membership` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `MembershipRole` ADD CONSTRAINT `MembershipRole_tenantId_roleId_fkey` FOREIGN KEY (`tenantId`, `roleId`) REFERENCES `Role` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Department` ADD CONSTRAINT `Department_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ReferenceData` ADD CONSTRAINT `ReferenceData_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Holiday` ADD CONSTRAINT `Holiday_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_tenantId_departmentId_fkey` FOREIGN KEY (`tenantId`, `departmentId`) REFERENCES `Department` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Employee` ADD CONSTRAINT `Employee_tenantId_managerId_fkey` FOREIGN KEY (`tenantId`, `managerId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `EmergencyContact` ADD CONSTRAINT `EmergencyContact_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `CompensationHistory` ADD CONSTRAINT `CompensationHistory_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveType` ADD CONSTRAINT `LeaveType_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveRequest` ADD CONSTRAINT `LeaveRequest_tenantId_leaveTypeId_fkey` FOREIGN KEY (`tenantId`, `leaveTypeId`) REFERENCES `LeaveType` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveLedger` ADD CONSTRAINT `LeaveLedger_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveLedger` ADD CONSTRAINT `LeaveLedger_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `LeaveLedger` ADD CONSTRAINT `LeaveLedger_tenantId_leaveTypeId_fkey` FOREIGN KEY (`tenantId`, `leaveTypeId`) REFERENCES `LeaveType` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Timesheet` ADD CONSTRAINT `Timesheet_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Timesheet` ADD CONSTRAINT `Timesheet_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Overtime` ADD CONSTRAINT `Overtime_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Overtime` ADD CONSTRAINT `Overtime_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollAdjustment` ADD CONSTRAINT `PayrollAdjustment_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `StatutoryRule` ADD CONSTRAINT `StatutoryRule_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollRun` ADD CONSTRAINT `PayrollRun_tenantId_ruleId_fkey` FOREIGN KEY (`tenantId`, `ruleId`) REFERENCES `StatutoryRule` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollSnapshot` ADD CONSTRAINT `PayrollSnapshot_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollSnapshot` ADD CONSTRAINT `PayrollSnapshot_tenantId_runId_fkey` FOREIGN KEY (`tenantId`, `runId`) REFERENCES `PayrollRun` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PayrollSnapshot` ADD CONSTRAINT `PayrollSnapshot_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `Subscription` ADD CONSTRAINT `Subscription_planId_fkey` FOREIGN KEY (`planId`) REFERENCES `Plan` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ManualPayment` ADD CONSTRAINT `ManualPayment_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PaymentEvent` ADD CONSTRAINT `PaymentEvent_paymentId_fkey` FOREIGN KEY (`paymentId`) REFERENCES `ManualPayment` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ActivationCode` ADD CONSTRAINT `ActivationCode_subscriptionId_fkey` FOREIGN KEY (`subscriptionId`) REFERENCES `Subscription` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `SubscriptionEvent` ADD CONSTRAINT `SubscriptionEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `AuditEvent` ADD CONSTRAINT `AuditEvent_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PrivateFile` ADD CONSTRAINT `PrivateFile_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `PrivateFile` ADD CONSTRAINT `PrivateFile_tenantId_employeeId_fkey` FOREIGN KEY (`tenantId`, `employeeId`) REFERENCES `Employee` (`tenantId`, `id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ImportBatch` ADD CONSTRAINT `ImportBatch_tenantId_fkey` FOREIGN KEY (`tenantId`) REFERENCES `Tenant` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE `ImportRow` ADD CONSTRAINT `ImportRow_batchId_fkey` FOREIGN KEY (`batchId`) REFERENCES `ImportBatch` (`id`) ON DELETE RESTRICT ON UPDATE CASCADE;

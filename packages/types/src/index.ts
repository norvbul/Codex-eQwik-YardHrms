import { z } from 'zod';
export const dateString = z.iso.date();
export const money = z
  .string()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Use a nonnegative amount with at most two decimal places');
export const frequency = z.enum(['WEEKLY', 'FORTNIGHTLY', 'MONTHLY']);
export const loginSchema = z
  .object({
    email: z
      .email()
      .max(191)
      .transform((s) => s.toLowerCase()),
    password: z.string().min(1).max(200),
    portal: z.enum(['hrms', 'platform']).default('hrms'),
  })
  .strict();
export const passwordSchema = z.string().min(12, 'Use at least 12 characters').max(200);
export const registerSchema = z
  .object({
    name: z.string().trim().min(2).max(191),
    email: z
      .email()
      .max(191)
      .transform((s) => s.toLowerCase()),
    password: passwordSchema,
    companyName: z.string().trim().min(2).max(191),
  })
  .strict();
export const employeeSchema = z
  .object({
    employeeNumber: z.string().trim().min(1).max(64),
    firstName: z.string().trim().min(1).max(100),
    lastName: z.string().trim().min(1).max(100),
    email: z.union([z.email(), z.literal('')]).optional(),
    phone: z.string().max(50).optional(),
    address: z.string().max(2000).optional(),
    parish: z.string().max(64).optional(),
    gender: z.string().max(32).optional(),
    dateOfBirth: dateString.optional(),
    departmentId: z.uuid().nullable().optional(),
    scheduleId: z.uuid().nullable().optional(),
    position: z.string().max(100).optional(),
    branch: z.string().max(100).optional(),
    employmentType: z.string().max(64).default('Permanent'),
    managerId: z.uuid().nullable().optional(),
    hireDate: dateString,
    probationDate: dateString.optional(),
    confirmationDate: dateString.optional(),
    terminationDate: dateString.optional(),
    frequency,
    payType: z.enum(['SALARY', 'HOURLY']).default('SALARY'),
    basePay: money,
    standardHours: money,
    overtimeEligible: z.boolean().default(false),
    active: z.boolean().default(true),
    sensitive: z
      .object({
        trn: z.string().max(32).optional(),
        nis: z.string().max(32).optional(),
        nht: z.string().max(32).optional(),
        bankName: z.string().max(100).optional(),
        bankAccount: z.string().max(100).optional(),
      })
      .strict()
      .optional(),
    effectiveDate: dateString.optional(),
    emergencyContacts: z
      .array(
        z
          .object({
            name: z.string().min(1).max(191),
            relationship: z.string().min(1).max(64),
            phone: z.string().min(1).max(50),
          })
          .strict(),
      )
      .max(5)
      .optional(),
    reason: z.string().trim().min(3).max(2000),
    version: z.number().int().positive().optional(),
  })
  .strict();
export const leaveSchema = z
  .object({
    employeeId: z.uuid(),
    leaveTypeId: z.uuid(),
    startDate: dateString,
    endDate: dateString,
    reason: z.string().trim().min(3).max(2000),
  })
  .strict()
  .refine((x) => x.endDate >= x.startDate, {
    message: 'End date must follow start date',
    path: ['endDate'],
  });
export const timesheetSchema = z
  .object({
    employeeId: z.uuid(),
    workDate: dateString,
    shift: z.string().trim().min(1).max(64),
    startTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    endTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
    breakHours: money,
  })
  .strict();
export const overtimeSchema = z
  .object({
    employeeId: z.uuid(),
    workDate: dateString,
    hours: money,
    category: z.string().min(1).max(64),
    reason: z.string().min(3).max(2000),
  })
  .strict();
export const decisionSchema = z
  .object({ status: z.enum(['APPROVED', 'REJECTED']), comment: z.string().trim().min(3).max(2000) })
  .strict();
export const companySchema = z
  .object({
    legalName: z.string().min(2).max(191),
    displayName: z.string().min(2).max(191),
    address: z.string().max(2000).nullable().optional(),
    contactEmail: z.email().nullable().optional(),
    timezone: z.string().refine((s) => {
      try {
        new Intl.DateTimeFormat('en', { timeZone: s });
        return true;
      } catch {
        return false;
      }
    }, 'Use a valid IANA timezone'),
    locale: z.string().max(16),
    logoUrl: z
      .union([
        z.url().refine((s) => s.startsWith('https://'), 'Logo URL must use HTTPS'),
        z.literal(''),
      ])
      .nullable()
      .optional(),
    accentColor: z.string().regex(/^#[\da-fA-F]{6}$/),
    monthlyStandardHours: money,
    allowSelfApproval: z.boolean(),
  })
  .strict();
export type EmployeeInput = z.infer<typeof employeeSchema>;
export interface Me {
  user: { id: string; name: string; email: string; platformRole: string | null };
  csrfToken: string;
  mfaRequired: boolean;
  mfaEnabled: boolean;
  tenant: {
    id: string;
    displayName: string;
    legalName: string;
    logoUrl: string | null;
    accentColor: string;
    timezone: string;
    monthlyStandardHours: string;
  } | null;
  memberships: { tenantId: string; tenant: { displayName: string } }[];
  roles: string[];
  permissions: string[];
  employeeId: string | null;
  subscription: {
    status: string;
    features: string[];
    employeeLimit: number;
    userLimit: number;
    plan: { name: string };
  } | null;
}

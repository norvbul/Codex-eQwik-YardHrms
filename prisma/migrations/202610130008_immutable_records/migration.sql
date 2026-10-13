-- AlterTable
ALTER TABLE `AuditEvent` ADD COLUMN `scope` VARCHAR(16) NOT NULL DEFAULT 'TENANT';



-- Database enforcement supplements API guards. Approved histories are append-only.
CREATE TRIGGER audit_no_update BEFORE UPDATE ON AuditEvent FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only';
CREATE TRIGGER audit_no_delete BEFORE DELETE ON AuditEvent FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only';

CREATE TRIGGER payroll_snapshot_no_update BEFORE UPDATE ON PayrollSnapshot FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM PayrollRun WHERE id=OLD.runId AND tenantId=OLD.tenantId AND status IN ('APPROVED','LOCKED','REVERSED')) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved payroll snapshots are immutable';
 END IF;
END;
CREATE TRIGGER payroll_snapshot_no_delete BEFORE DELETE ON PayrollSnapshot FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM PayrollRun WHERE id=OLD.runId AND tenantId=OLD.tenantId AND status IN ('APPROVED','LOCKED','REVERSED')) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved payroll snapshots are immutable';
 END IF;
END;
CREATE TRIGGER payroll_snapshot_no_insert BEFORE INSERT ON PayrollSnapshot FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM PayrollRun WHERE id=NEW.runId AND tenantId=NEW.tenantId AND status IN ('APPROVED','LOCKED','REVERSED')) THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved payroll snapshots are immutable';
 END IF;
END;
CREATE TRIGGER payroll_run_no_delete BEFORE DELETE ON PayrollRun FOR EACH ROW
BEGIN
 IF OLD.status IN ('APPROVED','LOCKED','REVERSED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved payroll history cannot be deleted';
 END IF;
END;
CREATE TRIGGER payroll_run_frozen BEFORE UPDATE ON PayrollRun FOR EACH ROW
BEGIN
 IF OLD.status IN ('APPROVED','LOCKED','REVERSED') THEN
  IF NOT (OLD.id <=> NEW.id) OR NOT (OLD.tenantId <=> NEW.tenantId) OR NOT (OLD.frequency <=> NEW.frequency)
   OR NOT (OLD.startDate <=> NEW.startDate) OR NOT (OLD.endDate <=> NEW.endDate) OR NOT (OLD.payDate <=> NEW.payDate)
   OR NOT (OLD.payGroup <=> NEW.payGroup) OR NOT (OLD.employeeSelection <=> NEW.employeeSelection)
   OR NOT (OLD.ruleId <=> NEW.ruleId) OR NOT (OLD.revision <=> NEW.revision)
   OR NOT (OLD.createdBy <=> NEW.createdBy) OR NOT (OLD.preparedBy <=> NEW.preparedBy) OR NOT (OLD.reviewedBy <=> NEW.reviewedBy)
   OR NOT (OLD.approvedBy <=> NEW.approvedBy) OR NOT (OLD.approvedAt <=> NEW.approvedAt)
   OR NOT (OLD.inputDigest <=> NEW.inputDigest) OR NOT (OLD.createdAt <=> NEW.createdAt)
   OR (OLD.status='REVERSED') OR (NEW.status NOT IN ('LOCKED','REVERSED'))
   OR (OLD.status='LOCKED' AND NEW.status <> 'REVERSED') THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved payroll requires an audited reversal, never an edit';
  END IF;
 END IF;
END;

CREATE TRIGGER statutory_rule_frozen BEFORE UPDATE ON StatutoryRule FOR EACH ROW
BEGIN
 IF OLD.status='APPROVED' THEN
  IF NOT (OLD.id <=> NEW.id) OR NOT (OLD.tenantId <=> NEW.tenantId) OR NOT (OLD.name <=> NEW.name)
   OR NOT (OLD.configuration <=> NEW.configuration) OR NOT (OLD.referenceVectors <=> NEW.referenceVectors)
   OR NOT (OLD.effectiveFrom <=> NEW.effectiveFrom) OR NOT (OLD.sourceReference <=> NEW.sourceReference)
   OR NOT (OLD.status <=> NEW.status) OR NOT (OLD.createdBy <=> NEW.createdBy)
   OR NOT (OLD.approvedBy <=> NEW.approvedBy) OR NOT (OLD.approvedAt <=> NEW.approvedAt) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved statutory configuration is immutable';
  END IF;
 END IF;
END;
CREATE TRIGGER statutory_rule_no_delete BEFORE DELETE ON StatutoryRule FOR EACH ROW
BEGIN
 IF OLD.status='APPROVED' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved statutory history cannot be deleted'; END IF;
END;
CREATE TRIGGER statutory_component_frozen_update BEFORE UPDATE ON StatutoryComponent FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM StatutoryRule WHERE id=OLD.ruleId AND tenantId=OLD.tenantId AND status='APPROVED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved statutory components are immutable';
 END IF;
END;
CREATE TRIGGER statutory_component_frozen_delete BEFORE DELETE ON StatutoryComponent FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM StatutoryRule WHERE id=OLD.ruleId AND tenantId=OLD.tenantId AND status='APPROVED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved statutory components are immutable';
 END IF;
END;
CREATE TRIGGER statutory_component_frozen_insert BEFORE INSERT ON StatutoryComponent FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM StatutoryRule WHERE id=NEW.ruleId AND tenantId=NEW.tenantId AND status='APPROVED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved statutory components are immutable';
 END IF;
END;
CREATE TRIGGER tax_band_frozen_update BEFORE UPDATE ON TaxBand FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM StatutoryComponent c JOIN StatutoryRule r ON r.id=c.ruleId AND r.tenantId=c.tenantId WHERE c.id=OLD.componentId AND c.tenantId=OLD.tenantId AND r.status='APPROVED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved tax bands are immutable';
 END IF;
END;
CREATE TRIGGER tax_band_frozen_delete BEFORE DELETE ON TaxBand FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM StatutoryComponent c JOIN StatutoryRule r ON r.id=c.ruleId AND r.tenantId=c.tenantId WHERE c.id=OLD.componentId AND c.tenantId=OLD.tenantId AND r.status='APPROVED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved tax bands are immutable';
 END IF;
END;
CREATE TRIGGER tax_band_frozen_insert BEFORE INSERT ON TaxBand FOR EACH ROW
BEGIN
 IF EXISTS (SELECT 1 FROM StatutoryComponent c JOIN StatutoryRule r ON r.id=c.ruleId AND r.tenantId=c.tenantId WHERE c.id=NEW.componentId AND c.tenantId=NEW.tenantId AND r.status='APPROVED') THEN
  SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Approved tax bands are immutable';
 END IF;
END;

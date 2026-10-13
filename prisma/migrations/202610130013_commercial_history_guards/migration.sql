-- Preserve generated-file classifications before enforcing commercial evidence access.
UPDATE PrivateFile SET kind='PAYSLIP' WHERE objectKey LIKE '%/payslips/%';
CREATE TRIGGER payment_event_no_update BEFORE UPDATE ON PaymentEvent FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment verification history is append-only';
CREATE TRIGGER payment_event_no_delete BEFORE DELETE ON PaymentEvent FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment verification history is append-only';
CREATE TRIGGER subscription_event_no_update BEFORE UPDATE ON SubscriptionEvent FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription history is append-only';
CREATE TRIGGER subscription_event_no_delete BEFORE DELETE ON SubscriptionEvent FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription history is append-only';
CREATE TRIGGER payment_no_delete BEFORE DELETE ON ManualPayment FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payments must be reversed, never deleted';
CREATE TRIGGER payment_preserve_receipt BEFORE UPDATE ON ManualPayment FOR EACH ROW
BEGIN
 IF NOT (NEW.tenantId<=>OLD.tenantId) OR NOT (NEW.amount<=>OLD.amount) OR NOT (NEW.currency<=>OLD.currency)
 OR NOT (NEW.method<=>OLD.method) OR NOT (NEW.reference<=>OLD.reference) OR NOT (NEW.invoiceNumber<=>OLD.invoiceNumber)
 OR NOT (NEW.paymentDate<=>OLD.paymentDate) OR NOT (NEW.periodStart<=>OLD.periodStart) OR NOT (NEW.periodEnd<=>OLD.periodEnd)
 OR NOT (NEW.evidenceFileId<=>OLD.evidenceFileId) OR NOT (NEW.recordedBy<=>OLD.recordedBy) OR NOT (NEW.createdAt<=>OLD.createdAt)
 OR (OLD.verifiedAt IS NOT NULL AND (NOT (NEW.verifiedBy<=>OLD.verifiedBy) OR NOT (NEW.verifiedAt<=>OLD.verifiedAt)))
 OR (OLD.usedAt IS NOT NULL AND (NOT (NEW.usedAt<=>OLD.usedAt) OR NOT (NEW.subscriptionId<=>OLD.subscriptionId) OR NOT (NEW.applicationKind<=>OLD.applicationKind))) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Recorded payment evidence and attribution are immutable';
 END IF;
 IF NEW.status<>OLD.status AND NOT ((OLD.status='PENDING' AND NEW.status IN ('VERIFIED','REJECTED')) OR (OLD.status='VERIFIED' AND NEW.status='REVERSED')) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Invalid payment state transition';
 END IF;
END;
CREATE TRIGGER activation_preserve_binding BEFORE UPDATE ON ActivationCode FOR EACH ROW
BEGIN
 IF NOT (NEW.hash<=>OLD.hash) OR NOT (NEW.tenantId<=>OLD.tenantId) OR NOT (NEW.subscriptionId<=>OLD.subscriptionId)
 OR NOT (NEW.payload<=>OLD.payload) OR NOT (NEW.issuedBy<=>OLD.issuedBy) OR NOT (NEW.createdAt<=>OLD.createdAt)
 OR (OLD.redeemedAt IS NOT NULL AND NOT (NEW.redeemedAt<=>OLD.redeemedAt)) OR NEW.expiresAt>OLD.expiresAt THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Activation binding and one-time redemption are immutable';
 END IF;
END;
CREATE TRIGGER activation_no_delete BEFORE DELETE ON ActivationCode FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Activation history is preserved';
CREATE TRIGGER configuration_preserve_version BEFORE UPDATE ON ConfigurationChange FOR EACH ROW
BEGIN
 IF NOT (NEW.proposal<=>OLD.proposal) OR NOT (NEW.previous<=>OLD.previous) OR NOT (NEW.tenantId<=>OLD.tenantId)
 OR NOT (NEW.kind<=>OLD.kind) OR NOT (NEW.targetKey<=>OLD.targetKey) OR NOT (NEW.proposedBy<=>OLD.proposedBy)
 OR NOT (NEW.reason<=>OLD.reason) OR NOT (NEW.effectiveDate<=>OLD.effectiveDate) OR NOT (NEW.createdAt<=>OLD.createdAt)
 OR (OLD.status<>'PENDING' AND (NOT (NEW.status<=>OLD.status) OR NOT (NEW.reviewedBy<=>OLD.reviewedBy)
 OR NOT (NEW.reviewedAt<=>OLD.reviewedAt) OR NOT (NEW.reviewComment<=>OLD.reviewComment)))
 OR (OLD.appliedAt IS NOT NULL AND NOT (NEW.appliedAt<=>OLD.appliedAt)) THEN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Configuration versions and review history are immutable';
 END IF;
END;
CREATE TRIGGER configuration_no_delete BEFORE DELETE ON ConfigurationChange FOR EACH ROW
SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Configuration history is preserved';

-- Compound trigger bodies restore correctly through MySQL mysqldump.
-- Direct SIGNAL bodies retain a trailing semicolon in MySQL metadata, producing invalid dump SQL.

DROP TRIGGER audit_no_update;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON AuditEvent FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only';
END;

DROP TRIGGER audit_no_delete;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON AuditEvent FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Audit events are append-only';
END;

DROP TRIGGER payment_event_no_update;
CREATE TRIGGER payment_event_no_update BEFORE UPDATE ON PaymentEvent FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment verification history is append-only';
END;

DROP TRIGGER payment_event_no_delete;
CREATE TRIGGER payment_event_no_delete BEFORE DELETE ON PaymentEvent FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payment verification history is append-only';
END;

DROP TRIGGER subscription_event_no_update;
CREATE TRIGGER subscription_event_no_update BEFORE UPDATE ON SubscriptionEvent FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription history is append-only';
END;

DROP TRIGGER subscription_event_no_delete;
CREATE TRIGGER subscription_event_no_delete BEFORE DELETE ON SubscriptionEvent FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Subscription history is append-only';
END;

DROP TRIGGER payment_no_delete;
CREATE TRIGGER payment_no_delete BEFORE DELETE ON ManualPayment FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Payments must be reversed, never deleted';
END;

DROP TRIGGER activation_no_delete;
CREATE TRIGGER activation_no_delete BEFORE DELETE ON ActivationCode FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Activation history is preserved';
END;

DROP TRIGGER configuration_no_delete;
CREATE TRIGGER configuration_no_delete BEFORE DELETE ON ConfigurationChange FOR EACH ROW
BEGIN
 SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Configuration history is preserved';
END;

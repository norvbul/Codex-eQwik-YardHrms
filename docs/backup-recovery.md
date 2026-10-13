# Backup and recovery

Production must use managed daily encrypted backups, point-in-time recovery and encrypted private-object/version retention. Keep field-encryption keys recoverable under a separate controlled key policy. Record approved RPO/RTO, backup retention, legal holds and quarterly restoration evidence. A database dump alone cannot restore private payslips.

## Local encrypted recovery utility

For the local Docker development environment:

```sh
npm run backup:local -- .private/backups/my-review.yardbackup
npm run restore:drill -- .private/backups/my-review.yardbackup
```

The bundle contains a consistent MySQL dump with routines/triggers, reconciliation counts and payroll gross/net totals, private S3 objects with SHA-256 checksums and the field-encryption key needed to recover encrypted records. It is gzip-compressed and encrypted using AES-256-GCM. No plaintext dump is written to disk. The utility is bounded to 100 MiB/5,000 objects; production-scale backup must use a streaming managed procedure.

Supply `BACKUP_ENCRYPTION_KEY` as a separate 32-byte hex secret. For development only, if none is supplied the tool generates `.private/backup.key` with mode 0600. Keep a protected independent copy: an encrypted archive is unusable if its key is lost. Keep backup keys separate from archives and runtime field keys. Private output files are ignored by Git and use mode 0600.

Restore drills create a uniquely named temporary database and S3 bucket. They decrypt/authenticate the archive, restore schema/data/triggers, compare counts and monetary totals, restore private objects and verify checksums, then remove only the drill resources. They never replace the working database. The tool refuses remote/production configurations; a narrowly guarded isolated-test mode supports the automated runner.

```sh
npm run test:recovery
```

This creates an owned temporary environment, prepares/reviews/approves an explicit `TEST_ONLY` payroll through the actual service, generates a protected PDF, then backs up/restores it. The verified drill preserved gross 100000.00, net 91600.00 (synthetic arithmetic only), one immutable snapshot, audit counts, 25 integrity triggers and one private PDF checksum. It removed its temporary source and restore resources.

The drill found that direct SIGNAL trigger bodies produce a malformed mysqldump restoration in MySQL. A new versioned migration wraps the same guards in BEGIN/END bodies. Fresh migration chains and restoration now retain their enforcement; existing successful migrations were not edited.

## Production restoration runbook

Freeze affected writes/queues under the approved incident procedure. Restore MySQL to an isolated replacement at the agreed recovery point; restore the matching S3 versions and encryption keys; restore/reconcile persisted queues and ensure idempotent jobs cannot double-pay or double-import. Verify migration state, tenant counts, approved payroll sums/versions, leave allocation balances, verified-payment history, licence/code state and historical document availability. Compare representative source records and statutory vectors. Rotate any exposed credentials, obtain operator/finance approval, then switch traffic through the tested deployment process. Preserve evidence and the old instance until rollback/recovery acceptance.

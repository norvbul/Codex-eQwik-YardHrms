# Qwik subscription administration

Qwik platform authority is separate from tenant HR membership. Only verified, MFA-enrolled Super Administrators or Licensing Officers can use the portal. Ordinary company administrators cannot use commercial endpoints; platform staff gain no HR access from managing licences.

## Catalogue and customers

Super Administrators configure products, prices/currencies, durations, capacities, grace periods and features. Free must retain its central code, zero/no price and no fixed duration. Paid seed prices and durations are unset; approve actual commercial terms before issue. Catalogue edits affect future issued entitlements, not existing subscription snapshots.

Create a customer and designate their owner. The owner receives a Free company and an invitation, or a sign-in notification for an existing verified identity. Qwik staff are not added to its HR memberships.

## Manual receipts and independent verification

Record the customer, invoice/payment reference, actual received date, positive amount, currency, method and covered start/end dates. Upload supporting evidence when required by the approved commercial policy. Only clean, customer-bound evidence can be attached; Qwik evidence routes cannot open employee documents or payroll reports. Receipt fields are immutable: reject an erroneous pending receipt and record a corrected one.

A second authorized staff member verifies a pending receipt when separation of duties is enabled, which is the default. Record a review reason/evidence. Reject a pending payment with a reason. Only Super Administrators may reverse verified payments. Every decision retains its actor and timestamp in append-only history. Reversing an applied receipt suspends the affected licence and invalidates outstanding codes without deleting records.

Portal receipt rows show payment IDs for renewal/reference and full decision history. Received dates cannot be in the future. The application records verified receipts by currency; those sums do not certify accounting revenue recognition.

## Paid activation

Select a configured active YardHRMS paid plan and a verified unused receipt. Amount/currency must cover the price; the covered period must match its configured duration. Code issuance reserves the receipt once and snapshots capacities/features, product and dates. Free access remains until redemption.

The cryptographically random company-bound code is displayed only in its issuance dialog. Copy it and deliver it securely to the designated company administrator. The database stores only its hash; code listings contain metadata. Validity is seven days by default, configurable from one to thirty, bounded by the covered term. A future term cannot activate early.

The company administrator enters it under Subscription. Redemption locks the company, refreshes authority and atomically consumes the unused unexpired code. It cannot activate another company, shorten an existing term, bypass suspension, use a reversed receipt or grant roles.

## Renewal, downgrade and access state

Record and independently verify a new receipt. Use its payment ID to renew the existing paid subscription. Active renewals must cover the contiguous next term. Expired subscriptions can resume a non-overlapping current term. Renewal extends the existing expiry/grace, links the payment once, preserves the entitlement snapshot and requires no code.

Super Administrators can adjust capacities, downgrade/change plans, suspend/revoke or restore valid access with an audit reason. Capacity reductions preserve records and block further creation/reactivation while over limit. Free-to-paid conversion uses verified activation. A paid expansion requires an activation code or a separately enabled, reasoned Super Administrator commercial exception. Exceptions are disabled by default.

Grace is computed from stored dates. Expiry after grace becomes read-only; historical authorized access remains. Revocation/suspension blocks business access. Review due/expired subscriptions in Renewals and active employee/user counts in Capacity Usage. No payment gateway, checkout or automated payment webhook is included.

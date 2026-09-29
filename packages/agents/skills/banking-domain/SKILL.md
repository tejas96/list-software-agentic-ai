---
name: banking-domain
description: Core-banking processes, controls and regulatory concerns (KYC, account lifecycle, audit, personal data) that shape requirements and designs.
---

# Banking domain context

Use this to ask the right questions and spot hidden requirements. Do not assert a specific regulation applies unless the ticket or project says so; name it as a consideration.

## Common processes
- **Customer onboarding / account opening**: identity capture, KYC/CDD checks, sanctions/PEP screening, product selection, account number generation, initial funding, welcome documents.
- **Account maintenance**: address/contact changes (often require verification and an audit record), status changes (active, dormant, frozen, closed), signatory changes.
- **Transactions**: posting, reversal, holds, limits, end-of-day batch, interest accrual, fees.
- **Reporting**: statements, regulatory returns, management reports, audit extracts.

## Controls that usually apply
- **Maker–checker (four-eyes)** for sensitive changes (limits, customer master data, GL).
- **Audit trail**: who changed what, when, old and new value. Changes to customer master data typically need it.
- **Data protection**: personal data (name, address, national ID, phone, email, date of birth, account numbers) must not appear in logs, test fixtures or error messages. Test data must be masked or synthetic.
- **Segregation of duties**: the requester should not approve their own change in production.
- **Retention**: records are usually kept for years; never delete, prefer status flags.

## Questions worth asking
- Does the new or changed field hold personal data? Then: masking in non-production, access restrictions, audit.
- Is the field mandatory for new records only, or also for existing ones? How are existing rows handled?
- Which reports, extracts, statements or interfaces show this data?
- Does the change affect end-of-day batch or regulatory reports?
- Is there a maker–checker step for this screen?

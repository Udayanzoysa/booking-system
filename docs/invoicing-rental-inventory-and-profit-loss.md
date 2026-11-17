# Techwing Arena invoicing, rental inventory, and profit and loss

**Status** — Draft for review before implementation.

**Current system** — Techwing Arena tracks lane bookings, unpaid holds, payments, refunds, and customer wallet balances. The calendar shows booking and payment activity. The architecture mentions gear rentals as a future FAQ topic. Invoice documents, rental inventory and availability, operating expenses, and a profit-and-loss report are new scope.

## Invoices and receipts

- Staff can prepare an invoice for a lane booking, equipment rental, or both. A rental-only invoice supports walk-ins. The draft shows the customer, branch, service or rental dates, line descriptions, quantity, unit price, discounts, currency, and total. Amounts use decimal values.
- Drafts can be edited. Issuing assigns a unique invoice number within the tenant and saves the customer details, prices, and branch as they were at issue. Staff can print or download the invoice as PDF. Corrections to issued amounts go through linked credit notes or replacement invoices, with a reason and staff audit trail.
- Show posted payments, credits, and balance due. A booking advance reduces the amount due when allocated to the invoice. The payment ledger remains the source for money movements. Each allocation links to the existing payment transaction so issuing an invoice or receipt cannot record the same collection twice.
- Extend the ledger to support rental-only settlements and payments after a session. Existing booking collection requires an active upcoming slot. Invoice settlement must validate the outstanding balance, permissions, and retry key independently of lane availability.
- A receipt acknowledges a particular posted payment. A credit note adjusts what the customer owes. A refund returns funds. A single cancellation can involve both a credit note and a refund, and the two records must be linked.
- Add an invoice list with branch, date, customer, and settlement filters. Staff can record or reverse settlements only with the appropriate permission. Customers can view and download their own issued documents.

## Rental catalog and availability

- Each branch can list items such as bats, helmets, pads, and gloves. Store item name, size or variant, rentable stock, rental rate, rate basis, optional refundable security deposit, and active status. For the first release, track quantities per branch and variant. Evaluate individual asset tags for items that need separate service histories.
- Staff can add rentals when creating a booking or enter rental-only orders. Show available quantities for the selected branch and time window. Checkout and return record actual timestamps, quantities, condition, and the acting staff member. Support partial returns.
- Available quantity is rentable stock minus the highest number of units committed at the same time within the requested window. Back-to-back reservations can use the same unit. Also exclude units currently overdue, damaged, under maintenance, or missing, counting each unavailable unit only once. A returned unit becomes rentable once staff mark it usable. Record and audit stock adjustments with a reason.
- Recheck stock inside a database transaction when saving, confirming, increasing a quantity, or rescheduling. Lock the affected branch inventory records in a consistent order. If stock is insufficient, return the available quantity and let staff choose a different size, time, or quantity. An active hold reserves equipment until its deadline. Expiry and cancellation release units that have yet to be collected.
- A booking reschedule rechecks equipment availability for the new window before moving the booking and rental together. Staff can remove unavailable items with an explicit invoice adjustment. Checked-out rentals require a return or an approved extension before their quantities can be released.
- Show reserved, checked out, overdue, returned, and unavailable items in the rental workspace. Record approved late, damage, or replacement charges as separate invoice lines. Keep the equipment security deposit separate from a booking advance and track whether it was held, returned, or applied to an approved charge.

## Profit and loss

Build a management report by tenant, branch, and date range using each branch’s local calendar dates. Show lane revenue, rental revenue, fees, revenue adjustments, and expenses by category. Add an expenses register with branch, incurred date, amount, currency, category, description, optional receipt reference, and staff audit trail. Start with categories such as rent, utilities, staff, equipment, maintenance, and payment processing.

| Report line | Proposed calculation |
| --- | --- |
| Net revenue | Earned lane and rental charges plus earned fees, less discounts and credit adjustments. |
| Total expenses | Approved expenses by incurred date, including applicable processing fees recorded once. |
| Operating profit or loss | Net revenue minus total expenses. Negative results display as a loss. |
| Cash activity | Show collections, cash refunds, and net cash movement separately, using payment dates. |

- Recognize lane revenue on the service date once the session is completed. Recognize rental revenue when the fulfilled rental closes, including partial-return handling. Record a permitted retained cancellation fee on the cancellation date. Track fulfilment explicitly so invoices and payments alone cannot mark a service as completed.
- Unpaid issued invoices may represent earned revenue once the service is fulfilled. Payments collected before service show as advances until earned or returned. Refundable equipment deposits stay outside revenue while held. Wallet credits and redemptions change a balance. Revenue comes from the service or fee that the wallet funds.
- Use credit notes to adjust revenue. Link refunds to the original collection or credit so a cash refund does not reduce revenue a second time. Use the credit note date for adjustments to already-reported periods and keep the original invoice visible for drill-down.
- Calculate branch results in the configured currency. Display separate totals by currency if multiple currencies are introduced. Show shared expenses as unallocated in branch views and include them in the tenant total.
- Give authorized staff drill-down to source invoices, credit notes, and expense entries, with CSV export matching the filters and on-screen totals. Show receipts and cash collections separately from earned revenue.

**Worked example.** A completed lane session earns LKR 6,000 and its bat rental earns LKR 1,000. Staff collected a LKR 2,000 booking advance and held a separate LKR 1,500 refundable equipment deposit. With LKR 2,400 in approved expenses, operating profit is LKR 4,600. The advance is part-payment of the invoice and the refundable deposit is held separately.

## Delivery and acceptance

1. **Invoicing** — Confirm invoice and credit note fields, add document numbering and payment allocation, and deliver print/PDF views. Verify a paid or partially paid booking creates one invoice with the correct balance, and that retries do not duplicate documents or collections.
2. **Rentals** — Add the catalog, stock adjustments, availability, reservations, checkout, and returns. Verify two staff members cannot reserve the last unit for overlapping times, an expired hold releases it, an overdue unit remains blocked, and a partial return releases only the quantity returned in usable condition.
3. **Reporting** — Add fulfilment tracking, the expense register, cash activity, and profit and loss. Verify the worked example, a loss period, a prepayment crossing two reporting periods, a refunded cancellation, branch isolation, and screen-to-export reconciliation.

Use the existing tenant and branch access boundaries. Proposed permissions cover invoice issuance and correction, inventory adjustments, rental checkout and return, expense approval, and financial report viewing and export. Keep existing payment and refund permissions for moving funds.

## Decisions before implementation

- Confirm invoice numbering, required business and customer fields, tax handling, and the PDF layout with the venue’s finance owner.
- Confirm rental rate units, deposit amounts, late and damage fees, and whether customers can add equipment online in the first release or staff will manage it initially.
- Confirm who marks bookings completed, approves expenses, and can access or export branch and tenant reports. Confirm how equipment purchases and any shared costs should appear in the management report.


# Private Company MIS — v2

A private Next.js + Supabase MIS for the seven separate company accounts: TELUS, SOUTHSQ, CRYSTAL, TP, KNACK, SKYSUN and CORONIS. TP is intentionally independent; the supplied `MIS arman.xlsx` Sheet3 contains six source CompanyHEAD values and no TP rows.

## Included

- Supabase email/password login.
- Company-wise transaction views, transaction search/date filters, party ledger and monthly summaries.
- Manual transaction entry.
- Excel `.xlsx` import with a preview, editable source-company mapping, row validation, and duplicate protection.
- Preserves source columns from Sheet3: posted date, value date, description, cheque number, Dr/Cr, amount, Remarks2, CompanyHEAD, Name, tax/PAN-like field, Month and Location.
- `Dr.` is imported as `paid`; `Cr.` as `received`. Original remarks are preserved. “Advance” is shown as a remarks-derived informational amount; it is not added a second time to net. Net is calculated as received minus paid.
- RLS policies keep workspace data private. Staff can read and insert; only admins can update/delete existing transactions.

## 1. Install

Use Node.js 20.9 or newer. Extract the ZIP, open this folder in VS Code, then run:

```powershell
npm install
```

## 2. Configure Supabase

Create `.env.local` in this project root (same folder as `package.json`):

```env
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=YOUR_SUPABASE_PUBLISHABLE_KEY
```

Use the Project URL and `sb_publishable_...` key from Supabase. Never put a `service_role` or secret key in a browser app. Keep `.env.local` private and do not upload it.

## 3. Apply database migration

The original `schema.sql` has already been run in the current project. **Do not rerun it** because it creates the initial workspace/company rows. Instead:

1. Supabase Dashboard → SQL Editor → New query.
2. Open `supabase/migration_v2.sql` from this project.
3. Paste the full SQL and Run.

This migration adds the extra Excel source columns, import history, duplicate fingerprint index and a stricter transaction insert policy. It does not delete or overwrite existing transaction rows.

## 4. Start locally

```powershell
npm run dev
```

Open http://localhost:3000 and sign in with your existing Supabase admin account.

## 5. Import the workbook

1. Open **Excel imports**.
2. Choose the original `.xlsx` workbook.
3. The importer looks for `Sheet3` and the header row `Txn Posted Date`.
4. Check the preview and review every CompanyHEAD mapping before importing.
5. Save to database. The import history records inserted and duplicate counts.

Suggested mappings for the supplied workbook are preselected when matching company codes exist:

| Excel CompanyHEAD | MIS company |
|---|---|
| Knack-Mohali | KNACK |
| SouthSquare | SOUTHSQ |
| Crystal-Mohali | CRYSTAL |
| Telus-Mohali | TELUS |
| Skysun- Mohali | SKYSUN |
| Coronis-Mohali | CORONIS |

These are suggestions shown in the import UI and can be changed before saving. The workbook's `Sheet2` is not imported. TP remains a separate company and is not mapped from any source rows.

The importer skips rows with invalid dates, non-positive amounts, missing source company or unsupported Dr/Cr values and shows their row numbers. It reads the workbook in the browser; the original file is not uploaded to a separate file-storage bucket. Only parsed transaction rows are sent to the authenticated Supabase database after you click Save.

Duplicate protection is based on a deterministic fingerprint that includes sheet and Excel row position. Re-importing the same workbook rows is skipped. If the workbook is rearranged or edited, review the preview carefully because changed row positions/content may be treated as new rows.

## 6. Staff access

Create/invite the staff account in Supabase → Authentication → Users. Then run this SQL in Supabase SQL Editor, replacing the email with the staff user's email:

```sql
insert into public.workspace_members(workspace_id, user_id, role)
select w.id, u.id, 'staff'
from public.workspaces w
cross join auth.users u
where w.name = 'My Company MIS'
  and u.email = 'STAFF_EMAIL';
```

Do not enable public sign-ups. Staff role can read and insert transactions; database RLS denies update/delete of existing transaction rows to staff.

## Important accounting and safety notes

- The imported workbook has 1,024 data rows in `Sheet3` (plus its header). Preview counts can differ if validation skips any row.
- Imported `Dr.`/`Cr.` is retained in `crdr`; normalized type is `paid`/`received`.
- The workbook's `Remarks2` is preserved in `remarks`. Advance details should be entered in Remarks; the ledger surfaces amounts where remarks contain “advance”. Balance is calculated as received minus paid, not entered as a separate transaction.
- Net is displayed as received minus paid. Confirm that this is the accounting sign convention your business wants before relying on it for formal statements.
- Dashboard totals reflect all transaction rows returned to the signed-in workspace. Keep your Supabase project's RLS policies enabled.
- This is a local development project until you deploy it to a secured hosting provider and configure production environment variables. Do not share the `.env.local` file or publish the Supabase secret/service-role key.

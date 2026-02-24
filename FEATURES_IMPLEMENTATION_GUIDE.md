# Gestão Loja — Implemented Features and How They Work

This document describes the features currently implemented in the system, their business purpose, how each flow works end-to-end, what data is written/read, and what can be improved.

---

## 1) Architecture Overview

### Stack
- **Frontend:** Next.js App Router + React + Shadcn UI + Tailwind
- **Backend:** Next.js API routes (`src/app/api/**`)
- **Database:** Firestore
- **Auth:** Firebase Auth (ID token on frontend, verification in API)

### High-level flow
1. Frontend pages call API routes through `api-client` with Bearer token.
2. API verifies token and user role.
3. API uses `src/lib/db.ts` as data/service layer.
4. Firestore stores operational data (products, orders, exchanges, cash registers, clients, suppliers, bills, users, settings, stock purchases).

---

## 2) Access Control and Authentication

### What exists
- Every protected API route uses `verifyAuth(request)`.
- Role model in practice:
  - **ADMIN:** full management and reports
  - **CASHIER:** operational pages such as PDV/trocas/vendas
- Legacy role normalization: `OWNER` is normalized to `ADMIN`.

### How it works
1. Client includes Firebase ID token in Authorization header.
2. API validates token server-side.
3. API reads Firestore `users/{uid}` to get role.
4. Endpoints return `403 Forbidden` when role does not match.

### Improvement ideas
- Add centralized RBAC matrix docs + middleware to reduce repeated checks.
- Add audit events for sensitive operations (settings updates, deletes, migrations).

---

## 3) Dashboard (Executive Snapshot)

### What exists
- Dashboard cards: total revenue, total profit, total orders, total products.
- Recent sales list.

### How it works
- Frontend loads:
  - `/api/products`
  - `/api/orders`
  - `/api/reports` (for revenue/profit)
- Aggregation is mostly from reports endpoint and list lengths.

### Notes
- It is a near-real-time operational overview, not a strict accounting close.

---

## 4) Product Management

### What exists
- CRUD for products with:
  - name, SKU, plus-size flag
  - cost price / sale price
  - total stock and stock by size
- SKU uniqueness validation.
- Plus-size migration tools (admin utilities).

### How it works
- **Create product (`POST /api/products`)**
  1. Validates required fields.
  2. Checks duplicate SKU.
  3. Creates Firestore `products` doc.
  4. If initial stock > 0, creates stock purchase ledger entry (see section 12).

- **Update product (`PUT /api/products/[id]`)**
  1. Loads existing product.
  2. Validates SKU uniqueness when changed.
  3. Updates fields.
  4. Detects positive stock delta and logs stock replenishment purchase entry.

- **Delete product (`DELETE /api/products/[id]`)**
  - Deletes product after existence and role checks.

### Improvement ideas
- Add soft-delete and “in use by transactions” constraints.
- Add stock adjustment reason codes and user comments.

---

## 5) Inventory (Estoque)

### What exists
- Read-only inventory analytics page:
  - total inventory value (stock * cost)
  - total units
  - detailed per-product table
  - projected revenue and projected gross gain by product
  - size-level visibility and low-stock visual indicators

### How it works
- Reads `/api/products` and calculates all inventory metrics client-side.

### Improvement ideas
- Add server-side inventory snapshots to support historical inventory valuation.

---

## 6) POS (PDV) and Checkout

### What exists
- Product selection/search (with size handling).
- Cart management.
- Multi-payment (cash/debit/credit/pix).
- Discount controls (admin-sensitive behaviors in backend).
- Pay-later (fiado) flow linked to clients.
- Integrated cash register open/close controls.
- Receipt printing in thermal format with test print mode.

### How checkout works (`POST /api/checkout`)
1. Validates cart items.
2. Restricts advanced operations by role (discount/pay-later).
3. For pay-later, validates selected client.
4. Calls `processCheckout(...)`:
   - validates stock
   - calculates subtotal/total/cost/profit at item level
   - writes `orders` + `orderItems`
   - decrements product stock (and size stock)
5. If pay-later: increments client balance.
6. If immediate payment and register open: updates cash register totals by payment method.

### Improvement ideas
- Add cancellation/refund flow with automatic stock and cash reversal.
- Add idempotency key for checkout requests.

---

## 7) Cash Register (Caixa)

### What exists
- Open register with opening balance.
- Close register with manual closing balance.
- Register-level accumulated totals:
  - total sales
  - totals by payment method
  - sales count
  - exchange-difference inflow totals
- Closing report with PDF export in POS page.

### How it works
- API `/api/cash-register`:
  - `GET` returns current open register for user.
  - `POST action=open` creates open register.
  - `POST action=close` closes register and returns register + orders in interval.

### Important behavior
- Sales update register through checkout endpoint.
- Positive exchange differences can also increase cash in register (section 8).

---

## 8) Exchanges (Trocas) with Financial Difference

### What exists
- PDV-style exchange page with IN/OUT item basket.
- Optional customer and notes.
- Automatic document number fallback if not provided.
- Full stock transaction safety (products and size stock).
- Automatic cash-in when exchange has positive difference.

### Business logic
- `difference = totalOutValue - totalInValue`
  - If positive, customer pays difference.
  - This value is recorded as `cashInAmount` and, when a register is open, incremented in cash register fields.

### How it works
1. Frontend posts exchange items with directions IN/OUT.
2. API gets currently open register for user.
3. `createExchange(...)` runs Firestore transaction:
   - reads all needed docs first
   - validates stock and sizes
   - applies stock movements
   - persists exchange document
   - if positive difference and register is open: increments register totals for exchange difference

### Improvement ideas
- Add payment method capture for exchange difference (today it enters cash bucket).
- Add explicit exchange settlement receipt metadata.

---

## 9) Sales History (Vendas)

### What exists
- Sales list with date filters and presets (today, week, month, etc.).
- CSV export.
- Detailed order view (items, payment details, fiado progress where applicable).
- Period summary metrics in UI (sold, received, fiado outstanding).

### How it works
- `/api/orders` returns orders with item details enriched with product data.
- Optional date filtering via query params.

---

## 10) Clients and Fiado Management

### What exists
- Client CRUD (admin).
- Client balance tracking.
- Pending fiado orders linked to each client.
- Partial payments with history and payment method.
- Legacy fallback behavior for older paid-later records.

### How it works
- `GET /api/clients/[id]` includes pending orders.
- `PATCH /api/clients/[id]` supports actions:
  - `pay_order`: applies partial or full fiado payment
  - `adjust_balance`: manual balance correction
- Payment updates order payment fields and client balance consistently.

### Improvement ideas
- Add explicit receivables aging buckets (0-30, 31-60, 60+ days).

---

## 11) Suppliers

### What exists
- Supplier CRUD (admin).
- Optional channels: Instagram, WhatsApp, website, observations.
- Accepted payment methods with normalization and deduplication.

### How it works
- APIs sanitize inputs and normalize payment methods to known enum values.

### Improvement ideas
- Add purchase order linkage between supplier and stock purchase entries.

---

## 12) Stock Purchase Ledger (for purchase spending analytics)

### What exists
- Dedicated collection: `stockPurchases`.
- Entry schema stores:
  - product identification
  - quantity
  - unit cost and total cost
  - source (`PRODUCT_CREATE` or `STOCK_REPLENISHMENT`)
  - user and timestamp

### How entries are created
- New product creation with initial stock > 0.
- Product update when stock increases.

### Why this matters
- Provides real purchase spending signal for reports, independent from sales flows.

### Limitation
- Historical periods before this ledger was introduced do not have full reconstruction unless backfilled.

---

## 13) Bills / Accounts Payable (Contas)

### What exists
- Account creation modes:
  - one-time
  - fixed recurring
  - installments
- Month and status filters.
- Mark paid / unpaid with payment method.
- Delete bill entries.

### How it works
- `POST /api/bills` branches by `kind` and creates one or many docs.
- `PATCH /api/bills/[id]` handles payment status transitions.
- Reports endpoint reads bills to compute actual outflows and projected 30-day outflows.

### Improvement ideas
- Add supplier/account category dimensions for managerial analysis.

---

## 14) Reports (Relatórios Gerenciais)

### What exists
Comprehensive admin report endpoint and page with:
- DRE-like metrics (gross, net, COGS, gross/net results)
- Sales KPIs (orders, items, ticket)
- Payment mix (cash/debit/credit/pix/fiado)
- Fiado outstanding and received
- Cash flow (actual and projected)
- Inventory and turnover indicators
- Product profitability ranking
- Goals/performance indicators
- Promotions/discount impact
- Alerts and textual insights
- Export to CSV/PDF
- Extra metrics recently added:
  - exchange difference inflow
  - stock purchase spending (buying for inventory)

### How it works (data sources)
- `orders` + `orderItems` for sales/revenue/cost/profit
- `products` for inventory and stock metrics
- `bills` for expense outflows/projections
- `exchanges` for exchange difference cash inflow
- `stockPurchases` for purchase spending metric

### Improvement ideas
- Add report caching/materialized snapshots for large datasets.
- Add configurable financial calendar close.

---

## 15) Barcode Label Generation

### What exists
- Product filtering and selection.
- Bulk barcode print layout generation.
- Quantity of labels generated based on current stock.

### How it works
- Frontend loads products and dynamically generates printable HTML with JsBarcode script.

### Improvement ideas
- Add configurable label templates (size, font, include price yes/no).

---

## 16) Settings and Operational Parameters

### What exists
- Store identity fields (name, address, phone, CNPJ, footer).
- Exchange policy days.
- Discount settings (pix/fixed/progressive toggles and percentages).

### How it works
- `/api/settings` GET/PUT tied to a single settings document (`settings/store`).

### Improvement ideas
- Add versioning/history for settings changes.

---

## 17) Printing and Thermal Receipt Behavior

### What exists
- POS print flow generates two separate documents/pages:
  1. Non-fiscal receipt
  2. Exchange receipt proof
- Print test mode with dummy data and no database write.
- 80mm-oriented CSS and page-break separation to support printer cut behavior.

### Improvement ideas
- Add printer profiles (58mm/80mm) selectable in settings.
- Add ESC/POS direct-print adapter for more deterministic cuts.

---

## 18) Data Model Summary (Main Collections)

- `users`
- `products`
- `orders`
- `orderItems`
- `exchanges`
- `cashRegisters`
- `clients`
- `suppliers`
- `bills`
- `settings` (doc: `store`)
- `stockPurchases`

---

## 19) Current Technical Constraints and Risks

1. **No full historical stock purchase backfill:** purchase metric is accurate from implementation forward.
2. **Some calculations are done client-side:** can diverge if frontend logic changes.
3. **Multiple direct aggregations on live Firestore data:** may become expensive with growth.
4. **No centralized audit trail for all critical actions.**
5. **Limited rollback flows** (void sale/refund, exchange reversal, etc.).

---

## 20) Suggested Improvement Roadmap (Practical)

### Phase 1 — Governance & Reliability
- Centralized permission middleware
- Audit log collection for sensitive mutations
- Idempotency keys for checkout/exchange creation

### Phase 2 — Financial Accuracy
- Payment-method capture for exchange difference
- Historical backfill script for stock purchase estimate (optional)
- Monthly close snapshots (frozen financial periods)

### Phase 3 — Operational UX
- Receipt profile selector (58/80mm)
- Structured adjustment reasons for stock changes
- Enhanced fiado aging and collection dashboard

### Phase 4 — Scalability
- Pre-aggregated reporting tables or scheduled materialized views
- Background jobs for heavy reports

---

## 21) Where to Start When Designing Improvements

If your goal is managerial accuracy, start with:
1. Reports endpoint (`/api/reports`) contracts
2. Data provenance for each KPI (which collection/field creates it)
3. Mutation points (checkout, exchanges, product create/update, bill payment)

If your goal is operational speed, start with:
1. PDV and exchanges pages
2. Cash register close flow
3. Printing pipeline and templates

---

## 22) Terminology Used in the System

- **Fiado:** sale with deferred payment
- **Troca IN:** item coming into inventory
- **Troca OUT:** item leaving inventory
- **Diferença de troca:** `totalOutValue - totalInValue` paid by customer when positive
- **Compras p/ Estoque:** stock additions valued by cost price and logged in `stockPurchases`

---

This document should be kept updated whenever business rules, report formulas, or mutation flows are changed.

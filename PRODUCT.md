# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Admin (owner/manager)**, on a desktop or notebook: registers products and stock, categorizes, manages clients and fiado, suppliers and bills, reads reports and monthly sales, configures discounts, users and store settings.
- **Caixa (cashier)**, at the shop counter on a PC with keyboard, mouse and a barcode scanner: sells through the PDV, opens and closes the cash register (suprimento, sangria), handles exchanges, receives fiado payments, prints barcodes, checks own commission.
- **Phone use is confirmed** (2026-10-25) for four task groups: checking stock and prices, reading sales and reports, looking up clients and receiving fiado, and selling on the PDV without a scanner. These screens need phone-first layouts; every other screen stays usable on a phone.

## Product Purpose

The internal management system of **Benê Brasil**, a clothing store. It runs the counter (sales, cash register, exchanges, fiado) and the back office (products, stock, finance, reports) in one place. Success means a sale at the counter is fast and never wrong, and stock, cash and client debt always match reality.

## Positioning

Not a generic retail SaaS: it is built around how this one store actually operates — fiado (store credit) with partial payments and audited corrections, a 3% sales commission per cashier, discount rules (fixed, PIX, progressive by item count, per product) with a cashier limit that an admin can override by password, exchanges that post the value difference to the open register, barcodes per product and size, and size grids by letter (TU, P, M, G, GG, XG, plus G1–G3) or by number (36–48).

## Operating Context

- Counter workflow: barcode scanning, cart, payment by dinheiro, débito, crédito, PIX or fiado; one open cash register per user.
- Printed outputs: barcode labels, inventory count sheets and other PDFs (jsPDF).
- Product categories are data, stored in Firestore (`settings/productCategories`), not in code.
- Language pt-BR, currency BRL.
- A demo account exists with all writes blocked.

## Capabilities and Constraints

- Stack in place: Next.js 14 (App Router), React 18, TypeScript, Tailwind CSS, shadcn/ui, lucide-react, Firebase Auth + Firestore.
- Two roles: ADMIN (everything) and CASHIER (Dashboard, PDV, Vendas, Comissão, Trocas, Clientes, Códigos de Barras). Navigation is filtered by role.
- Screens: Dashboard, PDV, Produtos, Categorias, Vendas, Vendas Mensais, Comissão, Trocas, Estoque, Entradas de Estoque, Clientes, Fornecedores, Contas, Relatórios, Correções de Débito, Códigos de Barras, Usuários, Configurações, Login.
- A redesign must keep every function, flow, permission and piece of data these screens have today.
- The interface presents itself as **Benê Brasil** (decided 2026-10-25), not "Gestão Loja".

## Brand Commitments

- Name: **Benê Brasil** (with the circumflex).
- **Binding: the logo and the logo's colors.** Palette from the logo: charcoal (grafite), denim blue, red, forest green.
- **Not binding: the brand fonts** (NaughtyMonster, Poiret One) — typography is free.
- **Feels wrong** (owner, 2026-10-25): a generic SaaS look, anything too playful around money, stock and debt, a counter that gets slower (more clicks, less on screen), and the four logo colors splashed everywhere.
- Brand files live outside the repo: `C:\Users\Gokai\Desktop\Backup\Bene Brasil\Identidade Visual benê Brasil-20250929T162343Z-1-001\Identidade Visual benê Brasil\` — logo variants Principal (multicolor), Azul, Verde, Vermelho and Branca in SVG/PNG/WebP/AI/EPS/PDF, plus a brand manual PDF (`Identidade Visual BENÊ BRASIL.pdf`). `Colors.txt` there is empty, so exact color values must be taken from the logo files.

## Evidence on Hand

- Real operational data in Firestore (174 products in 12 categories as of 2026-10-25, sales, clients, cash registers).
- Logo files and brand manual listed above.
- No testimonials, metrics or external claims exist; none are needed for an internal tool and none may be invented.

## Product Principles

1. **The counter never waits.** Anything on the PDV path (find product, pick size, take payment) must be fast to scan and fast to operate with a scanner and keyboard.
2. **Numbers are unambiguous.** Money, stock and debt are read at a glance and never open to misreading.
3. **It is Benê's own tool.** The interface belongs to this store and carries its identity, not a generic admin template.
4. **Works on the phone too.** Every screen stays usable on a phone, not only on the counter PC.

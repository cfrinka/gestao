---
version: 1
slug: "src-app-dashboard-layout-tsx"
primary_target: "src/app/(dashboard)/layout.tsx"
related_targets: ["src/app/login/page.tsx","src/components/layout/sidebar.tsx","src/app/(dashboard)/pos/page.tsx"]
---

# Benê Brasil system: shell and all screens

**Scope:** the whole authenticated app (shell, 18 dashboard screens) plus login. **Mode:** Operate.

**Audience and job:** cashier at the counter (scanner, keyboard, customers waiting) and admin on a notebook; on phones for stock and price lookups, sales and reports, clients and fiado, and selling without a scanner. The task is to sell fast and never wrong, and to keep stock, cash and debt matching reality.

**Constraints:** keep every function, flow, permission and piece of data. Avoid: a generic SaaS look, a playful tone around money, a slower counter, and the logo colours splashed everywhere.

## Direction contract

THESIS: Every product in the system wears its hang tag, and every money screen settles like the tag's stub. The size grid prints as boxed sizes with stock under each. Code and price are set like tag print. Totals sit below a tear line. Refuses the admin template of rounded cards, KPI tiles, soft shadows and grey-on-white.

OWN-WORLD: Cool card-grey ground #ECEDEA, white card-stock surfaces, grafite #282828 ink and 1.5px printed rules, plus 1px #D3D5D0 hairlines for structure. Colour roles: denim #2A5473 for actions, focus and selection; verde #355444 for paid, positive, discount and an open register; vermelho #BE1622 for debt, negative, low stock and destructive actions. Square corners. Barlow Condensed for tag print (titles, sizes, prices, totals), Barlow for the UI, tabular figures everywhere. The active navigation item prints inverse, white on grafite.

STORY: The cashier scans or finds a product, clicks a size box to add it, reads the total on the stub and finishes the sale. The admin reads stock by size at a glance. Nobody misreads a number.

FIRST VIEWPORT: PDV at 1440. A 220px white rail holds the colour logo and nav grouped Balcão, Estoque, Financeiro, Sistema. A 64px top bar carries the condensed uppercase title, a bordered register tag ("● Caixa aberto · 09:12"), the sales count and total, then Troco, Sangria and Fechar caixa at the right. Below it, a 50px scanner search, category chips, and tag rows, each a notched white tag with a square photo, name and code, size boxes with stock, and the price at 30px condensed. On the right, a 390px stub column behind a dashed tear edge, with cart lines, a 54px total, and a denim Finalizar venda button.

FORM: Etiqueta (clothing hang tags and printed size labels), position 1 on the ordered list, chosen by the user as the pick over the rolled direction. Disciplines kept from the round: tabular figures aligned to the comma everywhere; product photos at one fixed square scale on one ground; a product always shows photo, name, code, sizes with stock, then price; histories read newest-first. Signature move: the boxed size grid. On the PDV, clicking a size box adds that size directly, with no size dialog. The same SizeGrid appears wherever a product with sizes does. seed: none (unavailable)

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance

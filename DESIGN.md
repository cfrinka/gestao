---
name: Benê Brasil · Gestão
description: Store management for a clothing shop, printed like the hang tags on its own stock.
colors:
  ground: "#ECEDEA"
  paper: "#FFFFFF"
  sub: "#F5F6F3"
  ink: "#282828"
  ink-2: "#575B5F"
  ink-3: "#63676B"
  rule: "#D3D5D0"
  rule-strong: "#8C8F8B"
  denim: "#2A5473"
  denim-hover: "#21455E"
  denim-tint: "#E4EBF1"
  verde: "#355444"
  verde-tint: "#E1EAE4"
  vermelho: "#BE1622"
  vermelho-hover: "#9D101A"
  vermelho-tint: "#F7E3E4"
typography:
  display:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "52px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "-0.01em"
    fontFeature: "\"tnum\" 1"
  headline:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 800
    lineHeight: 1
    letterSpacing: "0.02em"
  title:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "1.125rem"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "0.04em"
  body:
    fontFamily: "Barlow, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.43
    fontFeature: "\"tnum\" 1"
  label:
    fontFamily: "Barlow Condensed, Barlow, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 700
    lineHeight: 1.33
    letterSpacing: "0.08em"
  logo:
    fontFamily: "Poiret One, system-ui, sans-serif"
    fontWeight: 400
rounded:
  sm: "1px"
  md: "2px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.denim}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-primary-hover:
    backgroundColor: "{colors.denim-hover}"
  button-outline:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-outline-hover:
    backgroundColor: "{colors.sub}"
  button-danger:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.vermelho}"
    rounded: "{rounded.sm}"
    padding: "0 12px"
    height: "36px"
  button-danger-hover:
    backgroundColor: "{colors.vermelho-tint}"
  button-destructive:
    backgroundColor: "{colors.vermelho}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "40px"
  button-destructive-hover:
    backgroundColor: "{colors.vermelho-hover}"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "40px"
  nav-item:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "0 20px"
    height: "28px"
  nav-item-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  chip:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "0 12px"
    height: "36px"
  chip-active:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  badge:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
    typography: "{typography.label}"
    rounded: "{rounded.sm}"
    padding: "1px 6px"
  size-box:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    size: "44px"
  size-box-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper}"
  size-box-hover:
    backgroundColor: "{colors.denim}"
    textColor: "{colors.paper}"
  tag-row:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    padding: "10px 16px 10px 28px"
---

# Design System: Benê Brasil · Gestão

## Overview

**Creative North Star: "Etiqueta"**

Every product in the system wears its hang tag, and every money screen settles like the tag's stub. The app is printed, not rendered: white card stock laid on a cool card-grey ground, grafite ink, 1.5px printed rules and 1px hairlines, square corners. Sizes print as a boxed grid with the stock under each size; codes, prices, titles and totals are set in condensed tag print; totals sit below a tear line.

This is an Operate-mode tool for a shop counter PC and the owner's notebook under daylight and shop lighting, and for phones doing stock lookups and sales without a scanner. Density is high and calm: one strip of figures instead of KPI tiles, lists of tags instead of card grids. The logo's three colours carry jobs, never decoration: denim acts, verde settles, vermelho owes. There is one light theme; no dark theme exists.

The system rejects the admin template: rounded cards, KPI tiles, soft-shadowed surfaces and grey-on-white. It also rejects a playful tone around money and the logo colours splashed for flavour.

**Key Characteristics:**
- Cool card-grey ground, white card-stock surfaces, grafite ink.
- 1.5px grafite printed rules for things you handle; 1px hairlines for structure.
- Square corners (2px at most).
- Barlow Condensed tag print for titles, sizes, prices and totals; Barlow for the UI; tabular figures everywhere.
- Colour is a job: denim acts, verde settles, vermelho owes.
- The boxed size grid with stock under each size is the signature, wherever a product with sizes appears.
- Inverse print (white on grafite) marks the current thing: active nav, chosen chip, picked size.

## Colors

A near-neutral printed palette (ground, paper, three inks, two rules) with the logo's three colours held to fixed semantic jobs. The HSL custom properties in `src/app/globals.css` are the normative source; hex values here are their equivalents.

### Primary
- **Denim** (#2A5473): the action colour. Primary buttons (Finalizar venda, Entrar), links, focus outlines and rings, text selection, the input caret, checked checkboxes, and the hover fill of a pickable size box. Hover deepens to **Deep Denim** (#21455E). **Denim Wash** (#E4EBF1) tints selected table rows, info badges and the arrival flash of a new cart line.

### Secondary
- **Verde** (#355444): paid, positive, discount, and an open register. Discount lines on the stub, positive totals, the open-register dot, the scanner's "Lido" confirmation bar. **Verde Wash** (#E1EAE4) backs positive badges.

### Tertiary
- **Vermelho** (#BE1622): debt, negative values, low stock (2 pieces or fewer) and destructive actions. Low-stock counts under a size box, debt totals, cancelled and pending badges, Remover and Fechar caixa. Hover deepens to **Deep Vermelho** (#9D101A); **Vermelho Wash** (#F7E3E4) backs debt badges and the hover of danger buttons.

### Neutral
- **Card Grey** (#ECEDEA): the app ground behind everything, and the browser theme colour. Also punches the eyelet in each tag.
- **Card Stock** (#FFFFFF): every working surface: rail, top bar, tags, stub, tables, dialogs, inputs.
- **Sub Stock** (#F5F6F3): hover rows, secondary buttons, table footers, the photo ground, sold-out size boxes.
- **Grafite** (#282828): body ink, printed rules, outline borders, and the inverse fill for active and selected states.
- **Ink 2** (#575B5F): secondary text, column labels, meta lines.
- **Ink 3** (#63676B): tertiary text, codes, group labels, stock counts at rest, placeholders.
- **Hairline** (#D3D5D0): 1px structural dividers, panel borders, row separators.
- **Strong Rule** (#8C8F8B): input borders, chip borders at rest, the dashed tear line, scrollbar thumbs.

### Named Rules
**The Colour Has a Job Rule.** Denim acts, verde settles, vermelho owes. A logo colour that is not doing its job does not appear; there is no decorative use of any of the three.

**The One Threshold Rule.** Low stock is 2 pieces or fewer (`LOW_STOCK = 2` in the size grid), everywhere. At or below it the count prints in vermelho; at zero the size fades.

**The No Amber Rule.** There is no warning colour. A state is either fine (ink), settled (verde) or owed (vermelho).

## Typography

**Display Font:** Barlow Condensed (with Barlow, system-ui)
**Body Font:** Barlow (with system-ui, sans-serif)
**Logo Font:** Poiret One, only for the "BRASIL" line of the logo lockup

**Character:** Barlow Condensed is the tag print: uppercase, bold to extrabold, slightly tracked, the voice of titles, sizes, prices and totals. Barlow is the plain working voice of the UI. All three are self-hosted through next/font.

### Hierarchy
- **Display** (Barlow Condensed 800, 52px, line-height 1, -0.01em): the sale total on the stub. Product prices on PDV tags use the same price setting at 26px, 30px from xl up.
- **Headline** (Barlow Condensed 800, 26px phones / 28px desktop, uppercase, 0.02em): the screen title in the top bar.
- **Title** (Barlow Condensed 700 to 800, 18 to 20px, uppercase, 0.04em to 0.06em): panel and stub titles ("Venda atual", "Total"), section heads in dialogs.
- **Body** (Barlow 400 to 600, 14px): UI text, table cells, nav items, buttons (600). Meta and hints at 12px in Ink 3.
- **Label** (Barlow Condensed 700, 12px, uppercase, 0.06em to 0.14em): table column heads (0.08em), badges (0.06em), nav group labels (0.14em, Ink 3).
- **Totals figure** (Barlow Condensed 700, 22px): each value in a totals strip.

### Named Rules
**The Tabular Figures Rule.** Tabular figures are on for the whole body (`"tnum" 1`). Money, stock and counts align to the comma in every list, table and strip.

**The Price Print Rule.** A price is condensed extrabold numerals with "R$" raised at 0.48em beside them, never the same size as the number. Discounts and withdrawals carry a leading minus sign.

## Layout

The shell is a fixed white rail (220px from md; a 264px slide-in drawer with a 56px top bar on phones) beside a main column on the card-grey ground, padded 12px / 16px / 24px at phone / sm / md. Each screen opens with a sticky 64px top bar of white card stock that bleeds to the column edges: the condensed title, one line of live state (a bordered state tag such as "Caixa aberto · 09:12"), and the screen's actions locked right.

The PDV is the signature layout: a working column of scanner search (with an F2 hint), category chips and tag rows, beside a 380px stub column from lg up, separated by a 1.5px dashed tear edge. On phones the stub collapses to a bottom bar carrying the total (28px) and Finalizar.

Products list as tags, not cards: one row per product with a square photo, name and code, size grid, then price, on a grid that adds a 128px price column at xl. Totals for a screen sit in one strip of figures divided by hairlines, wrapping to two columns on phones. Spacing follows the 4px Tailwind rhythm, mostly 8, 12, 16 and 24px. Histories read newest-first.

## Elevation & Depth

Surfaces are flat. Depth on the page comes from paper on ground, hairlines and printed rules. Only layers that float above the page lift, and then with a soft grafite-tinted drop.

### Shadow Vocabulary
- **Dialog** (`box-shadow: 0 18px 40px -12px rgba(40,40,40,0.45)`): modal dialogs.
- **Menu** (`box-shadow: 0 12px 28px -10px rgba(40,40,40,0.35)`): select popovers and dropdown menus.
- **Toast** (`box-shadow: 0 14px 32px -12px rgba(40,40,40,0.45)`): toasts.
- **Drawer** (`box-shadow: 12px 0 32px -12px rgba(40,40,40,0.4)`): the mobile nav drawer, over a 50% grafite scrim.
- **Login tag** (`filter: drop-shadow(0 18px 28px rgba(40,40,40,0.16))`): the single hang tag on the login screen.

### Named Rules
**The Flat Page Rule.** Nothing that sits in the page flow casts a shadow. Tags, strips, tables and panels separate by paper, rule and ground only.

## Shapes

Corners are square: the radius token is 0.125rem (2px), used at half that for most controls. The defining silhouettes are cut, not rounded. A product tag is a 5-point clip-path, notched to a point at the left end (14px deep), with a 7px eyelet punched through in the ground colour 9px from the left edge. The login card is a hang tag with a pointed top (44px rise). Printed rules are 1.5px grafite and outline things you handle: size grids, outline buttons, state tags, checkboxes, size marks on cart lines. Hairlines are 1px and only divide structure. Tear lines are 1.5px dashed in Strong Rule. The only circles are status dots and the eyelet.

## Components

### Buttons
Printed and plain: square, semibold, colour by job.
- **Shape:** square corners (1px), heights 36 / 40 / 48px for sm / default / lg; the Finalizar venda button runs 56px tall at 18px.
- **Primary:** Denim fill, white text, 16px side padding.
- **Hover / Focus:** fill deepens to Deep Denim; focus is a 2px denim ring offset 2px from paper. Disabled drops to 45% opacity.
- **Outline:** card stock with a 1.5px grafite rule (Troco, Sangria, Sair); hover to Sub Stock.
- **Danger:** card stock, 1.5px vermelho rule and vermelho text at rest, Vermelho Wash on hover. For stepping into a destructive flow (Fechar caixa, removing a payment).
- **Destructive:** solid vermelho, white text, for the confirming action inside a dialog (Cancelar venda, close the register).
- **Inline remove:** vermelho text with an icon and no border (Remover on a cart line), Vermelho Wash on hover.

### Chips
- **Style:** 36px tall, 1px Strong Rule border on card stock, 14px semibold label with its count in Ink 3.
- **State:** hover darkens the border to grafite; the chosen chip prints inverse (grafite fill, white text, count at 70% white). Chip rows scroll sideways without a bar on phones and wrap from md.

### Cards / Containers
- **Corner Style:** square (2px max).
- **Background:** card stock on the card-grey ground.
- **Shadow Strategy:** none (see The Flat Page Rule).
- **Border:** 1px hairline; a 2px grafite rule above stub totals and table footers.
- **Internal Padding:** 12 to 20px.

### Inputs / Fields
- **Style:** card stock, 1px Strong Rule border, 40px tall (44px on login, 50px for the PDV scanner search), Ink 3 placeholder.
- **Focus:** border and a 1px ring turn denim; the caret is denim. Hover darkens the border to Ink 2.
- **Error / Disabled:** invalid fields take a vermelho border; disabled fields sit on Sub Stock at 60% opacity.

### Navigation
- **Style:** white rail with the colour logo at the top, items grouped under Balcão, Estoque, Financeiro, Sistema in condensed caps (12px, 0.14em, Ink 3). Items are 14px Barlow with a 16px line icon in Ink 3, 28px tall on desktop and 40px in the mobile drawer.
- **States:** hover to Sub Stock with the icon darkening to grafite; the active item prints inverse, white on grafite, semibold.
- **Footer:** user name and role above a hairline, with an outline Sair button.

### Size Grid (signature)
Boxed sizes joined by 1.5px grafite printed rules inside a 1.5px grafite frame, on card stock. Each box (34 / 38 / 44px square for sm / responsive / md) prints the size in condensed bold above its stock count in 11px semibold. Stock at or below 2 prints vermelho; sold-out sizes fade on Sub Stock. Sizes already in the sale print inverse. Where the grid is pickable (PDV, trocas), each box is a button: hover fills denim with white text, and clicking adds that size directly with no size dialog. The same grid appears wherever a product with sizes does.

### Tag Row (signature)
A product on its hang tag: the notched card-stock shape with its eyelet, holding a square photo on Sub Stock (a quiet shirt glyph when there is no photo), name and code, the size grid, then the price in price print. Sold-out products fade to 60%. Column labels above a list of tags print in the label style on the same grid.

### Sale Stub (signature)
The right column of the PDV and trocas, behind a 1.5px dashed tear edge. Cart lines are separated by 1.5px dashed tear lines and flash Denim Wash as they arrive (0.9s). Each line shows the size in a 1.5px grafite box, a quantity stepper in Strong Rule, and an inline Remover. Below a 2px grafite rule: subtotal, discounts in verde with a leading minus, then TOTAL in condensed caps beside the 52px total, then the denim Finalizar venda button with its F9 key hint.

### Totals Strip
A screen's running figures on one strip of card stock divided by hairlines: one line of label in Ink 2, one line of 22px condensed figure, coloured by tone (ink, verde, vermelho, denim). Figures, not tiles.

### State Tag and Badges
- **State tag:** a 1.5px grafite-ruled tag with a status dot (verde open, Ink 3 closed, vermelho debt) and 14px semibold text, for a screen's live state in the top bar.
- **Badges:** printed labels in condensed caps, 12px, 1px border: inverse grafite by default, outline, Ink 2 on paper, and washed verde / denim / vermelho for paid, info and debt.

### Tables
Column heads in the label style over a grafite rule at 80%; rows on hairlines with Sub Stock hover and Denim Wash selection; footers on Sub Stock above a 2px grafite rule. Figures are tabular.

## Do's and Don'ts

### Do:
- **Do** give every logo colour its job: denim (#2A5473) for actions, focus and selection; verde (#355444) for paid, positive, discount and an open register; vermelho (#BE1622) for debt, negative values, low stock and destructive actions.
- **Do** print the current thing inverse, white on grafite (#282828): the active nav item, the chosen chip, picked sizes.
- **Do** show a product as photo, name, code, sizes with stock, then price, using the shared SizeGrid wherever sizes appear.
- **Do** use one low-stock threshold, 2 pieces or fewer, and print it in vermelho.
- **Do** set prices, sizes, titles and totals in Barlow Condensed and keep tabular figures on everywhere.
- **Do** use 1.5px grafite rules for things you handle and 1px hairlines (#D3D5D0) for structure; write border widths as arbitrary values (`border-[1.5px]`), because `cn()` runs tailwind-merge, which drops a custom named border width.
- **Do** settle money screens under a tear line: 1.5px dashed Strong Rule (#8C8F8B), then the total in condensed print.

### Don't:
- **Don't** use rounded cards, KPI tiles, soft shadows on in-page surfaces, or grey-on-white admin styling.
- **Don't** splash the logo colours for decoration or brand flavour.
- **Don't** introduce a warning or amber colour; it was removed on purpose.
- **Don't** add a size-picker dialog on the PDV; clicking a size box adds that size.
- **Don't** round corners past 2px.
- **Don't** add a dark theme without designing one; the system is a single light theme for a shop counter and a notebook in daylight.

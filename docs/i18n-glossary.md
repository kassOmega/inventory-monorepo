# Amharic (አማርኛ) Glossary & Register

Single source of truth for the localization sweep. `frontend/scripts/i18n-check.mjs`
**parses the table below**, so keep the column order and the `yes`/`no` values:

| English | Canonical Amharic | Avoid | Enforce | Notes |
| --- | --- | --- | --- | --- |
| Product | ምርት | ውጤት, ፕሮዳክት | yes | ውጤት means "result" |
| Variant | ተለዋጭ | ዝርያ, ቫሪያንት | yes | product/menu variant |
| Stock | ክምችት | ስቶክ, ኢንቬንቶሪ | yes | also "inventory" |
| Sale | ሽያጭ | ሴል | yes | plural ሽያጮች |
| Invoice | ደረሰኝ | ኢንቮይስ, ቢል | yes | the printed document |
| Purchase | ግዢ | ግዥ, ፐርቼስ | yes | ግዥ is a variant spelling — pick one, this one |
| Order | ትዕዛዝ | ትእዛዝ, ኦርደር | yes | ትእዛዝ is a variant spelling |
| Request | ጥያቄ | ሪኩዌስት | yes | |
| Customer | ደንበኛ | ካስተመር, ክላይንት | yes | |
| Supplier | አቅራቢ | ሰጪ, ቬንደር | yes | ሰጪ is a seller, not a supplier |
| Payment | ክፍያ | ፔይመንት | yes | |
| Credit (owed money) | ዕዳ | ክሬዲት | yes | በዕዳ = "on credit" |
| Expense | ወጪ | ኤክስፔንስ | yes | |
| Revenue | ገቢ | ሪቨንዩ | yes | |
| Profit | ትርፍ | ፕሮፊት | yes | |
| Loss | ኪሳራ | ሎስ | yes | |
| Tax | ታክስ | ቀረጥ | yes | ቀረጥ = customs duty |
| Discount | ቅናሽ | ዲስካውንት | yes | |
| Total | ጠቅላላ | ድምር | yes | ድምር only for an actual sum |
| Quantity | ብዛት | ቁጥር, ኳንቲቲ | yes | ቁጥር = number |
| Unit (of measure) | መለኪያ አሃድ | ክፍል | yes | ክፍል means Room in this app; bare አሃድ is fine in tables |
| COGS | የሸቀጦች ወጪ | — | yes | acronym kept in prose as "(COGS)" |
| Take-away | ያዙና ሂዱ | ፓርሴል | yes | restaurant order type |
| Price | ዋጋ | ፕራይስ | yes | |
| Category | ምድብ | ካቴጎሪ | yes | |
| Location | ቦታ | አካባቢ | yes | አካባቢ means area/region only |
| User | ተጠቃሚ | ዩዘር | yes | |
| Role | ሚና | ሮል | yes | |
| Permission | ፈቃድ | ፐርሚሽን | yes | |
| Employee | ሰራተኛ | ኤምፕሎይ | yes | |
| Business | ንግድ | ቢዝነስ | yes | |
| Organization | ድርጅት | ኦርጋናይዜሽን | yes | |
| Branch | ቅርንጫፍ | ብራንች | yes | |
| Settings | ቅንብሮች | ሴቲንግስ | yes | |
| Save | ያስቀምጡ | አስቀምጥ | yes | polite imperative (see Register) |
| Select | ይምረጡ | ምረጥ | yes | |
| Remove | ያስወግዱ | አስወግድ | yes | |
| Collapse | ይሰብስቡ | አጥፋ | yes | አጥፋ means destroy, not collapse |
| Search | ይፈልጉ | ፈልግ | yes | |
| Add | ያክሉ | ጨምር | yes | |
| Edit | ያስተካክሉ | አስተካክል | yes | |
| Loading | በመጫን ላይ | ሎዲንግ | yes | |
| Category / Unit / Location (as column heads) | ምድብ / አሃድ / ቦታ | — | no | short forms allowed in tables |
| Dashboard | ዳሽቦርድ | — | no | established loanword |
| Report | ሪፖርት | — | no | established loanword |
| Brand | ብራንድ | — | no | **needs review**: የንግድ ስም if preferred |
| Delete | ያጥፉ | ሰርዝ, ይሰርዙ | yes | destroys the record; confirmations read … ማጥፋት ይፈልጋሉ? |
| Cancel | ይሰርዙ | አጥፋ, ማጥፋት | yes | aborts an action, the record survives; status ተሰርዟል |
| Subtotal | ንዑስ ጠቅላላ | — | no | **needs review** |
| Warehouse | መጋዘን | — | no | **needs review** vs ሱቅ (shop) / መደብር (store) |

## Register — decided: polite plural imperative

Every button, menu item, confirmation and hint uses the polite plural imperative.
The familiar singular is gone from the catalog and is now a gate failure:
measured after the pass, 0 values contain ጨምር / አስቀምጥ / አስተካክል / ምረጥ /
አስወግድ / አጥፋ, while ያክሉ 46, ያስቀምጡ 22, ያስተካክሉ 23, ይፈልጉ 22, ይምረጡ 54,
ያስወግዱ 14. (The three ፈልግ/ምረጥ hits that a naive grep still finds are the
prefixed gerunds ለመምረጥ, ያስፈልግ, የሚያስፈልግ — correct to leave alone.)

Destructive actions use two distinct roots, so a user never has to guess which
button throws data away:

| English | polite imperative | root and meaning |
| --- | --- | --- |
| Delete | ያጥፉ | አጥፋ — the record is destroyed |
| Delete (done) | ተጠፍቷል | |
| Cancel | ይሰርዙ | ሰርዝ — the action is aborted, the record survives |
| Cancelled (status) | ተሰርዟል | |

Confirmation sentences follow a single shape — `… ማጥፋት ይፈልጋሉ?` / `… ማሰረዝ ይፈልጋሉ?`
("do you want to delete/cancel …?"). Measured after the pass: ያጥፉ 10,
ማጥፋት 46, ተጠፍቷል 13 vs ይሰርዙ 7, ማሰረዝ 3, ተሰርዟል 4 (the last are the
"Cancelled" statuses, which is exactly why ሰርዝ stays with Cancel).

## Applied in Phase 0

308 values in two passes, all applied and verified by `scripts/i18n-check.mjs`.

Terminology (133):

| Fix | keys | example |
| --- | --- | --- |
| Location: አካባቢ → ቦታ | 20 | `sales.location`: አካባቢ → ቦታ |
| Total: ድምር → ጠቅላላ | 4 | `common.total`: ድምር → ጠቅላላ |
| Unit: ክፍል → አሃድ | 13 | `hinv.colUnit`: ክፍል → አሃድ |
| Variant: አይነት/ዓይነት/ልዩነት/ቫሪያንት → ተለዋጭ | 60 | `sales.variant`: አይነት → ተለዋጭ |
| Invoice: ኢንቮይስ → ደረሰኝ | 3 | `orders.printedFiscal` |
| COGS: Latin → የሸቀጦች ወጪ | 7 | `fin.chartCogs` |
| Business: ቢዝነስ → ንግድ | 1 | `hospitalityServices.hint` |
| Take-away: Latin → ያዙና ሂዱ | 1 | `orders.takeAway` |

Register and destructive wording (175):

| Fix | example |
| --- | --- |
| Add/Save/Edit/Search/Select/Remove → polite plural | `sales.edit`: አስተካክል → ያስተካክሉ |
| Delete family → ያጥፉ / ማጥፋት / ተጠፍቷል | `menu.deleteItemConfirm`: ይሰርዙ? → ማጥፋት ይፈልጋሉ? |
| Cancel family → ይሰርዙ / ማሰረዝ | `common.cancel`: ሰርዝ → ይሰርዙ |
| Dropped the hedge in `orders.deleteOrder` ("ትዕዛዝ ሰርዝ (ደምስስ)") | now ትዕዛዝ ያጥፉ |
| `products.collapseVariants` read "ተለዋጮች አጥፋ" — *destroy* variants | now ተለዋጮች ይሰብስቡ |
| `users.delConfirm` / `biz.confirmDelete` used "ይሰርዛሉ?" (off conjugation) | now … ማጥፋት ይፈልጋሉ? |

## Statuses and confirmations

Statuses use the **passive perfect** — ተቀምጧል ("has been saved"), ተጠፍቷል ("has been
deleted"), ተሰርዟል ("has been cancelled"), ጸድቋል ("has been approved").

Placeholders inside `{{ }}` and the surrounding punctuation stay as they are: the
backend `tr()` interpolates `{{param}}`, and i18next does the same on the frontend.

## Kept in Latin on purpose

- Invoice/document number tokens (`#{{invoice}}`, `#{{id}}`).
- `SKU`, barcode, `ETB`, `PDF`, `CSV`, `QR`, `POS`, `OTP`, `PIN`, `COGS`.
- The product/company name. Amharic text is never transliterated into the catalog.
- Price-list / QR-sheet PDF strings while the PDF stacks cannot embed an Ethiopic
  font — those keys are deliberately identical in `en` and `am` and are listed in
  the `i18n-check.mjs` allowlist. Phase 5 removes that exemption.

## Numbers, dates, currency

Not part of the catalog: `lib/currency.ts` renders Amharic amounts as Western
digits + `ብር`, and `lib/datetime.ts` renders the Ethiopian calendar with native
month names in Amharic. Storage and filters stay Gregorian.

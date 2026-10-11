# Plan: Catalog images + expandable variants in the public catalogue

## Goal
1. **Products with variants stay expandable in the public catalogue** — a product
   shows its variants (size/colour/…) so the guest can pick one, instead of only
   the base product.
2. **Support a catalogue picture input** for **all** catalogues — menu items,
   rooms, products (and their variants), service items — so businesses can upload
   images that appear on the public pages.

## Current state
- **Images exist only on `MenuItem`** (`imageUrl String?`). `Product`,
  `ProductVariant`, `RoomType`, `ServiceItem`, and car-wash `ServiceItem`-style
  rows have **no image field**.
- **Public catalog** (`PublicService.resolveItem`) returns a flat public DTO for
  `PRODUCT` (brand/baseName/price) — **no variants, no image**; and no image for
  menu/rooms/services.
- **Variants** are `ProductVariant` (productId, sku, `attributes` JSON, price);
  the app has `variantLabel(...)` to render them (`size · colour`).
- **Uploads** already exist via the shared `common/upload.config.ts`
  (`createDocumentUploadOptions(subdir)` → UUID-named files under
  `UPLOAD_ROOT/<subdir>`), served back through **permissioned API routes** (never
  statically). Guest-ID and verification docs use it.
- The public surface has **no image route** yet.

## Design

### 1. Image storage — reuse the upload plumbing
- Add an **image field** to each catalogue model:
  - `Product.imageUrl String?`
  - `ProductVariant.imageUrl String?`
  - `RoomType.imageUrl String?`
  - `ServiceItem.imageUrl String?`
  - (`MenuItem.imageUrl` already exists.)
- New upload category: `catalog-images` via
  `createDocumentUploadOptions('catalog-images')` (same allow-list: JPG/PNG/WEBP;
  size limits already enforced).
- **Serve images publicly, safely:** a public read route that only serves images
  referenced by a **published public item** for the token's tenant — or, simpler
  and still safe (images are non-sensitive marketing assets), a public image route
  keyed by the stored file name. **Do not** expose the raw `UPLOAD_ROOT` path.
  - Two options (open question 1): (a) a guessed-name-resistant route
    `/public/image/:file` that serves any catalog image file (random UUID name),
    or (b) a token-scoped route that validates the image belongs to the entry's
    catalog. Recommend **(a)** for simplicity (marketing images are public by
    nature) with a strict allow-list of directories (`catalog-images` only).

### 2. Public catalog DTO gains an image + variants
Extend the public item shape:
```
PublicItem {
  ref, kind, name, description, price,
  image?: string | null,            // resolved URL
  variants?: Array<{ ref, name, price, image?: string | null }>,  // PRODUCT only
  meta?
}
```
- **PRODUCT with variants**: `resolveItem` loads `variants` and returns them as
  nested entries (each a selectable line with its own `ref`
  `PRODUCT:<id>:VARIANT:<variantId>`, label from `variantLabel`, its `sellPrice`
  or the product's, and its `image ?? product.image`).
- A **PRODUCT without variants** stays a single line (unchanged).
- **MENU_ITEM / ROOM_TYPE / SERVICE_ITEM**: include `image` (from their field).
- The order/submit path already resolves `ref → item`; extend it to accept the
  **variant ref** and record the variant (name/price) on the `GuestOrderItem`
  (and pass `variantId` into the internal order/sale where applicable).

### 3. Guest page — expandable variants
- In `app/o/[token]`, render a product with variants as an **expandable card**:
  a header (image + name + "from <min price>") that expands to the list of
  variants, each with its own image (if any), price, and Add button.
- Cart lines key by the variant `ref`; the order payload sends the chosen refs.
- Show item **images** in the list/cards, the cart, and (nice-to-have) the order
  status page.
- **Service tabs** already group items; images render inside each tab.

### 4. Admin image input (all catalogues)
- Add an **Image** input to every catalogue editor/form:
  - Product form (`ProductForm`), per-variant too,
  - Menu item form (`food/menu`),
  - Room type form (`hotel`),
  - Service item form (`service/catalog`),
  - (Menu already had a field — ensure it uploads to the same route.)
- A small shared **`CatalogImageInput`** component: upload (multipart) → shows a
  preview → stores the returned file name/URL on the record. Reuses the existing
  `Button`/`Loading` and the upload route.
- Upload endpoints: `POST /uploads/catalog-image` (auth + permission) returning
  `{ file }`; the item's `imageUrl` is set via the item's normal create/update.

### 5. Variants in the admin catalogue
- Ensure the **variant editor** can set an image per variant (extend the existing
  variant lines editor). Product detail already groups variants; add the image.

## Files to touch
- **Schema + migration** (idempotent): `imageUrl` on `Product`, `ProductVariant`,
  `RoomType`, `ServiceItem` (menu already has it).
- `src/common/upload.config.ts` — `catalogImageMulterOptions`.
- New `src/uploads/*` (or extend an existing module) — the authenticated upload
  endpoint + the **public image-serving** route.
- `src/public/public.service.ts` — include `image` (+ `variants` for products) in
  the DTO; resolve variant refs on submit.
- `src/guest-orders/*` — carry variant info into the created order/sale.
- Frontend: `app/o/[token]/page.tsx` (expandable variants + images),
  `components/CatalogImageInput.tsx` (new), and the catalogue forms
  (`ProductForm`, `food/menu`, `hotel`, `service/catalog`).
- i18n: a few labels (`public.from`, `public.variants`, `catalog.image`).

## Verification
- Upload an image on a product, a variant, a menu item, a room type, a service
  item → it appears on the public page for that item.
- A product with variants shows an **expandable** list; selecting a variant adds
  the correct variant (and price) to the cart; the order records the variant.
- A product without variants stays a single line.
- Multi-service hospitality tabs each show their items with images.
- Images load on the public page **without auth** but only from the allowed image
  directory; no internal path is exposed.
- `tsc` + jest + `next build` clean.

## Open questions
1. **Public image route:** (a) name-based public route restricted to the
   `catalog-images` directory (recommended — marketing images are public), or
   (b) token-scoped validation that the image belongs to the entry's catalog
   (stricter, more queries)?
2. **Multiple images per item** (gallery) or a **single** image each to start?
   (Recommend single to start; gallery is additive later.)
3. **Variant image fallback:** when a variant has no image, show the **product's**
   image (recommended) or a placeholder?
4. **Car wash / other verticals:** treat car-wash services as `SERVICE_ITEM` (so
   they get images via the same field) — confirmed?

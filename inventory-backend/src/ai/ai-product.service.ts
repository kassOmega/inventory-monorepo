// src/ai/ai-product.service.ts
// The AI product assistant: a product photo is sent as a base64 string in the
// request body, Gemini vision returns structured product data, and the payload
// is discarded immediately — nothing is written to disk.
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { JwtPayload } from '../common/interfaces/jwt-payload.interface';
import { PrismaService } from '../prisma/prisma.service';
import { GeminiService } from './gemini.service';

export interface AiProductVariantSuggestion {
  slot1: string | null;
  slot2: string | null;
  slot3: string | null;
  slot4: string | null;
  sku: string | null;
  buyPrice: number | null;
  sellPrice: number | null;
  quantity: number | null;
}

export interface AiProductSuggestion {
  brand: string;
  baseName: string;
  categoryName: string | null;
  unitName: string | null;
  categoryId: number | null;
  unitId: number | null;
  currentBuyPrice: number | null;
  currentSellPrice: number | null;
  barcode: string | null;
  hasVariants: boolean;
  variants: AiProductVariantSuggestion[];
  attributes: Record<string, string> | null;
  isPerishable: boolean;
  reorderLevel: number | null;
  reorderQty: number | null;
}

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
const MAX_DECODED_BYTES = 8 * 1024 * 1024;

const PRODUCT_ASSIST_SYSTEM_INSTRUCTION = [
  'You are the AI product assistant for a business inventory platform.',
  'You look at a photograph of a retail product (a box, bottle, garment, tool, machine, etc.) and describe it as structured product-catalog data.',
  'Read the brand and product name from the packaging/label whenever they are visible.',
  'If the photo shows multiple variants (e.g. different sizes, colors, capacities, voltages), list each one under "variants" with its specific attributes.',
  'Use ONLY category and unit names from the lists provided in the prompt. If no category/unit fits or none is listed, return null for that field.',
  'Estimate a reasonable currentBuyPrice and currentSellPrice in the local currency based on the product category (you may use typical market ranges). Use null when you cannot estimate.',
  'Return concise values only. Do not guess barcodes or SKUs — leave them null unless they are readable in the photo.',
].join('\n');

function productAssistPrompt(
  categoryNames: string[],
  unitNames: string[],
  hasSecondImage = false,
): string {
  return [
    'Analyze this product photo and return the product catalog fields.',
    hasSecondImage
      ? 'Two photos of the same product were provided — use BOTH to read the label, variants, and specifications as accurately as possible.'
      : '',
    'Allowed category names (pick the closest, or null):',
    JSON.stringify(categoryNames),
    'Allowed unit names (pick the closest, or null):',
    JSON.stringify(unitNames),
    'Rules:',
    '- brand / baseName: from the label; baseName is the generic product name.',
    '- variants: list EVERY visible size/color/capacity/voltage option as its own variant row (a shoe in sizes 40-44, a pump in 1HP/2HP, etc.). Fill slot1..slot4 with the most relevant attribute values in order (e.g. slot1 = size/capacity/power, slot2 = color/material, slot3 = flow/RAM/voltage, slot4 = extra note).',
    '- hasVariants: true whenever you list two or more variants, or whenever the product naturally comes in sizes/colors/options.',
    '- attributes (SPECIFICATIONS): list 3-8 product specifications as key/value pairs read from the label/packaging — e.g. Material, Capacity, Power, Voltage, Weight, Dimensions, Color, Warranty. Do not leave this empty when details are visible.',
    '- prices: estimate currentBuyPrice and currentSellPrice in ETHIOPIAN BIRR (ETB). Use null when you cannot estimate.',
    '- isPerishable: true only for food/drink/medical items with an expiry.',
    '- reorderLevel / reorderQty: small sensible numbers (or null).',
  ]
    .filter(Boolean)
    .join('\n');
}

// Shared variant-row schema (used by both the photo autofill and the
// "suggest variants" generator).
const VARIANT_ITEMS_SCHEMA = {
  type: 'object',
  properties: {
    slot1: { type: ['string', 'null'] },
    slot2: { type: ['string', 'null'] },
    slot3: { type: ['string', 'null'] },
    slot4: { type: ['string', 'null'] },
    sku: { type: ['string', 'null'] },
    buyPrice: { type: ['number', 'null'] },
    sellPrice: { type: ['number', 'null'] },
    quantity: { type: ['number', 'null'] },
  },
};

const PRODUCT_AI_SCHEMA = {
  type: 'object',
  properties: {
    brand: { type: 'string' },
    baseName: { type: 'string' },
    categoryName: { type: ['string', 'null'] },
    unitName: { type: ['string', 'null'] },
    currentBuyPrice: { type: ['number', 'null'] },
    currentSellPrice: { type: ['number', 'null'] },
    barcode: { type: ['string', 'null'] },
    hasVariants: { type: 'boolean' },
    variants: { type: 'array', items: VARIANT_ITEMS_SCHEMA },
    attributes: { type: 'object' },
    isPerishable: { type: 'boolean' },
    reorderLevel: { type: ['number', 'null'] },
    reorderQty: { type: ['number', 'null'] },
  },
  required: ['brand', 'baseName', 'hasVariants'],
};

const SUGGEST_VARIANTS_SCHEMA = {
  type: 'object',
  properties: {
    variants: { type: 'array', items: VARIANT_ITEMS_SCHEMA },
  },
  required: ['variants'],
};

const SUGGEST_VARIANTS_SYSTEM_INSTRUCTION = [
  'You are the AI product assistant for a business inventory platform.',
  'Given a product name, you generate a realistic set of stock variants (sizes, colors, capacities, voltages, etc.) that a shop would actually carry.',
  'Each variant fills 4 attribute slots. The slot meaning is FIXED:',
  '- slot1 = the PRIMARY ordering attribute: Size / Capacity / Storage / Power (e.g. 42, 1HP, 128GB, 5L). NEVER a color here.',
  '- slot2 = Color / Material / Finish (e.g. Black, White, Stainless Steel). Put the color here, never in slot1 or slot3.',
  '- slot3 = a SECONDARY technical attribute when it exists: Flow Rate / RAM / Voltage / Frequency / Feature (e.g. 220V, 8GB, WiFi). NEVER put size or color here.',
  '- slot4 = notes / packaging (e.g. "pack of 12", "with strap"). Leave null when empty.',
  'HARD RULES:',
  '- NEVER put a color/finish in slot1. NEVER put a size/capacity/power in slot2 or slot3.',
  '- Within one product, slot1 holds the same kind of value across all rows (all sizes, or all capacities, or all powers), and slot2 the same kind too.',
  '- Example (footwear): slot1="42", slot2="Black"; slot1="41", slot2="Blue".',
  '- Example (water pump): slot1="1HP", slot2="Stainless", slot3="220V"; slot1="2HP", slot2="Cast Iron", slot3="380V".',
  '- Example (mobile phone): slot1="128GB", slot2="Midnight Black", slot3="8GB RAM".',
  '- Example (cooking oil): slot1="5L", slot2="Refined", slot4="pack of 1".',
  'Return 2 to 8 variants. Do not invent SKUs or barcodes (leave null). You may estimate buy/sell prices in ETHIOPIAN BIRR (ETB) and a small quantity for each.',
  'If a variant already exists in the input, keep its values; add the missing ones around it.',
].join('\n');

// Partial variant shape accepted from the form's existing rows.
export interface ExistingVariantInput {
  slot1?: string | null;
  slot2?: string | null;
  slot3?: string | null;
  slot4?: string | null;
  sku?: string | null;
}

function suggestVariantsPrompt(input: {
  brand?: string;
  baseName?: string;
  existing?: ExistingVariantInput[];
}): string {
  return [
    `Product: ${[input.brand, input.baseName].filter(Boolean).join(' ') || 'Unknown product'}`,
    'Existing variants (keep these, fill gaps around them):',
    JSON.stringify(input.existing ?? []),
    'Generate the full variant set now.',
  ].join('\n');
}

// ---------------------------------------------------------------------------
// Variant slot normalization.
// Gemini sometimes puts colors into slot1 or drops sizes/capacities/powers
// into slot3. These helpers detect that and move values into the correct
// column so the 4-slot builder stays clean.
// ---------------------------------------------------------------------------

const COLOR_LEXICON = new Set([
  'black', 'white', 'red', 'blue', 'green', 'yellow', 'orange', 'purple',
  'pink', 'brown', 'grey', 'gray', 'beige', 'cream', 'navy', 'gold', 'silver',
  'maroon', 'teal', 'olive', 'coral', 'ivory', 'tan', 'lime', 'cyan',
  'stainless', 'matte', 'glossy', 'wood', 'walnut', 'oak', 'rose', 'sky',
  'cobalt', 'burgundy', 'mint', 'charcoal', 'denim', 'khaki', 'bamboo',
  'glass', 'leather', 'fabric', 'metal', 'brass', 'copper', 'bronze',
  'carbon', 'graphite', 'pearl', 'bordeaux', 'raspberry',
]);

function isColorLike(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim().toLowerCase();
  if (!v) return false;
  return v
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .some((w) => COLOR_LEXICON.has(w));
}

function isDimensionLike(value: string | null | undefined): boolean {
  if (!value) return false;
  const v = value.trim();
  if (!v) return false;
  return (
    /^\d+([.,]\d+)?$/.test(v) || // 42, 1.5
    /^\d+\s*[-–—]\s*\d+$/.test(v) || // 40-44
    /^\d+([.,]\d+)?\s*(HP|GB|TB|MB|KB|L|ML|KG|G|CM|MM|W|KW|V|A|AH|HZ|FT|IN|CC|CL|OZ|PK|PC)\b/i.test(
      v,
    )
  );
}

/**
 * Repair AI-generated variant rows so values land in the column they belong in:
 * slot1 = size/capacity/storage/power, slot2 = color/material, slot3 = secondary
 * technical spec, slot4 = notes. Also dedupes identical rows.
 */
function normalizeVariantSlots(
  variants: AiProductVariantSuggestion[],
): AiProductVariantSuggestion[] {
  const rows = variants.filter(
    (v) => v.slot1 || v.slot2 || v.slot3 || v.slot4 || v.sku,
  );
  if (rows.length === 0) return rows;

  const maj = (n: number) => n >= Math.max(2, Math.ceil(rows.length * 0.4));
  const s1IsColor = maj(rows.filter((r) => isColorLike(r.slot1)).length);
  const s3IsDim = maj(rows.filter((r) => isDimensionLike(r.slot3)).length);
  const s2IsColor = maj(rows.filter((r) => isColorLike(r.slot2)).length);

  for (const r of rows) {
    // Colors never belong in slot1 — relocate them to slot2.
    if (s1IsColor && isColorLike(r.slot1)) {
      if (!r.slot2) r.slot2 = r.slot1;
      r.slot1 = null;
    }
    // Sizes/capacities/powers never belong in slot3 — promote them to slot1.
    if (s3IsDim && isDimensionLike(r.slot3)) {
      if (!r.slot1) r.slot1 = r.slot3;
      r.slot3 = null;
    }
    // slot1 is the primary attribute: if it is empty and slot2 holds a
    // dimension, lift it up.
    if (!r.slot1 && isDimensionLike(r.slot2) && !s1IsColor && !r.slot3) {
      r.slot1 = r.slot2;
      r.slot2 = null;
    }
    // A leftover color in slot3 moves to slot2 (slot3 is technical-only).
    if (isColorLike(r.slot3) && (s2IsColor || !r.slot2)) {
      if (!r.slot2) r.slot2 = r.slot3;
      r.slot3 = null;
    }
  }

  const seen = new Set<string>();
  const out: AiProductVariantSuggestion[] = [];
  for (const r of rows) {
    const key = [r.slot1, r.slot2, r.slot3, r.slot4]
      .map((s) => (s ?? '').trim().toLowerCase())
      .join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Product identification (AI scan in Sales / Requests).
// A photo is matched against the tenant's existing catalog instead of building
// a new product.
// ---------------------------------------------------------------------------

export interface ExtractedProductInfo {
  brand: string | null;
  baseName: string | null;
  sku: string | null;
  barcode: string | null;
  variantHint: string | null;
}

export interface ProductIdentifyResult {
  /** Full product in the same shape as GET /products (variants, inventory, unit, category). */
  product: any | null;
  /** The specific variant the photo shows (when matched), else null. */
  variant: any | null;
  confidence: 'high' | 'medium' | 'low' | 'none';
  matchType: 'barcode' | 'sku' | 'exact' | 'partial' | 'none';
  extracted: ExtractedProductInfo;
}

const IDENTIFY_SYSTEM_INSTRUCTION = [
  'You are the product-recognition engine for a business inventory platform.',
  'You are shown a photograph of a retail product (packaging, label, garment, bottle, tool, etc.).',
  'Extract ONLY what is literally visible on the product or its label.',
  '- brand: the maker name.',
  '- baseName: the generic product name (e.g. "Runner Shoe", "Water Pump").',
  '- sku / barcode: only if you can actually read those characters.',
  '- variantHint: if the item is ONE specific variant of a larger range (a shoe of size 42, a pump of 1HP, a bottle of 5L, a Black colorway), return that exact value here — otherwise null.',
  'Do not guess. Return null for anything you cannot read.',
].join('\n');

const IDENTIFY_SCHEMA = {
  type: 'object',
  properties: {
    brand: { type: ['string', 'null'] },
    baseName: { type: ['string', 'null'] },
    sku: { type: ['string', 'null'] },
    barcode: { type: ['string', 'null'] },
    variantHint: { type: ['string', 'null'] },
  },
  required: ['brand', 'baseName'],
};

function identifyProductPrompt(hasSecondImage: boolean): string {
  return [
    'Read the product in the photo and return the extracted label data.',
    hasSecondImage
      ? 'Two photos of the same product were provided — use BOTH (e.g. front label + size/color tag) to extract as much as possible.'
      : '',
  ]
    .filter(Boolean)
    .join('\n');
}

@Injectable()
export class AiProductService {
  private readonly logger = new Logger(AiProductService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly gemini: GeminiService,
  ) {}

  /**
   * Analyze a product photo (one or two images) and return a ProductForm-ready
   * suggestion. The base64 images only exist in memory for the call.
   */
  async analyzePhoto(
    base64Image: string,
    tenantId: number | null,
    base64Image2?: string,
  ): Promise<AiProductSuggestion> {
    const { mimeType, data } = this.decodeBase64(base64Image);
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new BadRequestException(
        'Unsupported image type. Use JPEG, PNG, WEBP, or HEIC.',
      );
    }
    const decoded = Buffer.from(data, 'base64');
    if (decoded.byteLength === 0) {
      throw new BadRequestException('The image payload is empty.');
    }
    if (decoded.byteLength > MAX_DECODED_BYTES) {
      throw new BadRequestException(
        'Image is too large (max 8MB). Take a smaller photo.',
      );
    }

    // Optional second photo — decode + validate, then send to Gemini as an
    // extra image part (never persisted).
    let extraImages: Array<{ mimeType: string; base64: string }> | undefined;
    if (base64Image2 && base64Image2.trim()) {
      const second = this.decodeBase64(base64Image2);
      if (!ALLOWED_IMAGE_TYPES.has(second.mimeType)) {
        throw new BadRequestException(
          'Unsupported image type for the second photo. Use JPEG, PNG, WEBP, or HEIC.',
        );
      }
      const decoded2 = Buffer.from(second.data, 'base64');
      if (decoded2.byteLength === 0 || decoded2.byteLength > MAX_DECODED_BYTES) {
        throw new BadRequestException('The second photo is empty or too large (max 8MB).');
      }
      extraImages = [{ mimeType: second.mimeType, base64: second.data }];
    }

    // Load the tenant's category/unit names so the AI only suggests valid ones.
    const [categories, units] = await Promise.all([
      tenantId != null
        ? this.prisma.category.findMany({
            where: { tenantId },
            select: { id: true, name: true },
          })
        : [],
      tenantId != null
        ? this.prisma.unit.findMany({
            where: { tenantId },
            select: { id: true, name: true },
          })
        : [],
    ]);

    const suggestion = await this.gemini.analyzeImage<
      Omit<AiProductSuggestion, 'categoryId' | 'unitId'>
    >({
      systemInstruction: PRODUCT_ASSIST_SYSTEM_INSTRUCTION,
      prompt: productAssistPrompt(
        categories.map((c) => c.name),
        units.map((u) => u.name),
        !!extraImages,
      ),
      imageMimeType: mimeType,
      imageBase64: data,
      extraImages,
      schema: PRODUCT_AI_SCHEMA,
    });

    // Map suggested names onto real category/unit ids (case-insensitive).
    const categoryId =
      categories.find(
        (c) =>
          c.name.toLowerCase() === (suggestion.categoryName ?? '').toLowerCase(),
      )?.id ?? null;
    const unitId =
      units.find(
        (u) => u.name.toLowerCase() === (suggestion.unitName ?? '').toLowerCase(),
      )?.id ?? null;

    // The base64 payload goes out of scope here — it is never persisted.
    return {
      brand: suggestion.brand ?? '',
      baseName: suggestion.baseName ?? '',
      categoryName: suggestion.categoryName ?? null,
      unitName: suggestion.unitName ?? null,
      categoryId,
      unitId,
      currentBuyPrice: suggestion.currentBuyPrice ?? null,
      currentSellPrice: suggestion.currentSellPrice ?? null,
      barcode: suggestion.barcode ?? null,
      hasVariants: !!suggestion.hasVariants,
      variants: Array.isArray(suggestion.variants)
        ? normalizeVariantSlots(
            suggestion.variants.map((v) => ({
              slot1: v.slot1 ?? null,
              slot2: v.slot2 ?? null,
              slot3: v.slot3 ?? null,
              slot4: v.slot4 ?? null,
              sku: v.sku ?? null,
              buyPrice: v.buyPrice ?? null,
              sellPrice: v.sellPrice ?? null,
              quantity: v.quantity ?? null,
            })),
          )
        : [],
      attributes: suggestion.attributes ?? null,
      isPerishable: !!suggestion.isPerishable,
      reorderLevel: suggestion.reorderLevel ?? null,
      reorderQty: suggestion.reorderQty ?? null,
    };
  }



  /**
   * Suggest a realistic set of variants for a product (from the brand/name the
   * owner typed, optionally keeping the rows already in the form). Returns
   * variant rows ready to drop into the 4-slot builder.
   */
  async suggestVariants(input: {
    brand?: string;
    baseName?: string;
    existing?: ExistingVariantInput[];
  }): Promise<AiProductVariantSuggestion[]> {
    const suggestion = await this.gemini.generateJson<{
      variants?: AiProductVariantSuggestion[];
    }>({
      systemInstruction: SUGGEST_VARIANTS_SYSTEM_INSTRUCTION,
      prompt: suggestVariantsPrompt(input),
      schema: SUGGEST_VARIANTS_SCHEMA,
      temperature: 0.5,
    });
    return normalizeVariantSlots(
      (suggestion.variants ?? [])
        .filter((v) => v.slot1 || v.slot2 || v.slot3 || v.slot4 || v.sku)
        .map((v) => ({
          slot1: v.slot1 ?? null,
          slot2: v.slot2 ?? null,
          slot3: v.slot3 ?? null,
          slot4: v.slot4 ?? null,
          sku: v.sku ?? null,
          buyPrice: v.buyPrice ?? null,
          sellPrice: v.sellPrice ?? null,
          quantity: v.quantity ?? null,
        })),
    );
  }

  /**
   * AI scan for Sales/Requests: match a photo to an existing catalog product.
   * Returns the matched product in the same shape as GET /products plus the
   * matched variant (when the photo shows a specific variant of the range).
   */
  async identifyProduct(
    base64Image: string,
    tenantId: number | null,
    base64Image2: string | undefined,
    user: JwtPayload,
  ): Promise<ProductIdentifyResult> {
    const { imageMimeType, imageBase64, extraImages } =
      this.decodeAndValidateImages(base64Image, base64Image2);

    const extracted = await this.gemini.analyzeImage<ExtractedProductInfo>({
      systemInstruction: IDENTIFY_SYSTEM_INSTRUCTION,
      prompt: identifyProductPrompt(!!extraImages),
      imageMimeType,
      imageBase64,
      extraImages,
      schema: IDENTIFY_SCHEMA,
    });
    const clean: ExtractedProductInfo = {
      brand: extracted.brand ?? null,
      baseName: extracted.baseName ?? null,
      sku: extracted.sku ?? null,
      barcode: extracted.barcode ?? null,
      variantHint: extracted.variantHint ?? null,
    };

    const { product, variant, matchType, confidence } =
      await this.matchCatalogProduct(clean, tenantId, user);
    return { product, variant, confidence, matchType, extracted: clean };
  }

  /** Decode + validate one or two base64 images; returns Gemini-ready parts. */
  private decodeAndValidateImages(
    base64Image: string,
    base64Image2?: string,
  ): {
    imageMimeType: string;
    imageBase64: string;
    extraImages?: Array<{ mimeType: string; base64: string }>;
  } {
    const { mimeType, data } = this.decodeBase64(base64Image);
    if (!ALLOWED_IMAGE_TYPES.has(mimeType)) {
      throw new BadRequestException(
        'Unsupported image type. Use JPEG, PNG, WEBP, or HEIC.',
      );
    }
    const decoded = Buffer.from(data, 'base64');
    if (decoded.byteLength === 0) {
      throw new BadRequestException('The image payload is empty.');
    }
    if (decoded.byteLength > MAX_DECODED_BYTES) {
      throw new BadRequestException(
        'Image is too large (max 8MB). Take a smaller photo.',
      );
    }
    let extraImages: Array<{ mimeType: string; base64: string }> | undefined;
    if (base64Image2 && base64Image2.trim()) {
      const second = this.decodeBase64(base64Image2);
      if (!ALLOWED_IMAGE_TYPES.has(second.mimeType)) {
        throw new BadRequestException(
          'Unsupported image type for the second photo. Use JPEG, PNG, WEBP, or HEIC.',
        );
      }
      const decoded2 = Buffer.from(second.data, 'base64');
      if (decoded2.byteLength === 0 || decoded2.byteLength > MAX_DECODED_BYTES) {
        throw new BadRequestException(
          'The second photo is empty or too large (max 8MB).',
        );
      }
      extraImages = [{ mimeType: second.mimeType, base64: second.data }];
    }
    return { imageMimeType: mimeType, imageBase64: data, extraImages };
  }

  /** Best-effort match of the extracted label data against the tenant catalog. */
  private async matchCatalogProduct(
    extracted: ExtractedProductInfo,
    tenantId: number | null,
    user: JwtPayload,
  ): Promise<{
    product: any | null;
    variant: any | null;
    matchType: 'barcode' | 'sku' | 'exact' | 'partial' | 'none';
    confidence: 'high' | 'medium' | 'low' | 'none';
  }> {
    const tenantWhere = tenantId != null ? { tenantId } : {};
    const include: any = {
      category: true,
      unit: true,
      variants: { orderBy: { id: 'asc' } },
      inventory: user.locationId
        ? {
            where: { locationId: user.locationId },
            include: { location: true },
          }
        : { include: { location: true } },
    };

    // 1) Exact barcode on the product or one of its variants.
    if (extracted.barcode && extracted.barcode.trim()) {
      const b = extracted.barcode.trim();
      const hit = await this.prisma.product.findFirst({
        where: {
          ...tenantWhere,
          OR: [{ barcode: b }, { variants: { some: { barcode: b } } }],
        },
        select: { id: true },
      });
      if (hit) {
        const { product, variant } = await this.matchVariant(hit.id, extracted, include);
        return { product, variant, matchType: 'barcode', confidence: 'high' };
      }
    }

    // 2) Exact SKU on the product or one of its variants.
    if (extracted.sku && extracted.sku.trim()) {
      const s = extracted.sku.trim();
      const hit = await this.prisma.product.findFirst({
        where: {
          ...tenantWhere,
          OR: [{ sku: s }, { variants: { some: { sku: s } } }],
        },
        select: { id: true },
      });
      if (hit) {
        const { product, variant } = await this.matchVariant(hit.id, extracted, include);
        return { product, variant, matchType: 'sku', confidence: 'high' };
      }
    }

    const insensitive = { mode: 'insensitive' as const };

    // 3) Brand + baseName both match.
    if (extracted.brand && extracted.baseName) {
      const hits = await this.prisma.product.findMany({
        where: {
          ...tenantWhere,
          AND: [
            { brand: { contains: extracted.brand, ...insensitive } },
            { baseName: { contains: extracted.baseName, ...insensitive } },
          ],
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (hits.length > 0) {
        const { product, variant } = await this.matchVariant(hits[0].id, extracted, include);
        return { product, variant, matchType: 'exact', confidence: 'high' };
      }
    }

    // 4) baseName alone (partial).
    if (extracted.baseName) {
      const hits = await this.prisma.product.findMany({
        where: {
          ...tenantWhere,
          baseName: { contains: extracted.baseName, ...insensitive },
        },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (hits.length > 0) {
        const { product, variant } = await this.matchVariant(hits[0].id, extracted, include);
        return {
          product,
          variant,
          matchType: 'partial',
          confidence: variant ? 'high' : 'medium',
        };
      }
    }

    // 5) brand alone (loose).
    if (extracted.brand) {
      const hits = await this.prisma.product.findMany({
        where: { ...tenantWhere, brand: { contains: extracted.brand, ...insensitive } },
        select: { id: true },
        orderBy: { id: 'asc' },
      });
      if (hits.length > 0) {
        const { product, variant } = await this.matchVariant(hits[0].id, extracted, include);
        return { product, variant, matchType: 'partial', confidence: 'low' };
      }
    }

    return { product: null, variant: null, matchType: 'none', confidence: 'none' };
  }

  /** Fetch the full matched product and attach the matching variant (by hint). */
  private async matchVariant(
    productId: number,
    extracted: ExtractedProductInfo,
    include: any,
  ): Promise<{ product: any; variant: any | null }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      include,
    });
    if (!product) return { product: null, variant: null };
    const variants = product.variants ?? [];
    if (variants.length === 0) return { product, variant: null };

    const hint = (extracted.variantHint ?? '').trim().toLowerCase();
    if (!hint) return { product, variant: null };
    // Strip qualifiers ("size", "color", ...) so "Size 42" matches slot1 "42".
    const cleanHint = hint.replace(
      /^(size|color|colour|capacity|power|model|style|flavour|flavor|volume|type)\s*[:#-]?\s*/i,
      '',
    );
    const match = variants.find((v: any) => {
      const skuBarcode = [v.sku, v.barcode].filter(Boolean).join(' ').toLowerCase();
      if (skuBarcode.includes(hint) || skuBarcode.includes(cleanHint)) return true;
      const attrs = v.attributes ?? {};
      const attrText = Object.values(attrs).join(' ').toLowerCase();
      return attrText.includes(hint) || attrText.includes(cleanHint);
    });
    return { product, variant: match ?? null };
  }

  /** Accepts a `data:image/...;base64,....` data URL or a raw base64 string. */
  private decodeBase64(base64Image: string): {
    mimeType: string;
    data: string;
  } {
    const trimmed = base64Image.trim();
    const dataUrl = /^data:([a-z0-9.+-]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(
      trimmed,
    );
    if (dataUrl) {
      return {
        mimeType: dataUrl[1].toLowerCase(),
        data: dataUrl[2],
      };
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(trimmed)) {
      return { mimeType: 'image/jpeg', data: trimmed };
    }
    throw new BadRequestException('Invalid base64 image payload.');
  }
}


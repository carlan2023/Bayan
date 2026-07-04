import { connectDB, disconnectDB, Product } from "./db.js";

const CLOTHING_SIZES = ["XS", "S", "M", "L", "XL"];
const KID_SIZES = ["2-3y", "4-5y", "6-7y", "8-9y"];
const ONE_SIZE = ["One size"];

// Prices below are the original KES figures; they are converted to UGX on insert
// (see KES_TO_UGX). `img` is a real product photo (the UI falls back to generated
// art if a URL ever fails to load).
const U = (id) => `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=800&q=70`;

const products = [
  // ---- Women ----
  { name: "Linen Wrap Midi Dress", category: "Women", price: 4850, compare: 5900, swatch: "#2e4b3f", fabric: "100% linen", featured: 1,
    img: U("1596783074918-c84cb06531ca"),
    colors: [{ name: "Forest", hex: "#2E4B3F" }, { name: "Ivory", hex: "#F1EADB" }], sizes: CLOTHING_SIZES,
    desc: "A breezy wrap silhouette in washed linen with a self-tie waist and side pockets. Cut for an easy, flattering drape from desk to dinner." },
  { name: "Ribbed Knit Cardigan", category: "Women", price: 3200, swatch: "#b98a5a", fabric: "Cotton-wool blend",
    img: U("1576871337622-98d48d1cf531"),
    colors: [{ name: "Camel", hex: "#B98A5A" }, { name: "Charcoal", hex: "#3A3A38" }], sizes: CLOTHING_SIZES,
    desc: "A relaxed-fit cardigan in a chunky rib with horn-effect buttons. Soft enough for bare skin, warm enough for cool evenings." },
  { name: "High-Rise Wide Leg Trousers", category: "Women", price: 3950, swatch: "#22303a", fabric: "Tencel twill", featured: 1,
    img: U("1551803091-e20673f15770"),
    colors: [{ name: "Ink Navy", hex: "#22303A" }, { name: "Stone", hex: "#C8BFAE" }], sizes: CLOTHING_SIZES,
    desc: "Fluid wide-leg trousers with a sharp pressed crease and clean waistband. Tailoring that moves like loungewear." },
  { name: "Silk-Touch Blouse", category: "Women", price: 2890, swatch: "#dccbb4", fabric: "Sandwashed modal",
    img: U("1564257631407-4deb1f99d992"),
    colors: [{ name: "Champagne", hex: "#DCCBB4" }, { name: "Sage", hex: "#93A392" }], sizes: CLOTHING_SIZES,
    desc: "A featherweight blouse with a concealed placket and softly rounded collar. Tucks or drapes with equal ease." },
  { name: "Belted Trench Coat", category: "Women", price: 7450, compare: 8900, swatch: "#a98f6e", fabric: "Water-resistant cotton",
    img: U("1591047139829-d91aecb6caea"),
    colors: [{ name: "Sand", hex: "#A98F6E" }], sizes: CLOTHING_SIZES,
    desc: "A classic double-breasted trench with storm flap and deep welt pockets, cut slightly longer for modern proportion." },
  { name: "Pleated Satin Skirt", category: "Women", price: 3350, swatch: "#6e4b3f", fabric: "Recycled satin",
    img: U("1583496661160-fb5886a0aaaa"),
    colors: [{ name: "Cocoa", hex: "#6E4B3F" }, { name: "Olive", hex: "#5C6248" }], sizes: CLOTHING_SIZES,
    desc: "Knife pleats in a liquid satin that catches the light. Elasticated back waist for all-day comfort." },
  { name: "Everyday Leather Tote", category: "Women", price: 6200, swatch: "#43302b", fabric: "Full-grain leather", featured: 1,
    img: U("1584917865442-de89df76afd3"),
    colors: [{ name: "Espresso", hex: "#43302B" }, { name: "Tan", hex: "#A5754C" }], sizes: ONE_SIZE,
    desc: "A structured tote that fits a 14\" laptop, with an interior zip pocket and magnetic closure. Ages beautifully." },
  { name: "Chunky Gold-Tone Hoops", category: "Women", price: 1450, swatch: "#c9a24b", fabric: "Brass, 18k gold plate",
    img: U("1535632066927-ab7c9ab60908"),
    colors: [{ name: "Gold", hex: "#C9A24B" }], sizes: ONE_SIZE,
    desc: "Bold but featherlight hollow hoops with a secure hinged closure. The pair that finishes every outfit." },

  // ---- Men ----
  { name: "Garment-Dyed Oxford Shirt", category: "Men", price: 2950, swatch: "#7b8fa3", fabric: "100% cotton oxford", featured: 1,
    img: U("1603252109303-2751441dd157"),
    colors: [{ name: "Dusty Blue", hex: "#7B8FA3" }, { name: "White", hex: "#F4F1E8" }, { name: "Clay", hex: "#B06A4D" }], sizes: CLOTHING_SIZES,
    desc: "A washed oxford with a soft button-down collar and single chest pocket. Broken-in from the first wear." },
  { name: "Slim Stretch Chinos", category: "Men", price: 3450, swatch: "#8a7b5c", fabric: "Cotton with 2% elastane",
    img: U("1473966968600-fa801b869a1a"),
    colors: [{ name: "Khaki", hex: "#8A7B5C" }, { name: "Navy", hex: "#28323E" }, { name: "Black", hex: "#26241F" }], sizes: ["30", "32", "34", "36", "38"],
    desc: "Clean-front chinos cut slim through the thigh with a slight taper. Enough stretch to forget you're wearing them." },
  { name: "Merino Crew Neck Jumper", category: "Men", price: 4150, compare: 4900, swatch: "#4e5d4a", fabric: "Extra-fine merino wool",
    img: U("1614975059251-992f11792b9f"),
    colors: [{ name: "Moss", hex: "#4E5D4A" }, { name: "Oat", hex: "#CFC4AC" }], sizes: CLOTHING_SIZES,
    desc: "A 12-gauge merino crew that layers flat under a jacket and holds its shape wash after wash." },
  { name: "Heavyweight Pocket Tee", category: "Men", price: 1650, swatch: "#d6cdbb", fabric: "220gsm organic cotton",
    img: U("1521572163474-6864f9cf17ab"),
    colors: [{ name: "Ecru", hex: "#D6CDBB" }, { name: "Forest", hex: "#2E4B3F" }, { name: "Rust", hex: "#9E5B3C" }], sizes: CLOTHING_SIZES,
    desc: "A boxy-fit tee in dense jersey with a ribbed collar that won't sag. The one you'll reach for daily." },
  { name: "Wool-Blend Overcoat", category: "Men", price: 8950, swatch: "#57534a", fabric: "70% wool blend", featured: 1,
    img: U("1544022613-e87ca75a784a"),
    colors: [{ name: "Slate", hex: "#57534A" }, { name: "Camel", hex: "#B98A5A" }], sizes: CLOTHING_SIZES,
    desc: "A single-breasted topcoat with notch lapels and a clean back vent. Sharp over a suit, easy over a hoodie." },
  { name: "Suede Desert Boots", category: "Men", price: 5650, swatch: "#8c6748", fabric: "Suede, crepe sole",
    img: U("1520639888713-7851133b1ed0"),
    colors: [{ name: "Taupe", hex: "#8C6748" }], sizes: ["40", "41", "42", "43", "44", "45"],
    desc: "Two-eyelet desert boots on a cushioned crepe sole. The most versatile shoe in any wardrobe." },
  { name: "Canvas Weekender Bag", category: "Men", price: 4850, swatch: "#3f4a3c", fabric: "Waxed canvas, leather trim",
    img: U("1553062407-98eeb64c6a62"),
    colors: [{ name: "Hunter", hex: "#3F4A3C" }], sizes: ONE_SIZE,
    desc: "A 40L weekender in waxed canvas with a detachable shoulder strap and shoe compartment. Built for short escapes." },

  // ---- Kids ----
  { name: "Dinosaur Print Pyjama Set", category: "Kids", price: 1450, swatch: "#5b7a6a", fabric: "Brushed organic cotton", featured: 1,
    img: U("1522771930-4b3a86a0c7d4"),
    colors: [{ name: "Sage Dino", hex: "#5B7A6A" }], sizes: KID_SIZES,
    desc: "Snug-fit pyjamas covered in friendly dinosaurs, with ribbed cuffs to keep the warmth in and covers on." },
  { name: "Corduroy Dungarees", category: "Kids", price: 1950, swatch: "#a5754c", fabric: "Stretch corduroy",
    img: U("1560506840-ec148e82a604"),
    colors: [{ name: "Toffee", hex: "#A5754C" }, { name: "Berry", hex: "#7E4653" }], sizes: KID_SIZES,
    desc: "Hard-wearing dungarees with adjustable straps, popper legs and reinforced knees for serious playground work." },
  { name: "Colour-Block Raincoat", category: "Kids", price: 2350, swatch: "#3e6b8c", fabric: "Recycled waterproof shell",
    img: U("1547955605-6d5efb3f8d3b"),
    colors: [{ name: "Sea Blue", hex: "#3E6B8C" }], sizes: KID_SIZES,
    desc: "Fully taped seams, a peaked hood and reflective trims. Puddle-jumping approved." },
  { name: "Chunky Knit Bobble Hat", category: "Kids", price: 850, swatch: "#c0563e", fabric: "Soft acrylic knit",
    img: U("1576871337632-b9aef4c17ab9"),
    colors: [{ name: "Paprika", hex: "#C0563E" }, { name: "Cream", hex: "#F1EADB" }], sizes: ONE_SIZE,
    desc: "A double-layered bobble hat that stays put on the school run. Itch-free lining." },

  // ---- Home ----
  { name: "Stoneware Dinner Set (12pc)", category: "Home", price: 6950, compare: 8200, swatch: "#b9ae99", fabric: "Reactive-glaze stoneware", featured: 1,
    img: U("1578749556568-bc2c40e68b61"),
    colors: [{ name: "Oat Glaze", hex: "#B9AE99" }, { name: "Forest Glaze", hex: "#4A5C50" }], sizes: ONE_SIZE,
    desc: "Four place settings of speckled reactive-glaze stoneware. Each piece slightly unique; all dishwasher safe." },
  { name: "Waffle Cotton Bath Towel Set", category: "Home", price: 2850, swatch: "#93a392", fabric: "Turkish cotton waffle",
    img: U("1600369672770-985fd30004eb"),
    colors: [{ name: "Sage", hex: "#93A392" }, { name: "Ivory", hex: "#F1EADB" }, { name: "Clay", hex: "#B06A4D" }], sizes: ONE_SIZE,
    desc: "Two bath and two hand towels in airy waffle weave: quick-drying, lightweight and hotel-soft." },
  { name: "Linen Cushion Cover Pair", category: "Home", price: 1750, swatch: "#8b6d50", fabric: "Stonewashed linen",
    img: U("1584100936595-c0654b55a2e2"),
    colors: [{ name: "Tobacco", hex: "#8B6D50" }, { name: "Olive", hex: "#5C6248" }, { name: "Natural", hex: "#CFC4AC" }], sizes: ONE_SIZE,
    desc: "Two 50cm covers in heavyweight stonewashed linen with hidden zips. Instant texture for any sofa." },
  { name: "Amber Glass Table Lamp", category: "Home", price: 4250, swatch: "#b06a4d", fabric: "Glass, linen shade",
    img: U("1507473885765-e6ed057f782c"),
    colors: [{ name: "Amber", hex: "#B06A4D" }], sizes: ONE_SIZE,
    desc: "A ribbed amber glass base with a natural linen drum shade. Throws the warmest evening light." },
  { name: "Sandalwood & Fig Candle", category: "Home", price: 1250, swatch: "#6e5a43", fabric: "Soy wax, 45hr burn",
    img: U("1603006905003-be475563bc59"),
    colors: [{ name: "Sandalwood", hex: "#6E5A43" }], sizes: ONE_SIZE,
    desc: "Hand-poured soy candle with notes of fig, sandalwood and amber, in a reusable ribbed glass jar." },
];

// Currency: the catalogue was authored in KES; convert to realistic UGX and round
// to the nearest 1,000 UGX for clean pricing. Adjust individual prices in admin.
const KES_TO_UGX = 35;
const toUgxCents = (kes) => Math.round((kes * KES_TO_UGX) / 1000) * 1000 * 100;

const slugify = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");

const docs = () =>
  products.map((p) => ({
    slug: slugify(p.name),
    name: p.name,
    description: p.desc,
    category: p.category,
    price_cents: toUgxCents(p.price),
    compare_at_cents: p.compare ? toUgxCents(p.compare) : null,
    swatch: p.swatch,
    image: p.img || null,
    colors: p.colors,
    sizes: p.sizes,
    fabric: p.fabric || null,
    featured: !!p.featured,
    stock: 30 + Math.floor(Math.random() * 40),
  }));

async function main() {
  await connectDB();
  const count = await Product.countDocuments();

  // RESEED=1 forces a full refresh (drop + reinsert) — used to apply the UGX
  // prices and product photos to an already-seeded database. Normal boots keep
  // the idempotent "skip if products exist" behaviour so admin edits survive.
  if (count > 0 && !process.env.RESEED) {
    console.log(`Products collection already has ${count} docs - skipping seed.`);
    return;
  }
  if (count > 0) {
    await Product.deleteMany({});
    console.log(`RESEED: cleared ${count} existing products.`);
  }
  await Product.insertMany(docs());
  console.log(`Seeded ${products.length} products (UGX pricing, with photos).`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());

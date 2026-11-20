import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import ProductCard from "@/components/marketplace/ProductCard";

// Explicitly distinguish substitutes from accessories; no purchase-history claims.
const PAIRINGS: { trigger: RegExp; accessory: RegExp }[] = [
  { trigger: /phone|smartphone|iphone|samsung galaxy/, accessory: /case|screen protector|charger|charging cable|earbuds|headphone|power bank/ },
  { trigger: /laptop|notebook|macbook|computer/, accessory: /mouse|keyboard|laptop bag|sleeve|stand|usb hub|dock|charger/ },
  { trigger: /camera|dslr|mirrorless/, accessory: /tripod|memory card|sd card|camera bag|lens|battery/ },
  { trigger: /running shoe|sneaker|trainer|athletic shoe/, accessory: /sock|shorts|sportswear|shoe care|water bottle|fitness/ },
  { trigger: /dress|shirt|blouse|trouser|jeans|skirt|jacket/, accessory: /belt|handbag|necklace|earring|bracelet|shoe|sandal|watch/ },
  { trigger: /coffee machine|espresso|coffee maker/, accessory: /coffee bean|coffee capsule|coffee pod|mug|descaler|coffee filter/ },
  { trigger: /gaming console|playstation|xbox|nintendo switch/, accessory: /controller|headset|game|charging dock|console case/ },
  { trigger: /television|smart tv|\btv\b/, accessory: /soundbar|hdmi|tv mount|remote|speaker/ },
  { trigger: /bed|mattress/, accessory: /pillow|bedsheet|bed sheet|duvet|blanket|mattress protector/ },
  { trigger: /skincare|face cream|moisturizer|cleanser|serum/, accessory: /sunscreen|cleanser|serum|moisturizer|face mask/ },
  { trigger: /baby stroller|pushchair/, accessory: /diaper bag|rain cover|baby blanket|stroller organizer/ },
];

type Candidate = {
  id: string; name: string; slug: string; description: string | null;
  category_id: string | null; price: number; compare_at_price: number | null;
  stock: number | null; vendor_id: string; deal_ends_at: string | null;
  product_images: { url: string; position: number }[] | null;
  vendors: { store_name: string } | null;
};

const words = (value: string) => new Set((value.toLowerCase().match(/[a-z0-9]+/g) || [])
  .filter((w) => w.length > 3 && !["with", "from", "this", "that", "product", "quality"].includes(w)));

const scoreSimilar = (item: Candidate, selected: Candidate) => {
  const a = words(selected.name), b = words(item.name);
  const overlap = [...a].filter((w) => b.has(w)).length;
  const priceRatio = Math.abs(Number(item.price) - Number(selected.price)) / Math.max(Number(selected.price), 1);
  return overlap * 5 + Math.max(0, 3 - priceRatio * 3);
};

const scoreComplement = (item: Candidate, selected: Candidate) => {
  const selectedText = selected.name.toLowerCase();
  const itemText = item.name.toLowerCase();
  let score = 0;
  for (const rule of PAIRINGS) {
    if (rule.trigger.test(selectedText) && rule.accessory.test(itemText)) score += 10;
  }
  // Never show the same category as a complementary match without an explicit accessory rule.
  if (score === 0) return 0;
  const selectedWords = words(selected.name);
  const itemWords = words(item.name);
  score += [...selectedWords].filter((w) => itemWords.has(w)).length;
  return score;
};

const ProductGrid = ({ title, products }: { title: string; products: Candidate[] }) => {
  if (!products.length) return null;
  return (
    <section className="mt-10 space-y-4" aria-label={title}>
      <h2 className="text-xl font-bold">{title}</h2>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
        {products.map((p) => {
          const image = [...(p.product_images || [])].sort((a, b) => a.position - b.position)[0]?.url;
          return <ProductCard key={p.id} id={p.id} name={p.name} slug={p.slug}
            price={p.price} compareAtPrice={p.compare_at_price}
            image={image || "/placeholder.svg"} vendorId={p.vendor_id}
            vendorName={p.vendors?.store_name || ""} dealEndsAt={p.deal_ends_at} />;
        })}
      </div>
    </section>
  );
};

export default function ProductRecommendations({ product }: { product: Candidate }) {
  const { data: candidates = [] } = useQuery({
    queryKey: ["product-recommendations", product.id, product.category_id],
    queryFn: async () => {
      // Cap the candidate pool for predictable query cost. Rerank client-side.
      const { data, error } = await supabase.from("products")
        .select("id,name,slug,description,category_id,price,compare_at_price,stock,vendor_id,deal_ends_at,product_images(url,position),vendors(store_name)")
        .eq("status", "active").neq("id", product.id)
        .limit(250);
      if (error) throw error;
      return (data || []) as unknown as Candidate[];
    },
    enabled: !!product.id,
    staleTime: 60_000,
  });

  const available = candidates.filter((p) => p.stock == null || p.stock > 0);
  const similar = available.filter((p) => p.category_id && p.category_id === product.category_id)
    .sort((a, b) => scoreSimilar(b, product) - scoreSimilar(a, product))
    .slice(0, 8);
  const similarIds = new Set(similar.map((p) => p.id));
  const complements = available.filter((p) => !similarIds.has(p.id))
    .map((p) => ({ product: p, score: scoreComplement(p, product) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8).map((entry) => entry.product);

  return (
    <>
      <ProductGrid title="You May Also Like" products={similar} />
      <ProductGrid title="Goes Well With This" products={complements} />
    </>
  );
}

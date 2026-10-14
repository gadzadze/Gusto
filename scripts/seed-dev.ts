// Usage: npm run db:seed
//
// Fills a LOCAL or dedicated dev database with clearly fictional data: every
// business, category and product is prefixed "[DEMO]", every address is
// @demo.gusto.example. It refuses to run unless DATABASE_URL points at a local
// host or a host in SEED_ALLOWED_HOSTS, and refuses to run twice.
//
// The demo users cannot sign in (their addresses do not exist). To look around,
// sign in with your own address and `npm run admin:grant -- you@example.com`.
import "./load-env";
import Module from "node:module";
import { checkSeedTarget } from "./seed-guard";

// Domain modules import "server-only", which throws outside a React Server
// Components build. Running with the react-server condition would instead
// break next-intl, so this script makes that one import a no-op.
type Loader = { _load: (request: string, ...rest: unknown[]) => unknown };
const loader = Module as unknown as Loader;
const load = loader._load;
loader._load = function (this: unknown, request: string, ...rest: unknown[]) {
  return request === "server-only" ? {} : load.call(this, request, ...rest);
};

const guard = checkSeedTarget(process.env.DATABASE_URL, process.env.SEED_ALLOWED_HOSTS, process.env.NODE_ENV);
if (!guard.ok) {
  console.error(`Refusing to seed: ${guard.reason}`);
  process.exit(2);
}

type Item = { name: string; sku: string; unit: "piece" | "kg" | "l" | "bottle" | "box" | "pack" | "case"; price: string; vat?: string; pack?: string };

const BEVERAGES: Item[] = [
  { name: "[DEMO] მინერალური წყალი, ბუნებრივი", sku: "BEV-001", unit: "bottle", price: "1,10", pack: "0,5 ლ" },
  { name: "[DEMO] მინერალური წყალი, გაზიანი", sku: "BEV-002", unit: "bottle", price: "1,30", pack: "0,5 ლ" },
  { name: "[DEMO] ლიმონათი, ტარხუნა", sku: "BEV-003", unit: "bottle", price: "2,20", pack: "0,5 ლ" },
  { name: "[DEMO] ლიმონათი, ბარამბო", sku: "BEV-004", unit: "bottle", price: "2,20", pack: "0,5 ლ" },
  { name: "[DEMO] ვაშლის წვენი", sku: "BEV-005", unit: "l", price: "3,40" },
  { name: "[DEMO] ბროწეულის წვენი", sku: "BEV-006", unit: "l", price: "6,80" },
  { name: "[DEMO] ლუდი, ღია, 0,5", sku: "BEV-007", unit: "bottle", price: "2,60", pack: "0,5 ლ" },
  { name: "[DEMO] ლუდი, ბნელი, 0,5", sku: "BEV-008", unit: "bottle", price: "3,10", pack: "0,5 ლ" },
  { name: "[DEMO] წითელი ღვინო, საფერავი", sku: "BEV-009", unit: "bottle", price: "18,00", pack: "0,75 ლ" },
  { name: "[DEMO] თეთრი ღვინო, რქაწითელი", sku: "BEV-010", unit: "bottle", price: "16,50", pack: "0,75 ლ" },
  { name: "[DEMO] ყავის მარცვალი, ესპრესო", sku: "BEV-011", unit: "kg", price: "42,00" },
  { name: "[DEMO] შავი ჩაი, ფოთლოვანი", sku: "BEV-012", unit: "box", price: "9,90", pack: "100 გრ" },
  { name: "[DEMO] ენერგეტიკული სასმელი", sku: "BEV-013", unit: "piece", price: "3,80", pack: "0,25 ლ" },
  { name: "[DEMO] ტონიკი", sku: "BEV-014", unit: "bottle", price: "2,90", pack: "0,33 ლ" },
  { name: "[DEMO] წყალი, ყუთი 12 ბოთლი", sku: "BEV-015", unit: "case", price: "12,00" },
];
const FOOD: Item[] = [
  { name: "[DEMO] სულგუნი", sku: "FOD-001", unit: "kg", price: "18,50" },
  { name: "[DEMO] იმერული ყველი", sku: "FOD-002", unit: "kg", price: "16,00" },
  { name: "[DEMO] მაწონი", sku: "FOD-003", unit: "piece", price: "2,40", pack: "0,5 კგ" },
  { name: "[DEMO] კარაქი", sku: "FOD-004", unit: "pack", price: "7,90", pack: "200 გრ" },
  { name: "[DEMO] ხაჭო", sku: "FOD-005", unit: "kg", price: "11,50" },
  { name: "[DEMO] ქათმის ფილე", sku: "FOD-006", unit: "kg", price: "13,90" },
  { name: "[DEMO] საქონლის ხორცი, ფარში", sku: "FOD-007", unit: "kg", price: "22,00" },
  { name: "[DEMO] ბრინჯი", sku: "FOD-008", unit: "kg", price: "3,60" },
  { name: "[DEMO] ფქვილი, პირველი ხარისხი", sku: "FOD-009", unit: "kg", price: "1,90" },
  { name: "[DEMO] მზესუმზირის ზეთი", sku: "FOD-010", unit: "l", price: "4,70" },
  { name: "[DEMO] ზეითუნის ზეთი", sku: "FOD-011", unit: "l", price: "21,00" },
  { name: "[DEMO] პომიდორი", sku: "FOD-012", unit: "kg", price: "3,20" },
  { name: "[DEMO] კიტრი", sku: "FOD-013", unit: "kg", price: "2,80" },
  { name: "[DEMO] კვერცხი", sku: "FOD-014", unit: "pack", price: "6,40", pack: "10 ც" },
  { name: "[DEMO] შაქარი", sku: "FOD-015", unit: "kg", price: "2,70" },
];

async function main() {
  process.env.DATABASE_URL = process.env.DATABASE_URL_DIRECT ?? process.env.DATABASE_URL;
  // Re-check against the URL actually used.
  const used = checkSeedTarget(process.env.DATABASE_URL, process.env.SEED_ALLOWED_HOSTS, process.env.NODE_ENV);
  if (!used.ok) throw new Error(`Refusing to seed: ${used.reason}`);

  const { eq, like, sql } = await import("drizzle-orm");
  const { onboardingSchema } = await import("../src/lib/validation/onboarding");
  const { productSchema } = await import("../src/lib/validation/product");
  const { customerSchema } = await import("../src/lib/validation/customer");
  const { closeDb, getDb } = await import("../src/server/db/client");
  const { addresses, orders, organizations } = await import("../src/server/db/schema");
  const { grantPlatformAdmin } = await import("../src/server/domain/admin/grant-admin");
  const { createCategory } = await import("../src/server/domain/catalog/categories");
  const { createProduct } = await import("../src/server/domain/catalog/products");
  const { createCustomer, setCustomerPriceList } = await import("../src/server/domain/customers/customers");
  const { acceptInvitationAsBuyer } = await import("../src/server/domain/customers/invitations");
  const { createOrganizationForUser } = await import("../src/server/domain/onboarding/create-organization");
  const { getCart, setCartQuantity } = await import("../src/server/domain/orders/cart");
  const { submitOrder } = await import("../src/server/domain/orders/submit");
  const { confirmOrder, markDelivered, rejectOrder } = await import("../src/server/domain/orders/transitions");
  const { createPriceList, setPriceOverrides } = await import("../src/server/domain/pricing/price-lists");
  const { randomUUID } = await import("node:crypto");

  const db = getDb();
  try {
    const existing = await db.select({ id: organizations.id }).from(organizations).where(like(organizations.name, "[DEMO]%")).limit(1);
    if (existing.length > 0) {
      console.log("Demo data is already there ([DEMO] organizations exist). Nothing to do.");
      return;
    }

    const newUser = async (slug: string) => {
      const email = `${slug}@demo.gusto.example`;
      const rows = await db.execute<{ id: string }>(
        sql`insert into auth.users (id, email) values (${randomUUID()}, ${email}) returning id`,
      );
      // Sign-in is invite-only; the demo users are on the list like anyone else.
      await db.execute(sql`insert into allowed_emails (email, note, created_by_label) values (${email}, 'demo user', 'seed') on conflict (email) do nothing`);
      return { id: rows[0].id, email };
    };

    const adminUser = await newUser("admin");
    await db.execute(sql`insert into profiles (id) values (${adminUser.id}) on conflict do nothing`);
    await grantPlatformAdmin(adminUser.email, "seed");
    const admin = { userId: adminUser.id, isPlatformAdmin: true as const };
    const drinksCat = await createCategory(admin, "[DEMO] სასმელები");
    const foodCat = await createCategory(admin, "[DEMO] სურსათი");

    const supplier = async (slug: string, name: string, person: string) => {
      const user = await newUser(slug);
      const { orgId } = await createOrganizationForUser(
        user.id,
        onboardingSchema.parse({ kind: "supplier", businessName: name, contactName: person, phone: "599 00 00 01", city: "თბილისი", deliveryArea: "თბილისი" }),
      );
      await db.update(organizations).set({ status: "active" }).where(eq(organizations.id, orgId));
      return { userId: user.id, orgId, orgType: "supplier" as const, orgStatus: "active" as const };
    };
    const buyer = async (slug: string, name: string, type: "restaurant" | "cafe", person: string) => {
      const user = await newUser(slug);
      const { orgId } = await createOrganizationForUser(
        user.id,
        onboardingSchema.parse({ kind: "buyer", businessName: name, businessType: type, contactName: person, phone: "555 00 00 02", city: "თბილისი", addressLine: "[DEMO] ჭავჭავაძის გამზ. 1" }),
      );
      return { userId: user.id, orgId, orgType: "buyer" as const, orgStatus: "active" as const };
    };

    const drinks = await supplier("drinks", "[DEMO] სასმელების დისტრიბუცია", "დემო მომწოდებელი");
    const food = await supplier("food", "[DEMO] სურსათის დისტრიბუცია", "დემო მომწოდებელი");
    const restaurant = await buyer("restaurant", "[DEMO] რესტორანი „ვაკე“", "restaurant", "დემო მყიდველი");
    const cafe = await buyer("cafe", "[DEMO] კაფე „რუსთაველი“", "cafe", "დემო მყიდველი");

    const addProducts = async (ctx: typeof drinks, categoryId: string, items: Item[]) => {
      const ids: string[] = [];
      for (const i of items) {
        ids.push(
          await createProduct(
            ctx,
            productSchema.parse({
              name: i.name, description: "", brand: "", sku: i.sku, categoryId, unit: i.unit,
              packDescription: i.pack ?? "", basePrice: i.price, vatRate: "18", minQty: "1", qtyStep: "1",
            }),
          ),
        );
      }
      return ids;
    };
    const drinkIds = await addProducts(drinks, drinksCat, BEVERAGES);
    const foodIds = await addProducts(food, foodCat, FOOD);

    const connect = async (sup: typeof drinks, buy: typeof restaurant, name: string) => {
      const { customerId, token } = await createCustomer(sup, customerSchema.parse({ businessName: name, phone: "555000002", priceListId: "" }));
      await acceptInvitationAsBuyer(buy, token);
      return customerId;
    };
    const restaurantFood = await connect(food, restaurant, "[DEMO] რესტორანი „ვაკე“");
    await connect(drinks, restaurant, "[DEMO] რესტორანი „ვაკე“");
    await connect(drinks, cafe, "[DEMO] კაფე „რუსთაველი“");

    // One custom price list: ~10% off the first five food items for the restaurant.
    const listId = await createPriceList(food, "[DEMO] რესტორნის ფასები");
    await setPriceOverrides(
      food,
      listId,
      FOOD.slice(0, 5).map((item, i) => ({
        productId: foodIds[i],
        priceMinor: Math.round(Number(item.price.replace(",", ".")) * 90),
      })),
    );
    await setCustomerPriceList(food, restaurantFood, listId);

    const place = async (sup: typeof drinks, buy: typeof restaurant, lines: [string, number][], daysAgo: number) => {
      for (const [productId, qty] of lines) await setCartQuantity(buy, sup.orgId, productId, qty * 1000);
      const cart = await getCart(buy, sup.orgId);
      const [address] = await db.select({ id: addresses.id }).from(addresses).where(eq(addresses.organizationId, buy.orgId));
      const result = await submitOrder(buy, sup.orgId, {
        idempotencyKey: randomUUID(),
        expected: cart.lines.map((l) => ({ productId: l.productId, qtyMilli: l.qtyMilli, unitPriceMinor: l.unitPriceMinor })),
        addressId: address.id,
        note: "[DEMO] შეკვეთა",
      });
      if (result.status !== "created") throw new Error("seed order was not created");
      if (daysAgo > 0) {
        await db.update(orders).set({ createdAt: new Date(Date.now() - daysAgo * 24 * 3600 * 1000) }).where(eq(orders.id, result.orderId));
      }
      return result.orderId;
    };

    const o1 = await place(food, restaurant, [[foodIds[0], 5], [foodIds[2], 10], [foodIds[3], 4]], 9);
    await confirmOrder(food, o1, []);
    await markDelivered(food, o1);
    const o2 = await place(food, restaurant, [[foodIds[5], 8], [foodIds[7], 20]], 4);
    await confirmOrder(food, o2, []);
    const o3 = await place(food, restaurant, [[foodIds[10], 2]], 2);
    await rejectOrder(food, o3, "[DEMO] პროდუქტი ამოიწურა");
    await place(food, restaurant, [[foodIds[0], 3], [foodIds[13], 6]], 0);
    const o5 = await place(drinks, cafe, [[drinkIds[10], 5], [drinkIds[0], 24]], 6);
    await confirmOrder(drinks, o5, []);
    await markDelivered(drinks, o5);
    await place(drinks, cafe, [[drinkIds[2], 12]], 0);
    await place(drinks, restaurant, [[drinkIds[8], 6], [drinkIds[9], 6]], 1);

    console.log(`Seeded demo data on ${used.host}: 4 organizations, ${BEVERAGES.length + FOOD.length} products, 1 price list, 7 orders.`);
    console.log("The demo users cannot sign in. Sign in with your own address and run: npm run admin:grant -- you@example.com");
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

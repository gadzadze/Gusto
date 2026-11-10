// The standard set of HoReCa product categories, and how a spreadsheet's category
// text is matched to the categories 202 has. Suppliers cannot create categories
// (the admin does), so the import has to recognise the ways people actually write
// them: other capitals, extra spaces, "&" or "," instead of "და", the English
// name, a shorter or longer form.

export type StandardCategory = { name: string; aliases: string[] };

export const STANDARD_CATEGORIES: StandardCategory[] = [
  { name: "სასმელები", aliases: ["სასმელი", "უალკოჰოლო სასმელები", "გაზიანი სასმელები", "beverages", "beverage", "drinks", "soft drinks"] },
  { name: "წყალი", aliases: ["მინერალური წყალი", "water", "mineral water"] },
  { name: "წვენები", aliases: ["წვენები და ნექტარი", "ნექტარი", "juices", "juice"] },
  { name: "ღვინო", aliases: ["wine", "wines"] },
  { name: "ლუდი", aliases: ["beer", "beers"] },
  { name: "ალკოჰოლური სასმელები", aliases: ["ალკოჰოლი", "ძლიერი სასმელები", "არაყი", "alcohol", "spirits", "liquor"] },
  { name: "ყავა და ჩაი", aliases: ["ყავა", "ჩაი", "coffee", "tea", "coffee and tea"] },
  { name: "რძის პროდუქტები", aliases: ["რძის ნაწარმი", "რძე", "მაწონი", "dairy", "dairy products", "milk"] },
  { name: "ყველი", aliases: ["cheese", "cheeses"] },
  { name: "კვერცხი", aliases: ["eggs", "egg"] },
  { name: "ხორცი და ფრინველი", aliases: ["ხორცი", "ფრინველი", "ხორცპროდუქტები", "meat", "poultry", "meat and poultry"] },
  { name: "ძეხვეული და ნახევარფაბრიკატები", aliases: ["ძეხვეული", "ნახევარფაბრიკატები", "ძეხვეული და დელიკატესები", "sausages", "deli", "charcuterie"] },
  { name: "თევზი და ზღვის პროდუქტები", aliases: ["თევზი", "ზღვის პროდუქტები", "fish", "seafood", "fish and seafood"] },
  { name: "ბოსტნეული და ხილი", aliases: ["ბოსტნეული", "ხილი", "ხილი და ბოსტნეული", "ხილი და კენკრა", "vegetables", "fruit", "fruits", "vegetables and fruit", "fruit and vegetables", "produce"] },
  { name: "მწვანილი", aliases: ["herbs", "greens", "fresh herbs"] },
  { name: "მარცვლეული და ბურღულეული", aliases: ["მარცვლეული", "ბურღულეული", "ბრინჯი", "grains", "cereals", "rice"] },
  { name: "მაკარონი", aliases: ["მაკარონის ნაწარმი", "pasta", "noodles"] },
  { name: "ფქვილი და საცხობი ინგრედიენტები", aliases: ["ფქვილი", "საცხობი ინგრედიენტები", "flour", "baking", "baking ingredients"] },
  { name: "პური და გამომცხვარი პროდუქტები", aliases: ["პური", "საცხობი", "გამომცხვარი პროდუქტები", "bread", "bakery"] },
  { name: "ზეთი და ცხიმები", aliases: ["ზეთი", "ზეთები", "ცხიმები", "oil", "oils", "fats", "oil and fats"] },
  { name: "სანელებლები და მარილი", aliases: ["სანელებლები", "მარილი", "spices", "salt", "seasoning", "spices and salt"] },
  { name: "სოუსები და კონსერვები", aliases: ["სოუსები", "კონსერვები", "კეტჩუპი", "sauces", "canned", "canned goods", "preserves", "sauces and canned goods"] },
  { name: "შაქარი და ტკბილეული", aliases: ["შაქარი", "ტკბილეული", "ტკბილი", "sugar", "sweets", "confectionery", "sugar and sweets"] },
  { name: "გაყინული პროდუქტები", aliases: ["გაყინული", "frozen", "frozen food", "frozen products"] },
  { name: "თხილეული და მშრალი ხილი", aliases: ["თხილეული", "მშრალი ხილი", "ჩირი", "nuts", "dried fruit", "nuts and dried fruit"] },
  { name: "სურსათი", aliases: ["საკვები პროდუქტები", "პროდუქტები", "სურსათი და პროდუქტები", "groceries", "grocery", "food"] },
  { name: "ერთჯერადი ჭურჭელი და შეფუთვა", aliases: ["ერთჯერადი ჭურჭელი", "შეფუთვა", "შესაფუთი მასალა", "packaging", "disposables", "disposable tableware", "packaging materials"] },
  { name: "სანიტარული და ქიმიური საშუალებები", aliases: ["სანიტარია", "ქიმიური საშუალებები", "საწმენდი საშუალებები", "cleaning", "chemicals", "cleaning supplies", "hygiene"] },
  { name: "სხვა", aliases: ["სხვადასხვა", "other", "others", "misc", "miscellaneous"] },
];

/**
 * Comparison key for a category name: lowercase, "and"-words and separators
 * ("და", "&", ",", "/", "+", "and") reduced to a single space, quotes and
 * other punctuation dropped, spaces collapsed.
 */
export function normalizeCategoryKey(input: string): string {
  return input
    .toLowerCase()
    .replace(/[“”„"'`՚’‘«»]/g, "")
    .replace(/[&+/\\,;:|()[\]{}\-–—]+/g, " ")
    .replace(/(^|\s)(და|and)(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const STANDARD_BY_KEY = (() => {
  const map = new Map<string, string>();
  for (const category of STANDARD_CATEGORIES) {
    map.set(normalizeCategoryKey(category.name), category.name);
  }
  for (const category of STANDARD_CATEGORIES) {
    for (const alias of category.aliases) {
      const key = normalizeCategoryKey(alias);
      if (!map.has(key)) map.set(key, category.name); // a category's own name always wins over another's alias
    }
  }
  return map;
})();

/** The standard category a text stands for (its name or a known alias), or null. */
export function standardCategoryFor(text: string): string | null {
  return STANDARD_BY_KEY.get(normalizeCategoryKey(text)) ?? null;
}

/**
 * Lookup from a spreadsheet's category text to a 202 category id: the
 * category's own name first (normalised), then, for the standard categories
 * 202 has, their known aliases. Keys are normalised; query with
 * `lookup.get(normalizeCategoryKey(text))`.
 */
export function buildCategoryLookup(categories: readonly { id: string; name: string }[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const c of categories) {
    const key = normalizeCategoryKey(c.name);
    if (key && !lookup.has(key)) lookup.set(key, c.id);
  }
  for (const c of categories) {
    const standard = standardCategoryFor(c.name);
    if (!standard) continue;
    // c is (a spelling of) a standard category: every alias of that standard resolves to it.
    const owner = STANDARD_CATEGORIES.find((s) => s.name === standard)!;
    for (const alias of owner.aliases) {
      const key = normalizeCategoryKey(alias);
      if (!lookup.has(key)) lookup.set(key, c.id);
    }
  }
  return lookup;
}

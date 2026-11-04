// A conservative guess of a standard category from a product's name, for price
// lists that have no category column. Order matters: the first rule that matches
// wins, so specific products (cream cheese, coconut milk, frozen fries) come
// before the general words they contain. Returns null when nothing matches; the
// import then reports the row instead of guessing wrong.

import { normalizeCategoryKey } from "@/lib/catalog/categories-standard";

type Rule = { category: string; words: string[] };

// Words are matched as substrings of the lowercased name (Georgian words keep
// their stems, since endings vary: "კრევეტ" finds კრევეტები, კრევეტი ...).
const RULES: Rule[] = [
  { category: "სასმელები", words: ["ტონიკი", "შვეპსი", "ლიმონათი", "კოკა-კოლა", "ფანტა", "სპრაიტი", "ენერგეტიკ", "tonic", "soda", "cola", "lemonade", "energy drink"] },
  { category: "წყალი", words: ["მინერალური წყალი", "ბორჯომი", "ნაბეღლავი", "წყალი", "mineral water", "water"] },
  { category: "წვენები", words: ["წვენი", "ნექტარი", "juice", "nectar"] },
  { category: "ღვინო", words: ["ღვინო", "საფერავი", "რქაწითელი", "კახური", "wine"] },
  { category: "ლუდი", words: ["ლუდი", "beer"] },
  { category: "ალკოჰოლური სასმელები", words: ["არაყი", "ვისკი", "კონიაკი", "ჯინი", "რომი", "ლიქიორი", "ჭაჭა", "vodka", "whisky", "whiskey", "cognac", "gin ", "rum ", "liqueur"] },
  { category: "ყავა და ჩაი", words: ["ყავა", "ჩაი", "coffee", "espresso", " tea"] },
  { category: "სოუსები და კონსერვები", words: ["ქოქოსის რძე", "coconut milk", "კეჩუპი", "ეტჩუპი", "ketchup", "მაიონეზ", "mayonnaise", "სოუსი", "sauce", "sosu", "ძმარი", "vinegar", "ტომატი", "პომიდ. კანგაცლი", "კანგაცლი", "კონსერვ", "canned", "ზეთისხილი", "ხიზილალა კონსერვ", "ჩილი პასტა", "პასტა"] },
  { category: "თევზი და ზღვის პროდუქტები", words: ["კრევეტ", "shrimp", "prawn", "უნაგ", "ორაგულ", "salmon", "თინუს", "tuna", "კალმახ", "trout", "ხიზილალა", "caviar", "კრაბ", "crab", "თევზი", "თევზის", "fish", "ზღვის", "seafood", "კალმარ", "squid", "ხამანწკ", "მიდია", "oyster", "mussel", "სარდინ", "ქაშაყ", "კარპი"] },
  { category: "ძეხვეული და ნახევარფაბრიკატები", words: ["პეპერონი", "pepperoni", "სალიამ", "salami", "ძეხვ", "sausage", "ბეკონ", "bacon", "ლორი", "ჩიფსი", "ვიენერ", "სოსისი", "ნაგეტ", "nugget", "ჰამბურგერის კატლეტ", "კატლეტ"] },
  { category: "ყველი", words: ["ყველი", "ყველის", "ყვე.", "კრემყველი", "cheese", "მოცარელა", "mozzarella", "პარმეზან", "parmesan", "ფეტა", "feta", "ჩედარ", "cheddar", "ბრინზა", "მასკარპონე", "mascarpone", "რიკოტა", "ricotta", "სულგუნ", "იმერული", "გაუდა", "gouda", "ემენტალ", "ბრი ", "კამამბერ"] },
  { category: "რძის პროდუქტები", words: ["რძე", "milk", "ნაღები", "cream", "კარაქი", "butter", "მაწონი", "yogurt", "yoghurt", "არაჟანი", "ხაჭო", "კეფირი", "რიაჟენკა"] },
  { category: "კვერცხი", words: ["კვერცხი", "კვერცხის", "eggs", "egg "] },
  { category: "ზეთი და ცხიმები", words: ["ზეთი", "ზეთის", "frying oil", " oil", "მარგარინი", "margarine", "ფრიტურის", "ცხიმი"] },
  { category: "ხორცი და ფრინველი", words: ["ქათამ", "ქათმის", "chicken", "ბარკალი", "ფრთა", "ფილე", "საქონლის", "beef", "ღორის", "pork", "ხბო", "ბატკან", "ცხვრის", "lamb", "ნეკნი", "ribs", "ინდაური", "turkey", "ღვიძლი", "კუჭი", "ხორცი", "meat", "ბიფშტეკ", "სტეიკ", "steak", "ფარში", "ჩიქენ"] },
  { category: "გაყინული პროდუქტები", words: ["კარტოფილი", "კარტ ", "ფრი ", "fries", "ხახვის რგოლ", "onion rings", "გაყინული", "გაყ.", "frozen", "ნაყინი", "ice cream"] },
  { category: "ფქვილი და საცხობი ინგრედიენტები", words: ["ფქვილი", "flour", "ტემპურას", "tempura", "პანკო", "panko", "საფუარი", "yeast", "ცომი", "dough", "სახამებელი", "starch"] },
  { category: "პური და გამომცხვარი პროდუქტები", words: ["პური", "bread", "ბაგეტ", "baguette", "ბულკა", "bun", "ლავაში", "ხაჭაპური", "კრუასან", "croissant", "ტორტი", "ნამცხვარი", "cake"] },
  { category: "მაკარონი", words: ["მაკარონი", "ფენნე", "სპაგეტი", "spaghetti", "pasta ", "პასტა სპაგეტ", "ლაფშა", "noodle", "udon", "უდონი", "ბრინჯის ჩხირ", "lasagna", "ლაზანია"] },
  { category: "მარცვლეული და ბურღულეული", words: ["ბრინჯი", "rice", "წიწიბურა", "buckwheat", "ბურღული", "ფაფა", "oat", "შვრია", "ბრინჯ", "ლობიო", "beans", "ცერცვი", "lentil", "ბარდა", "ხორბალი", "სიმინდი"] },
  { category: "სანელებლები და მარილი", words: ["მარილი", "salt", "სანელებელ", "spice", "პილპილი", "pepper", "ვასაბი", "wasabi", "ჯინჯერი", "ginger", "ორეგანო", "oregano", "ქინძი", "კუმინ", "ზაფრანა", "ტყემალი", "სუნელი"] },
  { category: "შაქარი და ტკბილეული", words: ["შაქარი", "sugar", "ტოპინგ", "topping", "შოკოლად", "chocolate", "კარამელ", "caramel", "ფისტის კრემი", "პრალინე", "ვაფლი", "ნუგბარ", "თაფლი", "honey", "ჯემი", "jam", "ტკბილეული", "candy", "კანფეტ", "სიროფი", "syrup", "კაკაო", "cocoa"] },
  { category: "თხილეული და მშრალი ხილი", words: ["თხილი", "ნიგოზი", "ნუში", "almond", "pistachio", "ფისტა", "ჩირი", "ქიშმიში", "raisin", "თხილეული", "nuts", "walnut", "cashew", "ქაშიუ", "არაქისი", "peanut"] },
  { category: "ბოსტნეული და ხილი", words: ["პომიდორი", "კიტრი", "ხახვი", "ნიორი", "სტაფილო", "კომბოსტო", "ბადრიჯან", "წიწაკა", "ბულგარული", "ისპანახი", "სალათის", "ლიმონი", "ვაშლი", "მსხალი", "ბანანი", "ფორთოხალი", "მანდარინი", "ყურძენი", "მარწყვი", "ატამი", "ბროწეული", "vegetable", "fruit", "tomato", "cucumber", "onion", "garlic", "carrot", "cabbage", "apple", "lemon", "banana", "orange", "grape", "strawberry", "mushroom", "სოკო"] },
  { category: "მწვანილი", words: ["მწვანილი", "ოხრახუში", "კამა", "ქინძი", "ბაზილიკ", "პიტნა", "რეჰანი", "herb", "parsley", "dill", "basil", "mint", "cilantro"] },
  { category: "ერთჯერადი ჭურჭელი და შეფუთვა", words: ["ერთჯერადი", "ჭიქა", "თეფში", "ჩანგალი", "კოვზი", "სალფეთქი", "napkin", "ცელოფანი", "პარკი", "ფოლგა", "foil", "პერგამენტ", "წყალგაუმტარ", "კონტეინერ", "container", "disposable", "packaging", "ჩხირი სუშის", "ბამბუკის"] },
  { category: "სანიტარული და ქიმიური საშუალებები", words: ["სარეცხი", "საპონი", "soap", "ქლორ", "დეზინფექცი", "მტვერსასრუტ", "საწმენდი", "სარეცხი ფხვნილი", "detergent", "cleaner", "sanitizer", "ხელთათმან", "gloves", "ნაგვის"] },
  { category: "სურსათი", words: ["ნორი", "nori", "წყალმცენარე", "seaweed"] },
];

/** The standard category a product name most likely belongs to, or null. */
export function guessCategoryFromName(name: string): string | null {
  const text = ` ${normalizeCategoryKey(name)} `;
  for (const rule of RULES) {
    if (rule.words.some((w) => text.includes(w.toLowerCase()))) return rule.category;
  }
  return null;
}

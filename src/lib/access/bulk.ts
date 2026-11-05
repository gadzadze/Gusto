// Parses the "add many addresses" box on the admin Access page. One business
// per line: email, then optionally business name, legal ID and role
// (buyer / supplier / both), separated by commas, semicolons or tabs. A header line
// starting with "email" is skipped.

export const BULK_MAX_LINES = 100;

export type BulkEntry = {
  line: number;
  email: string;
  businessName: string;
  legalId: string;
  role: "" | "buyer" | "supplier" | "both";
};
export type BulkParseError = { line: number; key: "columns" | "role" | "name_or_id" };

const ROLE_WORDS: Record<string, "buyer" | "supplier" | "both"> = {
  buyer: "buyer",
  supplier: "supplier",
  მყიდველი: "buyer",
  მომწოდებელი: "supplier",
  both: "both",
  ორივე: "both",
};

export function parseBulkAccess(text: string): { entries: BulkEntry[]; errors: BulkParseError[]; tooMany: boolean } {
  const lines = text.split(/\r?\n/);
  const entries: BulkEntry[] = [];
  const errors: BulkParseError[] = [];
  let seen = 0;
  let tooMany = false;
  lines.forEach((raw, index) => {
    const line = index + 1;
    if (!raw.trim()) return;
    const cells = raw.split(/[,;\t]/).map((c) => c.trim());
    if (cells[0].toLowerCase() === "email") return;
    if (++seen > BULK_MAX_LINES) {
      tooMany = true;
      return;
    }
    if (cells.length > 4) return void errors.push({ line, key: "columns" });
    const [email, businessName = "", legalId = "", roleWord = ""] = cells;
    const role = roleWord ? ROLE_WORDS[roleWord.toLowerCase()] : "";
    if (roleWord && !role) return void errors.push({ line, key: "role" });
    if (Boolean(businessName) !== Boolean(legalId)) return void errors.push({ line, key: "name_or_id" });
    entries.push({ line, email, businessName, legalId, role: role ?? "" });
  });
  return { entries, errors, tooMany };
}

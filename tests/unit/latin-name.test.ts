import { describe, expect, it } from "vitest";
import { latinSearchQueries } from "@/lib/catalog/latin-name";

describe("latinSearchQueries", () => {
  it("writes a Georgian brand the way labels spell it first, then the national spelling", () => {
    expect(latinSearchQueries("ლუდი ყაზბეგი 0,5 ლ")).toEqual(["ludi kazbegi", "ludi qazbegi"]);
  });
  it("drops sizes and numbers and keeps at most four words", () => {
    const [q] = latinSearchQueries("წყალი ბორჯომი 0,5 ლ 12 ბოთლი ყუთში მინის");
    expect(q.split(" ")).toHaveLength(4);
    expect(q).toContain("borjomi");
  });
  it("passes Latin words through and uses the brand", () => {
    expect(latinSearchQueries("Water 1.5 L", "Nabeghlavi")).toEqual(["nabeglavi water", "nabeghlavi water"]);
  });
  it("gives nothing for a name with no words", () => {
    expect(latinSearchQueries("0,5 ლ")).toEqual([]);
  });
});

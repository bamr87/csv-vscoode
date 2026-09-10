import { describe, expect, it } from "vitest";
import { exportTable, toHtml, toJson, toMarkdown, toSql } from "../src/core/export";
import { parseCsv } from "../src/core/parse";

const table = () => parseCsv('id,name,price\n1,"Widget, small",1.5\n2,Gadget,\n');

describe("export", () => {
  it("exports JSON with numeric coercion", () => {
    const json = JSON.parse(toJson(table()));
    expect(json).toEqual([
      { id: 1, name: "Widget, small", price: 1.5 },
      { id: 2, name: "Gadget", price: "" }
    ]);
    const raw = JSON.parse(toJson(table(), { coerceNumbers: false }));
    expect(raw[0].id).toBe("1");
  });

  it("exports a Markdown table escaping pipes", () => {
    const t = parseCsv("a|b,c\nx,y\n");
    expect(toMarkdown(t)).toBe("| a\\|b | c |\n| --- | --- |\n| x | y |\n");
  });

  it("exports HTML with escaping", () => {
    const t = parseCsv("h\n<b>&\n");
    expect(toHtml(t)).toContain("<td>&lt;b&gt;&amp;</td>");
    expect(toHtml(t)).toContain("<th>h</th>");
  });

  it("exports SQL with typed columns and NULLs", () => {
    const sql = toSql(table(), { tableName: "items" });
    expect(sql).toContain('CREATE TABLE "items"');
    expect(sql).toContain('"id" INTEGER');
    expect(sql).toContain('"price" REAL');
    expect(sql).toContain("VALUES (1, 'Widget, small', 1.5);");
    expect(sql).toContain("VALUES (2, 'Gadget', NULL);");
  });

  it("converts delimiters", () => {
    expect(exportTable(table(), "tsv")).toBe("id\tname\tprice\n1\tWidget, small\t1.5\n2\tGadget\t\n");
    expect(exportTable(table(), "semicolon")).toBe("id;name;price\n1;Widget, small;1.5\n2;Gadget;\n");
    expect(exportTable(table(), "pipe").split("\n")[0]).toBe("id|name|price");
    expect(exportTable(table(), "csv")).toBe('id,name,price\n1,"Widget, small",1.5\n2,Gadget,\n');
  });
});

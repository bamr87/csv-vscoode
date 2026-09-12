import { describe, expect, it } from "vitest";
import { applyEdits, cloneTable } from "../src/core/edits";
import {
  applyHostTransform,
  applyTruncatedReplaceAllBug,
  rejectReplaceAllWhileTruncated
} from "../src/core/hostTransform";
import { parseCsv } from "../src/core/parse";

/** Five data rows; maxRows=3 reproduces the issue #27 probe. */
function fiveRowTable() {
  return parseCsv("name,note\n  a  ,keep\n  b  ,keep\nc,keep\nd,tail\ne,tail\n");
}

describe("truncation + replaceAll data loss (#27)", () => {
  it("documents the failure mode: trim via truncated replaceAll drops the file tail", () => {
    const full = fiveRowTable();
    expect(full.rows).toHaveLength(5);

    const broken = applyTruncatedReplaceAllBug(full, 3, {
      kind: "pipelineStep",
      step: { kind: "trim", columns: ["name"] }
    });

    // Pre-fix behaviour: host kept only the 3 loaded (trimmed) rows.
    expect(broken.rows).toHaveLength(3);
    expect(broken.rows.map((r) => r[0])).toEqual(["a", "b", "c"]);
  });

  it("host-authoritative trim preserves unloaded rows and trims them too", () => {
    const full = fiveRowTable();
    const fixed = applyHostTransform(full, {
      kind: "pipelineStep",
      step: { kind: "trim", columns: ["name"] }
    });

    expect(fixed.rows).toHaveLength(5);
    expect(fixed.rows.map((r) => r[0])).toEqual(["a", "b", "c", "d", "e"]);
    expect(fixed.rows[0][0]).toBe("a");
    expect(full.rows[0][0]).toBe("  a  "); // input not mutated
  });

  it("host-authoritative transpose uses every row, not just the loaded prefix", () => {
    const full = parseCsv("a,b\n1,2\n3,4\n5,6\n7,8\n9,0\n");
    const broken = applyTruncatedReplaceAllBug(full, 2, { kind: "transpose" });
    // Truncated view only had 2 data rows → transpose headers omit 5,7,9.
    expect(broken.headers).toEqual(["a", "1", "3"]);
    expect(broken.rows).toEqual([["b", "2", "4"]]);

    const fixed = applyHostTransform(full, { kind: "transpose" });
    expect(fixed.headers).toEqual(["a", "1", "3", "5", "7", "9"]);
    expect(fixed.rows).toEqual([["b", "2", "4", "6", "8", "0"]]);
  });

  it("host-authoritative normalizeRows pads ragged rows across the full file", () => {
    const full = parseCsv("a,b,c\n1,2\n1,2,3\n1,2,3,4\nx\n");
    const maxRows = 3;
    const broken = applyTruncatedReplaceAllBug(full, maxRows, { kind: "normalizeRows", width: 3 });
    expect(broken.rows).toHaveLength(3); // lost rows 3..end

    const fixed = applyHostTransform(full, { kind: "normalizeRows", width: 3 });
    expect(fixed.rows).toHaveLength(4);
    expect(fixed.rows[0]).toEqual(["1", "2", ""]);
    expect(fixed.rows[3]).toEqual(["x", "", ""]);
  });

  it("rejects webview replaceAll edits while the view is truncated", () => {
    const op = { kind: "replaceAll" as const, headers: ["h"], rows: [["1"], ["2"], ["3"]] };
    expect(rejectReplaceAllWhileTruncated([op], 5, 3)).toMatch(/truncated/i);
    expect(rejectReplaceAllWhileTruncated([op], 3, 3)).toBeUndefined();
    expect(rejectReplaceAllWhileTruncated([{ kind: "setCell", row: 0, col: 0, value: "x" }], 5, 3)).toBeUndefined();
  });

  it("cell edits on loaded rows still apply without touching the unloaded tail", () => {
    const host = fiveRowTable();
    const loaded = cloneTable(host);
    loaded.rows = host.rows.slice(0, 3);

    applyEdits(loaded, [{ kind: "setCell", row: 1, col: 1, value: "edited" }]);
    // Mirror only the cell edit onto the host (what a non-replaceAll edit does).
    applyEdits(host, [{ kind: "setCell", row: 1, col: 1, value: "edited" }]);

    expect(host.rows).toHaveLength(5);
    expect(host.rows[1][1]).toBe("edited");
    expect(host.rows[3][1]).toBe("tail");
    expect(host.rows[4][1]).toBe("tail");
  });
});

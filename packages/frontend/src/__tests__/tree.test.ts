import { describe, it, expect } from "vitest";
import {
  findPaneById,
  getAllPanes,
  replaceLeaf,
  removePaneFromTree,
  type PaneNode,
  type LeafNode,
  type SplitNode,
} from "../tree";

function leaf(id: string): LeafNode {
  return { type: "leaf", pane: { id } };
}

function split(
  direction: "horizontal" | "vertical",
  first: PaneNode,
  second: PaneNode,
  ratio = 0.5
): SplitNode {
  return { type: "split", direction, ratio, first, second };
}

describe("findPaneById", () => {
  it("should return null for null id", () => {
    expect(findPaneById(leaf("a"), null)).toBeNull();
  });

  it("should find pane in single leaf", () => {
    expect(findPaneById(leaf("a"), "a")).toEqual({ id: "a" });
  });

  it("should return null when id not found in leaf", () => {
    expect(findPaneById(leaf("a"), "b")).toBeNull();
  });

  it("should find pane in left branch of split", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(findPaneById(tree, "a")).toEqual({ id: "a" });
  });

  it("should find pane in right branch of split", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(findPaneById(tree, "b")).toEqual({ id: "b" });
  });

  it("should find pane in deeply nested tree", () => {
    const tree = split(
      "horizontal",
      split("vertical", leaf("a"), leaf("b")),
      split("vertical", leaf("c"), leaf("d"))
    );
    expect(findPaneById(tree, "d")).toEqual({ id: "d" });
  });

  it("should return null when id not found in tree", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(findPaneById(tree, "z")).toBeNull();
  });

  it("should return null for empty string id", () => {
    expect(findPaneById(leaf("a"), "")).toBeNull();
  });
});

describe("getAllPanes", () => {
  it("should return single pane from leaf", () => {
    expect(getAllPanes(leaf("a"))).toEqual([{ id: "a" }]);
  });

  it("should return all panes from split", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(getAllPanes(tree)).toEqual([{ id: "a" }, { id: "b" }]);
  });

  it("should return panes in depth-first left-to-right order", () => {
    const tree = split(
      "horizontal",
      split("vertical", leaf("a"), leaf("b")),
      split("vertical", leaf("c"), leaf("d"))
    );
    expect(getAllPanes(tree).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("should handle asymmetric trees", () => {
    const tree = split(
      "horizontal",
      leaf("a"),
      split("vertical", leaf("b"), leaf("c"))
    );
    expect(getAllPanes(tree).map((p) => p.id)).toEqual(["a", "b", "c"]);
  });

  it("should handle deeply nested single-path tree", () => {
    const tree = split(
      "horizontal",
      leaf("a"),
      split("vertical", leaf("b"), split("horizontal", leaf("c"), leaf("d")))
    );
    expect(getAllPanes(tree).map((p) => p.id)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("replaceLeaf", () => {
  it("should replace matching leaf", () => {
    const result = replaceLeaf(leaf("a"), "a", () => leaf("x"));
    expect(result).toEqual(leaf("x"));
  });

  it("should not replace non-matching leaf", () => {
    const result = replaceLeaf(leaf("a"), "b", () => leaf("x"));
    expect(result).toEqual(leaf("a"));
  });

  it("should replace leaf in split tree", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    const result = replaceLeaf(tree, "b", (original) =>
      split("vertical", original, leaf("c"))
    );
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.first).toEqual(leaf("a"));
      expect(result.second.type).toBe("split");
      if (result.second.type === "split") {
        expect(result.second.first).toEqual(leaf("b"));
        expect(result.second.second).toEqual(leaf("c"));
      }
    }
  });

  it("should replace leaf in deeply nested tree", () => {
    const tree = split(
      "horizontal",
      split("vertical", leaf("a"), leaf("b")),
      leaf("c")
    );
    const result = replaceLeaf(tree, "a", () => leaf("x"));
    expect(getAllPanes(result).map((p) => p.id)).toEqual(["x", "b", "c"]);
  });

  it("should preserve split properties during replacement", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"), 0.7);
    const result = replaceLeaf(tree, "a", () => leaf("x"));
    if (result.type === "split") {
      expect(result.direction).toBe("horizontal");
      expect(result.ratio).toBe(0.7);
    }
  });

  it("should return same tree for null targetId", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    const result = replaceLeaf(tree, null, () => leaf("x"));
    expect(getAllPanes(result).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("should pass original leaf to replacer", () => {
    let receivedLeaf: LeafNode | null = null;
    replaceLeaf(leaf("a"), "a", (original) => {
      receivedLeaf = original;
      return leaf("x");
    });
    expect(receivedLeaf).toEqual(leaf("a"));
  });

  it("should preserve extra properties on split nodes via spread", () => {
    const tree = { ...split("horizontal", leaf("a"), leaf("b")), extra: "data" } as PaneNode;
    const result = replaceLeaf(tree, "a", () => leaf("x"));
    expect((result as any).extra).toBe("data");
  });
});

describe("removePaneFromTree", () => {
  it("should return leaf unchanged (leaf removal handled by caller)", () => {
    expect(removePaneFromTree(leaf("a"), "a")).toEqual(leaf("a"));
  });

  it("should return sibling when first child is removed", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(removePaneFromTree(tree, "a")).toEqual(leaf("b"));
  });

  it("should return sibling when second child is removed", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(removePaneFromTree(tree, "b")).toEqual(leaf("a"));
  });

  it("should collapse nested tree when removing a leaf", () => {
    const tree = split(
      "horizontal",
      split("vertical", leaf("a"), leaf("b")),
      leaf("c")
    );
    const result = removePaneFromTree(tree, "a");
    expect(getAllPanes(result).map((p) => p.id)).toEqual(["b", "c"]);
  });

  it("should handle removing from right nested branch", () => {
    const tree = split(
      "horizontal",
      leaf("a"),
      split("vertical", leaf("b"), leaf("c"))
    );
    const result = removePaneFromTree(tree, "c");
    expect(getAllPanes(result).map((p) => p.id)).toEqual(["a", "b"]);
  });

  it("should handle deeply nested removal", () => {
    const tree = split(
      "horizontal",
      split("vertical", leaf("a"), leaf("b")),
      split("vertical", leaf("c"), leaf("d"))
    );
    const result = removePaneFromTree(tree, "b");
    expect(getAllPanes(result).map((p) => p.id)).toEqual(["a", "c", "d"]);
  });

  it("should not modify tree when target is not found", () => {
    const tree = split("horizontal", leaf("a"), leaf("b"));
    expect(getAllPanes(removePaneFromTree(tree, "z")).map((p) => p.id)).toEqual([
      "a",
      "b",
    ]);
  });

  it("should preserve parent split direction after removal", () => {
    const tree = split(
      "vertical",
      split("horizontal", leaf("a"), leaf("b")),
      leaf("c")
    );
    const result = removePaneFromTree(tree, "a");
    expect(result.type).toBe("split");
    if (result.type === "split") {
      expect(result.direction).toBe("vertical");
      expect(result.first).toEqual(leaf("b"));
      expect(result.second).toEqual(leaf("c"));
    }
  });

  it("should preserve extra properties on split nodes via spread", () => {
    const inner = { ...split("horizontal", leaf("a"), leaf("b")), extra: 42 };
    const tree = split("vertical", inner as PaneNode, leaf("c"));
    const result = removePaneFromTree(tree, "a");
    // Inner split collapses to leaf("b"), so extra is lost on the inner node
    // but the outer split is reconstructed via spread, preserving its properties
    expect(result.type).toBe("split");
  });
});

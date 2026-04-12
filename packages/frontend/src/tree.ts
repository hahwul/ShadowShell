export interface PaneBase {
  id: string;
}

export interface LeafNode<P extends PaneBase = PaneBase> {
  type: "leaf";
  pane: P;
}

export interface SplitNode<P extends PaneBase = PaneBase> {
  type: "split";
  direction: "horizontal" | "vertical";
  ratio: number;
  first: PaneNode<P>;
  second: PaneNode<P>;
}

export type PaneNode<P extends PaneBase = PaneBase> = LeafNode<P> | SplitNode<P>;

export function findPaneById<P extends PaneBase>(
  node: PaneNode<P>,
  id: string | null
): P | null {
  if (!id) return null;
  if (node.type === "leaf") {
    return node.pane.id === id ? node.pane : null;
  }
  return findPaneById(node.first, id) || findPaneById(node.second, id);
}

export function getAllPanes<P extends PaneBase>(node: PaneNode<P>): P[] {
  if (node.type === "leaf") return [node.pane];
  return [...getAllPanes(node.first), ...getAllPanes(node.second)];
}

export function replaceLeaf<P extends PaneBase>(
  node: PaneNode<P>,
  targetId: string | null,
  replacer: (leaf: LeafNode<P>) => PaneNode<P>
): PaneNode<P> {
  if (node.type === "leaf") {
    if (node.pane.id === targetId) {
      return replacer(node);
    }
    return node;
  }
  return {
    ...node,
    first: replaceLeaf(node.first, targetId, replacer),
    second: replaceLeaf(node.second, targetId, replacer),
  };
}

export function removePaneFromTree<P extends PaneBase>(
  node: PaneNode<P>,
  targetId: string
): PaneNode<P> {
  if (node.type === "leaf") return node;
  if (node.first.type === "leaf" && node.first.pane.id === targetId) {
    return node.second;
  }
  if (node.second.type === "leaf" && node.second.pane.id === targetId) {
    return node.first;
  }
  return {
    ...node,
    first: removePaneFromTree(node.first, targetId),
    second: removePaneFromTree(node.second, targetId),
  };
}

import type { Action } from "./types.js";

/** Nested actions of a "parallel" action, or [] if it isn't one / has none. */
function childrenOf(action: Action): Action[] {
  return action.type === "parallel" && Array.isArray(action.params.actions)
    ? (action.params.actions as Action[])
    : [];
}

/**
 * Find the action with `id` anywhere in `actions` (including inside a
 * "parallel" action's nested list) and replace it with `transform(action)`.
 * Actions not matching `id` are left as-is (nested lists are only rebuilt
 * along the path to the match).
 */
export function mapActions(actions: Action[], id: string, transform: (action: Action) => Action): Action[] {
  return actions.map((action) => {
    if (action.id === id) {
      return transform(action);
    }
    const children = childrenOf(action);
    if (children.length > 0) {
      return { ...action, params: { ...action.params, actions: mapActions(children, id, transform) } };
    }
    return action;
  });
}

/**
 * Keep only actions matching `predicate`, recursing into any surviving
 * "parallel" action's nested list too.
 */
export function filterActions(actions: Action[], predicate: (action: Action) => boolean): Action[] {
  return actions
    .filter(predicate)
    .map((action) => {
      const children = childrenOf(action);
      if (children.length > 0) {
        return { ...action, params: { ...action.params, actions: filterActions(children, predicate) } };
      }
      return action;
    });
}

/** Remove the action with `id` anywhere in `actions` (including nested). */
export function removeActionById(actions: Action[], id: string): Action[] {
  return filterActions(actions, (action) => action.id !== id);
}

/** Every action in `actions`, plus every action nested inside a "parallel" action. */
export function flattenActions(actions: Action[]): Action[] {
  return actions.flatMap((action) => [action, ...flattenActions(childrenOf(action))]);
}

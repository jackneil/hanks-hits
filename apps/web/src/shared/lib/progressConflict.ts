import type { AppProgressData, ValidAppId } from "@hank-neil/db/schema";
import { PROGRESS_FIELD_RULES } from "@/lib/progress-field-rules";
import { mergeProgress } from "@/lib/progress-merge";
import { validateProgress } from "@/lib/progress-schemas";
import { sameProgress } from "./progressStamp";
import { PROGRESS_CONFLICT_POLICIES, type EntityListPolicy } from "./progressConflictPolicy";

export type ProgressConflictResult<T> =
  | { kind: "merged"; data: T }
  | { kind: "conflict"; paths: string[] };

const record = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === "object" && !Array.isArray(v);
const own = (v: unknown, key: string): unknown =>
  record(v) && Object.hasOwn(v, key) ? v[key] : undefined;
const at = (v: unknown, path: string): unknown => path.split(".").reduce<unknown>(own, v);
const copy = <T>(v: T): T => v === undefined ? v : JSON.parse(JSON.stringify(v)) as T;

function editTime(value: unknown, field: string): number | null {
  const v = own(value, field);
  const time = typeof v === "number" ? v : typeof v === "string" ? Date.parse(v) : NaN;
  return Number.isFinite(time) && time >= 0 ? time : null;
}

/**
 * Merge only a KNOWN rejected operation with a proven common ancestor. The
 * session must handle unknown lineage/uncertain delivery before calling this.
 * A conflict returns no uploadable candidate: all originals stay in the journal.
 * Inputs and final output must pass the app's schema. This function merges cloud
 * projections; the journal retains original bytes, including local-only content.
 */
export function mergeProgressConflict<T extends AppProgressData>(
  appId: ValidAppId, base: T, local: T, remote: T,
): ProgressConflictResult<T> {
  const inputs = [base, local, remote];
  const checked = inputs.map(data => validateProgress(appId, data));
  if (checked.some((result, index) => !result.success || !sameProgress(result.data, inputs[index]))) {
    return { kind: "conflict", paths: ["$schema"] };
  }
  const policy = PROGRESS_CONFLICT_POLICIES[appId];
  const conflicts = new Set<string>();
  const fail = (path: string, fallback: unknown): unknown => {
    conflicts.add(path || "$root");
    return fallback;
  };
  const select = (b: unknown, l: unknown, r: unknown, path: string): unknown => {
    if (sameProgress(l, r) || sameProgress(l, b)) return r;
    if (sameProgress(r, b)) return l;
    return fail(path, r);
  };

  // Use the existing reviewed max/min/union rules, with remote as the base.
  // Atomic groups below override those folds for coupled purchases and worlds.
  const records = mergeProgress(local, remote, 0, 1, appId).data;
  const rules = Object.entries(PROGRESS_FIELD_RULES[appId]);
  const overrides = new Map<string, unknown>();
  for (const group of policy.atomicGroups ?? []) {
    const values = (source: T) => Object.fromEntries(group.map(path => [path, at(source, path)]));
    const chosen = select(values(base), values(local), values(remote), group.join(" + "));
    for (const path of group) overrides.set(path, own(chosen, path));
  }

  const mergeList = (b: unknown, l: unknown, r: unknown, path: string, spec: EntityListPolicy): unknown => {
    if (b === undefined && l === undefined && r === undefined) return undefined;
    if (![b, l, r].every(v => v === undefined || Array.isArray(v))) return fail(path, r);
    const indexed = (value: unknown) => {
      const entries = new Map<string, unknown>();
      for (const item of (value ?? []) as unknown[]) {
        const id = spec.id ? own(item, spec.id) : item;
        if ((typeof id !== "string" && typeof id !== "number") || entries.has(JSON.stringify(id))) {
          fail(path, r);
          continue;
        }
        entries.set(JSON.stringify(id), item);
      }
      return entries;
    };
    const [before, mine, theirs] = [indexed(b), indexed(l), indexed(r)];
    const merged: unknown[] = [];
    // Keep remote order and append independently created local items. No
    // truncation: combined overflow must be resolved without discarding a copy.
    for (const id of new Set([...theirs.keys(), ...mine.keys(), ...before.keys()])) {
      const start = before.get(id), left = mine.get(id), right = theirs.get(id);
      let value: unknown;
      if (!sameProgress(left, right) && !sameProgress(left, start) && !sameProgress(right, start)
          && left !== undefined && right !== undefined && spec.editedAt) {
        const lt = editTime(left, spec.editedAt), rt = editTime(right, spec.editedAt);
        value = lt !== null && rt !== null && lt !== rt
          ? lt > rt ? left : right : fail(path, right);
      } else value = select(start, left, right, path);
      if (value !== undefined) merged.push(value);
    }
    if (merged.length > spec.max) return fail(path, r);
    if (spec.orderBy) {
      const ordered = merged.map(value => ({ value, time: editTime(value, spec.orderBy!) }));
      if (ordered.some(item => item.time === null)) return fail(path, r);
      ordered.sort((a, b) => (a.time! - b.time!) * (spec.newestFirst ? -1 : 1));
      return ordered.map(item => item.value);
    }
    return merged;
  };

  const visit = (b: unknown, l: unknown, r: unknown, segments: string[]): unknown => {
    const path = segments.join(".");
    if (overrides.has(path)) return overrides.get(path);
    const rule = rules.find(([pattern]) => {
      const parts = pattern.split(".");
      return parts.length === segments.length && parts.every((part, i) => part === "*" || part === segments[i]);
    })?.[1];
    if (rule && rule.rule !== "neither") return segments.reduce<unknown>(own, records);
    if (rule?.subtree) return select(b, l, r, path);
    // A device can omit an entire dynamic record (for example levels.A).
    // Preserve its reviewed descendants even though ordinary recursion cannot
    // visit leaves on the absent side. The existing fold supplies that record.
    if ((l === undefined || r === undefined) && rules.some(([pattern, direction]) => {
      const parts = pattern.split(".");
      return direction.rule !== "neither" && parts.length > segments.length
        && segments.every((part, i) => parts[i] === "*" || parts[i] === part);
    })) return segments.reduce<unknown>(own, records);
    // Timestamps track the latest contributing player action; never stamp now.
    if (segments.length === 1 && (path === "lastModified" || (appId === "memory-match" && path === "updatedAt"))) {
      return Math.max(typeof l === "number" ? l : 0, typeof r === "number" ? r : 0);
    }
    const list = policy.entities && Object.hasOwn(policy.entities, path) ? policy.entities[path] : undefined;
    if (list) return mergeList(b, l, r, path, list);
    if (record(l) && record(r) && (record(b) || b === undefined)) {
      return Object.fromEntries([...new Set([...Object.keys(b ?? {}), ...Object.keys(l), ...Object.keys(r)])]
        .map(key => [key, visit(own(b, key), own(l, key), own(r, key), [...segments, key])])
        .filter(([, value]) => value !== undefined));
    }
    return select(b, l, r, path);
  };
  const merged = visit(base, local, remote, []) as T;
  if (conflicts.size) return { kind: "conflict", paths: [...conflicts] };
  const validated = validateProgress(appId, merged);
  return validated.success && sameProgress(validated.data, merged)
    ? { kind: "merged", data: copy(validated.data as T) }
    : { kind: "conflict", paths: ["$schema"] };
}

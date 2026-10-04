import { act, render, screen, fireEvent } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const runtime = vi.hoisted(() => ({
  snapshot: { ownerKey: "owner-a" as string | null },
  listeners: new Set<() => void>(),
}));
vi.mock("../index", () => ({ localWords: {
  subscribe(listener: () => void) { runtime.listeners.add(listener); return () => runtime.listeners.delete(listener); },
  getSnapshot: () => runtime.snapshot,
} }));
import { useWordDraft } from "../useWordDraft";
function Editor({ clean, entity = "setup" }: { clean: string; entity?: string }) {
  const [value, setValue] = useWordDraft(entity, clean);
  return <input aria-label="Name" value={value} onChange={event => setValue(event.target.value)} />;
}
beforeEach(() => { runtime.snapshot = { ownerKey: "owner-a" }; runtime.listeners.clear(); });
describe("word editor drafts", () => {
  it("follows asynchronously arriving words until the first actual edit, including an explicit clear", () => {
    const { rerender } = render(<Editor clean="" />);
    rerender(<Editor clean="Restored name" />);
    expect(screen.getByRole("textbox")).toHaveValue("Restored name");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "My edit" } });
    rerender(<Editor clean="Late disk name" />);
    expect(screen.getByRole("textbox")).toHaveValue("My edit");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "" } });
    rerender(<Editor clean="Another late result" />);
    expect(screen.getByRole("textbox")).toHaveValue("");
  });
  it("hides and resets drafts across unresolved ownership and entity changes", () => {
    const { rerender } = render(<Editor clean="" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Private draft" } });
    act(() => {
      runtime.snapshot = { ownerKey: null };
      for (const listener of runtime.listeners) listener();
    });
    expect(screen.getByRole("textbox")).toHaveValue("");
    act(() => {
      runtime.snapshot = { ownerKey: "owner-a" };
      for (const listener of runtime.listeners) listener();
    });
    expect(screen.getByRole("textbox")).toHaveValue("");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Second draft" } });
    rerender(<Editor clean="New journey name" entity="next-journey" />);
    expect(screen.getByRole("textbox")).toHaveValue("New journey name");
  });
});

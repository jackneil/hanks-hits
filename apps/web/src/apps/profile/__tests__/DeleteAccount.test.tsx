import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authClient = vi.hoisted(() => ({ signOutAndClear: vi.fn(async () => undefined) }));
vi.mock("@/lib/auth-client", () => authClient);

import { DeleteAccount, DELETE_ACCOUNT_FAILED, DELETE_ACCOUNT_LABEL, DELETE_ACCOUNT_WHAT } from "../components/DeleteAccount";
import { GUEST_OWNER_KEY, ownerKeyFor } from "@/shared/clips/library/ownerKey";
import { localWordsKey } from "@/lib/local-words-key";

/**
 * "Delete this account" (COPPA 312.6(a)(2)): a grown-up deletes the
 * account from the profile page. It asks for the gamer name first, so a
 * stray tap by a young player deletes nothing. The delete also deletes the
 * account's word store on this device (design/LOCAL_WORDS.html), and no
 * other player's.
 */

/** Word stores of this account, another account and the guest on this device. */
async function seedWordStores() {
  const mine = localWordsKey(await ownerKeyFor("user-1"));
  const other = localWordsKey(await ownerKeyFor("user-2"));
  const guest = localWordsKey(GUEST_OWNER_KEY);
  for (const key of [mine, other, guest]) localStorage.setItem(key, JSON.stringify({ "virtual-pet": { name: "Synthetic" } }));
  return { mine, other, guest };
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async () => new Response(JSON.stringify({ deleted: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  authClient.signOutAndClear.mockClear();
  localStorage.clear();
});

const open = () => fireEvent.click(screen.getByRole("button", { name: DELETE_ACCOUNT_LABEL }));

describe("Delete this account", () => {
  it("is under a For grown-ups heading and says what it deletes", () => {
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    expect(screen.getByRole("heading", { name: "For grown-ups" })).toBeInTheDocument();
    expect(screen.getByText(DELETE_ACCOUNT_WHAT)).toBeInTheDocument();
  });

  it("deletes nothing on the first tap: it only asks for the gamer name", () => {
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    open();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.getByLabelText(/type the gamer name/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeDisabled();
  });

  it("stays off until the gamer name is typed", () => {
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    open();
    fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "Turbo" } });
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "turbofox42" } });
    expect(screen.getByRole("button", { name: "Delete forever" })).toBeEnabled();
  });

  it("deletes the account with the typed name, deletes its words on this device, then signs out", async () => {
    const stores = await seedWordStores();
    let wordsAtSignOut: string | null = "not called";
    authClient.signOutAndClear.mockImplementationOnce(async () => {
      wordsAtSignOut = localStorage.getItem(stores.mine);
    });
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    open();
    fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "TurboFox42" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(authClient.signOutAndClear).toHaveBeenCalledWith("/"));
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/account",
      expect.objectContaining({ method: "DELETE", body: JSON.stringify({ confirm: "TurboFox42" }) })
    );
    // Deleted before the sign-out navigates away.
    expect(wordsAtSignOut).toBeNull();
    expect(localStorage.getItem(stores.mine)).toBeNull();
    // Another kid's words and the guest's words on this device stay.
    expect(localStorage.getItem(stores.other)).not.toBeNull();
    expect(localStorage.getItem(stores.guest)).not.toBeNull();
  });

  it("signs out after the delete also when this account has no words on this device", async () => {
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    open();
    fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "TurboFox42" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    await waitFor(() => expect(authClient.signOutAndClear).toHaveBeenCalledWith("/"));
  });

  it("still signs out, and says nothing failed, when storage is blocked", async () => {
    const removeItem = vi.spyOn(localStorage, "removeItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
      open();
      fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "TurboFox42" } });
      fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
      await waitFor(() => expect(authClient.signOutAndClear).toHaveBeenCalledWith("/"));
      expect(screen.queryByRole("alert")).toBeNull();
    } finally {
      removeItem.mockRestore();
      errors.mockRestore();
    }
  });

  it("keeps the account and its words, and says so, when the delete fails", async () => {
    const stores = await seedWordStores();
    fetchMock.mockResolvedValue(new Response("{}", { status: 500 }));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    open();
    fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "TurboFox42" } });
    fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(DELETE_ACCOUNT_FAILED);
    expect(authClient.signOutAndClear).not.toHaveBeenCalled();
    expect(localStorage.getItem(stores.mine)).not.toBeNull();
    errors.mockRestore();
  });

  it("never says the delete failed once the server deleted the account, even when the sign-out fails", async () => {
    // The server answers 200 once; the session is gone after that (401).
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ deleted: true }), { status: 200 }))
      .mockResolvedValue(new Response("{}", { status: 401 }));
    authClient.signOutAndClear.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const replace = vi.fn();
    const realLocation = window.location;
    Object.defineProperty(window, "location", { value: { ...realLocation, replace }, configurable: true, writable: true });
    localStorage.setItem("cookie-clicker-storage", "{}");
    const stores = await seedWordStores();
    try {
      render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
      open();
      fireEvent.change(screen.getByLabelText(/type the gamer name/i), { target: { value: "TurboFox42" } });
      fireEvent.click(screen.getByRole("button", { name: "Delete forever" }));
      await waitFor(() => expect(replace).toHaveBeenCalledWith("/"));
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.queryByText(DELETE_ACCOUNT_FAILED)).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
      // This device is cleared anyway: the saves and the account's words.
      expect(localStorage.getItem("cookie-clicker-storage")).toBeNull();
      expect(localStorage.getItem(stores.mine)).toBeNull();
      expect(localStorage.getItem(stores.other)).not.toBeNull();
    } finally {
      Object.defineProperty(window, "location", { value: realLocation, configurable: true, writable: true });
      errors.mockRestore();
    }
  });

  it("closes the question with Keep my account", () => {
    render(<DeleteAccount handle="TurboFox42" userId="user-1" />);
    open();
    fireEvent.click(screen.getByRole("button", { name: "Keep my account" }));
    expect(screen.queryByLabelText(/type the gamer name/i)).toBeNull();
    expect(screen.getByRole("button", { name: DELETE_ACCOUNT_LABEL })).toBeInTheDocument();
  });

  it("uses no dashes in its words (user-facing copy rule)", () => {
    for (const text of [DELETE_ACCOUNT_LABEL, DELETE_ACCOUNT_WHAT, DELETE_ACCOUNT_FAILED]) {
      expect(text).not.toMatch(/[‒-―]|--| - /);
    }
  });
});

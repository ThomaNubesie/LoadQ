jest.mock("../../hooks/useMyAvatar", () => ({ clearMyAvatarCache: jest.fn() }));

import { AuthAPI } from "../../services/auth";
import { supabase, setUser, resetSupabaseMock } from "../__mocks__/supabase";
import { clearMyAvatarCache } from "../../hooks/useMyAvatar";

beforeEach(() => {
  resetSupabaseMock();
  (supabase.auth.signInWithOtp as jest.Mock).mockReset();
  (supabase.auth.verifyOtp     as jest.Mock).mockReset();
  (supabase.auth.signOut       as jest.Mock).mockReset();
});

describe("AuthAPI.sendOTP", () => {
  it("forwards the phone number to Supabase signInWithOtp", async () => {
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({ data: {}, error: null });
    const r = await AuthAPI.sendOTP("+15555550100");
    expect(r.error).toBeUndefined();
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ phone: "+15555550100" });
  });

  it("surfaces error messages", async () => {
    (supabase.auth.signInWithOtp as jest.Mock).mockResolvedValue({
      data: null,
      error: { message: "Too many requests" },
    });
    const r = await AuthAPI.sendOTP("+1");
    expect(r.error).toBe("Too many requests");
  });
});

describe("AuthAPI.verifyOTP", () => {
  it("verifies with type=sms and returns the user + session", async () => {
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({
      data:  { user: { id: "u-1" }, session: { access_token: "tok" } },
      error: null,
    });
    const r = await AuthAPI.verifyOTP("+15555550100", "123456");
    expect(r.user?.id).toBe("u-1");
    expect(r.session?.access_token).toBe("tok");
    expect(supabase.auth.verifyOtp).toHaveBeenCalledWith({
      phone: "+15555550100", token: "123456", type: "sms",
    });
  });

  it("surfaces error messages on bad code", async () => {
    (supabase.auth.verifyOtp as jest.Mock).mockResolvedValue({
      data:  { user: null, session: null },
      error: { message: "Token has expired or is invalid" },
    });
    const r = await AuthAPI.verifyOTP("+1", "000000");
    expect(r.error).toMatch(/expired|invalid/i);
  });
});

describe("AuthAPI.getSession", () => {
  it("returns the active session payload from Supabase", async () => {
    setUser({ id: "u-1" });
    const session = await AuthAPI.getSession();
    expect(session).toBeTruthy();
  });

  it("returns null when no session exists", async () => {
    setUser(null);
    const session = await AuthAPI.getSession();
    expect(session).toBeNull();
  });
});

describe("AuthAPI.signOut", () => {
  it("calls Supabase signOut and clears the avatar cache", async () => {
    (supabase.auth.signOut as jest.Mock).mockResolvedValue({ error: null });
    await AuthAPI.signOut();
    expect(supabase.auth.signOut).toHaveBeenCalled();
    expect(clearMyAvatarCache).toHaveBeenCalled();
  });
});

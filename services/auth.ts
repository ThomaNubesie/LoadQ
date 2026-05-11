import { supabase } from "./supabase";

export const AuthAPI = {
  async sendOTP(phone: string) {
    const { error } = await supabase.auth.signInWithOtp({ phone });
    return { error: error?.message };
  },

  async verifyOTP(phone: string, token: string) {
    const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
    return { user: data?.user, session: data?.session, error: error?.message };
  },

  async getSession() {
    const { data } = await supabase.auth.getSession();
    return data.session;
  },

  async signOut() {
    await supabase.auth.signOut();
  },

  onAuthStateChange(callback: (event: string, session: any) => void) {
    return supabase.auth.onAuthStateChange(callback);
  },
};

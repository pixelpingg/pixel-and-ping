import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { api, getApiErrorMessage } from "@/lib/api";

export interface AdminUser {
  id: string;
  email: string;
  username: string;
  role: "SUPER_ADMIN" | "ADMIN" | "VIEWER";
  avatarUrl?: string | null;
}

interface AuthContextValue {
  admin: AdminUser | null;
  loading: boolean;
  login: (password: string, totpCode?: string, recoveryCode?: string) => Promise<{ requiresTwoFactor?: boolean }>;
  logout: () => Promise<void>;
  updateAvatar: (avatarUrl: string | null) => Promise<void>;
  error: string | null;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [admin, setAdmin] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get("/auth/me")
      .then((res) => setAdmin(res.data.admin))
      .catch(() => setAdmin(null))
      .finally(() => setLoading(false));
  }, []);

  async function login(password: string, totpCode?: string, recoveryCode?: string) {
    setError(null);
    try {
      const payload: Record<string, string> = { password };
      if (totpCode) payload.totpCode = totpCode;
      if (recoveryCode) payload.recoveryCode = recoveryCode;
      const res = await api.post("/auth/login", payload);
      if (res.data.requiresTwoFactor) return { requiresTwoFactor: true };
      setAdmin(res.data.admin);
      return {};
    } catch (err) {
      const message = getApiErrorMessage(err, "Unable to sign in");
      setError(message);
      throw new Error(message);
    }
  }

  async function updateAvatar(avatarUrl: string | null) {
    const res = await api.patch("/auth/profile", { avatarUrl });
    setAdmin(res.data.admin);
  }

  async function logout() {
    await api.post("/auth/logout").catch(() => undefined);
    setAdmin(null);
  }

  return (
    <AuthContext.Provider value={{ admin, loading, login, logout, updateAvatar, error }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

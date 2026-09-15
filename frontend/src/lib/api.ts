import axios from "axios";

// The browser only ever talks to our own backend, over same-origin/proxy
// requests with credentials (httpOnly cookie). No Cloudflare token, secret,
// or credential ever lives in frontend code, localStorage, or the URL.
export const api = axios.create({
  baseURL: "/api",
  withCredentials: true,
});

export interface ApiErrorShape {
  error: { code: string; message: string; details?: unknown };
}

export function getApiErrorMessage(err: unknown, fallback = "Something went wrong"): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as ApiErrorShape | undefined;
    if (data?.error?.message) return data.error.message;
    if (err.message === "Network Error") return "Cannot reach the server. Check your connection.";
  }
  return fallback;
}

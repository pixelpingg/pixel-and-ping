import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { AuthProvider, useAuth } from "@/store/AuthContext";
import { ToastProvider } from "@/store/ToastContext";
import { ThemeProvider } from "@/store/ThemeContext";
import { ErrorBoundary } from "@/layout/ErrorBoundary";
import { ProtectedRoute } from "@/layout/ProtectedRoute";
import { AppLayout } from "@/layout/AppLayout";

import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Users from "@/pages/Users";
import CreateUser from "@/pages/CreateUser";
import Servers from "@/pages/Servers";
import Endpoints from "@/pages/Endpoints";
import IpScanner from "@/pages/IpScanner";
import Ports from "@/pages/Ports";
import Cloudflare from "@/pages/Cloudflare";
import ConfigGenerator from "@/pages/ConfigGenerator";
import Traffic from "@/pages/Traffic";
import Analytics from "@/pages/Analytics";
import Failover from "@/pages/Failover";
import Logs from "@/pages/Logs";
import Notifications from "@/pages/Notifications";
import Settings from "@/pages/Settings";
import OwnerOverview from "@/pages/OwnerOverview";
import NotFound from "@/pages/NotFound";

// Independent of the server-side requireRole("SUPER_ADMIN") check on
// /api/analytics/owner-overview — this just avoids rendering the page
// shell for a non-owner who navigates to the URL directly; the API
// itself is what actually enforces the restriction either way.
function OwnerOnlyRoute() {
  const { admin } = useAuth();
  if (admin?.role !== "SUPER_ADMIN") return <Navigate to="/" replace />;
  return <OwnerOverview />;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AuthProvider>
          <ThemeProvider>
          <ToastProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route element={<ProtectedRoute />}>
                <Route element={<AppLayout />}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/users" element={<Users />} />
                  <Route path="/users/create" element={<CreateUser />} />
                  <Route path="/servers" element={<Servers />} />
                  <Route path="/endpoints" element={<Endpoints />} />
                  <Route path="/ip-scanner" element={<IpScanner />} />
                  <Route path="/ports" element={<Ports />} />
                  <Route path="/cloudflare" element={<Cloudflare />} />
                  <Route path="/config-generator" element={<ConfigGenerator />} />
                  <Route path="/traffic" element={<Traffic />} />
                  <Route path="/analytics" element={<Analytics />} />
                  <Route path="/failover" element={<Failover />} />
                  <Route path="/logs" element={<Logs />} />
                  <Route path="/notifications" element={<Notifications />} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/owner" element={<OwnerOnlyRoute />} />
                </Route>
              </Route>
              <Route path="*" element={<NotFound />} />
            </Routes>
          </ToastProvider>
          </ThemeProvider>
        </AuthProvider>
      </BrowserRouter>
    </ErrorBoundary>
  );
}

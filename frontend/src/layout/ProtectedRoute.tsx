import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/store/AuthContext";
import { Skeleton } from "@/components/ui/States";

export function ProtectedRoute() {
  const { admin, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <Skeleton className="h-10 w-40" />
      </div>
    );
  }

  if (!admin) return <Navigate to="/login" replace />;
  return <Outlet />;
}

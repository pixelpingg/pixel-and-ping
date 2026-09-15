import { Link } from "react-router-dom";

export default function NotFound() {
  return (
    <div className="min-h-screen flex items-center justify-center flex-col gap-3 text-center p-6">
      <h1 className="font-display text-4xl font-semibold text-gradient">404</h1>
      <p className="text-slate-400 text-sm">This page doesn't exist.</p>
      <Link to="/" className="text-signal-teal text-sm hover:underline">Back to dashboard</Link>
    </div>
  );
}

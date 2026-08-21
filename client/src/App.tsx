import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import AdminPage from "./pages/AdminPage";
import GamePage from "./pages/GamePage";

export default function App() {
  const isAdminRoute = window.location.pathname === "/admin";
  return <ErrorBoundary><TooltipProvider><Toaster />{isAdminRoute ? <AdminPage /> : <GamePage />}</TooltipProvider></ErrorBoundary>;
}

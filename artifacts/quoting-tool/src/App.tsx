import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useThemeSync } from "@/hooks/use-theme";

import Home from "./pages/home";
import DataSourcesPage from "./pages/data-sources";
import QuotePage from "./pages/quote";
import QuoteProfilePage from "./pages/quote-profile";
import NotFound from "./pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 5 * 60 * 1000, // 5 minutes
    }
  }
});

function Router() {
  return (
    <Switch>
      <Route path="/" component={Home} />
      <Route path="/quote/:id" component={QuotePage} />
      <Route path="/data-sources" component={DataSourcesPage} />
      <Route path="/data-sources/:id/profile" component={QuoteProfilePage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  useThemeSync();
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;

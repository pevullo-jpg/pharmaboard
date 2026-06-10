import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

const isUnauthorized = (err: unknown) =>
  (err instanceof Error ? err.message : String(err ?? "")).includes("Unauthorized");

let redirectingToAuth = false;

function handleAuthError(queryClient: QueryClient, err: unknown) {
  if (typeof window === "undefined") return;
  if (!isUnauthorized(err) || redirectingToAuth) return;
  if (window.location.pathname === "/auth") return;
  redirectingToAuth = true;
  (async () => {
    try {
      await queryClient.cancelQueries();
      queryClient.clear();
      const { supabase } = await import("@/integrations/supabase/client");
      await supabase.auth.signOut();
    } finally {
      window.location.replace("/auth");
    }
  })();
}

export const getRouter = () => {
  const queryClient: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (err) => handleAuthError(queryClient, err),
    }),
    mutationCache: new MutationCache({
      onError: (err) => handleAuthError(queryClient, err),
    }),
    defaultOptions: {
      queries: {
        retry: (failureCount, err) => !isUnauthorized(err) && failureCount < 2,
      },
    },
  });

  const router = createRouter({
    routeTree,
    context: { queryClient },
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};

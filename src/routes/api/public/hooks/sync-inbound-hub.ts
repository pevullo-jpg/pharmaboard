import { createFileRoute } from "@tanstack/react-router";
import { runHubSync } from "@/lib/gmail.functions";

/**
 * Endpoint pubblico richiamato dal cron (pg_cron via pg_net) ogni 5 min.
 * Protetto dall'header `apikey` con la chiave anon di Supabase.
 */
export const Route = createFileRoute("/api/public/hooks/sync-inbound-hub")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey") ?? "";
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY ?? "";
        if (!expected || apikey !== expected) {
          return new Response(JSON.stringify({ error: "Unauthorized" }), {
            status: 401,
            headers: { "Content-Type": "application/json" },
          });
        }

        try {
          const result = await runHubSync();
          return new Response(JSON.stringify(result), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e) {
          console.error("Hub sync failed", e);
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : "Errore" }),
            { status: 500, headers: { "Content-Type": "application/json" } },
          );
        }
      },
    },
  },
});
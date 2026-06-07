import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { listInboundPending, assignInboundPending, dismissInboundPending } from "@/lib/inboundHub.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, Mail, ShieldCheck, X } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/admin/email-pending")({
  head: () => ({ meta: [{ title: "Email da assegnare · Admin" }] }),
  component: AdminEmailPendingPage,
});

function AdminEmailPendingPage() {
  const list = useServerFn(listInboundPending);
  const assign = useServerFn(assignInboundPending);
  const dismiss = useServerFn(dismissInboundPending);
  const qc = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [picks, setPicks] = useState<Record<string, string>>({});

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-email-pending"],
    queryFn: () => list(),
  });

  async function doAssign(pendingId: string) {
    const farmaciaId = picks[pendingId];
    if (!farmaciaId) { toast.error("Scegli una farmacia"); return; }
    setBusyId(pendingId);
    try {
      await assign({ data: { pendingId, farmaciaId, rememberSender: true } });
      toast.success("Email assegnata. Future ricette di questo mittente verranno smistate in automatico.");
      await qc.invalidateQueries({ queryKey: ["admin-email-pending"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally { setBusyId(null); }
  }

  async function doDismiss(pendingId: string) {
    setBusyId(pendingId);
    try {
      await dismiss({ data: { pendingId } });
      toast.success("Email scartata");
      await qc.invalidateQueries({ queryKey: ["admin-email-pending"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally { setBusyId(null); }
  }

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (isError) return <p className="text-destructive">{error instanceof Error ? error.message : "Errore"}</p>;

  const pending = data?.pending ?? [];
  const farmacie = data?.farmacie ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <div className="size-10 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center">
          <ShieldCheck className="size-5 text-accent" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Email da assegnare</h1>
          <p className="text-sm text-muted-foreground">
            {pending.length} email da mittenti non ancora associati a una farmacia
          </p>
        </div>
      </div>

      {pending.length === 0 ? (
        <Card className="glass-card p-10 text-center text-muted-foreground">
          <Mail className="size-8 mx-auto mb-3 opacity-60" />
          Nessuna email in attesa. Tutte le farmacie attive sono riconosciute automaticamente.
        </Card>
      ) : (
        <div className="grid gap-3">
          {pending.map((p) => {
            const sender = p.forwarded_for ?? p.from_email ?? "(sconosciuto)";
            return (
              <Card key={p.id} className="glass-card p-4">
                <div className="flex flex-wrap items-start gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm bg-sidebar-accent/40 border border-border/40 rounded px-2 py-0.5">{sender}</span>
                      {p.received_at && (
                        <Badge variant="outline" className="text-xs">
                          {new Date(p.received_at).toLocaleString("it-IT")}
                        </Badge>
                      )}
                    </div>
                    {p.subject && <div className="text-sm font-medium truncate">{p.subject}</div>}
                    {p.snippet && <div className="text-xs text-muted-foreground line-clamp-2">{p.snippet}</div>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <select
                      className="bg-background border border-border/60 rounded-md text-sm px-3 py-2"
                      value={picks[p.id] ?? ""}
                      onChange={(e) => setPicks((s) => ({ ...s, [p.id]: e.target.value }))}
                    >
                      <option value="">Scegli farmacia…</option>
                      {farmacie.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}{f.email_inoltro ? ` (${f.email_inoltro})` : ""}
                        </option>
                      ))}
                    </select>
                    <Button onClick={() => doAssign(p.id)} disabled={busyId === p.id} size="sm">
                      Assegna
                    </Button>
                    <Button onClick={() => doDismiss(p.id)} disabled={busyId === p.id} variant="ghost" size="sm">
                      <X className="size-4" /> Scarta
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
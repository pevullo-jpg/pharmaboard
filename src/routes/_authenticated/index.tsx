import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { StatCard } from "@/components/pharmacy/stat-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CalendarClock, FileText, AlertTriangle, Euro, Mail, Loader2, ExternalLink, Trash2, ShieldCheck, CheckCircle2, PauseCircle, XCircle, Building2, Database, Clock, AlertOctagon } from "lucide-react";
import { format, differenceInCalendarDays } from "date-fns";
import { it } from "date-fns/locale";
import { syncGmailRicette, getRicettaAttachment, deleteRicettaEmail } from "@/lib/gmail.functions";
import { getMyFarmacia, listAllFarmacie, setFarmaciaStato, setFarmaciaDataStop } from "@/lib/farmacie.functions";
import { toast } from "sonner";
import { DebitiBadge } from "@/components/pharmacy/debiti-badge";
import { AnticipiBadge } from "@/components/pharmacy/anticipi-badge";
import { PrenotazioniBadge } from "@/components/pharmacy/prenotazioni-badge";
import { RicetteBadge } from "@/components/pharmacy/ricette-badge";
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useState } from "react";

export const Route = createFileRoute("/_authenticated/")({
  head: () => ({ meta: [{ title: "Dashboard · Farmacia Dashboard" }] }),
  component: Dashboard,
});

function Dashboard() {
  const fetchMy = useServerFn(getMyFarmacia);
  const { data: me, isLoading } = useQuery({
    queryKey: ["my-farmacia"],
    queryFn: () => fetchMy(),
    staleTime: 30_000,
  });
  if (isLoading) {
    return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  }
  if (me?.isSuperAdmin) return <SuperAdminDashboard />;
  return <FarmaciaDashboard />;
}

// ============ Super admin: monitoraggio farmacie ============

const PIE_COLORS = ["#22d3ee", "#a78bfa", "#f472b6", "#fbbf24", "#34d399", "#fb7185", "#60a5fa", "#c084fc", "#facc15", "#4ade80"];

function SuperAdminDashboard() {
  const qc = useQueryClient();
  const list = useServerFn(listAllFarmacie);
  const setStato = useServerFn(setFarmaciaStato);
  const setDataStop = useServerFn(setFarmaciaDataStop);
  const [busyId, setBusyId] = useState<string | null>(null);

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["admin-farmacie"],
    queryFn: () => list(),
  });

  const change = async (id: string, stato: "attiva" | "sospesa" | "disattivata") => {
    setBusyId(id);
    try {
      await setStato({ data: { farmaciaId: id, stato } });
      toast.success(`Stato aggiornato: ${stato}`);
      await qc.invalidateQueries({ queryKey: ["admin-farmacie"] });
      await qc.invalidateQueries({ queryKey: ["my-farmacia"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusyId(null);
    }
  };

  const changeStop = async (id: string, dataStop: string) => {
    setBusyId(id);
    try {
      await setDataStop({ data: { farmaciaId: id, dataStop } });
      toast.success("Data di stop aggiornata");
      await qc.invalidateQueries({ queryKey: ["admin-farmacie"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Errore");
    } finally {
      setBusyId(null);
    }
  };

  if (isLoading) return <div className="grid place-items-center py-20"><Loader2 className="size-6 animate-spin text-muted-foreground" /></div>;
  if (isError) return <p className="text-destructive">{error instanceof Error ? error.message : "Errore"}</p>;

  const farmacie = data?.farmacie ?? [];
  const counts = data?.counts ?? {};

  const totaleAttive = farmacie.filter((f) => f.stato === "attiva").length;
  const totaleRows = farmacie.reduce((s, f) => s + (counts[f.id]?.total ?? 0), 0);

  const pieData = farmacie
    .map((f) => ({ name: f.nome, value: counts[f.id]?.total ?? 0 }))
    .filter((d) => d.value > 0)
    .sort((a, b) => b.value - a.value);

  return (
    <div className="space-y-8">
      <div className="flex items-end gap-3">
        <div className="size-10 rounded-xl bg-accent/15 border border-accent/30 grid place-items-center">
          <ShieldCheck className="size-5 text-accent" />
        </div>
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Monitoraggio farmacie</h1>
          <p className="text-sm text-muted-foreground mt-1">Stato, volumi dati e scadenze di servizio</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Farmacie totali" value={farmacie.length} icon={Building2} hint={`${totaleAttive} attive`} />
        <StatCard label="Record totali" value={totaleRows.toLocaleString("it-IT")} icon={Database} hint="Ricette + assistiti + altro" />
        <StatCard label="Farmacie attive" value={totaleAttive} icon={CheckCircle2} hint={`${farmacie.length - totaleAttive} non attive`} accent />
      </div>

      <Card className="glass-card p-5">
        <div className="mb-4">
          <h2 className="font-semibold">Distribuzione dati per farmacia</h2>
          <p className="text-xs text-muted-foreground">Quota di record totali (ricette, assistiti, anticipi, prenotazioni, debiti)</p>
        </div>
        {pieData.length === 0 ? (
          <div className="text-sm text-muted-foreground py-12 text-center">Nessun dato registrato.</div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  dataKey="value"
                  nameKey="name"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  innerRadius={55}
                  paddingAngle={2}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  formatter={(v: number, n: string) => [`${v.toLocaleString("it-IT")} record (${totaleRows ? ((v / totaleRows) * 100).toFixed(1) : 0}%)`, n]}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      <div className="grid gap-3">
        {farmacie.map((f) => {
          const c = counts[f.id] ?? { members: 0, ricette: 0, assistiti: 0, anticipi: 0, prenotazioni: 0, debiti: 0, total: 0 };
          const quota = totaleRows ? ((c.total / totaleRows) * 100).toFixed(1) : "0.0";
          return (
            <Card key={f.id} className="glass-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="space-y-2 min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold truncate">{f.nome}</h3>
                    <StatoBadge stato={f.stato} />
                  </div>
                  <div className="text-xs text-muted-foreground space-x-3">
                    {f.ragione_sociale && <span>{f.ragione_sociale}</span>}
                    {f.partita_iva && <span>P.IVA {f.partita_iva}</span>}
                    {f.citta && <span>{f.citta}{f.cap ? ` (${f.cap})` : ""}</span>}
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 pt-1">
                    <span><b className="text-foreground">{c.members}</b> operatori</span>
                    <span><b className="text-foreground">{c.ricette.toLocaleString("it-IT")}</b> ricette</span>
                    <span><b className="text-foreground">{c.assistiti.toLocaleString("it-IT")}</b> assistiti</span>
                    <span><b className="text-foreground">{c.anticipi}</b> anticipi</span>
                    <span><b className="text-foreground">{c.prenotazioni}</b> prenot.</span>
                    <span><b className="text-foreground">{c.debiti}</b> debiti</span>
                  </div>
                  <div className="text-xs">
                    <span className="text-muted-foreground">Volume dati: </span>
                    <b className="text-foreground">{c.total.toLocaleString("it-IT")}</b>
                    <span className="text-muted-foreground"> record · </span>
                    <span className="text-accent">{quota}%</span>
                    <span className="text-muted-foreground"> del totale</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2 items-end">
                  <div className="flex gap-2 flex-wrap justify-end">
                    {f.stato !== "attiva" && (
                      <Button size="sm" disabled={busyId === f.id} onClick={() => change(f.id, "attiva")}>
                        <CheckCircle2 className="size-4 mr-1" />Attiva
                      </Button>
                    )}
                    {f.stato !== "sospesa" && (
                      <Button size="sm" variant="outline" disabled={busyId === f.id} onClick={() => change(f.id, "sospesa")}>
                        <PauseCircle className="size-4 mr-1" />Sospendi
                      </Button>
                    )}
                    {f.stato !== "disattivata" && (
                      <Button size="sm" variant="ghost" className="text-destructive" disabled={busyId === f.id} onClick={() => change(f.id, "disattivata")}>
                        <XCircle className="size-4 mr-1" />Disattiva
                      </Button>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="text-xs text-muted-foreground whitespace-nowrap">Stop servizi</label>
                    <Input
                      type="date"
                      defaultValue={f.data_stop_servizi ?? "2027-01-01"}
                      disabled={busyId === f.id}
                      onBlur={(e) => {
                        const v = e.currentTarget.value;
                        if (v && v !== f.data_stop_servizi) changeStop(f.id, v);
                      }}
                      className="h-8 w-[150px] text-xs"
                    />
                  </div>
                </div>
              </div>
            </Card>
          );
        })}
        {farmacie.length === 0 && (
          <Card className="glass-card p-8 text-center text-muted-foreground">Nessuna farmacia registrata.</Card>
        )}
      </div>
    </div>
  );
}

function StatoBadge({ stato }: { stato: string }) {
  const variants: Record<string, { className: string; label: string }> = {
    attiva: { className: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: "Attiva" },
    sospesa: { className: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: "In attesa" },
    disattivata: { className: "bg-red-500/15 text-red-400 border-red-500/30", label: "Disattivata" },
  };
  const v = variants[stato] ?? variants.sospesa;
  return <Badge variant="outline" className={v.className}>{v.label}</Badge>;
}

// ============ Farmacia: dashboard operativa esistente ============

function FarmaciaDashboard() {
  const qc = useQueryClient();
  const sync = useServerFn(syncGmailRicette);
  const openAtt = useServerFn(getRicettaAttachment);
  const delEmail = useServerFn(deleteRicettaEmail);
  const [filter, setFilter] = useState<"all" | "prenotazioni" | "ricette" | "dpc" | "debiti">("all");
  const syncMutation = useMutation({
    mutationFn: async () => sync(),
    onSuccess: (r) => {
      toast.success(`Sync completata: ${r.importedRicette} nuove ricette su ${r.checked} email`);
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const openMutation = useMutation({
    mutationFn: async (ricettaId: string) => openAtt({ data: { ricettaId } }),
    onSuccess: (res) => {
      const w = window.open("", "_blank");
      if (!w) {
        toast.error("Popup bloccato. Consenti i popup per aprire la ricetta.");
        return;
      }
      if (res.mimeType === "application/pdf") {
        w.document.write(`<iframe src="${res.dataUrl}" style="border:0;width:100%;height:100vh"></iframe>`);
      } else {
        w.document.write(`<img src="${res.dataUrl}" style="max-width:100%;height:auto" alt="Allegato ricetta importata da email" />`);
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const deleteMutation = useMutation({
    mutationFn: async (ricettaId: string) => delEmail({ data: { ricettaId } }),
    onSuccess: () => {
      toast.success("Email spostata nel cestino e ricetta eliminata");
      qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: async () => {
      const [prenotazioni, ricette, dpc, debiti, ultimeRicette, prenIds, debIds] = await Promise.all([
        supabase.from("prenotazioni").select("id", { count: "exact", head: true }).in("stato", ["in_attesa", "pronto"]),
        supabase.from("ricette").select("id", { count: "exact", head: true }).eq("stato", "nuova"),
        supabase.from("ricette").select("id", { count: "exact", head: true }).eq("is_dpc_alert", true).eq("stato", "nuova"),
        supabase.from("debiti").select("importo").eq("stato", "aperto"),
        supabase.from("ricette").select("id, assistito_id, nome, cognome, codice_fiscale, data_ricetta, medico, dpc, is_dpc_alert, stato, created_at").order("data_ricetta", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(200),
        supabase.from("prenotazioni").select("assistito_id").in("stato", ["in_attesa", "pronto"]),
        supabase.from("debiti").select("assistito_id").eq("stato", "aperto"),
      ]);
      const totaleDebiti = (debiti.data ?? []).reduce((s, r: { importo: number | string }) => s + Number(r.importo ?? 0), 0);
      const all = ultimeRicette.data ?? [];
      const cfs = [...new Set(all.map((r) => r.codice_fiscale).filter(Boolean) as string[])];
      const { data: assistitiByCf, error: assistitiErr } = cfs.length
        ? await supabase.from("assistiti").select("id, codice_fiscale").in("codice_fiscale", cfs)
        : { data: [], error: null };
      if (assistitiErr) throw assistitiErr;
      const assistitoIdByCf = new Map((assistitiByCf ?? []).map((a) => [a.codice_fiscale, a.id]));
      const withStatus = all.map((r) => {
        const ref = r.data_ricetta ? new Date(r.data_ricetta) : null;
        const days = ref ? differenceInCalendarDays(new Date(), ref) : null;
        let kind: "expired" | "expiring" | "normal" = "normal";
        if (days !== null) {
          if (days > 32) kind = "expired";
          else if (days > 25) kind = "expiring";
        }
        return {
          ...r,
          _days: days,
          _kind: kind,
          _assistito_id: r.assistito_id ?? (r.codice_fiscale ? assistitoIdByCf.get(r.codice_fiscale) ?? null : null),
        };
      });
      const prenSet = new Set((prenIds.data ?? []).map((r: { assistito_id: string | null }) => r.assistito_id).filter(Boolean) as string[]);
      const debSet = new Set((debIds.data ?? []).map((r: { assistito_id: string | null }) => r.assistito_id).filter(Boolean) as string[]);
      return {
        prenotazioni: prenotazioni.count ?? 0,
        ricette: ricette.count ?? 0,
        dpc: dpc.count ?? 0,
        debiti: totaleDebiti,
        all: withStatus,
        prenSet,
        debSet,
      };
    },
  });

  const rows = (() => {
    if (!data) return [] as typeof data extends { all: infer A } ? A : never[];
    const all = data.all;
    if (filter === "all") {
      const expired = all.filter((r) => r._kind === "expired").sort((a, b) => (b._days ?? 0) - (a._days ?? 0));
      const expiring = all.filter((r) => r._kind === "expiring").sort((a, b) => (b._days ?? 0) - (a._days ?? 0));
      const normal = all.filter((r) => r._kind === "normal").slice(0, 8);
      return [...expired, ...expiring, ...normal];
    }
    let matched = all;
    if (filter === "ricette") matched = all.filter((r) => r.stato === "nuova");
    else if (filter === "dpc") matched = all.filter((r) => r.is_dpc_alert);
    else if (filter === "prenotazioni") matched = all.filter((r) => r._assistito_id && data.prenSet.has(r._assistito_id));
    else if (filter === "debiti") matched = all.filter((r) => r._assistito_id && data.debSet.has(r._assistito_id));
    // dedupe per assistito (keep most recent — list è già ordinata per data_ricetta desc)
    const seen = new Set<string>();
    const out: typeof matched = [];
    for (const r of matched) {
      const key = r._assistito_id ?? r.assistito_id ?? `r:${r.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    // expired first, then expiring, then normal
    const order = { expired: 0, expiring: 1, normal: 2 } as const;
    out.sort((a, b) => order[a._kind] - order[b._kind] || (b._days ?? 0) - (a._days ?? 0));
    return out;
  })();

  const toggle = (f: typeof filter) => setFilter((cur) => (cur === f ? "all" : f));

  return (
    <div className="space-y-8">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">Panoramica giornaliera della farmacia</p>
        </div>
        <Button
          onClick={() => syncMutation.mutate()}
          disabled={syncMutation.isPending}
          className="gap-2"
        >
          {syncMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <Mail className="size-4" />}
          Sincronizza Gmail
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Prenotazioni attive" value={isLoading ? "…" : data!.prenotazioni} icon={CalendarClock} hint="In attesa o pronte" tone="secondary" active={filter === "prenotazioni"} onClick={() => toggle("prenotazioni")} />
        <StatCard label="Ricette nuove" value={isLoading ? "…" : data!.ricette} icon={FileText} hint="Da lavorare" tone="primary" active={filter === "ricette"} onClick={() => toggle("ricette")} />
        <StatCard label="Avvisi DPC" value={isLoading ? "…" : data!.dpc} icon={AlertTriangle} hint="Da evidenziare" tone="accent" active={filter === "dpc"} onClick={() => toggle("dpc")} />
        <StatCard
          label="Debiti aperti"
          value={isLoading ? "…" : new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(data!.debiti)}
          icon={Euro}
          hint="Totale insoluto"
          tone="emerald"
          active={filter === "debiti"}
          onClick={() => toggle("debiti")}
        />
      </div>

      <Card className="glass-card overflow-hidden">
        <div className="px-5 py-4 border-b border-border/60 flex items-center justify-between">
          <div>
            <h2 className="font-semibold">
              {filter === "all" && "Ultime ricette"}
              {filter === "prenotazioni" && "Assistiti con prenotazioni attive"}
              {filter === "ricette" && "Ricette nuove da lavorare"}
              {filter === "dpc" && "Assistiti con avvisi DPC"}
              {filter === "debiti" && "Assistiti con debiti aperti"}
            </h2>
            <p className="text-xs text-muted-foreground">
              {filter === "all" ? "Importate da Gmail o inserite manualmente" : "Ogni assistito è mostrato una sola volta"}
            </p>
          </div>
          {filter !== "all" && (
            <Button size="sm" variant="ghost" onClick={() => setFilter("all")}>Mostra tutte</Button>
          )}
        </div>
        <div className="divide-y divide-border/40">
          {rows.length === 0 && !isLoading && (
            <div className="px-5 py-12 text-center text-sm text-muted-foreground">
              {filter === "all" ? "Nessuna ricetta ancora. Collega Gmail in Impostazioni o aggiungi manualmente." : "Nessun assistito corrisponde al filtro selezionato."}
            </div>
          )}
          {rows.map((r) => {
            const kind = (r as { _kind?: "expired" | "expiring" | "normal" })._kind ?? "normal";
            const days = (r as { _days?: number | null })._days ?? null;
            const assistitoId = (r as { _assistito_id?: string | null })._assistito_id ?? r.assistito_id;
            const rowCls =
              kind === "expired"
                ? "bg-red-500/10 hover:bg-red-500/15"
                : kind === "expiring"
                  ? "bg-amber-500/10 hover:bg-amber-500/15"
                  : "hover:bg-sidebar-accent/30";
            return (
            <div key={r.id} className={`px-5 py-3 flex items-center justify-between gap-4 transition-colors flex-wrap ${rowCls}`}>
              <div className="min-w-0 flex-1 basis-64">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium truncate">{r.cognome ?? ""} {r.nome ?? ""}</span>
                  {r.codice_fiscale && <span className="text-xs text-muted-foreground font-mono">{r.codice_fiscale}</span>}
                  {r.is_dpc_alert && <Badge className="bg-accent/20 text-accent border border-accent/40 accent-glow">DPC</Badge>}
                  {r.dpc && !r.is_dpc_alert && <Badge variant="outline">DPC</Badge>}
                  {kind === "expiring" && days !== null && (
                    <Badge className="bg-amber-500/20 text-amber-300 border border-amber-500/40 gap-1">
                      <Clock className="size-3" /> Scade tra {Math.max(0, 30 - days)}g
                    </Badge>
                  )}
                  {kind === "expired" && (
                    <Badge className="bg-red-500/20 text-red-300 border border-red-500/40 gap-1">
                      <AlertOctagon className="size-3" /> Scaduta {days !== null ? `da ${days - 30}g` : ""}
                    </Badge>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1 flex items-center gap-3 flex-wrap">
                  {r.medico && <span>Dr. {r.medico}</span>}
                  {r.data_ricetta && <span>{format(new Date(r.data_ricetta), "d MMM yyyy", { locale: it })}</span>}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
                {assistitoId && (
                  <DebitiBadge assistitoId={assistitoId} label={`${r.cognome ?? ""} ${r.nome ?? ""}`.trim()} />
                )}
                {assistitoId && (
                  <AnticipiBadge assistitoId={assistitoId} label={`${r.cognome ?? ""} ${r.nome ?? ""}`.trim()} />
                )}
                {assistitoId && (
                  <PrenotazioniBadge assistitoId={assistitoId} label={`${r.cognome ?? ""} ${r.nome ?? ""}`.trim()} />
                )}
                {assistitoId && (
                  <RicetteBadge assistitoId={assistitoId} />
                )}
                <Badge variant={r.stato === "nuova" ? "default" : "secondary"}>{r.stato}</Badge>
                <Button
                  size="icon"
                  variant="ghost"
                  title="Apri ricetta"
                  disabled={openMutation.isPending && openMutation.variables === r.id}
                  onClick={() => openMutation.mutate(r.id)}
                >
                  {openMutation.isPending && openMutation.variables === r.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <ExternalLink className="size-4" />}
                </Button>
                {kind === "expired" ? (
                  <Button
                    size="sm"
                    variant="destructive"
                    className="gap-1"
                    disabled={deleteMutation.isPending && deleteMutation.variables === r.id}
                    onClick={() => {
                      if (window.confirm("Ricetta scaduta. Confermi l'eliminazione (e lo spostamento dell'email nel cestino)?")) {
                        deleteMutation.mutate(r.id);
                      }
                    }}
                  >
                    {deleteMutation.isPending && deleteMutation.variables === r.id
                      ? <Loader2 className="size-4 animate-spin" />
                      : <><Trash2 className="size-4" /> Elimina</>}
                  </Button>
                ) : (
                <Button
                  size="icon"
                  variant="ghost"
                  title="Elimina email e ricetta"
                  disabled={deleteMutation.isPending && deleteMutation.variables === r.id}
                  onClick={() => {
                    if (window.confirm("Spostare l'email nel cestino di Gmail ed eliminare la ricetta?")) {
                      deleteMutation.mutate(r.id);
                    }
                  }}
                >
                  {deleteMutation.isPending && deleteMutation.variables === r.id
                    ? <Loader2 className="size-4 animate-spin" />
                    : <Trash2 className="size-4 text-destructive" />}
                </Button>
                )}
              </div>
            </div>
          );
          })}
        </div>
      </Card>
    </div>
  );
}
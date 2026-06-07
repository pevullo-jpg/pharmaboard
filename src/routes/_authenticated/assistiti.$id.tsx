import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ArrowLeft, Plus, FileText, CalendarClock, Wallet, Euro, Check, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { it } from "date-fns/locale";

export const Route = createFileRoute("/_authenticated/assistiti/$id")({
  head: () => ({ meta: [{ title: "Assistito · Farmacia" }] }),
  component: AssistitoDetail,
});

function AssistitoDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();

  const { data: assistito, isLoading } = useQuery({
    queryKey: ["assistito", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("assistiti").select("*").eq("id", id).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: ricette } = useQuery({
    queryKey: ["ricette", id],
    queryFn: async () => (await supabase.from("ricette").select("*").eq("assistito_id", id).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: prenotazioni } = useQuery({
    queryKey: ["prenotazioni", id],
    queryFn: async () => (await supabase.from("prenotazioni").select("*").eq("assistito_id", id).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: anticipi } = useQuery({
    queryKey: ["anticipi", id],
    queryFn: async () => (await supabase.from("anticipi").select("*").eq("assistito_id", id).order("created_at", { ascending: false })).data ?? [],
  });
  const { data: debiti } = useQuery({
    queryKey: ["debiti", id],
    queryFn: async () => (await supabase.from("debiti").select("*").eq("assistito_id", id).order("created_at", { ascending: false })).data ?? [],
  });

  const invalidate = (k: string) => qc.invalidateQueries({ queryKey: [k, id] });

  if (isLoading) return <div className="text-muted-foreground">Caricamento…</div>;
  if (!assistito) return <div>Assistito non trovato</div>;

  const totaleDebiti = (debiti ?? []).filter((d) => d.stato === "aperto").reduce((s, d) => s + Number(d.importo), 0);

  return (
    <div className="space-y-6">
      <Link to="/assistiti" className="text-sm text-muted-foreground inline-flex items-center gap-1 hover:text-foreground">
        <ArrowLeft className="size-4" /> Tutti gli assistiti
      </Link>
      <Card className="glass-card p-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{assistito.cognome} {assistito.nome}</h1>
            <div className="text-sm text-muted-foreground mt-2 flex flex-wrap gap-x-6 gap-y-1">
              {assistito.codice_fiscale && <span className="font-mono">{assistito.codice_fiscale}</span>}
              {assistito.medico && <span>Dr. {assistito.medico}</span>}
              {assistito.esenzione && <span>Esenzione {assistito.esenzione}</span>}
              {assistito.telefono && <span>📞 {assistito.telefono}</span>}
            </div>
          </div>
          {totaleDebiti > 0 && (
            <Badge className="bg-destructive/20 text-destructive border border-destructive/40 text-base px-3 py-1.5">
              <Euro className="size-3.5 mr-1" /> {new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(totaleDebiti)}
            </Badge>
          )}
        </div>
      </Card>

      <Tabs defaultValue="ricette">
        <TabsList className="grid grid-cols-4 w-full max-w-2xl">
          <TabsTrigger value="ricette"><FileText className="size-4 mr-2" />Ricette</TabsTrigger>
          <TabsTrigger value="prenotazioni"><CalendarClock className="size-4 mr-2" />Prenotazioni</TabsTrigger>
          <TabsTrigger value="anticipi"><Wallet className="size-4 mr-2" />Anticipi</TabsTrigger>
          <TabsTrigger value="debiti"><Euro className="size-4 mr-2" />Debiti</TabsTrigger>
        </TabsList>

        <TabsContent value="ricette" className="space-y-3 mt-4">
          {(ricette ?? []).length === 0 && <EmptyState text="Nessuna ricetta" />}
          {(ricette ?? []).map((r) => (
            <Card key={r.id} className="glass-card p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium flex items-center gap-2">
                  {r.data_ricetta ? format(new Date(r.data_ricetta), "d MMM yyyy", { locale: it }) : "Senza data"}
                  {r.is_dpc_alert && <Badge className="bg-accent/20 text-accent border border-accent/40">DPC</Badge>}
                  {r.dpc && !r.is_dpc_alert && <Badge variant="outline">DPC</Badge>}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {r.medico && <>Dr. {r.medico} · </>}{r.numero_ricetta && <>#{r.numero_ricetta} · </>}{r.source}
                </div>
              </div>
              <div className="flex gap-2">
                {r.stato === "nuova" && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    await supabase.from("ricette").update({ stato: "lavorata" }).eq("id", r.id);
                    invalidate("ricette"); toast.success("Ricetta lavorata");
                  }}><Check className="size-4" /></Button>
                )}
                <Button size="sm" variant="ghost" onClick={async () => {
                  await supabase.from("ricette").delete().eq("id", r.id);
                  invalidate("ricette"); toast.success("Eliminata");
                }}><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          ))}
          <AddItemDialog
            title="Nuova ricetta"
            fields={[
              { name: "data_ricetta", label: "Data", type: "date", required: true },
              { name: "medico", label: "Medico" },
              { name: "numero_ricetta", label: "Numero ricetta" },
              { name: "dpc", label: "DPC", type: "checkbox" },
              { name: "is_dpc_alert", label: "Avviso DPC", type: "checkbox" },
            ]}
            onSubmit={async (v) => {
              await supabase.from("ricette").insert({
                assistito_id: id,
                nome: assistito.nome,
                cognome: assistito.cognome,
                codice_fiscale: assistito.codice_fiscale,
                medico: v.medico || assistito.medico,
                esenzione: assistito.esenzione,
                data_ricetta: v.data_ricetta || null,
                numero_ricetta: v.numero_ricetta || null,
                dpc: !!v.dpc,
                is_dpc_alert: !!v.is_dpc_alert,
                source: "manuale",
              });
              invalidate("ricette");
            }}
          />
        </TabsContent>

        <TabsContent value="prenotazioni" className="space-y-3 mt-4">
          {(prenotazioni ?? []).length === 0 && <EmptyState text="Nessuna prenotazione" />}
          {(prenotazioni ?? []).map((p) => (
            <Card key={p.id} className="glass-card p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{p.farmaco} <span className="text-muted-foreground">×{p.quantita}</span></div>
                <div className="text-xs text-muted-foreground mt-1">{format(new Date(p.data_prenotazione), "d MMM yyyy", { locale: it })} · {p.note ?? ""}</div>
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant={p.stato === "consegnato" ? "secondary" : "default"}>{p.stato}</Badge>
                {p.stato !== "consegnato" && (
                  <Button size="sm" variant="outline" onClick={async () => {
                    const next = p.stato === "in_attesa" ? "pronto" : "consegnato";
                    await supabase.from("prenotazioni").update({ stato: next }).eq("id", p.id);
                    invalidate("prenotazioni");
                  }}>{p.stato === "in_attesa" ? "Pronto" : "Consegna"}</Button>
                )}
                <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("prenotazioni").delete().eq("id", p.id); invalidate("prenotazioni"); }}><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          ))}
          <AddItemDialog
            title="Nuova prenotazione"
            fields={[
              { name: "farmaco", label: "Farmaco", required: true },
              { name: "quantita", label: "Quantità", type: "number", defaultValue: "1" },
              { name: "note", label: "Note" },
            ]}
            onSubmit={async (v) => {
              await supabase.from("prenotazioni").insert({ assistito_id: id, farmaco: v.farmaco, quantita: Number(v.quantita) || 1, note: v.note || null });
              invalidate("prenotazioni");
            }}
          />
        </TabsContent>

        <TabsContent value="anticipi" className="space-y-3 mt-4">
          {(anticipi ?? []).length === 0 && <EmptyState text="Nessun anticipo" />}
          {(anticipi ?? []).map((p) => (
            <Card key={p.id} className="glass-card p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{p.farmaco} <span className="text-muted-foreground">×{p.quantita}</span></div>
                <div className="text-xs text-muted-foreground mt-1">{format(new Date(p.data_anticipo), "d MMM yyyy", { locale: it })} · {p.note ?? ""}</div>
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant={p.stato === "saldato" ? "secondary" : "default"}>{p.stato}</Badge>
                {p.stato !== "saldato" && (
                  <Button size="sm" variant="outline" onClick={async () => { await supabase.from("anticipi").update({ stato: "saldato" }).eq("id", p.id); invalidate("anticipi"); }}>Salda</Button>
                )}
                <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("anticipi").delete().eq("id", p.id); invalidate("anticipi"); }}><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          ))}
          <AddItemDialog
            title="Nuovo anticipo"
            fields={[
              { name: "farmaco", label: "Farmaco", required: true },
              { name: "quantita", label: "Quantità", type: "number", defaultValue: "1" },
              { name: "note", label: "Note" },
            ]}
            onSubmit={async (v) => {
              await supabase.from("anticipi").insert({ assistito_id: id, farmaco: v.farmaco, quantita: Number(v.quantita) || 1, note: v.note || null });
              invalidate("anticipi");
            }}
          />
        </TabsContent>

        <TabsContent value="debiti" className="space-y-3 mt-4">
          {(debiti ?? []).length === 0 && <EmptyState text="Nessun debito" />}
          {(debiti ?? []).map((d) => (
            <Card key={d.id} className="glass-card p-4 flex items-center justify-between gap-3">
              <div>
                <div className="font-medium">{new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(Number(d.importo))}</div>
                <div className="text-xs text-muted-foreground mt-1">{format(new Date(d.data_debito), "d MMM yyyy", { locale: it })} · {d.descrizione ?? ""}</div>
              </div>
              <div className="flex gap-2 items-center">
                <Badge variant={d.stato === "saldato" ? "secondary" : "destructive"}>{d.stato}</Badge>
                {d.stato !== "saldato" && (
                  <Button size="sm" variant="outline" onClick={async () => { await supabase.from("debiti").update({ stato: "saldato" }).eq("id", d.id); invalidate("debiti"); }}>Salda</Button>
                )}
                <Button size="sm" variant="ghost" onClick={async () => { await supabase.from("debiti").delete().eq("id", d.id); invalidate("debiti"); }}><Trash2 className="size-4" /></Button>
              </div>
            </Card>
          ))}
          <AddItemDialog
            title="Nuovo debito"
            fields={[
              { name: "importo", label: "Importo €", type: "number", required: true, step: "0.01" },
              { name: "descrizione", label: "Descrizione" },
            ]}
            onSubmit={async (v) => {
              await supabase.from("debiti").insert({ assistito_id: id, importo: Number(v.importo), descrizione: v.descrizione || null });
              invalidate("debiti");
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return <Card className="glass-card p-8 text-center text-sm text-muted-foreground">{text}</Card>;
}

type Field = { name: string; label: string; type?: string; required?: boolean; defaultValue?: string; step?: string };
function AddItemDialog({ title, fields, onSubmit }: { title: string; fields: Field[]; onSubmit: (v: Record<string, string | boolean>) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string | boolean>>({});
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setVals(Object.fromEntries(fields.map((f) => [f.name, f.defaultValue ?? (f.type === "checkbox" ? false : "")]))); }}>
      <DialogTrigger asChild>
        <Button variant="outline" className="gap-2 w-full"><Plus className="size-4" /> {title}</Button>
      </DialogTrigger>
      <DialogContent className="glass-card">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try { await onSubmit(vals); toast.success("Salvato"); setOpen(false); }
            catch (err) { toast.error(err instanceof Error ? err.message : "Errore"); }
            finally { setBusy(false); }
          }}
          className="space-y-4"
        >
          {fields.map((f) => (
            <div key={f.name} className="space-y-2">
              <Label>{f.label}</Label>
              {f.type === "checkbox" ? (
                <input type="checkbox" checked={!!vals[f.name]} onChange={(e) => setVals({ ...vals, [f.name]: e.target.checked })} className="size-4 accent-accent" />
              ) : (
                <Input
                  type={f.type ?? "text"}
                  step={f.step}
                  required={f.required}
                  value={(vals[f.name] as string) ?? ""}
                  onChange={(e) => setVals({ ...vals, [f.name]: e.target.value })}
                />
              )}
            </div>
          ))}
          <DialogFooter><Button type="submit" disabled={busy}>Salva</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
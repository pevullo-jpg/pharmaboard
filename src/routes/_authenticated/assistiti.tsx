import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { getAssistitoMergedPdf } from "@/lib/gmail.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Search, ChevronRight, UserPlus, FileStack, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { DebitiBadge } from "@/components/pharmacy/debiti-badge";

export const Route = createFileRoute("/_authenticated/assistiti")({
  head: () => ({ meta: [{ title: "Assistiti · Farmacia" }] }),
  component: AssistitiPage,
});

function AssistitiPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const mergePdfs = useServerFn(getAssistitoMergedPdf);
  const [mergingId, setMergingId] = useState<string | null>(null);

  const handleOpenRicette = async (e: React.MouseEvent, assistitoId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setMergingId(assistitoId);
    try {
      const res = await mergePdfs({ data: { assistitoId } });
      const w = window.open("", "_blank");
      if (!w) {
        toast.error("Abilita i popup per visualizzare il PDF");
        return;
      }
      w.document.write(`<iframe src="${res.dataUrl}" style="border:0;width:100vw;height:100vh"></iframe>`);
      w.document.close();
      toast.success(`${res.mergedCount} ricette unite${res.skipped ? ` (${res.skipped} saltate)` : ""}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore");
    } finally {
      setMergingId(null);
    }
  };

  const { data, isLoading } = useQuery({
    queryKey: ["assistiti", search],
    queryFn: async () => {
      let q = supabase
        .from("assistiti")
        .select("id, nome, cognome, codice_fiscale, medico, esenzione, debiti(importo, stato), prenotazioni(id, stato), anticipi(id, stato)")
        .order("cognome", { ascending: true });
      if (search.trim()) {
        const s = `%${search.trim()}%`;
        q = q.or(`cognome.ilike.${s},nome.ilike.${s},codice_fiscale.ilike.${s}`);
      }
      const { data, error } = await q.limit(200);
      if (error) throw error;
      return data ?? [];
    },
  });

  const create = useMutation({
    mutationFn: async (input: { nome: string; cognome: string; codice_fiscale?: string; medico?: string; esenzione?: string; telefono?: string }) => {
      const { error } = await supabase.from("assistiti").insert(input);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Assistito aggiunto");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["assistiti"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Assistiti</h1>
          <p className="text-sm text-muted-foreground mt-1">{data?.length ?? 0} registrati</p>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button className="gap-2"><UserPlus className="size-4" /> Nuovo assistito</Button>
          </DialogTrigger>
          <NuovoAssistitoDialog onSubmit={(v) => create.mutate(v)} pending={create.isPending} />
        </Dialog>
      </div>

      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
        <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cerca per nome, cognome o codice fiscale…" className="pl-9" />
      </div>

      <Card className="glass-card overflow-hidden">
        {isLoading && <div className="p-8 text-center text-sm text-muted-foreground">Caricamento…</div>}
        {!isLoading && (data?.length ?? 0) === 0 && (
          <div className="p-12 text-center text-sm text-muted-foreground">
            Nessun assistito trovato. <button onClick={() => setOpen(true)} className="text-accent hover:underline">Aggiungine uno</button>.
          </div>
        )}
        <div className="divide-y divide-border/40">
          {(data ?? []).map((a) => {
            const prenAttive = (a.prenotazioni ?? []).filter((p: { stato: string }) => p.stato !== "consegnato").length;
            const anticipiAperti = (a.anticipi ?? []).filter((p: { stato: string }) => p.stato === "aperto").length;
            return (
              <Link key={a.id} to="/assistiti/$id" params={{ id: a.id }} className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-sidebar-accent/30 transition-colors">
                <div className="min-w-0">
                  <div className="font-medium">{a.cognome} {a.nome}</div>
                  <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-3">
                    {a.codice_fiscale && <span className="font-mono">{a.codice_fiscale}</span>}
                    {a.medico && <span>Dr. {a.medico}</span>}
                    {a.esenzione && <span>Esenz. {a.esenzione}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={(e) => handleOpenRicette(e, a.id)}
                    disabled={mergingId === a.id}
                    className="gap-1"
                  >
                    {mergingId === a.id ? <Loader2 className="size-3.5 animate-spin" /> : <FileStack className="size-3.5" />}
                    Ricette
                  </Button>
                  <DebitiBadge assistitoId={a.id} label={`${a.cognome} ${a.nome}`} />
                  {prenAttive > 0 && <Badge variant="secondary">{prenAttive} pren.</Badge>}
                  {anticipiAperti > 0 && <Badge variant="outline">{anticipiAperti} ant.</Badge>}
                  <ChevronRight className="size-4 text-muted-foreground" />
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function NuovoAssistitoDialog({ onSubmit, pending }: { onSubmit: (v: { nome: string; cognome: string; codice_fiscale?: string; medico?: string; esenzione?: string; telefono?: string }) => void; pending: boolean }) {
  const [form, setForm] = useState({ nome: "", cognome: "", codice_fiscale: "", medico: "", esenzione: "", telefono: "" });
  return (
    <DialogContent className="glass-card">
      <DialogHeader><DialogTitle>Nuovo assistito</DialogTitle></DialogHeader>
      <form
        onSubmit={(e) => { e.preventDefault(); onSubmit({ ...form, codice_fiscale: form.codice_fiscale || undefined }); }}
        className="space-y-4"
      >
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Nome</Label><Input required value={form.nome} onChange={(e) => setForm({ ...form, nome: e.target.value })} /></div>
          <div className="space-y-2"><Label>Cognome</Label><Input required value={form.cognome} onChange={(e) => setForm({ ...form, cognome: e.target.value })} /></div>
        </div>
        <div className="space-y-2"><Label>Codice fiscale</Label><Input value={form.codice_fiscale} onChange={(e) => setForm({ ...form, codice_fiscale: e.target.value.toUpperCase() })} className="font-mono" /></div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-2"><Label>Medico</Label><Input value={form.medico} onChange={(e) => setForm({ ...form, medico: e.target.value })} /></div>
          <div className="space-y-2"><Label>Esenzione</Label><Input value={form.esenzione} onChange={(e) => setForm({ ...form, esenzione: e.target.value })} /></div>
        </div>
        <div className="space-y-2"><Label>Telefono</Label><Input value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></div>
        <DialogFooter><Button type="submit" disabled={pending}>Salva</Button></DialogFooter>
      </form>
    </DialogContent>
  );
}
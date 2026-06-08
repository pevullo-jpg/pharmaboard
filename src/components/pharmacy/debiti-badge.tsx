import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Euro, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { toast } from "sonner";

const eur = (n: number) => new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

export function DebitiBadge({ assistitoId, label }: { assistitoId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: debiti } = useQuery({
    queryKey: ["debiti", assistitoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("debiti")
        .select("*")
        .eq("assistito_id", assistitoId)
        .eq("stato", "aperto")
        .order("data_debito", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const totale = (debiti ?? []).reduce((s, d) => s + Number(d.importo), 0);
  const lit = (debiti ?? []).length > 0;

  const [importo, setImporto] = useState("");
  const [descrizione, setDescrizione] = useState("");
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["debiti", assistitoId] });
    qc.invalidateQueries({ queryKey: ["assistiti"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  const handleAdd = async () => {
    const n = Number(importo.replace(",", "."));
    if (!importo || Number.isNaN(n) || n === 0) {
      toast.error("Inserisci un importo valido (può essere negativo per saldo parziale)");
      return;
    }
    setBusy(true);
    const { error } = await supabase.from("debiti").insert({
      assistito_id: assistitoId,
      importo: n,
      descrizione: descrizione || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setImporto(""); setDescrizione("");
    invalidate();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("debiti").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border transition-colors " +
          (lit
            ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 shadow-[0_0_14px_-4px_rgb(16_185_129/0.55)]"
            : "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50")
        }
        title="Gestisci debiti"
      >
        <Euro className="size-3" />
        {eur(totale)}
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="glass-card max-w-lg"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Debiti{label ? ` · ${label}` : ""}</span>
              <span className="text-primary text-base font-semibold">{eur(totale)}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {(debiti ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">Nessuna voce</div>
            )}
            {(debiti ?? []).map((d) => {
              const n = Number(d.importo);
              return (
                <div key={d.id} className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
                  <div className="min-w-0">
                    <div className={`font-medium tabular-nums ${n < 0 ? "text-emerald-500" : ""}`}>{eur(n)}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      {format(new Date(d.data_debito), "d MMM yyyy", { locale: it })}
                      {d.descrizione ? ` · ${d.descrizione}` : ""}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" onClick={() => handleDelete(d.id)} title="Elimina voce">
                    <Trash2 className="size-4 text-destructive" />
                  </Button>
                </div>
              );
            })}
          </div>

          <div className="border-t border-border/40 pt-3 space-y-3">
            <div className="text-xs text-muted-foreground">Aggiungi voce (usa valori negativi per saldi parziali)</div>
            <div className="grid grid-cols-[120px_1fr_auto] gap-2 items-end">
              <div className="space-y-1">
                <Label className="text-xs">Importo €</Label>
                <Input
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  value={importo}
                  onChange={(e) => setImporto(e.target.value)}
                  placeholder="es. 12.50"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Descrizione</Label>
                <Input value={descrizione} onChange={(e) => setDescrizione(e.target.value)} placeholder="opzionale" />
              </div>
              <Button type="button" onClick={handleAdd} disabled={busy} className="gap-1">
                <Plus className="size-4" /> Aggiungi
              </Button>
            </div>
          </div>

          <DialogFooter>
            <Button onClick={() => setOpen(false)}>Salva e chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
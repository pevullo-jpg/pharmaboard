import { useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Package, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { toast } from "sonner";

export function AnticipiBadge({ assistitoId, label }: { assistitoId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: assistito } = useQuery({
    queryKey: ["assistito-medico", assistitoId],
    queryFn: async () => {
      const { data, error } = await supabase.from("assistiti").select("medico").eq("id", assistitoId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const { data: anticipi } = useQuery({
    queryKey: ["anticipi", assistitoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("anticipi")
        .select("*")
        .eq("assistito_id", assistitoId)
        .eq("stato", "aperto")
        .order("data_anticipo", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const count = (anticipi ?? []).length;
  const lit = count > 0;

  const [farmaco, setFarmaco] = useState("");
  const [quantita, setQuantita] = useState("1");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [medico, setMedico] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && assistito?.medico && !medico) setMedico(assistito.medico);
  }, [open, assistito?.medico, medico]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["anticipi", assistitoId] });
    qc.invalidateQueries({ queryKey: ["assistiti"] });
    qc.invalidateQueries({ queryKey: ["medici"] });
    qc.invalidateQueries({ queryKey: ["assistito-medico", assistitoId] });
  };

  const handleAdd = async () => {
    if (!farmaco.trim()) { toast.error("Inserisci il nome del farmaco"); return; }
    const q = parseInt(quantita) || 1;
    setBusy(true);
    // Se medico cambiato rispetto a quello dell'assistito, aggiorna assistito
    if (medico.trim() && medico.trim() !== (assistito?.medico ?? "")) {
      await supabase.from("assistiti").update({ medico: medico.trim() }).eq("id", assistitoId);
    }
    const { error } = await supabase.from("anticipi").insert({
      assistito_id: assistitoId,
      farmaco: farmaco.trim(),
      quantita: q,
      data_anticipo: data,
      note: medico.trim() ? `Dr. ${medico.trim()}` : null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setFarmaco(""); setQuantita("1"); setData(new Date().toISOString().slice(0, 10));
    invalidate();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("anticipi").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  const handleClose = () => {
    setOpen(false);
    setFarmaco(""); setQuantita("1"); setMedico("");
    setData(new Date().toISOString().slice(0, 10));
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className={
          "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border transition-colors " +
          (lit
            ? "neon-flash neon-accent border-accent bg-accent/30 text-accent-foreground hover:bg-accent/45 accent-glow shadow-[0_0_18px_-2px_var(--accent)]"
            : "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50")
        }
        title="Gestisci anticipi"
      >
        <Package className="size-3" />
        {count} ant.
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
        <DialogContent
          className="glass-card max-w-xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Anticipi{label ? ` · ${label}` : ""}</span>
              <span className="text-accent text-base font-semibold">{count}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {(anticipi ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">Nessuna voce</div>
            )}
            {(anticipi ?? []).map((a) => (
              <div key={a.id} className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.farmaco} <span className="text-muted-foreground font-normal">× {a.quantita}</span></div>
                  <div className="text-xs text-muted-foreground truncate">
                    {format(new Date(a.data_anticipo), "d MMM yyyy", { locale: it })}
                    {a.note ? ` · ${a.note}` : ""}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => handleDelete(a.id)} title="Elimina voce">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="border-t border-border/40 pt-3 space-y-3">
            <div className="text-xs text-muted-foreground">Aggiungi anticipo</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Farmaco</Label>
                <Input value={farmaco} onChange={(e) => setFarmaco(e.target.value)} placeholder="Nome farmaco" />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quantità</Label>
                <Input type="number" min="1" value={quantita} onChange={(e) => setQuantita(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Data</Label>
                <Input type="date" value={data} onChange={(e) => setData(e.target.value)} />
              </div>
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Medico</Label>
                <Input value={medico} onChange={(e) => setMedico(e.target.value)} placeholder="Nome medico" />
              </div>
            </div>
            <Button type="button" onClick={handleAdd} disabled={busy} className="gap-1 w-full">
              <Plus className="size-4" /> Aggiungi anticipo
            </Button>
          </div>

          <DialogFooter>
            <Button onClick={handleClose}>Salva e chiudi</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
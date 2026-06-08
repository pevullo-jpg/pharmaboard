import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { format } from "date-fns";
import { it } from "date-fns/locale";
import { toast } from "sonner";

export function PrenotazioniBadge({ assistitoId, label }: { assistitoId: string; label?: string }) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const { data: prenotazioni } = useQuery({
    queryKey: ["prenotazioni", assistitoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("prenotazioni")
        .select("*")
        .eq("assistito_id", assistitoId)
        .neq("stato", "consegnato")
        .order("data_prenotazione", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const count = (prenotazioni ?? []).length;
  const lit = count > 0;

  const [farmaco, setFarmaco] = useState("");
  const [quantita, setQuantita] = useState("1");
  const [data, setData] = useState(() => new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["prenotazioni", assistitoId] });
    qc.invalidateQueries({ queryKey: ["assistiti"] });
    qc.invalidateQueries({ queryKey: ["dashboard-stats"] });
  };

  const handleAdd = async () => {
    if (!farmaco.trim()) { toast.error("Inserisci il nome del farmaco"); return; }
    const q = parseInt(quantita) || 1;
    setBusy(true);
    const { error } = await supabase.from("prenotazioni").insert({
      assistito_id: assistitoId,
      farmaco: farmaco.trim(),
      quantita: q,
      data_prenotazione: data,
      note: note.trim() || null,
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setFarmaco(""); setQuantita("1"); setNote("");
    setData(new Date().toISOString().slice(0, 10));
    invalidate();
  };

  const handleDelete = async (id: string) => {
    const { error } = await supabase.from("prenotazioni").delete().eq("id", id);
    if (error) { toast.error(error.message); return; }
    invalidate();
  };

  const handleClose = () => {
    setOpen(false);
    setFarmaco(""); setQuantita("1"); setNote("");
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
            ? "border-secondary bg-secondary/60 text-secondary-foreground hover:bg-secondary/80"
            : "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50")
        }
        title="Gestisci prenotazioni"
      >
        <CalendarClock className="size-3" />
        {count} pren.
      </button>

      <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else setOpen(true); }}>
        <DialogContent
          className="glass-card max-w-xl"
          onInteractOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center justify-between gap-3">
              <span>Prenotazioni{label ? ` · ${label}` : ""}</span>
              <span className="text-base font-semibold">{count}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-2 max-h-64 overflow-auto pr-1">
            {(prenotazioni ?? []).length === 0 && (
              <div className="text-sm text-muted-foreground text-center py-4">Nessuna voce</div>
            )}
            {(prenotazioni ?? []).map((p) => (
              <div key={p.id} className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
                <div className="min-w-0">
                  <div className="font-medium truncate">{p.farmaco} <span className="text-muted-foreground font-normal">× {p.quantita}</span></div>
                  <div className="text-xs text-muted-foreground truncate">
                    {format(new Date(p.data_prenotazione), "d MMM yyyy", { locale: it })}
                    {p.stato ? ` · ${p.stato}` : ""}
                    {p.note ? ` · ${p.note}` : ""}
                  </div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => handleDelete(p.id)} title="Elimina voce">
                  <Trash2 className="size-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>

          <div className="border-t border-border/40 pt-3 space-y-3">
            <div className="text-xs text-muted-foreground">Aggiungi prenotazione</div>
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Farmaco</Label>
                <Input value={farmaco} onChange={(e) => setFarmaco(e.target.value)} placeholder="Nome farmaco" autoFocus />
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
                <Label className="text-xs">Note</Label>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Opzionale" />
              </div>
            </div>
            <Button type="button" onClick={handleAdd} disabled={busy} className="gap-1 w-full">
              <Plus className="size-4" /> Aggiungi prenotazione
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
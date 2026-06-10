import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getAssistitoMergedPdf } from "@/lib/gmail.functions";

export function RicetteBadge({ assistitoId }: { assistitoId: string }) {
  const [busy, setBusy] = useState(false);
  const mergePdfs = useServerFn(getAssistitoMergedPdf);

  const { data: countData } = useQuery({
    queryKey: ["ricette-count", assistitoId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("ricette")
        .select("numero_ricetta")
        .eq("assistito_id", assistitoId);
      if (error) throw error;
      // Il numero mostrato = numero di NRE DIVERSI (le righe sintesi con lo
      // stesso NRE di una ricetta non contano due volte).
      const nres = new Set<string>();
      let senzaNre = 0;
      for (const r of data ?? []) {
        if (r.numero_ricetta) nres.add(r.numero_ricetta);
        else senzaNre++;
      }
      return nres.size + senzaNre;
    },
  });

  const count = countData ?? 0;
  const lit = count > 0;

  const handleClick = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    try {
      const res = await mergePdfs({ data: { assistitoId } });
      if ("empty" in res && res.empty) {
        toast.info("Nessuna ricetta con allegato per questo assistito");
        return;
      }
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
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy}
      className={
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium border transition-colors cursor-pointer " +
        (lit
          ? "neon-flash neon-sky border-sky-400/80 bg-sky-400/30 text-sky-100 hover:bg-sky-400/45 shadow-[0_0_18px_-2px_rgb(56_189_248/0.8)]"
          : "border-border/40 bg-muted/30 text-muted-foreground hover:bg-muted/50")
      }
      title="Apri ricette unite"
    >
      {busy ? <Loader2 className="size-3 animate-spin" /> : <FileText className="size-3" />}
      {count} ric.
    </button>
  );
}

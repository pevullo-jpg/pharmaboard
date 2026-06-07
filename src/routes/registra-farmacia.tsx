import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { registerFarmacia } from "@/lib/farmacie.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Pill, Loader2 } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/registra-farmacia")({
  ssr: false,
  head: () => ({ meta: [{ title: "Registra la tua farmacia · Farmacia Dashboard" }] }),
  component: RegisterPage,
});

function RegisterPage() {
  const navigate = useNavigate();
  const register = useServerFn(registerFarmacia);
  const [loading, setLoading] = useState(false);
  const [form, setForm] = useState({
    displayName: "",
    email: "",
    password: "",
    nome: "",
    ragioneSociale: "",
    partitaIva: "",
    indirizzo: "",
    citta: "",
    cap: "",
    telefono: "",
  });

  const upd = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await register({
        data: {
          email: form.email,
          password: form.password,
          displayName: form.displayName,
          nome: form.nome,
          ragioneSociale: form.ragioneSociale || null,
          partitaIva: form.partitaIva || null,
          indirizzo: form.indirizzo || null,
          citta: form.citta || null,
          cap: form.cap || null,
          telefono: form.telefono || null,
          emailContatto: null,
        },
      });
      // login automatico
      const { error } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });
      if (error) throw error;
      toast.success("Farmacia registrata! In attesa di attivazione.");
      navigate({ to: "/", replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Errore di registrazione");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen grid place-items-center px-4 py-12">
      <div className="w-full max-w-2xl">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-primary to-accent grid place-items-center accent-glow">
            <Pill className="size-7 text-primary-foreground" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">Registra la tua farmacia</h1>
          <p className="text-sm text-muted-foreground text-center max-w-md">
            Dopo la registrazione la farmacia resta <strong>in attesa di attivazione</strong> dal nostro team.
            Riceverai conferma via email.
          </p>
        </div>
        <Card className="glass-card p-6">
          <form onSubmit={onSubmit} className="space-y-6">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Operatore</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="displayName" label="Nome operatore" value={form.displayName} onChange={upd("displayName")} required />
                <Field id="email" label="Email" type="email" value={form.email} onChange={upd("email")} required />
                <Field id="password" label="Password (min 8)" type="password" value={form.password} onChange={upd("password")} required minLength={8} />
              </div>
            </section>
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Farmacia</h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field id="nome" label="Nome farmacia" value={form.nome} onChange={upd("nome")} required />
                <Field id="ragioneSociale" label="Ragione sociale" value={form.ragioneSociale} onChange={upd("ragioneSociale")} />
                <Field id="partitaIva" label="Partita IVA" value={form.partitaIva} onChange={upd("partitaIva")} />
                <Field id="telefono" label="Telefono" value={form.telefono} onChange={upd("telefono")} />
                <Field id="indirizzo" label="Indirizzo" value={form.indirizzo} onChange={upd("indirizzo")} className="sm:col-span-2" />
                <Field id="citta" label="Città" value={form.citta} onChange={upd("citta")} />
                <Field id="cap" label="CAP" value={form.cap} onChange={upd("cap")} />
              </div>
            </section>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading && <Loader2 className="size-4 animate-spin mr-2" />}Registra farmacia
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Hai già un account? <Link to="/auth" className="text-accent hover:underline">Accedi</Link>
            </p>
          </form>
        </Card>
      </div>
    </div>
  );
}

function Field(props: {
  id: string; label: string; value: string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  type?: string; required?: boolean; minLength?: number; className?: string;
}) {
  return (
    <div className={`space-y-2 ${props.className ?? ""}`}>
      <Label htmlFor={props.id}>{props.label}{props.required && <span className="text-destructive"> *</span>}</Label>
      <Input id={props.id} type={props.type ?? "text"} value={props.value} onChange={props.onChange} required={props.required} minLength={props.minLength} />
    </div>
  );
}
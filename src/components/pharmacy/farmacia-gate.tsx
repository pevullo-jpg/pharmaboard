import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { getMyFarmacia } from "@/lib/farmacie.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Pill, Loader2, Clock, LogOut, ShieldCheck } from "lucide-react";

export function FarmaciaGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const fetchFn = useServerFn(getMyFarmacia);
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-farmacia"],
    queryFn: () => fetchFn(),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !data) {
    return (
      <CenteredCard
        icon={<Clock className="size-7 text-muted-foreground" />}
        title="Impossibile caricare la farmacia"
        description="Si è verificato un errore. Riprova."
        action={<Button onClick={() => refetch()}>Riprova</Button>}
      />
    );
  }

  // Super admin: non deve essere bloccato dal requisito di una farmacia associata.
  if (data.isSuperAdmin && !data.farmacia) {
    const isAdminSurface = location.pathname === "/" || location.pathname.startsWith("/admin/");
    if (isAdminSurface) return <>{children}</>;

    return (
      <CenteredCard
        icon={<ShieldCheck className="size-7 text-accent" />}
        title="Pannello super-amministratore"
        description="Questa sezione è riservata agli operatori farmacia."
        action={
          <div className="flex flex-col sm:flex-row justify-center gap-2">
            <Button asChild>
              <Link to="/">Vai al pannello farmacie</Link>
            </Button>
            <SignOutBtn />
          </div>
        }
      />
    );
  }

  if (!data.farmacia) {
    return (
      <CenteredCard
        icon={<Clock className="size-7 text-muted-foreground" />}
        title="Nessuna farmacia associata"
        description="Il tuo account non risulta collegato a una farmacia. Contatta l'amministratore."
        action={<SignOutBtn />}
      />
    );
  }

  if (data.farmacia.stato !== "attiva" && !data.isSuperAdmin) {
    const labels: Record<string, { title: string; desc: string }> = {
      sospesa: {
        title: "In attesa di attivazione",
        desc: "La tua farmacia è stata registrata correttamente ed è in attesa di approvazione dal nostro team. Riceverai una conferma via email.",
      },
      disattivata: {
        title: "Farmacia disattivata",
        desc: "L'accesso alla tua farmacia è stato disattivato. Contatta l'amministratore per maggiori informazioni.",
      },
    };
    const info = labels[data.farmacia.stato] ?? labels.sospesa;
    return (
      <CenteredCard
        icon={<Clock className="size-7 text-muted-foreground" />}
        title={info.title}
        description={info.desc}
        meta={data.farmacia.nome}
        action={<SignOutBtn />}
      />
    );
  }

  return <>{children}</>;
}


function CenteredCard({
  icon,
  title,
  description,
  meta,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  meta?: string;
  action: React.ReactNode;
}) {
  return (
    <div className="min-h-screen grid place-items-center px-4 py-12">
      <Card className="glass-card p-8 max-w-lg w-full text-center space-y-4">
        <div className="flex flex-col items-center gap-3">
          <div className="size-14 rounded-2xl bg-gradient-to-br from-primary to-accent grid place-items-center accent-glow">
            <Pill className="size-7 text-primary-foreground" />
          </div>
          <div className="size-12 rounded-full bg-muted/30 grid place-items-center">{icon}</div>
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {meta && <p className="text-sm font-medium">{meta}</p>}
        <p className="text-sm text-muted-foreground">{description}</p>
        <div className="pt-2">{action}</div>
      </Card>
    </div>
  );
}

function SignOutBtn() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const signOut = async () => {
    await qc.cancelQueries();
    qc.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  };
  return (
    <Button variant="outline" onClick={signOut}>
      <LogOut className="size-4 mr-2" />
      Esci
    </Button>
  );
}
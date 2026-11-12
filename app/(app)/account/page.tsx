import { AlertDevices } from "@/components/AlertDevices";
import { PasswordForm } from "@/components/PasswordForm";
import { TotpSection } from "@/components/TotpSection";
import { requireUser } from "@/lib/auth";
import { listAlertDevices } from "@/lib/queries";
import { getTotpState } from "@/lib/queries-enterprise";

export const metadata = { title: "Il mio account · Vigil" };

export default async function AccountPage() {
  const user = await requireUser();
  const [totp, devices] = await Promise.all([getTotpState(user), listAlertDevices(user)]);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Il mio account</h1>
          <p>
            {user.username} · {user.role === "admin" ? "Amministratore" : "Visualizzatore"}
          </p>
        </div>
      </header>
      <div className="stack">
        <section className="panel narrow narrow--wide">
          <div className="panel__head">
            <h2 className="panel__title">Cambia password</h2>
          </div>
          <PasswordForm />
        </section>
        <TotpSection enabled={totp.enabled} recoveryLeft={totp.recoveryLeft} />
        <AlertDevices devices={devices} />
      </div>
    </>
  );
}

import { redirect } from "next/navigation";
import { LoginForm } from "@/components/LoginForm";
import { Credito, Marchio } from "@/components/Marchio";
import { getUser } from "@/lib/auth";

export const metadata = { title: "Accedi · Vigil" };

export default async function LoginPage() {
  if (await getUser()) redirect("/");

  return (
    <main className="login">
      <div className="login__frame crocini">
        <div className="login__card">
          <div className="login__brand">
            <Marchio />
            <h1 className="marchio-testo">Vigil</h1>
          </div>
          <Credito />
          <LoginForm />
        </div>
      </div>
    </main>
  );
}

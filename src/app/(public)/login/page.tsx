import type { Metadata } from "next";

import { signInAction } from "@/app/actions";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = {
  title: "Iniciar sesión · DecorAR",
};

export default function LoginPage() {
  return (
    <main className="auth-page">
      <AuthForm action={signInAction} mode="login" />
    </main>
  );
}

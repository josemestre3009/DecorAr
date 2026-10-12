import type { Metadata } from "next";

import { signInAction } from "@/app/actions";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = {
  title: "Iniciar sesión · DecorAR",
};

export default function LoginPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-decor-bg px-6 py-10 font-decor text-decor-ink">
      <AuthForm action={signInAction} mode="login" />
    </main>
  );
}

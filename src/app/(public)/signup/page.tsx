import type { Metadata } from "next";

import { signUpAction } from "@/app/actions";

import { AuthForm } from "../auth-form";

export const metadata: Metadata = {
  title: "Crear cuenta · DecorAR",
};

export default function SignupPage() {
  return (
    <main className="auth-page">
      <AuthForm action={signUpAction} mode="signup" />
    </main>
  );
}

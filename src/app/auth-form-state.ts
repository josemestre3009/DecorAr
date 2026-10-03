export type AuthFormState = {
  readonly status: "idle" | "error" | "pending_confirmation";
  readonly message: string;
  readonly field?: "email" | "password";
};

export const initialAuthFormState: AuthFormState = {
  status: "idle",
  message: "",
};

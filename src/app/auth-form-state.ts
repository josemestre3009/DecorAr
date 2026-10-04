export type AuthFormState = {
  readonly status: "idle" | "error" | "pending_confirmation";
  readonly message: string;
  readonly field?: "email" | "password";
  /**
   * Correo tal como se escribió. React 19 vacía los campos no controlados al
   * terminar la acción, así que el formulario lo repone con `defaultValue`. La
   * contraseña no se devuelve nunca.
   */
  readonly email?: string;
};

export const initialAuthFormState: AuthFormState = {
  status: "idle",
  message: "",
};

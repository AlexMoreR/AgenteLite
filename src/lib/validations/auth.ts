import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Correo invalido"),
  password: z.string().min(8, "Minimo 8 caracteres"),
});

export const registerSchema = z.object({
  name: z.string().min(2, "Nombre muy corto").max(100, "Nombre muy largo"),
  email: z.string().email("Correo invalido"),
  password: z.string().min(8, "Minimo 8 caracteres"),
  role: z.enum(["ADMIN", "EMPLEADO", "CLIENTE"]),
});

export const profileSchema = z.object({
  name: z.string().min(2, "Nombre muy corto").max(100, "Nombre muy largo"),
  email: z.string().email("Correo invalido"),
  image: z.union([z.string().url("URL invalida"), z.literal("")]),
  // Firma que se agrega a los mensajes que la persona escribe a mano en los chats.
  // Opcional: quien no la configure sigue enviando sin firma, como hasta ahora.
  // El tope de 160 es para que no se coma el mensaje: va en CADA respuesta al cliente.
  chatSignature: z.string().max(160, "La firma es muy larga").optional(),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(8, "Contrasena actual invalida"),
    newPassword: z.string().min(8, "Minimo 8 caracteres"),
    confirmPassword: z.string().min(8, "Minimo 8 caracteres"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contrasenas no coinciden",
    path: ["confirmPassword"],
  });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1, "Token invalido"),
    newPassword: z.string().min(8, "Minimo 8 caracteres"),
    confirmPassword: z.string().min(8, "Minimo 8 caracteres"),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contrasenas no coinciden",
    path: ["confirmPassword"],
  });

export type ActionState = {
  ok: boolean;
  message: string;
  errors?: Record<string, string[]>;
  data?: {
    name?: string;
    email?: string;
    image?: string | null;
  };
};

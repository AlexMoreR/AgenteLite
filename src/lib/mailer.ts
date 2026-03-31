import type { Role } from "@prisma/client";

type AccountEmailParams = {
  to: string;
  name: string;
  role: Role;
};

type VerificationEmailParams = {
  to: string;
  name: string;
  verificationUrl: string;
};

type PasswordResetEmailParams = {
  to: string;
  name: string;
  resetUrl: string;
};

function getSmtpConfig() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT ?? "587");
  const secure = process.env.SMTP_SECURE === "true";
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  const from = process.env.SMTP_FROM;

  if (!host || !user || !pass || !from || Number.isNaN(port)) {
    return null;
  }

  return { host, port, secure, user, pass, from };
}

export async function sendAccountCreatedEmail(params: AccountEmailParams): Promise<void> {
  const config = getSmtpConfig();
  if (!config) {
    return;
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const displayName = params.name?.trim() || "usuario";

  await transporter.sendMail({
    from: config.from,
    to: params.to,
    subject: "Tu cuenta ha sido creada",
    text: `Hola ${displayName}, tu cuenta fue creada con rol ${params.role}. Ya puedes iniciar sesion en la plataforma.`,
    html: `<p>Hola <strong>${displayName}</strong>,</p><p>Tu cuenta fue creada con rol <strong>${params.role}</strong>.</p><p>Ya puedes iniciar sesion en la plataforma.</p>`,
  });
}

export async function sendEmailVerificationEmail(params: VerificationEmailParams): Promise<void> {
  const config = getSmtpConfig();
  if (!config) {
    throw new Error("SMTP no configurado");
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const displayName = params.name?.trim() || "usuario";

  await transporter.sendMail({
    from: config.from,
    to: params.to,
    subject: "Confirma tu registro",
    text: `Hola ${displayName}, confirma tu cuenta en este enlace: ${params.verificationUrl}`,
    html: `<p>Hola <strong>${displayName}</strong>,</p><p>Para activar tu cuenta, confirma tu registro en el siguiente enlace:</p><p><a href="${params.verificationUrl}">${params.verificationUrl}</a></p>`,
  });
}

export async function sendPasswordResetEmail(params: PasswordResetEmailParams): Promise<void> {
  const config = getSmtpConfig();
  if (!config) {
    throw new Error("SMTP no configurado");
  }

  const nodemailer = await import("nodemailer");
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
  });

  const displayName = params.name?.trim() || "usuario";

  await transporter.sendMail({
    from: config.from,
    to: params.to,
    subject: "Recupera tu contrasena",
    text: `Hola ${displayName}, usa este enlace para crear una nueva contrasena: ${params.resetUrl}`,
    html: `<p>Hola <strong>${displayName}</strong>,</p><p>Recibimos una solicitud para recuperar tu contrasena.</p><p>Crea una nueva desde este enlace:</p><p><a href="${params.resetUrl}">${params.resetUrl}</a></p><p>Si no fuiste tu, puedes ignorar este correo.</p>`,
  });
}

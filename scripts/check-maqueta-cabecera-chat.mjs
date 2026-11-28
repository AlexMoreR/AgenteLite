// Prueba de la maqueta de la cabecera del chat (src/app/cliente/maquetas/).
// La maqueta usa datos inventados: no puede leer la base ni llamar acciones, y tiene que traer sus textos.
// Correr: npm run test:maqueta-cabecera-chat
import fs from "node:fs";
import path from "node:path";

const carpeta = path.resolve("src/app/cliente/maquetas");
const prohibidos = ["lib/prisma", "app/actions", "@/features"];
const textos = [
  "Sin asignar",
  "Tomarlo",
  "El agente está atendiendo este chat",
  "Tomar control",
  "Agente pausado",
  "Devolverle el chat",
  "Próximo seguimiento",
  "Pausar",
  "Cambiar hora",
  "Cancelar",
  "Resolver",
];

function archivos(dir) {
  const salida = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const ruta = path.join(dir, e.name);
    if (e.isDirectory()) salida.push(...archivos(ruta));
    else if (/\.tsx?$/.test(e.name)) salida.push(ruta);
  }
  return salida;
}

const fallos = [];
if (!fs.existsSync(carpeta)) fallos.push("No existe src/app/cliente/maquetas/");
else {
  for (const f of archivos(carpeta)) {
    const codigo = fs.readFileSync(f, "utf8");
    for (const p of prohibidos) {
      if (codigo.includes(p)) fallos.push(`${path.relative(process.cwd(), f)} contiene «${p}» (la maqueta no puede leer la base ni llamar acciones)`);
    }
  }
  const maqueta = path.join(carpeta, "cabecera-del-chat", "maqueta-cabecera.tsx");
  if (!fs.existsSync(maqueta)) fallos.push("Falta cabecera-del-chat/maqueta-cabecera.tsx");
  else {
    const codigo = fs.readFileSync(maqueta, "utf8");
    for (const t of textos) if (!codigo.includes(t)) fallos.push(`maqueta-cabecera.tsx: falta el texto «${t}»`);
    if (!codigo.includes("390")) fallos.push("maqueta-cabecera.tsx: falta el marco de celular («390»)");
  }
  const explicacion = path.join(carpeta, "cabecera-del-chat", "explicacion.tsx");
  if (!fs.existsSync(explicacion)) fallos.push("Falta cabecera-del-chat/explicacion.tsx");
  else {
    const codigo = fs.readFileSync(explicacion, "utf8");
    for (const t of ["Devolverle el chat", "Cambiar hora"]) if (!codigo.includes(t)) fallos.push(`explicacion.tsx: falta el texto «${t}»`);
  }
}

if (fallos.length) {
  console.error("FALLA la prueba de la maqueta de la cabecera del chat:");
  for (const f of fallos) console.error(` - ${f}`);
  process.exit(1);
}
console.log("OK: maqueta de la cabecera del chat (sin base, sin acciones, con los 11 textos, el marco de celular y el recuadro explicativo)");

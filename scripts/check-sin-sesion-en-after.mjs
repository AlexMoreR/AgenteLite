// Prueba: dentro de un after() de src/app/actions/chats-actions.ts no se lee la sesion.
//
// after() corre cuando la respuesta ya salio: ahi ya no hay pedido, y auth() (que lee headers())
// revienta con "Route /cliente/chats used headers() inside after()". Ese error lo ve la vigilancia
// de 30 min y deshace la subida; y la asesora que contesto no se quedaba con el chat.
//
// Falla (sale con 1) si dentro del cuerpo de algun after( aparece auth(, headers( o cookies(, o si
// alguna llamada a claimConversationIfUnassigned de adentro no pasa userId (sin userId lo busca con
// auth(), que es el mismo error).
//
// Correr: npm run test:sin-sesion-en-after
// Otro archivo (por ejemplo el de origin/main, para ver que falla):
//   node scripts/check-sin-sesion-en-after.mjs <ruta-del-archivo>
import fs from "node:fs";
import path from "node:path";

const archivo = path.resolve(process.argv[2] ?? "src/app/actions/chats-actions.ts");
const original = fs.readFileSync(archivo, "utf8");

// Borra comentarios y el contenido de los textos (los cambia por espacios, asi las posiciones y
// las lineas siguen iguales): un "after()" o un "headers()" escrito en un comentario no cuenta.
function sinComentariosNiTextos(texto) {
  let salida = "";
  let i = 0;
  while (i < texto.length) {
    const c = texto[i];
    const sig = texto[i + 1];
    if (c === "/" && sig === "/") {
      while (i < texto.length && texto[i] !== "\n") {
        salida += " ";
        i += 1;
      }
      continue;
    }
    if (c === "/" && sig === "*") {
      salida += "  ";
      i += 2;
      while (i < texto.length && !(texto[i] === "*" && texto[i + 1] === "/")) {
        salida += texto[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      salida += "  ";
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      salida += c;
      i += 1;
      while (i < texto.length && texto[i] !== c) {
        if (texto[i] === "\\") {
          salida += "  ";
          i += 2;
          continue;
        }
        salida += texto[i] === "\n" ? "\n" : " ";
        i += 1;
      }
      salida += c;
      i += 1;
      continue;
    }
    salida += c;
    i += 1;
  }
  return salida;
}

// Desde el "(" en `desde`, devuelve la posicion de su ")" contando parentesis, llaves y corchetes.
function cierreDe(texto, desde) {
  const pila = [];
  const pares = { "(": ")", "{": "}", "[": "]" };
  for (let i = desde; i < texto.length; i += 1) {
    const c = texto[i];
    if (pares[c]) {
      pila.push(pares[c]);
    } else if (c === ")" || c === "}" || c === "]") {
      if (pila.pop() !== c) {
        throw new Error(`parentesis o llaves desparejas en la linea ${lineaDe(texto, i)}`);
      }
      if (pila.length === 0) {
        return i;
      }
    }
  }
  throw new Error(`after( sin cerrar desde la linea ${lineaDe(texto, desde)}`);
}

function lineaDe(texto, posicion) {
  return texto.slice(0, posicion).split("\n").length;
}

const codigo = sinComentariosNiTextos(original);
const fallas = [];
let cuerpos = 0;

for (const encontrado of codigo.matchAll(/(?<![\w$.])after\s*\(/g)) {
  const abre = encontrado.index + encontrado[0].length - 1;
  const cierra = cierreDe(codigo, abre);
  const cuerpo = codigo.slice(abre, cierra + 1);
  const lineaDelAfter = lineaDe(codigo, encontrado.index);
  cuerpos += 1;

  for (const prohibida of cuerpo.matchAll(/(?<![\w$.])(auth|headers|cookies)\s*\(/g)) {
    fallas.push(
      `linea ${lineaDe(codigo, abre + prohibida.index)}: ${prohibida[1]}() dentro del after() de la linea ${lineaDelAfter}`,
    );
  }

  for (const llamada of cuerpo.matchAll(/(?<![\w$.])claimConversationIfUnassigned\s*\(/g)) {
    const abreLlamada = abre + llamada.index + llamada[0].length - 1;
    const argumentos = codigo.slice(abreLlamada, cierreDe(codigo, abreLlamada) + 1);
    if (!/(?<![\w$.])userId(?![\w$])/.test(argumentos)) {
      fallas.push(
        `linea ${lineaDe(codigo, abreLlamada)}: claimConversationIfUnassigned sin userId dentro del after() de la linea ${lineaDelAfter}`,
      );
    }
  }
}

const nombre = path.relative(process.cwd(), archivo);
if (cuerpos === 0) {
  console.error(`FALLA: no se encontro ningun after( en ${nombre}; la prueba ya no mira nada`);
  process.exit(1);
}
if (fallas.length > 0) {
  console.error(`FALLA: ${nombre} lee la sesion dentro de after() (${cuerpos} after revisados)`);
  for (const falla of fallas) {
    console.error(`- ${falla}`);
  }
  process.exit(1);
}
console.log(`ok - ${nombre}: ${cuerpos} after() sin auth(), headers() ni cookies(), y la toma del chat lleva userId`);

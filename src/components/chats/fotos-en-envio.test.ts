import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import {
  actualizarFoto,
  agregarArchivosFallidos,
  agregarFotos,
  clasificarRespuestaDeEnvio,
  conReintentosAutomaticos,
  decidirReintento,
  encolarEnvio,
  esFotoEnEnvio,
  hayEnviosEnCurso,
  nuevaClaveDeEnvio,
  tipoDeArchivo,
  fotoComoMensaje,
  fotoEnviadaVencida,
  fotosDelChat,
  fotosQueYaLlegaron,
  leerArchivosFallidos,
  leerFoto,
  leerFotos,
  nuevoIdDeFoto,
  quitarArchivosFallidos,
  quitarFotos,
  vaciarFotosEnEnvio,
  VIDA_DE_FOTO_ENVIADA_MS,
  type DestinoDeFoto,
  type FotoEnEnvio,
} from "./fotos-en-envio";
import { marcaDeEnvioDeLaBurbuja } from "./marca-de-envio-de-la-burbuja";

function destino(conversationId: string): DestinoDeFoto {
  return {
    uploadPath: "/api/subir",
    conversationId,
    source: "agent",
    agentId: "agente-1",
    returnTo: "/cliente/chats",
    sendAction: async () => ({ ok: true }),
  };
}

function foto(cambios: Partial<FotoEnEnvio> & { conversationId: string }): FotoEnEnvio {
  return {
    id: nuevoIdDeFoto(),
    tipo: "IMAGE",
    clave: nuevaClaveDeEnvio(),
    destino: destino(cambios.conversationId),
    destinoDeAudio: null,
    archivo: new File(["x"], "foto.jpg", { type: "image/jpeg" }),
    comprimida: false,
    vistaPrevia: "blob:http://localhost/abc",
    caption: "",
    duracionMs: null,
    subida: null,
    avance: 0,
    estado: "subiendo",
    motivo: null,
    creadaEn: new Date(),
    enviadaEn: null,
    intentoDeEnvioEn: null,
    ...cambios,
  };
}

const subida = (url: string) => ({ url, fileName: "foto.jpg", mimeType: "image/jpeg", mediaType: "IMAGE" as const });

afterEach(() => vaciarFotosEnEnvio());

describe("qué burbuja se retira al llegar el mensaje real", () => {
  it("retira la que tiene la misma dirección del servidor", () => {
    const enviada = foto({ conversationId: "chat-a", subida: subida("/uploads/a.jpg"), estado: "enviada" });
    const otra = foto({ conversationId: "chat-a", subida: subida("/uploads/b.jpg"), estado: "enviando" });
    assert.deepEqual(fotosQueYaLlegaron([enviada, otra], "chat-a", [{ mediaUrl: "/uploads/a.jpg" }]), [enviada.id]);
  });

  it("no retira la que todavía no terminó de subir (no tiene dirección)", () => {
    const subiendo = foto({ conversationId: "chat-a" });
    assert.deepEqual(
      fotosQueYaLlegaron([subiendo], "chat-a", [{ mediaUrl: "blob:http://localhost/abc" }, { mediaUrl: null }]),
      [],
    );
  });

  it("una coincidencia en otro chat no la retira", () => {
    const deA = foto({ conversationId: "chat-a", subida: subida("/uploads/a.jpg"), estado: "enviada" });
    assert.deepEqual(fotosQueYaLlegaron([deA], "chat-b", [{ mediaUrl: "/uploads/a.jpg" }]), []);
  });

  it("también retira una fallida cuyo mensaje real sí llegó", () => {
    const fallida = foto({ conversationId: "chat-a", subida: subida("/uploads/a.jpg"), estado: "fallida" });
    assert.deepEqual(fotosQueYaLlegaron([fallida], "chat-a", [{ mediaUrl: "/uploads/a.jpg" }]), [fallida.id]);
  });

  it("se retira por clave aunque la URL sea distinta", () => {
    const enviada = foto({ conversationId: "chat-a", clave: "k1", subida: subida("/uploads/a.jpg"), estado: "enviada" });
    assert.deepEqual(
      fotosQueYaLlegaron([enviada], "chat-a", [
        { mediaUrl: "/uploads/a-grande.jpg", rawPayload: { clientMessageId: "k1" } },
      ]),
      [enviada.id],
    );
  });

  it("se retira por clave aunque todavía no tenga la dirección del servidor", () => {
    const enviando = foto({ conversationId: "chat-a", clave: "k1", estado: "enviando" });
    assert.deepEqual(
      fotosQueYaLlegaron([enviando], "chat-a", [{ mediaUrl: "https://gateway/x.jpg", rawPayload: { clientMessageId: "k1" } }]),
      [enviando.id],
    );
  });

  it("la misma clave en otro chat no la retira", () => {
    const deA = foto({ conversationId: "chat-a", clave: "k1", subida: subida("/uploads/a.jpg"), estado: "enviada" });
    assert.deepEqual(
      fotosQueYaLlegaron([deA], "chat-b", [{ mediaUrl: "/uploads/a-grande.jpg", rawPayload: { clientMessageId: "k1" } }]),
      [],
    );
  });

  it("no retira una sin clave coincidente ni con clave vacía", () => {
    const distinta = foto({ conversationId: "chat-a", clave: "k1", subida: subida("/uploads/a.jpg"), estado: "enviada" });
    const vacia = foto({ conversationId: "chat-a", clave: "", subida: subida("/uploads/b.jpg"), estado: "enviada" });
    assert.deepEqual(
      fotosQueYaLlegaron([distinta, vacia], "chat-a", [
        { mediaUrl: "/uploads/a-grande.jpg", rawPayload: { clientMessageId: "k2" } },
        { mediaUrl: "/uploads/b-grande.jpg", rawPayload: { clientMessageId: "" } },
        { mediaUrl: "/uploads/c.jpg", rawPayload: {} },
        { mediaUrl: "/uploads/d.jpg", rawPayload: null },
      ]),
      [],
    );
  });
});

/*
  Lo retomado tras recargar a mitad del envio (reanudarEnviosGuardados) y lo que quedo en el almacen
  mientras la asesora estaba en otro chat: el panel lo cruza con los mensajes del chat abierto
  (fotosQueYaLlegaron) y lo retira con quitarFotos, que tambien borra lo guardado en el navegador.
*/
describe("retomado tras recargar y vuelta de otro chat", () => {
  function retirarLasQueLlegaron(chat: string, mensajes: Parameters<typeof fotosQueYaLlegaron>[2]) {
    quitarFotos(fotosQueYaLlegaron(leerFotos(), chat, mensajes));
  }

  it("retomado cuyo mensaje real ya existe → se retira", () => {
    const porDireccion = foto({
      conversationId: "chat-a",
      clave: "k1",
      subida: subida("/uploads/a.jpg"),
      estado: "enviando",
      retomada: true,
    });
    const porClave = foto({
      conversationId: "chat-a",
      clave: "k2",
      subida: subida("/uploads/b.jpg"),
      estado: "enviando",
      retomada: true,
    });
    agregarFotos([porDireccion, porClave]);
    retirarLasQueLlegaron("chat-a", [
      { mediaUrl: "/uploads/a.jpg", rawPayload: null },
      { mediaUrl: "https://gateway/b-grande.jpg", rawPayload: { clientMessageId: "k2" } },
    ]);
    assert.equal(leerFoto(porDireccion.id), null);
    assert.equal(leerFoto(porClave.id), null);
  });

  it("retomado sin subida, con la clave en el mensaje real → se retira", () => {
    const subiendo = foto({ conversationId: "chat-a", clave: "k1", subida: null, estado: "subiendo", retomada: true });
    agregarFotos([subiendo]);
    retirarLasQueLlegaron("chat-a", [{ mediaUrl: "https://gateway/x.jpg", rawPayload: { clientMessageId: "k1" } }]);
    assert.equal(leerFoto(subiendo.id), null);
  });

  it("retomado sin subida y sin la clave en el chat → sigue para enviarse", () => {
    const subiendo = foto({ conversationId: "chat-a", clave: "k1", subida: null, estado: "subiendo", retomada: true });
    agregarFotos([subiendo]);
    retirarLasQueLlegaron("chat-a", [{ mediaUrl: "https://gateway/x.jpg", rawPayload: { clientMessageId: "otra" } }]);
    assert.equal(leerFoto(subiendo.id)?.estado, "subiendo");
  });

  it("una fallida retomada cuyo mensaje real sí salió se retira y no queda en rojo", () => {
    const fallida = foto({
      conversationId: "chat-a",
      clave: "k1",
      estado: "fallida",
      motivo: "Quedó sin enviar al cerrar la pestaña.",
      retomada: true,
    });
    agregarFotos([fallida]);
    retirarLasQueLlegaron("chat-a", [{ mediaUrl: "/uploads/a.jpg", rawPayload: { clientMessageId: "k1" } }]);
    assert.equal(leerFoto(fallida.id), null);
    assert.equal(leerFotos().filter((una) => una.estado === "fallida").length, 0);
  });

  it("una enviada del chat A sigue mientras está abierto B y se retira al volver a A", () => {
    const deA = foto({ conversationId: "chat-a", clave: "k1", subida: subida("/uploads/a.jpg"), estado: "enviada" });
    agregarFotos([deA]);
    const mensajesDeA = [{ mediaUrl: "/uploads/a.jpg", rawPayload: { clientMessageId: "k1" } }];
    // En B: aunque B tuviera la misma dirección o clave, no se toca la de A.
    retirarLasQueLlegaron("chat-b", mensajesDeA);
    assert.ok(leerFoto(deA.id));
    // Al volver a A, con su mensaje real ya en el chat, se retira en ese primer cruce.
    retirarLasQueLlegaron("chat-a", mensajesDeA);
    assert.equal(leerFoto(deA.id), null);
  });
});

describe("cada chat ve solo sus burbujas", () => {
  it("filtra por chat", () => {
    const deA = foto({ conversationId: "chat-a" });
    const deB = foto({ conversationId: "chat-b" });
    assert.deepEqual(fotosDelChat([deA, deB], "chat-a"), [deA]);
    assert.deepEqual(fotosDelChat([deA, deB], "chat-b"), [deB]);
  });

  it("sin chat abierto no muestra ninguna", () => {
    assert.deepEqual(fotosDelChat([foto({ conversationId: "chat-a" })], null), []);
  });

  it("la tarjeta de archivos fallidos también se separa por chat y guarda su destino", () => {
    agregarArchivosFallidos({ id: "t1", conversationId: "chat-a", destino: destino("chat-a"), files: [] });
    agregarArchivosFallidos({ id: "t2", conversationId: "chat-b", destino: destino("chat-b"), files: [] });
    const deA = fotosDelChat(leerArchivosFallidos(), "chat-a");
    assert.equal(deA.length, 1);
    assert.equal(deA[0].destino.conversationId, "chat-a");
    quitarArchivosFallidos("t1");
    assert.deepEqual(
      leerArchivosFallidos().map((t) => t.id),
      ["t2"],
    );
  });
});

describe("decisión de reintento", () => {
  it("con la dirección guardada solo envía", () => {
    assert.equal(decidirReintento({ estado: "fallida", subida: subida("/uploads/a.jpg") }), "solo-enviar");
  });

  it("sin dirección sube y envía", () => {
    assert.equal(decidirReintento({ estado: "fallida", subida: null }), "subir-y-enviar");
  });

  it("una burbuja que no está fallida no se reintenta (doble toque = uno)", () => {
    assert.equal(decidirReintento({ estado: "subiendo", subida: null }), "nada");
    assert.equal(decidirReintento({ estado: "enviando", subida: subida("/uploads/a.jpg") }), "nada");
    assert.equal(decidirReintento({ estado: "enviada", subida: subida("/uploads/a.jpg") }), "nada");
    assert.equal(decidirReintento(null), "nada");
  });

  it("un archivo perdido al recargar y sin subir no se reintenta; si ya había subido, solo envía", () => {
    assert.equal(decidirReintento({ estado: "fallida", subida: null, archivoPerdido: true }), "nada");
    assert.equal(decidirReintento({ estado: "fallida", subida: subida("/uploads/a.m4a"), archivoPerdido: true }), "solo-enviar");
  });
});

describe("foto enviada sin mensaje real", () => {
  it("se vence a los 5 minutos", () => {
    const ahora = 1_000_000;
    assert.equal(fotoEnviadaVencida({ estado: "enviada", enviadaEn: ahora }, ahora + VIDA_DE_FOTO_ENVIADA_MS - 1), false);
    assert.equal(fotoEnviadaVencida({ estado: "enviada", enviadaEn: ahora }, ahora + VIDA_DE_FOTO_ENVIADA_MS), true);
    assert.equal(fotoEnviadaVencida({ estado: "fallida", enviadaEn: null }, ahora * 10), false);
  });
});

describe("almacén", () => {
  it("los ids llevan el prefijo de burbuja en envío y no se repiten", () => {
    const a = nuevoIdDeFoto();
    const b = nuevoIdDeFoto();
    assert.ok(a.startsWith("optimistic-media:local-"));
    assert.ok(esFotoEnEnvio(a));
    assert.ok(!esFotoEnEnvio("optimistic-media:/uploads/a.jpg"));
    assert.notEqual(a, b);
  });

  it("agrega, actualiza y retira; actualizar una que ya no está no hace nada", () => {
    const una = foto({ conversationId: "chat-a" });
    agregarFotos([una]);
    actualizarFoto(una.id, { avance: 0.5 });
    assert.equal(leerFoto(una.id)?.avance, 0.5);
    quitarFotos([una.id]);
    assert.equal(leerFotos().length, 0);
    actualizarFoto(una.id, { estado: "fallida" });
    assert.equal(leerFotos().length, 0);
  });

  it("la burbuja muestra la vista previa local como foto con el texto", () => {
    const una = foto({ conversationId: "chat-a", caption: "Hola" });
    const mensaje = fotoComoMensaje(una);
    assert.equal(mensaje.id, una.id);
    assert.equal(mensaje.type, "IMAGE");
    assert.equal(mensaje.mediaUrl, una.vistaPrevia);
    assert.equal(mensaje.content, "Hola");
    assert.equal(mensaje.direction, "OUTBOUND");
  });

  it("video, documento y nota de voz salen con su tipo; la nota de voz con su duración y sin texto", () => {
    assert.equal(fotoComoMensaje(foto({ conversationId: "chat-a", tipo: "VIDEO" })).type, "VIDEO");
    assert.equal(fotoComoMensaje(foto({ conversationId: "chat-a", tipo: "DOCUMENT" })).type, "DOCUMENT");
    const nota = fotoComoMensaje(foto({ conversationId: "chat-a", tipo: "AUDIO", caption: "x", duracionMs: 6400 }));
    assert.equal(nota.type, "AUDIO");
    assert.equal(nota.content, null);
    assert.equal((nota.rawPayload as { seconds?: number }).seconds, 6);
  });

  it("en curso mientras sube o envía; no cuando salió o falló", () => {
    const una = foto({ conversationId: "chat-a" });
    agregarFotos([una]);
    assert.equal(hayEnviosEnCurso(), true);
    actualizarFoto(una.id, { estado: "fallida" });
    assert.equal(hayEnviosEnCurso(), false);
  });
});

describe("tipo y clave", () => {
  it("el tipo sale del mime, como en el servidor", () => {
    assert.equal(tipoDeArchivo("image/jpeg"), "IMAGE");
    assert.equal(tipoDeArchivo("video/mp4"), "VIDEO");
    assert.equal(tipoDeArchivo("application/pdf"), "DOCUMENT");
  });

  it("la clave cumple el formato que acepta el servidor (idDeMensajeValido)", () => {
    const clave = nuevaClaveDeEnvio();
    assert.match(clave, /^[A-Za-z0-9_-]{8,80}$/);
    assert.notEqual(clave, nuevaClaveDeEnvio());
  });
});

describe("reintentos automáticos", () => {
  const sinEspera = async () => undefined;

  it("sin respuesta se reintenta hasta 3 intentos y sale si alguno funciona", async () => {
    let llamadas = 0;
    const resultado = await conReintentosAutomaticos(async () => {
      llamadas += 1;
      return llamadas < 3
        ? clasificarRespuestaDeEnvio({ excepcion: true })
        : clasificarRespuestaDeEnvio({ resultado: { ok: true } });
    }, sinEspera);
    assert.equal(resultado.ok, true);
    assert.equal(resultado.intentos, 3);
  });

  it("si sigue sin respuesta, para a los 3 intentos y queda el motivo", async () => {
    let llamadas = 0;
    const resultado = await conReintentosAutomaticos(async () => {
      llamadas += 1;
      return clasificarRespuestaDeEnvio({ excepcion: true });
    }, sinEspera);
    assert.equal(resultado.ok, false);
    assert.equal(llamadas, 3);
  });

  it("un { error } del servidor no se reintenta: ya decidió", async () => {
    let llamadas = 0;
    const resultado = await conReintentosAutomaticos(async () => {
      llamadas += 1;
      return clasificarRespuestaDeEnvio({ resultado: { error: "No se pudo enviar el archivo: rechazado" } });
    }, sinEspera);
    assert.equal(llamadas, 1);
    assert.equal(resultado.ok, false);
    assert.equal(!resultado.ok && resultado.motivo, "No se pudo enviar el archivo: rechazado");
  });
});

describe("cola por chat", () => {
  it("en un chat salen en orden, aunque el primero tarde más", async () => {
    const orden: string[] = [];
    const lento = encolarEnvio("chat-a", async () => {
      await new Promise((listo) => setTimeout(listo, 20));
      orden.push("a1");
    });
    const rapido = encolarEnvio("chat-a", async () => {
      orden.push("a2");
    });
    await Promise.all([lento, rapido]);
    assert.deepEqual(orden, ["a1", "a2"]);
  });

  it("un envío que falla no frena al siguiente del mismo chat", async () => {
    const orden: string[] = [];
    const falla = encolarEnvio("chat-a", async () => {
      throw new Error("x");
    });
    const sigue = encolarEnvio("chat-a", async () => {
      orden.push("siguio");
    });
    await falla.catch(() => undefined);
    await sigue;
    assert.deepEqual(orden, ["siguio"]);
  });

  it("otro chat no espera al primero", async () => {
    const orden: string[] = [];
    const lento = encolarEnvio("chat-a", async () => {
      await new Promise((listo) => setTimeout(listo, 20));
      orden.push("a");
    });
    const otro = encolarEnvio("chat-b", async () => {
      orden.push("b");
    });
    await Promise.all([lento, otro]);
    assert.deepEqual(orden, ["b", "a"]);
  });
});

describe("marcaDeEnvioDeLaBurbuja: cuándo dibuja ruedita la burbuja", () => {
  it("una foto de la cola sin estado (ya la soltó) se ve enviada, nunca con ruedita", () => {
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic-media:local-x" }), "enviado");
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: nuevoIdDeFoto(), fotoEstado: null }), "enviado");
  });

  it("una foto de la cola en camino se ve enviada; solo la fallida cambia", () => {
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic-media:local-x", fotoEstado: "subiendo" }), "enviado");
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic-media:local-x", fotoEstado: "enviando" }), "enviado");
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic-media:local-x", fotoEstado: "enviada" }), "enviado");
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic-media:local-x", fotoEstado: "fallida" }), "fallida");
  });

  it("un optimistic-media: que no es de la cola deja la ruedita, como antes", () => {
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic-media:/uploads/a.jpg" }), "ruedita");
  });

  it("un texto optimista sin acuse de WhatsApp lleva el reloj; con acuse, no", () => {
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic:abc" }), "reloj");
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "optimistic:abc", outboundStatusLabel: "SENT" }), "ninguna");
  });

  it("un mensaje real no lleva ni ruedita ni reloj: se dibuja su acuse", () => {
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "cm123", outboundStatusLabel: "READ" }), "ninguna");
    assert.equal(marcaDeEnvioDeLaBurbuja({ id: "cm123" }), "ninguna");
  });
});

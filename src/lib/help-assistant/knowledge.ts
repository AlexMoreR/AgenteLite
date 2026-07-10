// BASE DE CONOCIMIENTO del copiloto de ayuda de AgenteLite.
//
// ⚠️ MANTENIMIENTO — "siempre actualizado":
// Esta guía es la ÚNICA fuente de verdad del asistente. Cuando cambie algo de la
// interfaz que use el equipo (un botón, un flujo, una sección nueva), ACTUALIZA este
// archivo en el mismo desarrollo. Si un texto de botón cambia en la UI, cámbialo aquí.
// El asistente solo sabe lo que esté escrito abajo.
//
// Redactada para personas NO técnicas: pasos con los nombres reales de los botones.

export const HELP_KNOWLEDGE_BASE = `# GUÍA DE LA APP (AgenteLite)

Esta guía describe cómo usar AgenteLite. Úsala como única fuente para dar pasos.

============================================================
## CONTACTOS
============================================================

En Contactos ves todas las personas que han escrito a la bandeja. A la izquierda está la lista; al hacer clic en un contacto, a la derecha se abre su ficha con la información, sus conversaciones y las acciones.

Nota importante: los contactos se crean solos cuando alguien escribe por primera vez. En esta pantalla NO hay botón para "crear" ni para "editar los datos" a mano.

### Buscar un contacto
1. Arriba de la lista (izquierda) hay una casilla que dice "Nombre, telefono, email o nota".
2. Escribe el nombre, teléfono, correo o una palabra de las notas.
3. Presiona Enter para ver los resultados.
4. Para ver todos de nuevo, borra el texto y presiona Enter.

### Moverte entre páginas de contactos
1. Abajo de la lista verás un texto tipo "Mostrando 1-20 de 120".
2. Usa el botón "Siguiente" para avanzar y "Anterior" para retroceder.

### Ver la ficha de un contacto
1. En la lista de la izquierda, haz clic en el contacto.
2. A la derecha se abre su ficha con: nombre, teléfono y correo; sus etiquetas; un bloque "Resumen" (conversaciones, mensajes, fecha de creación, última actividad); "Producto activo"; "Ultimo match" e "Historial de matches"; "Conversaciones recientes" y "Notas", si los tiene.
3. Si no has elegido a nadie, verás "Selecciona un contacto".

### Copiar el teléfono del contacto
1. Abre la ficha del contacto.
2. Arriba a la derecha, haz clic en el botón con ícono de copiar ("Copiar"). Al copiarse cambia a "Copiado".

### Abrir el chat del contacto
1. Abre la ficha del contacto.
2. Haz clic en el botón con ícono de mensaje ("Abrir chat"), arriba a la derecha.
3. También puedes bajar a "Conversaciones recientes" y usar "Abrir conversacion".

### Exportar la información del contacto
1. Abre la ficha del contacto.
2. Arriba a la derecha, haz clic en el botón de tres puntos ("Acciones del contacto").
3. Elige "Exportar ejecución simple" (resumida) o "Exportar ejecución avanzada" (completa). El archivo se descarga solo.

### Ocultar o mostrar el contacto en el CRM
1. Abre la ficha del contacto.
2. Haz clic en el botón de tres puntos ("Acciones del contacto").
3. Elige "Ocultar del CRM" (deja de mostrarse en el CRM, pero el contacto y su historial siguen intactos) o "Mostrar en CRM" (vuelve a mostrarlo). No borra nada.

### Empezar de 0 (reiniciar la conversación)
Úsalo para que el agente atienda a esa persona como si fuera la primera vez (por ejemplo, para que reciba de nuevo la bienvenida).
1. Abre la ficha del contacto.
2. Haz clic en el botón de tres puntos ("Acciones del contacto").
3. Elige "Empezar de 0" (aparece en naranja).
4. Se abre la ventana "Empezar de 0" que avisa que se borrarán las conversaciones, mensajes, seguimientos y el estado del agente, pero se conserva el contacto (nombre, etiquetas, etapa y notas).
5. Confirma con "Empezar de 0" o cancela con "Cancelar".

### Eliminar un contacto (definitivo)
Solo cuando quieras borrar por completo a la persona y todo su historial. No se puede deshacer.
1. Abre la ficha del contacto.
2. Haz clic en el botón de tres puntos ("Acciones del contacto").
3. Elige "Eliminar contacto" (en rojo).
4. Se abre la ventana "Eliminar contacto" ("Accion irreversible"): se eliminará la persona y todo su historial.
5. Confirma con "Eliminar contacto" o cancela con "Cancelar".

### Diferencia: Ocultar del CRM vs Empezar de 0 vs Eliminar
- Ocultar del CRM: conserva todo; solo deja de verse en el CRM. Reversible con "Mostrar en CRM".
- Empezar de 0: borra conversaciones, mensajes y seguimientos, pero conserva el contacto. No se puede deshacer.
- Eliminar contacto: borra a la persona y TODO. Definitivo.

### Ver el Informe de contactos
1. Junto al título "Contactos", haz clic en el botón de tres puntos y elige "Informe".
2. Verás las tarjetas "Total", "Con chats" y "Sin chat", y el "Tráfico de creación".
3. Cambia el período con el menú de la derecha: "Últimos 7 días", "Últimos 14 días" o "Últimos 30 días".
4. Usa "Descargar reporte" para bajar el resumen.

============================================================
## CHATS (bandeja de WhatsApp)
============================================================

Pantalla donde ves y respondes las conversaciones. La lista está a la izquierda y la conversación a la derecha (en el celular, primero ves la lista y al tocar un chat se abre a pantalla completa).

### Abrir una conversación
1. En la columna izquierda, busca el chat en la lista.
2. Toca el chat (la fila con la foto y el nombre). Se abre a la derecha.
3. En el celular, para volver a la lista toca la flecha de arriba a la izquierda ("Volver a chats").

### Buscar una conversación
1. Arriba de la lista, escribe en la casilla "Buscar chats...".
2. La lista se filtra sola (por nombre, número o texto del mensaje).
3. Toca la X dentro de la casilla para borrar la búsqueda.

### Filtrar la lista: Mías / Sin asignar / Todas
Debajo del buscador hay pestañas:
1. "Mías": solo los chats que tienes asignados.
2. "Sin asignar": los que no tienen encargado (solo administradores).
3. "Todas": todas las conversaciones (solo administradores).

### Filtrar por estado (Abiertas / Resueltas / Todas)
1. A la derecha del buscador, toca el icono de embudo ("Filtrar").
2. En "Filtrar conversaciones" → "Estado", elige "Todas", "Abiertas" o "Resueltas".
3. Toca "Aplicar" o "Limpiar".

### Responder un mensaje (texto)
1. Abre la conversación.
2. Escribe en la casilla de abajo ("Escribe un mensaje...").
3. Toca el botón de enviar (la flecha).
Para emoticones: toca la carita junto a la casilla y elige uno.

### Responder citando un mensaje
1. Pasa el mouse por el mensaje (o mantén pulsado en el celular) y toca la flechita ("Opciones del mensaje").
2. Toca "Responder".
3. Escribe tu respuesta y envíala. Para quitar la cita, toca la X ("Cancelar respuesta").

### Copiar el texto de un mensaje
1. Abre el menú del mensaje (la flechita).
2. Toca "Copiar" ("Mensaje copiado").

### Enviar una foto o video
1. En la casilla de mensaje, toca el botón + ("Adjuntar").
2. Elige "Fotos y videos".
3. Selecciona una o varias imágenes/videos.
4. En la vista previa puedes escribir un texto opcional ("Añadir un mensaje… (opcional)").
5. Toca enviar (la flecha).

### Enviar un documento (PDF)
1. Toca + ("Adjuntar") → "Documento".
2. Selecciona el PDF.
3. Escribe un texto opcional y toca enviar.

### Enviar un audio / nota de voz
1. Toca + ("Adjuntar") → "Audio"; o toca el icono de micrófono a la derecha de la casilla (cuando no has escrito nada).
2. Verás "Grabando" con el tiempo.
3. Toca la flecha ("Enviar nota de voz") para enviarla, o el bote de basura ("Cancelar grabación") para descartarla.

### Usar respuestas rápidas (mensajes guardados)
1. Toca + ("Adjuntar") → "Respuestas rápidas".
2. En la ventana "Respuestas rápidas", toca una: su texto se coloca en la casilla (no se envía solo). Revísalo y envíalo.
Para crear una: toca "Crear respuesta rápida", escribe "Título" y "Mensaje", y toca "Crear". Para editar/borrar usa el lápiz ("Editar") o el bote de basura ("Eliminar").

### Respuesta sugerida con IA
1. En la casilla, toca el icono de destello/estrellas ("Respuesta sugerida con IA").
2. La IA escribe una propuesta en la casilla. Revísala, edítala y envíala.

### Poner o quitar etiquetas a un chat
Las etiquetas están en el panel del contacto: toca la foto del contacto en la cabecera de la conversación y busca "Etiquetas".
Para poner: toca el botón + ("Agregar etiqueta") y toca la etiqueta que quieras (queda con ✓).
Para crear una nueva: toca "Crear etiqueta", escribe el "Nombre de la etiqueta", elige color y toca "Guardar".
Para quitarla de este chat: toca la etiqueta (la insignia) y en el mini-menú toca "Quitar".
Para eliminarla por completo (solo administradores, afecta a todos los chats): toca el bote de basura junto a la etiqueta y confirma con "Eliminar".

### Asignar la conversación a un colaborador
Abre el panel del contacto (toca la foto en la cabecera) y busca "Agente asignado" (botón con "Sin asignar" o un nombre).
1. Toca ese botón ("Asignar chat").
- Si eres colaborador: "Tomar este chat" para asignártela, o "Soltar chat" para dejarla libre.
- Si eres administrador: elige "Sin asignar" o el nombre de la persona (tu nombre aparece con "(tú)").

### Pausar o reactivar el bot (la IA) en una conversación
En la cabecera hay un interruptor:
- Encendido: la IA responde automáticamente.
- Apágalo para pausar la IA y responder tú a mano.
En el celular: toca el botón de tres puntos ("Acciones de la conversación") y usa "Pausar agente".

### Resolver o reabrir una conversación
1. En la cabecera, toca "Resolver" para cerrarla ("Conversación resuelta").
2. Cuando está resuelta, el botón cambia a "Reabrir".
En el celular está en el botón de tres puntos ("Acciones"), bajo "Conversación".

### Eliminar un mensaje
1. Abre el menú del mensaje (la flechita) y toca "Eliminar".
2. Confirma: si el mensaje lo enviaste tú, se borra también en el WhatsApp del cliente; si es del cliente, solo se borra de la bandeja.

### Ver los datos del contacto desde el chat
1. Toca la foto del contacto en la cabecera.
2. Se abre el panel "Contacto" (nombre, número con botón "Copiar", ciudad, etiquetas).
3. Para editarlo, toca el lápiz ("Editar").

Nota sobre "no leído": cada chat con mensajes nuevos muestra un globito azul con el número sin leer. No hay opción manual para marcar como "no leído".

============================================================
## CONEXIÓN (WhatsApp)
============================================================

Aquí conectas tu WhatsApp, lo vinculas a un agente, lo enciendes/apagas y ajustas sonido y notificaciones. Todo en el menú "Conexión".

### Conectar un WhatsApp nuevo (escanear el código QR)
1. En "Conexión", toca "Nuevo canal".
2. En la ventana "Nuevo canal", toca la tarjeta "WhatsApp QR Code" ("Empezar ahora").
3. En "Ponle un nombre a tu canal", escribe un nombre en "Nombre del canal".
4. Toca "Crear canal".
5. Aparece "Escanea el QR". En tu teléfono: abre WhatsApp → Dispositivos vinculados → vincular un dispositivo → escanea el código de la pantalla.
6. Si el código expira, se refresca solo; espera el nuevo.
7. Al conectarse, el estado cambia a "Conectado".
Nota: si no puedes escanear, debajo del QR puede aparecer un "Código alterno" para vincular escribiéndolo.

### Asignar la conexión a un agente / chatbot
1. Abre la conexión (toca su nombre en la lista).
2. Entra a la pestaña "Agente".
3. En "Agente vinculado", abre "Seleccionar agente" y elige el agente. Se guarda solo ("Canal vinculado al agente").
Forma rápida: si entraste con un agente seleccionado, cada conexión muestra "Asignar a este agente".
En la pestaña "Agente" también puedes ajustar: "Agente activo" (encender/apagar el agente), "Frase de reactivacion" y "Retraso de respuesta IA" (segundos).

### Encender o apagar la conexión
1. En la lista de "Conexión", cada tarjeta tiene un interruptor; tócalo para encender/apagar ("Canal encendido" / "Canal apagado").
2. También dentro de la conexión, en el interruptor de arriba.

### Eliminar / quitar una conexión
1. En la lista de "Conexión", ubica la conexión.
2. Toca el botón de tres puntos ("Acciones") al final de su tarjeta.
3. Toca "Eliminar" ("Canal eliminado").
Ojo: al eliminar una conexión también se borran sus conversaciones. Hazlo solo si estás segura.

### Cambiar el sonido de aviso
Dentro de la conexión, pestaña "Agente", tarjeta "Sonido":
1. Abre el selector y elige "Silenciar", "Sonido 1", "Sonido 2", "Sonido 3", "Sonido 4" o "Sonido 5".
2. Al elegir, se reproduce una vista previa. Se guarda en ese dispositivo/navegador.

### Activar las notificaciones en este dispositivo
Dentro de la conexión, pestaña "Agente", tarjeta "Notificaciones del dispositivo" (también disponible desde el icono de campana arriba):
1. Toca "Activar notificaciones en este dispositivo" (o "Activar sonido en este dispositivo" en la campana).
2. Acepta el permiso del navegador. Verás "Activadas en este dispositivo".
3. Toca "Probar" para comprobar que suena, o "Desactivar" para apagarlas.
Importante (iPhone): primero instala la app en la pantalla de inicio (Compartir → "Agregar a inicio"), ábrela desde ese ícono y vuelve para activarlas; si no, el iPhone no deja.
Si aparece "Notificaciones bloqueadas": actívalas en los ajustes del navegador (el candado junto a la dirección → Notificaciones → Permitir) y recarga.
Las notificaciones y el sonido son por dispositivo: actívalas en cada celular o computador donde quieras recibirlas.

### Sincronizar chats (traer conversaciones anteriores)
Disponible en conexiones de WhatsApp por QR. Dentro de la conexión, pestaña "Agente", tarjeta "Sincronizar chats":
1. Toca "Sincronizar chats".
2. Todos los chats: en "Importar ... mensajes recientes" elige cuántos ("Todas", "1000", "100", "50" o "10") y toca "Sincronizar chats". O un solo número: escribe el número con código de país, elige cantidad y toca "Sincronizar numero".
3. Si hay "Coincidencias detectadas", elige el contacto, revisa la vista previa y toca "Agregar" (o "Ignorar").
4. Si no hay nada nuevo, verás "Sin cambios".

### Conexión por API oficial de WhatsApp (Meta)
Es una conexión avanzada para líneas oficiales de WhatsApp Business; normalmente la configura alguien con los datos de Meta.
Crear: "Nuevo canal" → tarjeta "WhatsApp API (Meta)" ("Crear y configurar") → escribe "Nombre del canal" → "Crear canal".
Configurar: dentro de la conexión, pestaña "Ajustes" ("Credenciales API"), completa Phone Number ID, ID de la cuenta de WhatsApp Business, Token de acceso permanente y Webhook Verify Token; copia el "Webhook Callback URL" con "Copiar" y pégalo en Meta. Usa "Probar API" y luego "Guardar conexion".

============================================================
## CRM
============================================================

El CRM organiza tus clientes potenciales (leads) según el punto del proceso de venta. Tres vistas dentro de la sección "CRM" del menú: "Registro" (tabla), "Kanban" (tablero por columnas) e "Informe".
Las etapas son: Nuevo, Frio, Tibio, Caliente, Ganado y Descartado.

### Abrir el tablero CRM (Kanban)
1. En el menú lateral, haz clic en "CRM" y luego en "Kanban".
2. Verás seis columnas (Nuevo, Frio, Tibio, Caliente, Ganado, Descartado), cada una con un número de tarjetas.

### Mover un lead entre etapas en el Kanban
1. Abre la vista "Kanban".
2. Ubica la tarjeta del cliente en su columna actual.
3. Haz clic sostenido y arrástrala a la columna de la etapa que quieras.
4. Suéltala dentro de la columna. El cambio se guarda solo.

### Ver el registro (tabla) del CRM
1. Menú lateral → "CRM" → "Registro".
2. Tabla con columnas: Fecha, Numero, Nombre, Origen, Etiquetas, Detalle y Estado.
3. Buscar: casilla "Buscar por numero, nombre, origen, detalle o etiqueta".
4. Filtrar por etapa: selector "Estados". Filtrar por fecha: "1 Dia", "7 Dias", "15 Dias", "30 Dias" o "Todos".
5. En el botón de tres puntos está "Exportar CSV".

### Cambiar la etapa de un contacto desde la tabla
1. Abre "Registro".
2. En la fila del contacto, columna "Estado", haz clic en el selector.
3. Elige la nueva etapa (Nuevo, Frio, Tibio, Caliente, Ganado o Descartado). Se guarda automáticamente.
En cada fila, el botón de tres puntos ofrece "Copiar detalle", "Ir a chats" y "Marcar seguimiento".

### Ocultar un contacto del CRM
Se hace desde "Contactos" (ver sección Contactos): abre el contacto → "Acciones del contacto" → "Ocultar del CRM" (o "Mostrar en CRM").

============================================================
## NAVEGACIÓN GENERAL Y PERFIL
============================================================

### Moverte por el menú lateral
El menú de la izquierda muestra las secciones según tus permisos. Puede incluir: Productos, Categorias, Proveedores, Cotizaciones, Chats, Contactos, CRM (Registro, Kanban, Informe), Flujos, Seguimientos, Marketing IA, Finanzas, Conexion, Agentes, Agente V2, Api oficial, Equipo, Usuarios, Configuracion negocio, Control de modulos, Configuracion WhatsApp.
1. Haz clic en el nombre de la sección para abrirla.
2. Las secciones con flechita (como CRM o Chats) se despliegan para mostrar subopciones.
3. El botón de arriba a la izquierda contrae o expande el menú.

### Abrir tu perfil
1. Abajo del menú lateral verás tu nombre y correo con dos flechas.
2. Haz clic ahí y elige "Perfil". (También pueden aparecer "Mi Empresa" y "Configuracion".)

### Cambiar tema claro / oscuro
1. En la barra superior (arriba a la derecha), haz clic en el botón de luna (oscuro) o sol (claro).
2. El tema cambia al instante y se recuerda.

### Cerrar sesión
1. Abajo del menú lateral, haz clic en tu nombre y correo.
2. Haz clic en "Cerrar sesion".
`;

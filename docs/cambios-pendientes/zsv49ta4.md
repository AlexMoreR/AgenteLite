## Advertencias de operación

- `contactos`: al abrir Contactos, la etiqueta "Nuevo lead" de los contactos de la página se revisa por lotes (`syncLeadLifecycleForContacts`, igual que la bandeja de chats): solo se escribe lo que cambia y la lista se vuelve a leer solo si algo cambió. Para saber si un contacto tiene historial basta con un saliente (`EXISTS`), ya no se cuentan. Mi Día busca el último mensaje de cada chat solo desde el chat más viejo de su lista menos 30 días de margen: un chat cuyo último mensaje real sea más viejo que eso sale con "Sin mensajes visibles." en la vista previa.

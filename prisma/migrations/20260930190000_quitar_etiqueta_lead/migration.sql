-- Quitar la etiqueta automatica "Lead" (slug "lead") de todos los contactos (pedido de Alex, 30-09-2026).
--
-- La ponia sola el ciclo de vida de contact-default-tags.ts a todo contacto con historial: 2.803
-- contactos con la misma chapita "LEAD", que no distinguia nada porque todos los contactos del CRM
-- son leads. El codigo ya no la pone; esto borra la que quedo.
--
-- Borrar la etiqueta borra sus asignaciones ("ContactTag" tiene ON DELETE CASCADE) y deja en null
-- las referencias de "ContactMatch" (ON DELETE SET NULL; hoy son cero). Nada mas la usa: se reviso
-- que ningun agente, regla de seguimiento, campaña ni filtro guardado la tuviera.
--
-- "Nuevo lead" (slug "nuevo-lead") NO se toca: esa si separa a quien todavia no hablo.

DELETE FROM "Tag" WHERE "slug" = 'lead';

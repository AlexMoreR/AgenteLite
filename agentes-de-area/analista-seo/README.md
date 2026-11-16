# Analista SEO de Magilus (rutina de claude.ai)

El Analista SEO **no es código del CRM**: es una **rutina de claude.ai en la nube**. Esta carpeta guarda una
**copia versionada** de su texto para poder revisarlo y ver qué cambió.

| Dato | Valor |
|---|---|
| Rutina | `trig_01NTU1CvjmNKfUHPXiScPdPi` ("Analista SEO Magilus") |
| Horario | `52 6 * * 1-6` (lunes a sábado, 6:52 a. m., hora de Bogotá) |
| Ambiente de la nube | `env_011111111111111111111117`, o uno propio del SEO si ese lo usan otras rutinas (el que diga la rutina en claude.ai) |
| Red que necesita | `magilus.com`, `www.magilus.com` y los dominios de descarga de Chromium que pide la skill Claude SEO (salen de `/tmp/seo-install.log`) |
| Texto de la rutina | [`PROMPT.md`](PROMPT.md) |
| Manual del Analista | Google Doc `1dnU0FDuCKRN1bYVBL1KVbRHHxRGBRPPGFoKVgEITL0Y` (en el cerebro: "06 Tecnología/SEO Magilus") |
| Prueba del texto | `node agentes-de-area/pruebas/probar-analista-seo.mjs` |

## Regla principal (Alexander, 16-nov-2026)

En cada corrida, **incluido el lunes**, crea **mínimo 2 tarjetas** Tarea hijas de Features (T-736, id
`cmwbcu28700b732qmru2nd890`), repo `gestion`, título `SEO: ...`, riesgo ALTO. Cada tarjeta dice la página, el cambio
y el número de Search Console que debe mejorar. No repite T-812 ni tarjetas abiertas; si no hay 2 buenas, lo anota
en la Bitácora y no inventa.

## Cómo actualizar el texto

1. Cambia `PROMPT.md` aquí y corre la prueba (`node agentes-de-area/pruebas/probar-analista-seo.mjs`).
2. Desde la sesión de aizen1 (que tiene RemoteTrigger), actualiza la rutina con `update` poniendo como prompt el
   contenido **exacto** de `PROMPT.md`. No cambies la hora ni el ambiente.
3. Comprueba con `get` que el texto es igual a `PROMPT.md`, que el cron sigue en `52 6 * * 1-6` y que `enabled` es `true`.

**Ojo:** si alguien cambia el texto a mano en claude.ai, la copia de aquí queda vieja. Antes de editar, compara el
texto de `get` con `PROMPT.md` y, si son distintos, trae primero lo de claude.ai a este archivo.

## Cómo correrla a mano

1. RemoteTrigger `run` de `trig_01NTU1CvjmNKfUHPXiScPdPi`.
2. `list_runs` y `get_run_log` de esa corrida. Revisa:
   - que no salga `CONNECT tunnel failed` ni `PROVENANCE_REQUIRED` para magilus.com;
   - que el instalador de la skill no diga "Chromium is unavailable";
   - que haya 2 o más `crear_tarjeta` con `padre_id` de Features.
3. En el tablero Empresa Magilus (`ver_tablero`): 2 o más tarjetas nuevas con `SEO:` y fecha de hoy, hijas de T-736.

## Accesos

- **WebFetch** solo abre sin pedir permiso las direcciones escritas en el texto de la rutina; por eso `PROMPT.md`
  trae una lista de direcciones de magilus.com y, para las demás, usa `curl` (la red del ambiente lo permite).
- **Google Colombia**: Google no deja descargar sus resultados con un programa. La competencia se mide con
  WebSearch en español de Colombia y es **aproximada**; el puesto de Magilus sale de Search Console.

# CLAUDE.md — Sistema ERP Degusta
> Actualizado: 17/06/2026 · Sesión v14 · Score: 84/100

---

## Identidad del proyecto

Sistema ERP para negocio de comida (restaurante/delivery pequeño) compuesto por:
- **Backend:** Google Apps Script (`degusta_script_v15.gs`) desplegado como Web App
- **Frontend:** App móvil PWA en GitHub Pages (`index.html`)
- **Base de datos:** Google Sheets con 9 hojas

El negocio prepara solo 3 platos por día. Diana activa/desactiva disponibilidad cada mañana en `BASE_PLATOS` col E.

---

## Datos críticos del sistema

| Campo | Valor |
|-------|-------|
| Google Sheet ID | `1gH56b4yltH-85rTmEHQ8i61Hmsak2G0tSvTY0qOe59o` |
| App móvil | https://jonathan1-lang.github.io/Degusta/ |
| Repositorio GitHub | https://github.com/Jonathan1-lang/Degusta |
| Apps Script proyecto | https://script.google.com/home/projects/1JiqDDtxDi2HS_ntJF03219ZvHtxUZJMxOoJdn5UGZ0p6GHscuyIs-UC1/edit |
| Web App URL (GAS) | https://script.google.com/macros/s/AKfycbyegu7IqgP5WmMtwJ500QK7bWLPf5aOYypmfus5c-4QQqgENRxj8t9DdBKttii1dmA/exec |
| Script activo | `degusta_script_v15.gs` desplegado como **Versión 24** |
| index.html activo | commit `8b62c670` — Degusta v2.1.2 |
| Token API | `dgst-K7m2Xp9Q-vR4tLw8s-Zn3bHj6c` (CONFIG!B18) |
| Cuenta propietaria | virtualsv1@gmail.com (Diana Alvarez) |
| Co-editor | jonathan_mau2101@hotmail.com |
| Co-editor Gemini | nias11670@gmail.com |
| Pedidos reales | 53 (IDs 001–054, gap 030 intencional; próximo: `055`) |
| Clientes reales | 34 (TestVerificacion eliminado; conteo auditado v14) |

---

---

## Hojas del sistema

| Hoja | Descripción |
|------|-------------|
| DASHBOARD | Reportes — hoja completa protegida (solo Diana) |
| CLIENTES | 34 clientes registrados |
| BASE_PLATOS | Col E: disponibilidad diaria (Diana activa/desactiva cada mañana) |
| BASE_EXTRAS | Col D: "Sí"/"No" con tilde — el script normaliza |
| PEDIDOS | 53 pedidos reales. **Es una Tabla de Sheets con columnas TIPADAS** (ver abajo). Cols Q:Y y AC protegidas. Fórmulas pre-llenadas hasta fila 1001. Col AG: UUID |
| CONFIG | B13: teléfono negocio (NO es método de pago). B18: Token API |
| COCINA | Hoja completa protegida (solo Diana) |
| CIERRE_CAJA | Completada hasta 12/06 |
| INVENTARIO | Fórmulas dinámicas de alerta `=SI(E<=F,"⚠️ REPONER","✅ OK")` |

---

## Esquema de columnas PEDIDOS (CRÍTICO para escribir pedidos)

**PEDIDOS es una Tabla de Sheets con columnas tipadas.** Escribir el tipo equivocado (p.ej. un string a una columna Fecha) se **descarta en silencio** — el `setValue` no lanza error pero el valor no queda. Por eso `registrarPedido` debe escribir el tipo correcto en cada columna.

| Col | Campo | Tipo / Nota al escribir |
|-----|-------|--------------------------|
| A | ID | Texto `055` (usar `setNumberFormat('@')`). ID = `max(IDs 1..999)+1`, **ignorar valores ≥1000** (seriales de fecha residuales) |
| B | Fecha | **objeto `Date`** + `setNumberFormat('dd/MM/yyyy')` |
| C | Hora | **objeto `Date`** + `setNumberFormat('HH:mm')` |
| D | Cliente | texto |
| E,F | Plato1, Cant1 | texto / número |
| G,H / I,J | Plato2,Cant2 / Plato3,Cant3 | texto / número |
| K–P | Extra1–3 + cantidades | texto / número |
| **Q–Y** | Precios y subtotales | **FÓRMULAS — NO escribir** (Q=P.Plato1…, W=Subtotal, X=T.Extras, **Y=TOTAL**) |
| Z | Pago | texto (Efectivo/Transferencia) |
| AA | Estado | texto (Preparando/En camino/Entregado/Cancelado/Por cobrar) |
| AB | Notas | texto |
| AC | Timestamp | **objeto `Date`** + `setNumberFormat('dd/MM/yyyy HH:mm:ss')` |
| AD | Dirección entrega | texto |
| AE | Descuento | número (se **resta** del total) |
| AF | **Delivery ($)** | número (se **suma** al total) |
| AG | UUID | texto |

**Fórmula del total:** `Y = W + X − AE + AF`. El costo de delivery va en **AF** y entra solo al total.

**Fila de inserción:** detectar por la última fila con **col D (Cliente)** no vacía + 1 — NO contar por col A (puede tener residuales).

---

## Protecciones activas — NO romper

| Rango | Restricción |
|-------|-------------|
| DASHBOARD (hoja completa) | Solo Diana |
| PEDIDOS Q:Y | Solo Diana (precios y subtotales) |
| PEDIDOS AC | Solo Diana (timestamps) |
| COCINA (hoja completa) | Solo Diana |
| PEDIDOS Z/AA/AB/AD:AF | Libres para operadores |

---

## Patrón operativo — qué herramienta usa qué

| Herramienta | Uso permitido |
|-------------|---------------|
| **Gemini** (nias11670) | Cambios en rangos NO protegidos |
| **Apps Script desde Diana** | Protecciones, rangos bloqueados, funciones de corrección |
| **Composio/API** | Solo lectura y verificación — **NUNCA escritura** |
| **`GOOGLESHEETS_BATCH_UPDATE`** | ❌ Bug confirmado — siempre escribe desde A1, nunca usar |

---

## Cómo editar Apps Script

1. Abrir el proyecto en el enlace de arriba
2. Seleccionar `degusta_script_v15.gs`
3. Usar `monaco.editor.getEditors()[0].setValue(codigoNuevo)` para inyectar código completo
4. Guardar con `Ctrl+S`
5. Desplegar: "Implementar" → "Administrar las implementaciones" → ícono lápiz → "Nueva versión" → "Implementar"
6. La URL del Web App **no cambia** entre versiones
7. **IMPORTANTE:** Todos los archivos `.gs` comparten el mismo scope global. `const` duplicados entre archivos rompen TODO con `SyntaxError: Identifier already declared`. Al crear una versión nueva, vaciar la anterior dejando solo `// Código movido a vX.gs`
8. **Convención de nombres:** el archivo activo actual es `degusta_script_v15.gs`. El próximo debe ser `degusta_script_v16.gs`

---

## Cómo editar index.html (GitHub API REST)

El editor web de GitHub no permite pegar via JS de forma confiable.

**Flujo que funciona:**
1. Generar PAT classic en https://github.com/settings/tokens/new con scope `repo` (expiración 7-30 días)
2. Desde consola JS:
   - `GET /repos/.../git/blobs/{sha}` — leer blob original
   - Decodificar con `atob()` + `TextDecoder('utf-8')` (NO usar `unescape(encodeURIComponent())` — dobla-codifica UTF-8 y corrompe emojis)
   - Aplicar cambios con `.replace()`
   - Re-codificar con `TextEncoder()` + loop `String.fromCharCode` + `btoa()`
   - `PUT /repos/.../contents/index.html` con `sha` del archivo actual
3. **Revocar el PAT inmediatamente** tras cada commit: https://github.com/settings/tokens → Delete. Nunca dejar un PAT activo entre sesiones.
4. GitHub Pages tarda **15-30 segundos** en propagar. Usar `Ctrl+Shift+R` o agregar `?v=N` a la URL para forzar bypass de caché.

---

## Comportamiento del backend — cosas que NO son bugs

- **`"Por cobrar"`** = pago diferido legítimo. No es un error.
- **Gap 030** en PEDIDOS es intencional. No rellenar.
- **Col AG** con UUID vacío en pedidos históricos = esperado (los nuevos desde la app sí lo llevan).
- **Fórmulas Q:Y/AE/AF pre-llenadas hasta fila 1001** — contar pedidos reales por **col D (Cliente)** no vacía, NO por col A (puede tener seriales residuales ≥1000, p.ej. A1001).
- **Pedidos desde la app SÍ funcionan** (GAS v24): escriben fecha/hora servidor, total con delivery, UUID. El próximo ID se calcula solo.
- **CONFIG!B13** = teléfono del negocio (72815557). NO es método de pago.
- **POST en la app se envía como GET+`?d=JSON`** — workaround CORS para GAS. Todo el backend debe asumir este patrón.
- **`BASE_PLATOS`/`BASE_EXTRAS`** devuelven OBJETOS `{nombre, precio, categoria}` desde v15 — no strings. Cualquier código frontend nuevo debe manejar ambos casos.

---

## Backlog (no bloquea sesiones actuales)

| ID | Acción |
|----|--------|
| ~~H-14~~ | ~~Token API visible en CONFIG!B18~~ — **Cerrado v14**: movido a PropertiesService, GAS Versión 18. Limpiar CONFIG!B18 manualmente. |
| R-20 | Normalizar teléfonos a E.164 en CLIENTES |
| ~~F-19~~ | ~~Cols Email y Canal en CLIENTES vacías~~ — **Won't fix**: negocio usa solo WhatsApp |
| N-R04 | Corregir snapshot P.Plato2 en pedido 002 (cosmético) |
| N-R05 | Documentar inconsistencia de nombres de extras históricos |
| V9-H05 | Fila residual A30 en tabla semanal DASHBOARD |

---

## Historial de bugs cerrados

| ID | Descripción | Sesión | Commit/Versión |
|----|-------------|--------|----------------|
| TOKEN | Fix `?t=` no reconocido en doGet | v11 | — |
| BUG-EXT-01 | `extras: []` — índice `r[3]` fuera de rango | v11 | — |
| BUG-PAY-01 | `metodosPago` incluía estados y teléfono | v11 | — |
| BUG-PLAT-01 | Comparación `'sí'` sensible a mayúsculas | v11 | — |
| BUG-CLI-01 | Autocomplete mostraba "0 clientes" | v12 | — |
| BUG-CLI-02 | Registro de clientes nunca se escribía en CLIENTES | v14 | GAS Versión 17 |
| H-14 | Token API hardcodeado → PropertiesService | v14 | GAS Versión 18 |
| BUG-PED-01 | `doGet` no manejaba `accion=pedido` (pedidos de app se perdían) | v14 | GAS Versión 19/20 |
| BUG-PED-02 | ID de pedido por count (gap 030 → ID duplicado) → `max+1` | v14 | GAS Versión 20 |
| BUG-PED-03 | Mapeo de columnas corrido; destruía fórmulas Q:Y | v14 | GAS Versión 21-23 |
| BUG-PED-04 | Tabla tipada descartaba strings en B/C/AC → escribir `Date` | v14 | GAS Versión 24 |
| BUG-ENC-01 | Emojis corruptos por doble encoding UTF-8 | v13 | `c5e84865` |
| BUG-SYN-01 | SyntaxError por comillas mal escapadas en "+Nuevo" | v13 | `375cc78f` |
| BUG-OBJ-01 | Catálogo fallaba con `s.trim is not a function` | v13 | `8b62c670` |

---

## Score actual por categoría (17/06/2026)

| Categoría | Score |
|-----------|------:|
| Integridad de datos | 82 |
| Exactitud de cálculos | 82 |
| Estructura del modelo | 71 |
| Dashboard / reportes | 78 |
| Seguridad | 82 |
| Experiencia de usuario | 86 |
| Resistencia al estrés | 60 |
| Trazabilidad | 82 |
| Usabilidad operativa | 88 |
| Diseño de fórmulas | 70 |
| **Global** | **84** |

> Score subió 79 → 82 → 84 en v14: BUG-CLI-02, H-14 y los 4 BUG-PED (pedidos desde app ya funcionan end-to-end). Próximo salto: Resistencia al estrés (60) y Diseño de fórmulas (70).

---

## Primera acción al abrir una nueva sesión

1. Leer este archivo (ya lo estás haciendo)
2. Continuar con backlog según prioridad (no hay bugs críticos activos)

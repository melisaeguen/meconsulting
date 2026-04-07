# ME Consultora — Contexto del Proyecto para Claude Code

## RESUMEN DEL PROYECTO
Consultora estratégica para PYMES argentinas fundada por Melisa Eguen. 
Se construyó desde cero: sitio web público con test de diagnóstico IA, 
infraestructura cloud y app interna CRM+Copilot.

---

## INFRAESTRUCTURA

| Servicio | Detalle |
|---|---|
| **URL producción** | https://meconsulting.vercel.app |
| **Dominio** | meconsulting.com.ar (delegado a Vercel via NIC.ar) |
| **GitHub** | github.com/melisaeguen/meconsulting |
| **Vercel** | Proyecto `meconsulting`, variable `ANTHROPIC_API_KEY` configurada |
| **Google Apps Script** | https://script.google.com/macros/s/AKfycbyWvm7ncy4KnNlmdlzPfBMTAvewdSj_mfzgiajUDI6xCOzvyxoxjzeB3Q2F3fob8Qu1RA/exec |
| **Google Sheet** | "ME Consultora — Clientes" en Drive (carpeta "ME Consultora") |
| **Calendly** | https://calendly.com/melisaeguen/30min |
| **Email** | melisaeguen@gmail.com |

---

## ESTRUCTURA DEL REPOSITORIO

```
meconsulting/
├── index.html          ← Sitio público completo (landing + test + resultado)
├── vercel.json         ← Config Vercel con routes
├── package.json        ← package.json mínimo
└── api/
    └── diagnostico.js  ← Función serverless (proxy seguro a Anthropic API)
```

---

## SITIO PÚBLICO (index.html)

### Stack
HTML + JS puro, sin frameworks. Una sola página con todo incluido.

### Estructura de la landing
1. **Nav** — Soluciones | Cómo trabajamos | Tecnología AI | Quiénes somos | Comenzar hoy
2. **Hero** — "De gestionar sin datos a tomar decisiones con claridad estratégica"
3. **¿Tu negocio tiene alguno de estos síntomas?** (`#pain`) — 6 problemas + 6 soluciones correspondientes
4. **Cómo trabajamos** (`#como-trabajamos`) — Funnel de 5 pasos con precios:
   - Step 01: Test de Salud (Gratis)
   - Step 02: Sesión Estratégica (Gratis)
   - Step 03: Diagnóstico 360 (desde $160.000) — 1–2 semanas
   - Step 04: Implementación de Soluciones (desde $300.000) — 1–3 meses
   - Step 05: Partner Estratégico (desde $180.000) — mensual
5. **Quiénes somos** (`#nosotros`) — Foto Melisa en círculo + bio + LinkedIn
6. **Tecnología AI + criterio humano** (`#soluciones`) — Diferenciador IA
7. **CTA Final** — "¿Cuál es la salud real de tu negocio?"

### Diseño / Colores
- Navy: `#1b2340`
- Gold: `#c9a96e`
- Cream: `#faf9f7`
- Tipografía: Playfair Display (serif) + DM Sans

### Flujo del Test
1. **Pantalla contacto** — Nombre, empresa, email, celular, industria, descripción (todos obligatorios)
2. **15 preguntas** en 4 dimensiones (Finanzas, Operaciones, Gestión, Estrategia)
3. **Pregunta abierta** — "¿Cuál es el problema que más te está frenando AHORA?"
4. **Pantalla generating** — 4 etapas animadas
5. **Resultado** — Scorecard + diagnóstico IA + palanca principal + próximo paso recomendado + CTA Calendly
6. **Error grisado** — si falla la API, muestra secciones skeleton grisadas + botones "Intentar de nuevo" / "Agendar igualmente"

### API de Diagnóstico
- El HTML llama a `/api/diagnostico` (Vercel Function, NO directo a Anthropic)
- La función serverless en `api/diagnostico.js` agrega la API key de Anthropic (variable de entorno en Vercel)
- Modelo: `claude-sonnet-4-20250514`
- **IMPORTANTE**: Desde `file://` local da error CORS — solo funciona publicado en Vercel

### Guardado en Google Sheets
- Usa iframe+form (evita CORS desde file://)
- POST al Apps Script con campo `payload` (JSON stringificado)
- El Apps Script crea la carpeta "ME Consultora" y el Sheet automáticamente
- **PENDIENTE**: Verificar que el Apps Script esté republicado con código que lee `e.parameter.payload`

---

## APP INTERNA CRM (app-interna.html)

### Estado actual
- Archivo standalone `app-interna.html` — NO está en el repo de GitHub todavía
- Funciona con datos de muestra hardcodeados
- **PENDIENTE**: Subir al repo y configurar route en Vercel

### Funcionalidades implementadas
- **Login**: usuario `melisa` / contraseña `meconsulting2026`
- **Pipeline Kanban**: 7 columnas arrastrables:
  1. Test completado (gris)
  2. Sesión Estratégica (azul)
  3. Diagnóstico 360 (dorado)
  4. Implementación (verde)
  5. Partner estratégico (púrpura)
  6. En pausa (amarillo) — guarda `stageAnterior`
  7. Cliente perdido (rojo) — guarda `stageAnterior`
- **Perfil de cliente**: 4 tabs (Resumen, Scores, Notas, Historial)
- **Copilot IA por stage**: herramientas específicas para stages 2, 3, 4, 5
- **Chat libre** con contexto completo del cliente cargado automáticamente
- **Buscador** por nombre/empresa en el Copilot

### Pendientes de la app interna
1. **Setup Google Cloud OAuth** (ver instrucciones abajo)
2. Conectar con Google Sheets real (leer clientes del test automáticamente)
3. Subir al repo GitHub como `app.html` o `/app/index.html`
4. Configurar route en `vercel.json`

---

## PENDIENTES CRÍTICOS

### 1. Verificar diagnóstico IA en producción
El diagnóstico en Vercel usa el fallback local (buildLocalDiag) en lugar de Anthropic.
**Cómo verificar**: Vercel → proyecto meconsulting → Logs → buscar errores en `/api/diagnostico`

### 2. Republicar Apps Script
El Apps Script necesita leer el campo `payload` del form-data.
**Función doPost actualizada**:
```javascript
function doPost(e) {
  let data;
  if (e.parameter && e.parameter.payload) {
    data = JSON.parse(e.parameter.payload);
  } else {
    data = JSON.parse(e.postData.contents);
  }
  // ... resto del código
}
```
Pasos: script.google.com → Implementar → Administrar implementaciones → lápiz → Nueva versión → Implementar

### 3. Setup Google Cloud OAuth (para app interna)
1. console.cloud.google.com → Nuevo proyecto: "ME Consultora App"
2. Habilitar: Google Sheets API, Google Drive API, Google Docs API
3. Crear credenciales OAuth → Aplicación web
   - Orígenes JS: `https://meconsulting.vercel.app`, `http://localhost:3000`
   - URIs redirección: `https://meconsulting.vercel.app/app`, `http://localhost:3000/app`
4. Agregar `melisaeguen@gmail.com` como usuario de prueba
5. Guardar Client ID → agregar como variable de entorno en Vercel

### 4. Dominio meconsulting.com.ar
Delegado a Vercel via NIC.ar. Puede estar tardando en propagar.
Vercel → Settings → Domains → verificar si pasó de "Invalid" a "Valid"

---

## PERFIL DE LA USUARIA (Melisa Eguen)

- **Background**: FP&A Global Lead en Globant, ex-Accenture y Satellogic
- **Formación**: Contadora Pública (UNC), MBA (UMANRESA España), Master Finanzas Corporativas (UCC)
- **Experiencia**: +15 años en finanzas, FP&A, pricing, modelos financieros
- **LinkedIn**: https://ar.linkedin.com/in/melieguen
- **Email**: melisaeguen@gmail.com
- **Celular**: +5493513050183

### Estilo de trabajo preferido
- Respuestas directas, estratégicas y accionables
- Sin explicaciones básicas innecesarias
- Primero lógica estratégica, después acciones concretas
- Velocidad y avance del proyecto como prioridad

---

## MODELO DE NEGOCIO

**Target**: PyMEs 0–50 empleados, fundador/CEO como decisor
**Posicionamiento**: "De gestionar sin datos a tomar decisiones con claridad estratégica"

**Funnel**:
| Step | Servicio | Precio | Duración |
|---|---|---|---|
| 1 | Test de Salud | Gratis | Inmediato |
| 2 | Sesión Estratégica | Gratis | 30 min |
| 3 | Diagnóstico 360 | desde $160.000 | 1–2 semanas |
| 4 | Implementación | desde $300.000 | 1–3 meses |
| 5 | Partner Estratégico | desde $180.000 | mensual |

---

## NOTAS TÉCNICAS IMPORTANTES

- **CORS desde file://**: El test solo funciona en Vercel, no abriendo el HTML local
- **Foto de Melisa**: Incluida como base64 en el HTML (comprimida a ~9KB, 120px círculo)
- **Apps Script como backend**: Gratis, sin servidor propio, usa iframe+form para evitar CORS
- **Vercel como proxy**: La clave de Anthropic NUNCA está en el HTML — solo en variables de entorno de Vercel
- **Google Sheets estructura**: Columnas incluyen pregunta débil por dimensión y "Problema principal (pregunta abierta)"

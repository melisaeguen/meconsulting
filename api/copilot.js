// api/copilot.js
// Vercel serverless — Copilot IA para el CRM interno

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { action, stage, client, index, existingItems, currentDim } = req.body;
    if (!action || !client) return res.status(400).json({ error: 'Faltan parámetros' });

    if (action === 'pregunta_individual') {
      client.indice = index ?? 0;
      client.preguntasExistentes = existingItems || [];
      client.currentDim = currentDim || '';
    }
    if (action === 'quickwin_individual') {
      client.indice = index ?? 0;
      client.quickwinsExistentes = existingItems || [];
    }

    const prompt = buildPrompt(action, stage, client);
    if (!prompt) return res.status(400).json({ error: 'Acción no reconocida' });

    const isHeavy = ['framework', 'informe_diag', 'presentacion_diag'].includes(action);
    const isDiagSlides = action === 'presentacion_diag';
    const isSlides = action === 'presupuesto' || isDiagSlides || action === 'presupuesto_impl';
    const model = isHeavy ? 'claude-sonnet-4-20250514' : 'claude-haiku-4-5-20251001';
    const maxTokens = action === 'informe_diag' ? 4000 : (isHeavy ? 3000 : 1024);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: maxTokens,
        ...(isSlides && {
          system: 'Sos un generador de contenido para presentaciones. Respondé ÚNICAMENTE con los campos del formato solicitado. Sin texto antes ni después. Sin secciones extra.',
        }),
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic copilot error:', response.status, JSON.stringify(data));
      return res.status(response.status).json({ error: 'Error de IA' });
    }

    const raw = data.content?.[0]?.text || '';

    // Para presupuesto: ensamblar los [SLIDE] bloques acá,
    // el modelo solo generó el contenido variable
    let result = raw;
    if (action === 'presupuesto')        result = assemblePresupuesto(raw, client);
    if (action === 'presupuesto_impl')   result = assemblePresupuesto(raw, client);
    if (action === 'presentacion_diag')  result = assemblePresentacionDiag(raw, client);

    return res.status(200).json({ result });

  } catch (err) {
    console.error('Copilot handler error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
}

// ── ENSAMBLADO DE SLIDES ──────────────────────────────────────────────────────
// El modelo solo genera el contenido variable. El código arma el formato final.

function parseFields(text) {
  // Parsea un texto con secciones CLAVE: y bullets • debajo
  const result = {};
  let curKey = null;
  let buf = [];

  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const header = trimmed.match(/^([A-Z_]{2,}):\s*(.*)$/);
    if (header && !trimmed.startsWith('•')) {
      if (curKey) result[curKey] = buf.join('\n').trim();
      curKey = header[1];
      buf = header[2] ? [header[2]] : [];
    } else if (curKey) {
      buf.push(line);
    }
  }
  if (curKey) result[curKey] = buf.join('\n').trim();
  return result;
}

function assemblePresupuesto(raw, c) {
  const f       = parseFields(raw);
  const empresa = c.empresa || '';
  // Usar el precio de la calculadora directamente, no el del modelo
  const precio  = c.price ? `$${Number(c.price).toLocaleString('es-AR')}` : (f.PRECIO || '$—');

  const slides = [
    // Slide 1 — cover fijo
    `[SLIDE]\nTITLE: PRESUPUESTO DIAGNÓSTICO 360°\nSUBTITLE: ${empresa}\nTYPE: cover`,

    // Slide 2 — situación actual (variable)
    `[SLIDE]\nTITLE: Situación actual\n${f.SITUACION || ''}`,

    // Slide 3 — alertas (variable)
    `[SLIDE]\nTITLE: Principales alertas identificadas\n${f.ALERTAS || ''}`,

    // Slide 4 — incluye (100% fijo, el modelo no genera nada acá)
    `[SLIDE]\nTITLE: DIAGNÓSTICO 360° COMPLETO\nTYPE: incluye`,

    // Slide 5 — inversión (solo el precio es variable, resto fijo en Apps Script)
    `[SLIDE]\nTITLE: INVERSIÓN\nHIGHLIGHT: ${precio}\nTYPE: inversion`,
  ];

  return slides.join('\n\n');
}

function assemblePresentacionDiag(raw, c) {
  const empresa = c.empresa || '';
  const mes = new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });
  const cover = `[SLIDE]\nTYPE: cover_diag\nTITLE: DIAGNÓSTICO 360°\nSUBTITLE: ${empresa}  ·  ${mes}`;
  return cover + '\n\n' + raw.trim();
}

// ── PROMPT BUILDER ────────────────────────────────────────────────────────────
function buildPrompt(action, stage, c) {
  const dims = `Finanzas: ${c.scoreFinanzas}/100 | Operaciones: ${c.scoreOps}/100 | Gestión: ${c.scoreGestion}/100 | Estrategia: ${c.scoreEst}/100`;
  const weakest = getWeakest(c);
  const context = `
CLIENTE:
- Empresa: ${c.empresa} | Industria: ${c.industria}
- Descripción: ${c.descripcion}
- Score total: ${c.scoreTotal}/100 (${c.perfil})
- Dimensiones: ${dims}
- Dimensión más débil: ${weakest}
- Problema declarado: "${c.problema}"
- Diagnóstico IA: ${c.resumen}
- Palanca principal: ${c.palancaTitulo} — ${c.palancaDesc}`.trim();

  const prompts = {

    // ── STAGE 2: SESIÓN ESTRATÉGICA ──────────────────────────────────────────

    preguntas: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.
Tenés 10-15 minutos para hacer preguntas en una sesión estratégica. Necesitás preguntas cortas que disparen conversación.

${context}

Generá exactamente 8 preguntas: 2 por cada dimensión.
Priorizá las dimensiones más débiles del cliente.

Reglas estrictas:
- Máximo 8 palabras por pregunta
- Que inviten a hablar, no a responder sí/no
- Específicas para este cliente e industria (no genéricas)
- Sin contexto ni preámbulo — ir directo al punto

Respondé ÚNICAMENTE con este formato, sin texto antes ni después:
[Finanzas] Pregunta
[Finanzas] Pregunta
[Operaciones] Pregunta
[Operaciones] Pregunta
[Gestión] Pregunta
[Gestión] Pregunta
[Estrategia] Pregunta
[Estrategia] Pregunta`,

    pregunta_individual: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.

${context}

Ya tenés estas preguntas preparadas para la sesión:
${(c.preguntasExistentes || []).map((p, i) => `${i + 1}. ${p}`).join('\n')}

Regenerá la pregunta número ${c.indice + 1}${c.currentDim ? ` (dimensión: ${c.currentDim})` : ''} con una alternativa diferente y mejor.
Debe ser directa (máx 1 línea), específica para este cliente y su industria${c.currentDim ? `, enfocada en ${c.currentDim}` : ''}, y distinta a las demás.

Respondé SOLO con el texto de la nueva pregunta, sin número, sin corchetes, sin explicación.`,

    quickwins: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.

${context}

Generá exactamente 3 "quick wins" concretos para este cliente específico, implementables en los próximos 30 días.
Basate en los scores por dimensión y el problema declarado — no des consejos genéricos.
Cada acción debe:
- Atacar directamente uno de los puntos débiles identificados en el test
- No requerir inversión significativa ni cambios estructurales grandes
- Ser ejecutable por el dueño/CEO en su industria específica

Formato — SOLO los 3 items, sin texto adicional:
1. **[Nombre corto]**
[Qué hacer exactamente, 1-2 líneas, específico para este negocio]

2. **[Nombre corto]**
[Qué hacer exactamente, 1-2 líneas, específico para este negocio]

3. **[Nombre corto]**
[Qué hacer exactamente, 1-2 líneas, específico para este negocio]`,

    quickwin_individual: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.

${context}

Ya tenés estos quick wins preparados:
${(c.quickwinsExistentes || []).map((q, i) => `${i + 1}. ${q}`).join('\n')}

Regenerá el quick win número ${c.indice + 1} con una alternativa diferente y mejor.
Debe ser concreto, específico para su industria y distinto a los demás.

Respondé con este formato exacto (sin número):
**[Nombre corto de la acción]**
[Descripción concreta en 2 líneas máximo]`,

    // Solo genera situación y alertas — el código arma los [SLIDE] bloques con precio de la calculadora
    presupuesto: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA:
${c.transcript || '(sin transcript disponible)'}

Generá el contenido variable para una propuesta comercial del Diagnóstico 360°.

REGLAS ESTRICTAS:
- Usá la información del test Y del transcript para dar observaciones específicas y concretas de este negocio.
- Solo español. Prohibido: "pricing" (→ estrategia de precios), "data" (→ información), "roadmap" (→ hoja de ruta).
- Sin asteriscos ni negritas.
- SIEMPRE exactamente 4 bullets. Ni más, ni menos.
- SITUACION: cada bullet es un párrafo de entre 45 y 50 palabras en total.
- ALERTAS: cada bullet tiene formato "Nombre: texto". El nombre es 2-4 palabras. El texto después del nombre tiene que tener entre 42 y 46 palabras. Total del bullet (nombre + texto) = entre 45 y 50 palabras.
- Concreto y específico para este negocio. Nada genérico.

Respondé ÚNICAMENTE con este formato:

SITUACION:
• [párrafo de 45-50 palabras totales].
• [párrafo de 45-50 palabras totales].
• [párrafo de 45-50 palabras totales].
• [párrafo de 45-50 palabras totales].

ALERTAS:
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].`,

    // ── STAGE 3: DIAGNÓSTICO 360° ─────────────────────────────────────────────

    framework: `
Sos una consultora estratégica senior especializada en PyMEs argentinas.
Tu objetivo es construir un diagnóstico 360° real del negocio a través de 2 horas de entrevista con el dueño.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA (ya tuviste una primera reunión):
${c.transcript || '(sin transcript disponible)'}

LÓGICA DE LAS PREGUNTAS — MUY IMPORTANTE:
Las preguntas tienen que seguir una lógica de dos capas dentro de cada sección:
- CAPA 1 (primeras preguntas): entender la base real del negocio. No asumas nada. El test da señales pero no confirmaciones. Empezá desde lo que el dueño vive, no desde lo que vos creés que pasa.
- CAPA 2 (últimas preguntas de la sección): basándote en lo que ya sabés del test y la sesión anterior, profundizá en los puntos débiles específicos de ESTE negocio.

REGLAS DE CALIDAD:
1. Las preguntas de la Capa 1 deben ser abiertas y exploratorias. Evitá los sí/no.
2. Las preguntas de la Capa 2 deben ser más incisivas: exponer puntos ciegos, decisiones postergadas, cosas que no miden y deberían.
3. NO hagas suposiciones graves sin base. Si el score de finanzas es bajo, preguntá primero cómo manejan las finanzas antes de asumir que no pueden pagar sueldos.
4. Usá el contexto del cliente para hacer preguntas específicas de su industria y situación, no genéricas.
5. La dimensión más débil es ${weakest} — dale más preguntas y más profundidad en esa sección.
6. Tono directo, simple y conversacional. Sin academicismo ni tecnicismos.

ESTRUCTURA: 6 secciones en este orden exacto:

SECCIÓN 1 — CONTEXTO Y EVOLUCIÓN (8 preguntas)
Objetivo: entender la historia del negocio, cómo evolucionó de idea a proyecto a empresa, qué motivó al dueño, qué oportunidades o problemas encontraron, y cómo ven el negocio hoy en general.
Tipo de preguntas: narrativas, de reflexión sobre el camino recorrido y los hitos importantes.
NO hacer preguntas de dimensiones específicas (finanzas, operaciones, etc.) acá.

SECCIÓN 2 — OPERACIONES[si es la más débil: ★ MÁS DÉBIL] (8 o 12 preguntas)
Capa 1: cómo funciona el día a día, cómo se organiza el trabajo, qué herramientas usan.
Capa 2: basándote en el score de operaciones (${c.scoreOps}/100), buscá cuellos de botella y límites de escala.

SECCIÓN 3 — FINANZAS[si es la más débil: ★ MÁS DÉBIL] (8 o 12 preguntas)
Capa 1: cómo manejan las finanzas hoy, qué información tienen, cómo toman decisiones financieras.
Capa 2: basándote en el score de finanzas (${c.scoreFinanzas}/100), profundizá en rentabilidad, control de costos, precios.

SECCIÓN 4 — GESTIÓN[si aplica: ★ MÁS DÉBIL] (8 o 12 preguntas)
Capa 1: cómo está conformado el equipo, cómo se toman decisiones, cómo se organiza el dueño.
Capa 2: basándote en el score de gestión (${c.scoreGestion}/100), explorá dependencia del dueño y capacidad de delegación.

SECCIÓN 5 — ESTRATEGIA[si aplica: ★ MÁS DÉBIL] (8 o 12 preguntas)
Capa 1: hacia dónde va el negocio, qué quieren lograr, cómo se ven en el mercado.
Capa 2: basándote en el score de estrategia (${c.scoreEst}/100), detectá si hay dirección real o si se reacciona sin rumbo.

SECCIÓN 6 — CIERRE Y PRIORIZACIÓN (6 preguntas)
Objetivo: que el dueño priorice sus problemas, entienda el costo de no actuar y alinee expectativas con el diagnóstico.

FORMATO DE RESPUESTA:
- Separar cada pregunta con una línea en blanco entre una y otra.
- Separar cada sección de la siguiente con DOS líneas en blanco.
- Respondé ÚNICAMENTE con las 6 secciones y sus preguntas numeradas. Sin introducción ni cierre.`,

    informe_diag: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas. Terminaste el Diagnóstico 360° de este cliente y vas a escribir el informe completo.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA:
${c.transcript || '(sin transcript disponible)'}

${[
  c.entrevistas    ? 'NOTAS DE ENTREVISTAS:\n'         + c.entrevistas    : '',
  c.datos_internos ? 'DATOS INTERNOS RELEVADOS:\n'     + c.datos_internos : '',
  c.benchmarking   ? 'BENCHMARKING Y COMPETENCIA:\n'   + c.benchmarking   : '',
].filter(Boolean).join('\n\n')}

Generá el informe completo del Diagnóstico 360°. Todo en español, lenguaje claro y directo, sin tecnicismos. Específico para este negocio — nada genérico.

Respondé ÚNICAMENTE con este formato (no agregues texto antes ni después):

[REPORTE_EJECUTIVO]
[3-4 párrafos de síntesis ejecutiva. Qué está funcionando, qué no, y cuál es el diagnóstico general. 200-250 palabras.]

[LEAN_CANVAS]
PROBLEMA PRINCIPAL: [descripción del problema central que resuelve el negocio]
SEGMENTOS DE CLIENTES: [quiénes son sus clientes]
PROPUESTA DE VALOR: [qué valor único ofrece]
SOLUCIÓN: [cómo resuelve el problema]
CANALES: [cómo llega a sus clientes]
FUENTES DE INGRESOS: [cómo genera dinero]
ESTRUCTURA DE COSTOS: [principales costos del negocio]
MÉTRICAS CLAVE: [qué medir para saber si el negocio funciona]

[FODA]
FORTALEZAS:
• [fortaleza concreta del negocio]
• [fortaleza concreta]
• [fortaleza concreta]
• [fortaleza concreta]
DEBILIDADES:
• [debilidad concreta]
• [debilidad concreta]
• [debilidad concreta]
• [debilidad concreta]
OPORTUNIDADES:
• [oportunidad concreta del mercado]
• [oportunidad concreta]
• [oportunidad concreta]
AMENAZAS:
• [amenaza concreta]
• [amenaza concreta]
• [amenaza concreta]

[RADIOGRAFIA]
FINANZAS:
[2-3 párrafos sobre la situación financiera real: rentabilidad, flujo de caja, estructura de costos, precios. 100-120 palabras.]

OPERACIONES:
[2-3 párrafos sobre procesos, eficiencia, cuellos de botella, sistemas. 100-120 palabras.]

GESTIÓN:
[2-3 párrafos sobre estructura, roles, delegación, capacidades del equipo. 100-120 palabras.]

ESTRATEGIA:
[2-3 párrafos sobre misión, visión, posicionamiento, modelo de negocio, competencia. 100-120 palabras.]

[BENCHMARKING]
[2-3 párrafos sobre el sector, buenas prácticas de la industria y dónde está este negocio respecto al mercado. 100-120 palabras.]

[PROBLEMAS]
1. [Nombre del problema — 3-5 palabras]:
[Descripción del problema estructural real, no solo el síntoma. Qué lo causa y por qué es importante resolverlo. 60-80 palabras.]

2. [Nombre]:
[Descripción. 60-80 palabras.]

3. [Nombre]:
[Descripción. 60-80 palabras.]

4. [Nombre]:
[Descripción. 60-80 palabras.]

5. [Nombre]:
[Descripción. 60-80 palabras.]

[PLAN_ACCION]
1. [Nombre de la acción] — Plazo: [X semanas]:
[Qué hacer exactamente y por qué es la primera prioridad. Qué resultado concreto se espera. 60-80 palabras.]

2. [Nombre de la acción] — Plazo: [X semanas]:
[Descripción. 60-80 palabras.]

3. [Nombre de la acción] — Plazo: [X semanas]:
[Descripción. 60-80 palabras.]

4. [Nombre de la acción] — Plazo: [X meses]:
[Descripción. 60-80 palabras.]

5. [Nombre de la acción] — Plazo: [X meses]:
[Descripción. 60-80 palabras.]`,

    presentacion_diag: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas. Generá el contenido para la presentación de cierre del Diagnóstico 360° que le vas a mostrar al cliente.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA:
${c.transcript || '(sin transcript disponible)'}

${[
  c.entrevistas    ? 'NOTAS DE ENTREVISTAS:\n'         + c.entrevistas    : '',
  c.datos_internos ? 'DATOS INTERNOS RELEVADOS:\n'     + c.datos_internos : '',
  c.benchmarking   ? 'BENCHMARKING Y COMPETENCIA:\n'   + c.benchmarking   : '',
].filter(Boolean).join('\n\n')}

Generá el contenido para 7 slides. Todo en español, lenguaje claro y directo, sin tecnicismos. Concreto y específico para este negocio.

Respondé ÚNICAMENTE con este formato exacto, sin texto antes ni después:

[SLIDE]
TYPE: lean_canvas
PROBLEMA: [máx 20 palabras]
SEGMENTOS: [máx 15 palabras]
VALOR: [máx 20 palabras]
SOLUCION: [máx 20 palabras]
CANALES: [máx 15 palabras]
INGRESOS: [máx 15 palabras]
COSTOS: [máx 15 palabras]
METRICAS: [máx 15 palabras]

[SLIDE]
TYPE: foda
FORTALEZAS: ítem 1 | ítem 2 | ítem 3 | ítem 4
DEBILIDADES: ítem 1 | ítem 2 | ítem 3 | ítem 4
OPORTUNIDADES: ítem 1 | ítem 2 | ítem 3 | ítem 4
AMENAZAS: ítem 1 | ítem 2 | ítem 3 | ítem 4

[SLIDE]
TYPE: resumen_ejecutivo
• [bullet de 40-50 palabras sobre el estado general del negocio]
• [bullet de 40-50 palabras sobre los hallazgos principales]
• [bullet de 40-50 palabras sobre la palanca de mayor impacto]
• [bullet de 40-50 palabras sobre la urgencia de actuar]

[SLIDE]
TYPE: radiografia
FINANZAS: [2-3 líneas concretas sobre la situación financiera]
OPERACIONES: [2-3 líneas concretas sobre operaciones]
GESTION: [2-3 líneas concretas sobre gestión]
ESTRATEGIA: [2-3 líneas concretas sobre estrategia]

[SLIDE]
TYPE: problemas
• [Nombre del problema]: [descripción concisa del problema estructural, 20-25 palabras]
• [Nombre del problema]: [descripción, 20-25 palabras]
• [Nombre del problema]: [descripción, 20-25 palabras]
• [Nombre del problema]: [descripción, 20-25 palabras]
• [Nombre del problema]: [descripción, 20-25 palabras]

[SLIDE]
TYPE: plan_accion
• [Acción 1] — [descripción concisa] | Plazo: [X semanas]
• [Acción 2] — [descripción concisa] | Plazo: [X semanas]
• [Acción 3] — [descripción concisa] | Plazo: [X semanas]
• [Acción 4] — [descripción concisa] | Plazo: [X meses]
• [Acción 5] — [descripción concisa] | Plazo: [X meses]

[SLIDE]
TYPE: proximos_pasos
• [próximo paso concreto 1]
• [próximo paso concreto 2]
• [próximo paso concreto 3]
• [próximo paso concreto 4]`,

    presupuesto_impl: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA:
${c.transcript || '(sin transcript disponible)'}

SOLUCIONES A IMPLEMENTAR (definidas para este cliente):
${c.soluciones || '(no especificadas)'}

TIEMPO ESTIMADO DE DISEÑO E IMPLEMENTACIÓN: ${c.meses || '?'} meses

Generá el contenido variable para la propuesta comercial del Diseño e Implementación de Soluciones.
Usá las soluciones listadas arriba y el tiempo estimado como referencia concreta.

REGLAS ESTRICTAS:
- Usá toda la información disponible del cliente para dar observaciones específicas y concretas.
- Solo español. Prohibido: "pricing" (→ estrategia de precios), "data" (→ información), "roadmap" (→ hoja de ruta).
- Sin asteriscos ni negritas.
- SIEMPRE exactamente 4 bullets. Ni más, ni menos.
- SITUACION: cada bullet es un párrafo de entre 45 y 50 palabras en total.
- ALERTAS: cada bullet tiene formato "Nombre: texto". El nombre es 2-4 palabras. El texto después del nombre tiene que tener entre 42 y 46 palabras. Total del bullet (nombre + texto) = entre 45 y 50 palabras.
- Concreto y específico para este negocio. Nada genérico.

Respondé ÚNICAMENTE con este formato:

SITUACION:
• [párrafo de 45-50 palabras totales].
• [párrafo de 45-50 palabras totales].
• [párrafo de 45-50 palabras totales].
• [párrafo de 45-50 palabras totales].

ALERTAS:
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].
• [Nombre corto 2-4 palabras]: [texto de 42-46 palabras. Total bullet = 45-50 palabras].`,

    // ── STAGE 4: IMPLEMENTACIÓN ───────────────────────────────────────────────
    hitos: `
Sos Melisa Eguen, consultora estratégica. Estás en la etapa de implementación con este cliente.

${context}

Generá un plan de hitos detallado para el proyecto de implementación.
Asumí una duración de 8 a 12 semanas.

Formato de respuesta:

OBJETIVO GENERAL DE LA IMPLEMENTACIÓN
[1 párrafo específico]

HITOS POR SEMANA

Semana 1-2: [Nombre del hito]
• Actividades: [lista]
• Entregable: [qué queda documentado/implementado]
• Responsable: [Melisa / Cliente / Conjunto]

[Continuar con el resto de semanas...]

INDICADORES DE PROGRESO
[KPIs semanales a medir]

RIESGOS Y MITIGACIÓN
[2-3 riesgos principales con plan de contingencia]

Respondé directamente sin introducción ni cierre.`,

    informe: `
Sos Melisa Eguen, consultora estratégica. Generá un template de informe de avance mensual para este cliente.

${context}

El informe debe mostrar:
- Progreso vs. hitos planificados
- Métricas clave (con placeholders para los valores reales)
- Obstáculos y cómo se resolvieron
- Plan para el próximo mes

Formato de respuesta — generá directamente el template listo para completar:

═══════════════════════════════════════
INFORME DE AVANCE — [MES AÑO]
${(c.empresa||'').toUpperCase()}
ME Consultora | Melisa Eguen
═══════════════════════════════════════

RESUMEN EJECUTIVO
[2-3 líneas de estado general — COMPLETAR]

HITOS DEL MES
✅ Completado: [listar]
🔄 En progreso: [listar]
❌ Pendiente: [listar con motivo]

MÉTRICAS CLAVE
[Indicadores relevantes para este cliente con columnas Objetivo / Real / Desvío]

OBSTÁCULOS Y RESOLUCIÓN
[Tabla de obstáculos encontrados y cómo se manejaron]

FOCO PRÓXIMO MES
[3-5 prioridades concretas]

PRÓXIMA REUNIÓN
[Fecha y agenda sugerida]`,

    // ── STAGE 5: PARTNER ESTRATÉGICO ─────────────────────────────────────────
    mensual: `
Sos Melisa Eguen, consultora estratégica. Generá el resumen mensual de resultados para este cliente en relación de Partner Estratégico.

${context}

Generá el template del resumen mensual ejecutivo listo para completar:

═══════════════════════════════════════
RESUMEN MENSUAL — [MES AÑO]
${(c.empresa||'').toUpperCase()} × ME CONSULTORA
═══════════════════════════════════════

DASHBOARD DE SALUD DEL NEGOCIO
[Scores actuales por dimensión — COMPLETAR vs. baseline del diagnóstico]

LOGROS DEL MES
• [Logro 1 con impacto cuantificado]
• [Logro 2...]

DECISIONES ESTRATÉGICAS TOMADAS
[Tabla: Decisión / Contexto / Resultado esperado]

ALERTAS Y OPORTUNIDADES
🔴 Alertas: [si hay]
🟡 Monitoreo: [temas a vigilar]
🟢 Oportunidades: [quick wins identificados]

FOCO DEL PRÓXIMO MES
[Top 3 prioridades estratégicas]

REFLEXIÓN ESTRATÉGICA
[1 párrafo de evaluación de tendencia general del negocio]`,

    upsell: `
Sos Melisa Eguen, consultora estratégica con relación de Partner Estratégico con este cliente.

${context}

Analizá las oportunidades de expansión de la relación y generá recomendaciones estratégicas de próximos pasos.

Formato de respuesta:

ESTADO ACTUAL DE LA RELACIÓN
[Evaluación de 2-3 líneas de la madurez del cliente y el valor entregado]

OPORTUNIDADES IDENTIFICADAS

Expansión de scope actual:
• [Área donde podés profundizar trabajo existente]
• [Nueva dimensión a incorporar]

Nuevos proyectos:
• [Proyecto concreto que agrega valor — con justificación]
• [Otro proyecto si aplica]

Referidos potenciales:
• [Análisis de si este cliente puede recomendar ME Consultora en su red]

PROPUESTA DE CONVERSACIÓN
[Cómo plantear estas oportunidades en la próxima reunión mensual, sin ser invasivo]

INDICADORES QUE JUSTIFICAN LA EXPANSIÓN
[2-3 métricas o señales que respaldan la propuesta]

Respondé directamente sin introducción ni cierre.`,
  };

  return prompts[action] || null;
}

function getWeakest(c) {
  const dims = [
    { name: 'Finanzas',    score: c.scoreFinanzas || 0 },
    { name: 'Operaciones', score: c.scoreOps      || 0 },
    { name: 'Gestión',     score: c.scoreGestion  || 0 },
    { name: 'Estrategia',  score: c.scoreEst      || 0 },
  ];
  return dims.sort((a, b) => a.score - b.score)[0].name;
}

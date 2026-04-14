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

    const isSlides = ['prediag', 'presupuesto'].includes(action);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: isSlides ? 1024 : 1024,
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

    // Para prediag y presupuesto: ensamblar los [SLIDE] bloques acá,
    // el modelo solo generó el contenido variable
    let result = raw;
    if (action === 'prediag')      result = assemblePrediag(raw, client);
    if (action === 'presupuesto')  result = assemblePresupuesto(raw, client);

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

function assemblePrediag(raw, c) {
  const f       = parseFields(raw);
  const empresa = c.empresa || '';
  const precio  = c.price ? `$${Number(c.price).toLocaleString('es-AR')}` : '$—';

  const slides = [
    // Slide 1 — cover fijo
    `[SLIDE]\nTITLE: PRE-DIAGNÓSTICO 360°\nSUBTITLE: ${empresa}\nTYPE: cover`,

    // Slide 2 — situación actual (variable)
    `[SLIDE]\nTITLE: Situación actual\n${f.SITUACION || ''}`,

    // Slide 3 — alertas (variable)
    `[SLIDE]\nTITLE: Principales alertas identificadas\n${f.ALERTAS || ''}`,

    // Slide 4 — incluye (100% fija)
    `[SLIDE]\nTITLE: DIAGNÓSTICO 360° COMPLETO\nTYPE: incluye`,

    // Slide 5 — inversión (precio de la calculadora)
    `[SLIDE]\nTITLE: INVERSIÓN\nHIGHLIGHT: ${precio}\nTYPE: inversion`,
  ];

  return slides.join('\n\n');
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

    // Solo genera SITUACION y ALERTAS — el código arma los 5 slides
    prediag: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA:
${c.transcript || '(sin transcript disponible)'}

Generá el contenido para 2 secciones de un Pre-Diagnóstico 360°.

REGLAS ESTRICTAS:
- Solo español. Sin tecnicismos. Lenguaje claro y directo.
- Prohibido: "pricing", "data", "roadmap", "performance", "feedback", "revenue".
- Sin asteriscos ni negritas.
- SIEMPRE exactamente 4 bullets. Ni más, ni menos.
- Cada bullet: un párrafo continuo de EXACTAMENTE entre 35 y 40 palabras. Contá las palabras antes de escribir.
- En ALERTAS, el "Nombre alerta:" NO cuenta como palabras — el texto que viene después tiene que tener entre 35 y 40 palabras.
- Concreto y específico para este negocio. Nada genérico.

Respondé ÚNICAMENTE con este formato:

SITUACION:
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].

ALERTAS:
• [Nombre alerta 1]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].
• [Nombre alerta 2]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].
• [Nombre alerta 3]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].
• [Nombre alerta 4]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].`,

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
- Cada bullet: un párrafo continuo de EXACTAMENTE entre 35 y 40 palabras. Contá las palabras antes de escribir.
- En ALERTAS, el "Nombre alerta:" NO cuenta como palabras — el texto que viene después tiene que tener entre 35 y 40 palabras.
- Concreto y específico para este negocio. Nada genérico.

Respondé ÚNICAMENTE con este formato:

SITUACION:
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].
• [párrafo continuo. contá: debe tener entre 35 y 40 palabras exactas].

ALERTAS:
• [Nombre alerta 1]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].
• [Nombre alerta 2]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].
• [Nombre alerta 3]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].
• [Nombre alerta 4]: [texto después del label: entre 35 y 40 palabras exactas. el label no cuenta].`,

    // ── STAGE 3: DIAGNÓSTICO 360° ─────────────────────────────────────────────
    estructura: `
Sos Melisa Eguen, consultora estratégica. Estás planificando el Diagnóstico 360° para este cliente.

${context}

Generá la estructura detallada del diagnóstico a realizar. Recordá que el diagnóstico:
- Es un análisis profundo (no implementación — eso es Stage 4)
- Incluye el "qué está pasando y por qué" con algunas recomendaciones de alto nivel
- NO incluye el diseño detallado de soluciones ni el plan de implementación
- Debe ser específico para esta empresa e industria

Formato de respuesta:

OBJETIVO DEL DIAGNÓSTICO
[1 párrafo específico para este cliente]

ESTRUCTURA DE TRABAJO
Por cada una de las 4 dimensiones (Finanzas, Operaciones, Gestión, Estrategia):
**[Dimensión] — [estado: Crítico/En riesgo/Estable]**
• Qué relevar: [3-4 puntos específicos]
• Preguntas clave de diagnóstico: [2-3 preguntas]
• Herramientas a usar: [ej: análisis de estados contables, entrevistas, etc.]

ENTREGABLES DEL DIAGNÓSTICO
[Lista de 4-5 entregables concretos]

CRONOGRAMA SUGERIDO
[Plan semanal de actividades]

Respondé directamente sin introducción ni cierre.`,

    propuesta: `
Sos Melisa Eguen, consultora estratégica. Terminaste el Diagnóstico 360° y estás preparando la propuesta para la etapa de Implementación.

${context}

Generá el borrador de propuesta de implementación. Recordá que:
- La implementación diseña y ejecuta las soluciones (diferente al diagnóstico)
- Debe priorizar las 2-3 palancas de mayor impacto identificadas
- Tiene que ser alcanzable en 1-3 meses
- El precio orientativo de implementación es desde $300.000

Formato de respuesta:

SÍNTESIS DEL DIAGNÓSTICO
[3-4 líneas con los hallazgos principales]

ALCANCE DE LA IMPLEMENTACIÓN
[Qué se va a diseñar e implementar — específico para este cliente]

PALANCAS PRIORIZADAS
1. **[Palanca 1]** — [por qué es la más urgente]
2. **[Palanca 2]** — [impacto esperado]
3. **[Palanca 3]** — [si aplica]

PLAN DE TRABAJO
[Cronograma mensual de actividades]

INVERSIÓN ESTIMADA
$[rango] + IVA | Duración: [X semanas/meses]

MÉTRICAS DE ÉXITO
[3-4 KPIs que vamos a medir]

Respondé directamente sin introducción ni cierre.`,

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

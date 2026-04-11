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

    // Inject extra context for individual regeneration actions
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

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: action === 'prediag' ? 2048 : 1024,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('Anthropic copilot error:', response.status, JSON.stringify(data));
      return res.status(response.status).json({ error: 'Error de IA' });
    }

    const result = data.content?.[0]?.text || '';
    return res.status(200).json({ result });

  } catch (err) {
    console.error('Copilot handler error:', err);
    return res.status(500).json({ error: 'Error interno' });
  }
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
    prediag: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.
Estás preparando el Pre-Diagnóstico 360° en formato presentación para el cliente.

${context}

TRANSCRIPT DE LA SESIÓN ESTRATÉGICA:
${c.transcript || '(sin transcript disponible)'}

Generá exactamente 5 slides con este formato.
REGLAS ESTRICTAS:
- Empezá DIRECTO con el primer [SLIDE]. Nada de texto antes ni después de los 5 slides.
- Sin palabras en inglés ni tecnicismos. Todo en español claro y directo.
- Sin asteriscos ni formato negrita (**texto**). Texto limpio.
- Bullets cortos y concretos. Máximo 2 líneas por bullet.

[SLIDE]
TITLE: PRE-DIAGNÓSTICO 360°
SUBTITLE: ${c.empresa}
TYPE: cover

[SLIDE]
TITLE: Situación actual
• [qué está pasando hoy en este negocio — concreto, sin generalidades]
• [segunda observación específica sobre la operación o gestión]
• [la limitación principal que frena el crecimiento]

[SLIDE]
TITLE: Principales alertas identificadas
• [Nombre de la alerta 1]: [explicación en una línea, específica para este negocio]
• [Nombre de la alerta 2]: [explicación]
• [Nombre de la alerta 3]: [explicación]

[SLIDE]
TITLE: Palanca de mayor impacto
SUBTITLE: ${c.palancaTitulo || weakest}
• [por qué esta palanca es la más crítica para este negocio]
• [qué cambia concretamente en el negocio si se resuelve]

[SLIDE]
TITLE: Lo que el Diagnóstico 360° va a revelar
• [pregunta crítica 1 que quedará respondida — específica para este cliente]
• [pregunta crítica 2 — específica para su industria y situación]
• Diagnóstico completo en 1-2 semanas · desde $160.000
TYPE: cta`,

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

    presupuesto: `
Sos Melisa Eguen, consultora estratégica para PyMEs argentinas.
Tu tarifa objetivo es de $40.000/hora (pesos argentinos).

${context}

Generá exactamente 5 slides para la propuesta comercial del Diagnóstico 360°.
REGLAS ESTRICTAS:
- Empezá DIRECTO con el primer [SLIDE]. Nada de texto antes ni después de los 5 slides.
- Sin palabras en inglés ni tecnicismos. Todo en español claro y directo.
- Sin asteriscos ni formato negrita (**texto**). Texto limpio.
- Los slides 4 y 5 tienen contenido FIJO — copialo exactamente como está, solo completá los valores entre corchetes.

[SLIDE]
TITLE: PRESUPUESTO DIAGNÓSTICO 360°
SUBTITLE: ${c.empresa}
TYPE: cover

[SLIDE]
TITLE: Situación actual
• [observación concreta 1 sobre el negocio de ${c.empresa} — específica, sin generalidades]
• [observación concreta 2 sobre las limitaciones operativas o de gestión actuales]
• [el cuello de botella principal que impide el crecimiento]

[SLIDE]
TITLE: Principales alertas identificadas
• [Nombre de la alerta 1]: [explicación en una línea, específica para este negocio]
• [Nombre de la alerta 2]: [explicación]
• [Nombre de la alerta 3]: [explicación]

[SLIDE]
TITLE: DIAGNÓSTICO 360° — ¿QUÉ INCLUYE?
• Análisis profundo de las 4 dimensiones del negocio: finanzas, operaciones, gestión y estrategia
• Entrevistas en profundidad y revisión de información real del negocio
• Identificación de las 3 palancas de mayor impacto con su justificación
• Informe final con hallazgos, oportunidades y hoja de ruta priorizada
• Presentación ejecutiva de resultados

[SLIDE]
TITLE: INVERSIÓN
HIGHLIGHT: $[estimá el monto justo para ${c.empresa} entre $160.000 y $400.000 según su complejidad]
SUBTITLE: Plazo estimado: [X a Y semanas] · 3 reuniones por videoconferencia (1,5 hs c/u)
• Forma de pago: 50% adelantado · 50% previo a la entrega del informe
• Beneficio especial: si al finalizar decidís continuar con la implementación, reintegramos el 30% del valor del diagnóstico como crédito para el siguiente paso
• El diagnóstico no es un gasto: es la inversión que te permite saber exactamente dónde invertir
• Condiciones: avisar con 72 hs de anticipación para reprogramar · cancelación con al menos 1 mes de antelación`,

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
    {name:'Finanzas',    score: c.scoreFinanzas || 0},
    {name:'Operaciones', score: c.scoreOps      || 0},
    {name:'Gestión',     score: c.scoreGestion  || 0},
    {name:'Estrategia',  score: c.scoreEst      || 0},
  ];
  return dims.sort((a,b) => a.score - b.score)[0].name;
}

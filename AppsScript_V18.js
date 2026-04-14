// ═══════════════════════════════════════════════════════════════════
// ME Consultora — Apps Script V18
// ─ saveFromTest : lee payload nested (scores.finanzas, etc.) + ID auto-increment
// ─ doGet        : actions getClients | getCRM
// ─ doPost       : actions saveFromTest | updateCRM
// ─ Slides V17   : sin cambios
// ═══════════════════════════════════════════════════════════════════

// ── CONFIG ──────────────────────────────────────────────────────────
const FOLDER_NAME  = 'ME Consultora';
const SHEET_NAME   = 'ME Consultora — Clientes';
const CRM_TAB      = 'ME Consultora — CRM';
const CLIENTS_TAB  = 'Clientes';

// ── ENTRY POINTS ────────────────────────────────────────────────────
function doGet(e) {
  const action = (e && e.parameter && e.parameter.action) || 'getClients';

  if (action === 'getClients') {
    return jsonResponse(getClients());
  }
  if (action === 'getCRM') {
    return jsonResponse(readCRM());
  }
  return jsonResponse({ error: 'Acción no reconocida: ' + action });
}

function doPost(e) {
  try {
    let data;
    if (e.parameter && e.parameter.payload) {
      data = JSON.parse(e.parameter.payload);
    } else {
      data = JSON.parse(e.postData.contents);
    }

    const action = data.action || 'saveFromTest';

    if (action === 'saveFromTest') {
      return jsonResponse(saveFromTest(data));
    }
    if (action === 'updateCRM') {
      return jsonResponse(updateCRM(data));
    }
    if (action === 'createPresupuesto') {
      return jsonResponse(createPresupuesto(data));
    }

    return jsonResponse({ error: 'Acción no reconocida: ' + action });
  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// ── HELPERS ─────────────────────────────────────────────────────────
function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function tryParse(val, fallback) {
  if (val === null || val === undefined || val === '') return fallback;
  if (typeof val === 'object') return val;
  try { return JSON.parse(val); } catch(e) { return fallback; }
}

// ── SHEET HELPERS ───────────────────────────────────────────────────
function getOrCreateSheet() {
  // Find or create spreadsheet in Drive folder
  const files = DriveApp.getFilesByName(SHEET_NAME);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  // Create in folder
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  const ss = SpreadsheetApp.create(SHEET_NAME);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  return ss;
}

function getClientsTab(ss) {
  let tab = ss.getSheetByName(CLIENTS_TAB);
  if (!tab) {
    tab = ss.insertSheet(CLIENTS_TAB);
    // Write headers
    tab.getRange(1, 1, 1, 28).setValues([[
      'ID','Fecha','Nombre','Empresa','Email','Celular','Industria','Descripción del negocio',
      'Score Total','Perfil',
      'Score Finanzas','Score Operaciones','Score Gestión','Score Estrategia',
      'Pregunta débil — Finanzas','Puntaje',
      'Pregunta débil — Operaciones','Puntaje',
      'Pregunta débil — Gestión','Puntaje',
      'Pregunta débil — Estrategia','Puntaje',
      'Diagnóstico resumen','Palanca — Título','Palanca — Descripción','Frase cierre',
      'Problema principal (pregunta abierta)','Estado sesión'
    ]]);
  }
  return tab;
}

function getOrCreateCRMTab(ss) {
  let tab = ss.getSheetByName(CRM_TAB);
  if (!tab) {
    tab = ss.insertSheet(CRM_TAB);
    tab.getRange(1, 1, 1, 9).setValues([[
      'clientId','email','stage','stageAnterior','notes','transcript','aiOutputs','updatedAt','links'
    ]]);
  }
  return tab;
}

// ── GET CLIENTS ─────────────────────────────────────────────────────
function getClients() {
  const ss  = getOrCreateSheet();
  const tab = getClientsTab(ss);
  const data = tab.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ── READ CRM ────────────────────────────────────────────────────────
function readCRM() {
  const ss  = getOrCreateSheet();
  const tab = getOrCreateCRMTab(ss);
  const data = tab.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(h => String(h).trim());
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = row[i]; });
    return obj;
  });
}

// ── SAVE FROM TEST ──────────────────────────────────────────────────
// Reads nested payload structure sent by index.html
function saveFromTest(data) {
  const ss  = getOrCreateSheet();
  const tab = getClientsTab(ss);

  // ── Auto-increment ID ──
  const lastRow = tab.getLastRow();
  let nextId = 1;
  if (lastRow >= 2) {
    const ids = tab.getRange(2, 1, lastRow - 1, 1).getValues()
      .map(r => parseInt(r[0]) || 0)
      .filter(n => !isNaN(n));
    nextId = ids.length > 0 ? Math.max(...ids) + 1 : 1;
  }

  // ── Parse nested payload ──
  const scores     = data.scores     || {};
  const pDebil     = data.preguntaDebil || {};
  const diagnostico = data.diagnostico || {};

  const fecha = new Date().toLocaleDateString('es-AR');

  const row = [
    nextId,                                                   // ID
    fecha,                                                    // Fecha
    data.nombre        || '',                                 // Nombre
    data.empresa       || '',                                 // Empresa
    data.email         || '',                                 // Email
    data.celular       || '',                                 // Celular
    data.industria     || '',                                 // Industria
    data.descripcion   || '',                                 // Descripción del negocio
    data.scoreTotal    || 0,                                  // Score Total
    data.perfil        || '',                                 // Perfil
    scores.finanzas    || data.scoreFinanzas    || 0,         // Score Finanzas
    scores.operaciones || data.scoreOperaciones || 0,         // Score Operaciones
    scores.gestion     || data.scoreGestion     || 0,         // Score Gestión
    scores.estrategia  || data.scoreEstrategia  || 0,         // Score Estrategia
    (pDebil.finanzas    || {}).pregunta || data.preguntaDebilFinanzas    || '',  // Pregunta débil — Finanzas
    (pDebil.finanzas    || {}).score    || '',                                   // Puntaje
    (pDebil.operaciones || {}).pregunta || data.preguntaDebilOps        || '',  // Pregunta débil — Operaciones
    (pDebil.operaciones || {}).score    || '',                                   // Puntaje
    (pDebil.gestion     || {}).pregunta || data.preguntaDebilGestion    || '',  // Pregunta débil — Gestión
    (pDebil.gestion     || {}).score    || '',                                   // Puntaje
    (pDebil.estrategia  || {}).pregunta || data.preguntaDebilEstrategia || '',  // Pregunta débil — Estrategia
    (pDebil.estrategia  || {}).score    || '',                                   // Puntaje
    diagnostico.resumen      || data.resumen       || '',    // Diagnóstico resumen
    diagnostico.palancaTitulo || data.palancaTitulo || '',   // Palanca — Título
    diagnostico.palancaDesc   || data.palancaDesc   || '',   // Palanca — Descripción
    diagnostico.fraseCierre   || data.fraseCierre   || '',   // Frase cierre
    data.problemaAbierto || '',                               // Problema principal
    'Test completado',                                        // Estado sesión
  ];

  tab.appendRow(row);
  return { ok: true, id: nextId };
}

// ── UPDATE CRM ──────────────────────────────────────────────────────
// Upsert row — escribe por nombre de columna, no por posición
// (soporta cualquier orden de columnas en el sheet existente)
function updateCRM(data) {
  const ss  = getOrCreateSheet();
  const tab = getOrCreateCRMTab(ss);

  const clientId = String(data.clientId || data.email || '');
  const email    = String(data.email || '');

  if (!clientId) return { error: 'clientId requerido' };

  const all     = tab.getDataRange().getValues();
  const headers = all[0].map(h => String(h).trim());
  const idxId   = headers.indexOf('clientId');

  // Buscar fila por clientId (primary key numérico)
  let rowIndex = -1;
  for (let i = 1; i < all.length; i++) {
    if (String(all[i][idxId]) === clientId) {
      rowIndex = i + 1; // 1-based
      break;
    }
  }

  // Mapa de valores por nombre de columna
  // Soporta tanto "transcript" como "transcripts" (nombre viejo/nuevo)
  const values = {
    clientId:      clientId,
    email:         email,
    stage:         data.stage         || 1,
    stageAnterior: data.stageAnterior || '',
    notes:         data.notes         || '',
    transcript:    data.transcript    || '',
    transcripts:   data.transcript    || '',
    aiOutputs:     data.aiOutputs ? JSON.stringify(data.aiOutputs) : '',
    updatedAt:     data.updatedAt || new Date().toISOString(),
    links:         data.links ? JSON.stringify(data.links) : '',
  };

  // Armar array en el orden exacto de las columnas existentes
  const rowData = headers.map(h => values[h] !== undefined ? values[h] : '');

  if (rowIndex > 1) {
    tab.getRange(rowIndex, 1, 1, rowData.length).setValues([rowData]);
  } else {
    tab.appendRow(rowData);
  }

  return { ok: true };
}

// ════════════════════════════════════════════════════════════════════
// GOOGLE SLIDES — Presupuesto Diagnóstico 360°
// V17 code — unchanged
// ════════════════════════════════════════════════════════════════════

const W = 720, H = 405;
const C_NAVY  = { red: 27/255,  green: 35/255,  blue: 64/255  };
const C_GOLD  = { red: 201/255, green: 169/255, blue: 110/255 };
const C_CREAM = { red: 250/255, green: 249/255, blue: 247/255 };
const C_WHITE = { red: 1, green: 1, blue: 1 };

function sText(slide, text, x, y, w, h, opts) {
  // Google Slides API falla con string vacío — usar espacio como fallback
  const safeText = (text !== undefined && text !== null && String(text).trim() !== '') ? String(text) : ' ';
  const tb = slide.insertTextBox(safeText, x, y, w, h);
  const tf = tb.getText();
  const ts = tf.getTextStyle();
  ts.setFontFamily('DM Sans');
  ts.setFontSize(opts.size || 14);
  ts.setBold(opts.bold !== undefined ? opts.bold : false);
  if (opts.color) ts.setForegroundColor(opts.color);
  if (opts.italic) ts.setItalic(true);
  const align = opts.align || 'LEFT';
  tf.getParagraphs().forEach(p => {
    const pStyle = p.getRange().getParagraphStyle();
    if (align === 'CENTER')         pStyle.setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);
    else if (align === 'RIGHT')     pStyle.setParagraphAlignment(SlidesApp.ParagraphAlignment.RIGHT);
    else if (align === 'JUSTIFIED') pStyle.setParagraphAlignment(SlidesApp.ParagraphAlignment.JUSTIFIED);
    else                            pStyle.setParagraphAlignment(SlidesApp.ParagraphAlignment.START);
  });
  tb.setContentAlignment(SlidesApp.ContentAlignment.TOP);
  const s = tb.getBorder().getLineFill().setSolidFill(0, 0, 0, 0); // transparent border
  tb.getFill().setSolidFill(0, 0, 0, 0);
  return tb;
}

function addFooter(slide) {
  sText(slide, 'ME CONSULTORA  ·  meconsulting.com.ar', 0, H - 22, W, 18,
    { size: 8, bold: false, color: '#8899bb', align: 'CENTER' });
}

function buildCoverSlide(slide, title, subtitle) {
  slide.getBackground().setSolidFill(C_NAVY.red * 255, C_NAVY.green * 255, C_NAVY.blue * 255);
  sText(slide, title, 44, H/2 - 114, W - 88, 96,
    { size: 36, bold: true, color: '#faf9f7', align: 'LEFT' });
  const ln = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 44, H/2 - 12, 44, 2);
  ln.getFill().setSolidFill(C_GOLD.red * 255, C_GOLD.green * 255, C_GOLD.blue * 255);
  ln.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);
  if (subtitle) {
    sText(slide, subtitle, 44, H/2 + 2, W - 88, 30,
      { size: 18, bold: false, color: '#c9a96e', align: 'LEFT' });
  }
  addFooter(slide);
}

function buildContentSlide(slide, title, bullets, empresa) {
  slide.getBackground().setSolidFill(C_CREAM.red * 255, C_CREAM.green * 255, C_CREAM.blue * 255);
  // Gold accent top bar
  const bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, W, 4);
  bar.getFill().setSolidFill(C_GOLD.red * 255, C_GOLD.green * 255, C_GOLD.blue * 255);
  bar.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);
  // Title — empresa on same line: "Situación actual — ATLAS GARDEN"
  const fullTitle = empresa ? title + ' — ' + empresa : title;
  sText(slide, fullTitle, 26, 14, W - 34, 28,
    { size: 16, bold: true, color: '#1b2340', align: 'LEFT' });
  const top = 66; // bullets start lower, leaving breathing room under title
  const rowH = 60; // fixed: 3 lines at 11.5pt + small gap between bullets
  bullets.forEach(function(b, i) {
    const txt = typeof b === 'string' ? b : (b.text || String(b));
    sText(slide, '•  ' + txt, 26, top + i * rowH, W - 52, 56,
      { size: 11.5, bold: false, color: '#1b2340', align: 'JUSTIFIED' });
  });
  addFooter(slide);
}

function buildIncluyeSlide(slide) {
  slide.getBackground().setSolidFill(C_NAVY.red * 255, C_NAVY.green * 255, C_NAVY.blue * 255);

  // Centered gold title
  sText(slide, 'DIAGNÓSTICO 360° COMPLETO', 26, 18, W - 52, 28,
    { size: 18, bold: true, color: '#c9a96e', align: 'CENTER' });

  // Gold divider line (centered)
  const div = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, W/2 - 60, 52, 120, 2);
  div.getFill().setSolidFill(C_GOLD.red * 255, C_GOLD.green * 255, C_GOLD.blue * 255);
  div.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);

  // Intro para 1
  sText(slide,
    'El Diagnóstico 360° es el paso fundamental para diseñar soluciones reales e implementarlas con impacto. ' +
    'Sin un diagnóstico riguroso, cualquier intervención es un disparo a ciegas.',
    60, 62, W - 120, 44,
    { size: 10.5, bold: false, color: '#faf9f7', align: 'CENTER' });

  // Intro para 2
  sText(slide,
    'Profundizamos todo lo que apareció en la sesión, validamos con información real del negocio e ' +
    'identificamos las palancas concretas de mejora con su plan de acción.',
    60, 108, W - 120, 40,
    { size: 10.5, bold: false, color: '#faf9f7', align: 'CENTER' });

  // "¿Qué incluye?" label — left aligned
  sText(slide, '¿Qué incluye?', 44, 162, 200, 20,
    { size: 12, bold: true, color: '#c9a96e', align: 'LEFT' });

  // 2×2 grid — gold bullet dot + text, no boxes
  const items = [
    'Análisis de las 4 dimensiones del negocio:\nFinanzas · Operaciones · Gestión · Estrategia',
    'Entrevistas en profundidad con el equipo\nclave y revisión de información existente',
    'Identificación de las palancas de mayor\nimpacto y cuellos de botella prioritarios',
    'Informe ejecutivo con hallazgos y\nrecomendaciones accionables para el siguiente paso',
  ];
  const colW  = (W - 88) / 2;
  const gridTop = 186;
  const rowH    = 82;
  items.forEach(function(txt, idx) {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const cx  = 44 + col * (colW + 8);
    const cy  = gridTop + row * rowH;
    // Gold bullet circle
    const dot = slide.insertShape(SlidesApp.ShapeType.ELLIPSE, cx, cy + 6, 8, 8);
    dot.getFill().setSolidFill(C_GOLD.red * 255, C_GOLD.green * 255, C_GOLD.blue * 255);
    dot.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);
    // Item text
    sText(slide, txt, cx + 16, cy, colW - 20, rowH - 8,
      { size: 10.5, bold: false, color: '#faf9f7', align: 'LEFT' });
  });

  addFooter(slide);
}

function buildInversionSlide(slide, total) {
  slide.getBackground().setSolidFill(C_NAVY.red * 255, C_NAVY.green * 255, C_NAVY.blue * 255);

  // Gold centered title
  sText(slide, 'INVERSIÓN', 26, 20, W - 52, 22,
    { size: 14, bold: true, color: '#c9a96e', align: 'CENTER' });

  // Large white price
  const priceStr = '$' + Number(total).toLocaleString('es-AR');
  sText(slide, priceStr, 26, 48, W - 52, 72,
    { size: 56, bold: true, color: '#faf9f7', align: 'CENTER' });

  // Gold italic value phrase
  sText(slide,
    'El diagnóstico no es un gasto: es la inversión que te permite saber exactamente dónde mejorar.',
    80, 130, W - 160, 30,
    { size: 10.5, bold: false, color: '#c9a96e', italic: true, align: 'CENTER' });

  // Gold divider
  const div = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, W/2 - 80, 168, 160, 1);
  div.getFill().setSolidFill(C_GOLD.red * 255, C_GOLD.green * 255, C_GOLD.blue * 255);
  div.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);

  // Payment terms
  sText(slide, 'Forma de pago: 50% al inicio · 50% al entregable final',
    60, 178, W - 120, 22,
    { size: 10.5, bold: false, color: '#faf9f7', align: 'CENTER' });

  // Credit offer
  sText(slide,
    'Si al finalizar el Diagnóstico decidís continuar con el diseño e implementación de soluciones, ' +
    'te reintegramos el 30% del valor del Diagnóstico como crédito para el siguiente paso.',
    60, 210, W - 120, 44,
    { size: 10, bold: false, color: '#faf9f7', align: 'CENTER' });

  // Cancellation
  sText(slide, 'Cancelación: aviso con 72 hs · baja con 1 mes de anticipación',
    60, 262, W - 120, 20,
    { size: 10, bold: false, color: '#8899bb', align: 'CENTER' });

  addFooter(slide);
}

function buildSituacionSlide(slide, title, situacion, alertas) {
  slide.getBackground().setSolidFill(C_CREAM.red * 255, C_CREAM.green * 255, C_CREAM.blue * 255);
  const bar = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 0, 0, W, 4);
  bar.getFill().setSolidFill(C_GOLD.red * 255, C_GOLD.green * 255, C_GOLD.blue * 255);
  bar.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);
  sText(slide, title, 26, 14, W - 34, 28,
    { size: 16, bold: true, color: '#1b2340', align: 'LEFT' });

  // Situación block
  sText(slide, 'SITUACIÓN ACTUAL', 26, 50, 200, 16,
    { size: 9, bold: true, color: '#8a8a8a', align: 'LEFT' });
  const sitBox = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, 26, 68, W/2 - 36, H - 110);
  sitBox.getFill().setSolidFill(240, 237, 232);
  sitBox.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);
  sText(slide, situacion || '', 34, 76, W/2 - 52, H - 126,
    { size: 11, bold: false, color: '#1b2340', align: 'LEFT' });

  // Alertas block
  const ax = W/2 + 10;
  sText(slide, 'ALERTAS CLAVE', ax, 50, 200, 16,
    { size: 9, bold: true, color: '#dc2626', align: 'LEFT' });
  const alertList = Array.isArray(alertas) ? alertas : (typeof alertas === 'string' ? alertas.split('\n').filter(Boolean) : []);
  const aBox = slide.insertShape(SlidesApp.ShapeType.RECTANGLE, ax, 68, W/2 - 36, H - 110);
  aBox.getFill().setSolidFill(254, 226, 226);
  aBox.getBorder().getLineFill().setSolidFill(0, 0, 0, 0);
  alertList.slice(0, 5).forEach((a, i) => {
    const txt = typeof a === 'string' ? a : (a.text || String(a));
    sText(slide, '⚠  ' + txt, ax + 8, 76 + i * 40, W/2 - 52, 36,
      { size: 11, bold: false, color: '#7f1d1d', align: 'LEFT' });
  });
  addFooter(slide);
}

// ── SLIDE CONTENT PARSER ─────────────────────────────────────────────
function parseSlideBlocks(content) {
  // Split the [SLIDE] text format into structured objects
  const blocks = (content || '').split(/\[SLIDE\]/g).filter(b => b.trim());
  return blocks.map(function(block) {
    var lines   = block.trim().split('\n');
    var slide   = { title: '', type: '', subtitle: '', highlight: '', bullets: [] };
    lines.forEach(function(line) {
      var t = line.trim();
      if (!t) return;
      var m;
      if ((m = t.match(/^TITLE:\s*(.+)$/)))     { slide.title     = m[1]; return; }
      if ((m = t.match(/^TYPE:\s*(.+)$/)))       { slide.type      = m[1].toLowerCase(); return; }
      if ((m = t.match(/^SUBTITLE:\s*(.+)$/)))   { slide.subtitle  = m[1]; return; }
      if ((m = t.match(/^HIGHLIGHT:\s*(.+)$/)))  { slide.highlight = m[1]; return; }
      if ((m = t.match(/^HORAS:\s*(.+)$/)))      { slide.horas     = m[1]; return; }
      if ((m = t.match(/^TOTAL:\s*(.+)$/)))      { slide.total     = m[1]; return; }
      if (t.charAt(0) === '\u2022') {
        // bullet line: strip the • and optional space
        slide.bullets.push(t.replace(/^\u2022\s*/, ''));
      }
    });
    return slide;
  });
}

// ── CREATE PRESUPUESTO ───────────────────────────────────────────────
function createPresupuesto(data) {
  const empresa = data.empresa || 'Cliente';
  const mes     = data.mes     || new Date().toLocaleDateString('es-AR', { month: 'long', year: 'numeric' });

  // Parse slide blocks from assembled content
  const slideBlocks = parseSlideBlocks(data.content || '');

  const findByTitle = function(keyword) {
    return slideBlocks.find(function(s) {
      return s.title.toLowerCase().indexOf(keyword.toLowerCase()) !== -1;
    }) || {};
  };
  const findByType = function(type) {
    return slideBlocks.find(function(s) { return s.type === type; }) || {};
  };

  const situacionSlide = findByTitle('situaci');   // "Situación actual"
  const alertasSlide   = findByTitle('alerta');    // "Principales alertas"
  const inversionSlide = findByType('inversion');

  // Horas y total: prefer explicit data fields, fall back to content parse
  const horas = data.horas || 0;
  let total   = data.total  || 0;
  if (!total && inversionSlide.highlight) {
    total = parseInt(inversionSlide.highlight.replace(/[^0-9]/g, ''), 10) || 0;
  }

  const pres = SlidesApp.create('Diagnóstico 360° — ' + empresa + ' — ' + mes);
  pres.getSlides().forEach(function(s) { s.remove(); });

  // Slide 1: Cover
  const s1 = pres.appendSlide();
  buildCoverSlide(s1, 'PRESUPUESTO\nDIAGNÓSTICO 360°', empresa + '  ·  ' + mes);

  // Slide 2: Situación actual — full-width AI bullets
  const s2 = pres.appendSlide();
  buildContentSlide(s2, 'Situación actual', situacionSlide.bullets || [], empresa);

  // Slide 3: Alertas — full-width AI bullets
  const s3 = pres.appendSlide();
  buildContentSlide(s3, 'Principales alertas identificadas', alertasSlide.bullets || [], empresa);

  // Slide 4: Qué incluye (navy grid)
  const s4 = pres.appendSlide();
  buildIncluyeSlide(s4);

  // Slide 5: Inversión
  const s5 = pres.appendSlide();
  buildInversionSlide(s5, total);

  // Move to ME Consultora folder
  const folders = DriveApp.getFoldersByName(FOLDER_NAME);
  const folder  = folders.hasNext() ? folders.next() : DriveApp.createFolder(FOLDER_NAME);
  DriveApp.getFileById(pres.getId()).moveTo(folder);

  return { ok: true, url: pres.getUrl(), id: pres.getId() };
}

// ── TEST FUNCTION (run manually in editor) ───────────────────────────
function testSlides() {
  const result = createPresupuesto({
    empresa: 'Atlas Garden',
    nombre:  'Juan Pérez',
    mes:     'abril de 2026',
    horas:   12,
    total:   480000,
    slides: [
      {
        type: 'SITUACION',
        content: 'Atlas Garden es una empresa de paisajismo con 8 años de trayectoria. ' +
          'Actualmente enfrenta dificultades en la gestión del flujo de caja y la rentabilidad por proyecto. ' +
          'La facturación creció un 30% pero la rentabilidad neta cayó al 8%.'
      },
      {
        type: 'ALERTAS',
        bullets: [
          'Flujo de caja negativo en temporada baja (noviembre–febrero)',
          'Sin sistema de costos por proyecto — pricing subjetivo',
          'Dependencia crítica del dueño: el 90% de las decisiones pasan por él',
          'Sin KPIs de seguimiento — gestión reactiva',
        ]
      },
      {
        type: 'ALCANCE',
        bullets: [
          'Análisis de rentabilidad por proyecto y tipo de cliente',
          'Mapeo de flujo de caja y estacionalidad del negocio',
          'Diagnóstico del proceso comercial y de ejecución de obras',
          'Revisión de estructura organizacional y delegación',
          'Identificación de las 3 palancas de crecimiento más rentables',
        ]
      }
    ]
  });
  Logger.log(result.url);
}

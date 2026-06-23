// ================================================================
// degusta_script_v20.gs — Sistema ERP Degusta
// v20: + captura PÚBLICA de ubicación de clientes (accion=ubicacion,
//      SIN token) → cola de revisión UBICACIONES_PENDIENTES.
//      Aditivo: NO cambia nada de Cocina/Envíos. Diana aprueba a mano.
// v19: + telefono del cliente en vista=repartidor (para el botón
//      "Contactar cliente" — llamada / WhatsApp en la app). (22/06/2026)
// v18: + total en vista=repartidor (col Y), accion=pago,
//      LOG_PAGOS (auditoría de cambios de pago), repartidores
//      desde CONFIG!B20:B25. (19/06/2026)
//
// REQUIERE Script Properties (Configuración del proyecto → Propiedades del script):
//   API_TOKEN = token de la API
//   SHEET_ID  = ID del Google Sheet
// (Movidos desde código hardcodeado para no exponerlos en el repo público.)
// ================================================================

const SPREADSHEET_ID = PropertiesService.getScriptProperties().getProperty('SHEET_ID') || '';
const TOKEN_ESPERADO = PropertiesService.getScriptProperties().getProperty('API_TOKEN') || '';

// Índices (0-based desde col B) usados en actualizarResumenDiario
const COL_FECHA   = 0;   // B
const COL_HORA    = 1;   // C
const COL_CLIENTE = 2;   // D
const COL_TOTAL   = 23;  // Y
const COL_PAGO    = 24;  // Z
const COL_ESTADO  = 25;  // AA

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function fmtHora(v)  { return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'HH:mm')       : String(v||''); }
function fmtFecha(v) { return (v instanceof Date) ? Utilities.formatDate(v, Session.getScriptTimeZone(), 'dd/MM/yyyy') : String(v||''); }

// ── Dashboard: trigger cada minuto (sin cambios vs v17.1) ──────
function actualizarResumenDiario() {
  try {
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const SHEET_PEDIDOS   = ss.getSheetByName('PEDIDOS');
    const SHEET_DASHBOARD = ss.getSheetByName('DASHBOARD');
    if (!SHEET_PEDIDOS || !SHEET_DASHBOARD) return;
    const lastRow = SHEET_PEDIDOS.getLastRow();
    if (lastRow < 2) return;
    const data = SHEET_PEDIDOS.getRange('B2:AA' + lastRow).getValues();
    const resumenPorFecha = {};
    for (var i = 0; i < data.length; i++) {
      const fila = data[i];
      const cliente = fila[COL_CLIENTE];
      if (!cliente || cliente === '') continue;
      const fecha = fila[COL_FECHA];
      var fechaObj;
      if (typeof fecha === 'object' && fecha instanceof Date) { fechaObj = fecha; }
      else if (typeof fecha === 'number') { fechaObj = new Date((fecha - 25569) * 86400 * 1000); }
      else continue;
      const fechaKey = Utilities.formatDate(fechaObj, 'America/El_Salvador', 'dd/MM/yyyy');
      if (!resumenPorFecha[fechaKey]) {
        resumenPorFecha[fechaKey] = { fecha:fechaObj, pedidos:0, ventasTotal:0, efectivo:0, transferencia:0, porCobrar:0 };
      }
      const estado     = fila[COL_ESTADO];
      const metodoPago = fila[COL_PAGO];
      const total      = fila[COL_TOTAL];
      if (estado !== 'Cancelado') {
        resumenPorFecha[fechaKey].pedidos += 1;
        const totalNum = typeof total === 'number' ? total : 0;
        resumenPorFecha[fechaKey].ventasTotal += totalNum;
        if (metodoPago === 'Efectivo')       resumenPorFecha[fechaKey].efectivo      += totalNum;
        else if (metodoPago === 'Transferencia') resumenPorFecha[fechaKey].transferencia += totalNum;
        else resumenPorFecha[fechaKey].porCobrar += totalNum;
      }
    }
    const hoy = new Date();
    const hace6Dias = new Date(hoy); hace6Dias.setDate(hace6Dias.getDate() - 6);
    const ultimos7Dias = [];
    for (var i = 0; i < 7; i++) {
      const d = new Date(hace6Dias); d.setDate(d.getDate() + i);
      const key = Utilities.formatDate(d, 'America/El_Salvador', 'dd/MM/yyyy');
      ultimos7Dias.push({ fecha:key, datos:resumenPorFecha[key] || { fecha:d, pedidos:0, ventasTotal:0, efectivo:0, transferencia:0, porCobrar:0 } });
    }
    const output = [];
    for (var i = 0; i < ultimos7Dias.length; i++) {
      const item  = ultimos7Dias[i];
      const datos = item.datos;
      const ticketProm = datos.pedidos > 0 ? datos.ventasTotal / datos.pedidos : 0;
      output.push([ item.fecha, datos.pedidos, datos.ventasTotal, ticketProm, datos.efectivo ]);
    }
    SHEET_DASHBOARD.getRange('A23:E29').setValues(output);
    SHEET_DASHBOARD.getRange('A23:A29').setNumberFormat('dd/MM/yyyy');
    SHEET_DASHBOARD.getRange('B23:B29').setNumberFormat('0');
    SHEET_DASHBOARD.getRange('C23:C29').setNumberFormat('$#,##0.00');
    SHEET_DASHBOARD.getRange('D23:D29').setNumberFormat('$#,##0.00');
    SHEET_DASHBOARD.getRange('E23:E29').setNumberFormat('$#,##0.00');
  } catch(error) {
    Logger.log('Error en actualizarResumenDiario: ' + error.message);
  }
}
function pruebaDashboard() { actualizarResumenDiario(); }

// ══════════════════════════════════════════════════════════════
function doGet(e) {
  try {
    const accionParam = (e.parameter || {}).accion || '';

    // ── Acción PÚBLICA (sin token): captura de ubicación del cliente ──
    // Es el ÚNICO endpoint sin token. Solo agrega a la cola de revisión
    // UBICACIONES_PENDIENTES; jamás escribe en CLIENTES ni en otra hoja.
    if (accionParam === 'ubicacion') {
      const dRaw = (e.parameter || {}).d || '{}';
      let dataUbi;
      try { dataUbi = JSON.parse(dRaw); } catch(err) { return jsonResponse({ ok:false, error:'JSON invalido' }); }
      return registrarUbicacionPendiente(dataUbi);
    }

    const token = (e.parameter || {}).token || (e.parameter || {}).t;
    if (token !== TOKEN_ESPERADO) return jsonResponse({ ok:false, error:'Token invalido' });
    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);

    if (accionParam === 'cliente') {
      const dRaw = (e.parameter || {}).d || '{}';
      let dataCli;
      try { dataCli = JSON.parse(dRaw); } catch(err) { return jsonResponse({ ok:false, error:'JSON invalido' }); }
      return registrarCliente(dataCli);
    }

    if (accionParam === 'pedido') {
      const dRaw = (e.parameter || {}).d || '{}';
      let dataPed;
      try { dataPed = JSON.parse(dRaw); } catch(err) { return jsonResponse({ ok:false, error:'JSON invalido' }); }
      return registrarPedido(dataPed);
    }

    if (accionParam === 'estado') {
      const dRaw = (e.parameter || {}).d || '{}';
      let dataEst;
      try { dataEst = JSON.parse(dRaw); } catch(err) { return jsonResponse({ ok:false, error:'JSON invalido' }); }
      return cambiarEstadoPedido(dataEst);
    }

    if (accionParam === 'pago') {
      const dRaw = (e.parameter || {}).d || '{}';
      let dataPago;
      try { dataPago = JSON.parse(dRaw); } catch(err) { return jsonResponse({ ok:false, error:'JSON invalido' }); }
      return cambiarMetodoPago(dataPago);
    }

    const vista = (e.parameter || {}).vista || '';

    if (vista === 'cocina') {
      const sh   = ss.getSheetByName('PEDIDOS');
      const last = sh.getLastRow();
      if (last < 2) return jsonResponse({ ok:true, pedidos:[] });
      const rows = sh.getRange(2, 1, last-1, 33).getValues();
      const out  = [];
      rows.forEach(function(r) {
        const cliente = String(r[3]||'').trim();
        const est     = String(r[26]||'').trim();
        if (!cliente) return;
        if (est !== 'Preparando') return;
        out.push({ id:String(r[0]||'').trim(), uuid:String(r[32]||'').trim(),
          fecha:fmtFecha(r[1]), hora:fmtHora(r[2]), cliente:cliente,
          plato1:String(r[4]||''),  cant1:r[5],
          plato2:String(r[6]||''),  cant2:r[7],
          plato3:String(r[8]||''),  cant3:r[9],
          extra1:String(r[10]||''), cantE1:r[11],
          extra2:String(r[12]||''), cantE2:r[13],
          extra3:String(r[14]||''), cantE3:r[15],
          metodoPago:String(r[25]||''), estado:est,
          notaCocina:String(r[27]||''),
          delivery:Number(r[31])||0 });
      });
      return jsonResponse({ ok:true, pedidos:out });
    }

    if (vista === 'repartidor') {
      const sh   = ss.getSheetByName('PEDIDOS');
      const last = sh.getLastRow();
      if (last < 2) return jsonResponse({ ok:true, pedidos:[] });
      const rows = sh.getRange(2, 1, last-1, 33).getValues();
      const cli  = ss.getSheetByName('CLIENTES').getRange('B2:D200').getValues();
      const dirPorNombre = {};
      const telPorNombre = {};
      cli.forEach(function(c) {
        var n = String(c[0]||'').trim().toLowerCase();
        if (n) { dirPorNombre[n] = String(c[2]||'').trim();   // col D
                 telPorNombre[n] = String(c[1]||'').trim(); } // col C
      });
      const out = [];
      rows.forEach(function(r) {
        const cliente = String(r[3]||'').trim();
        const est     = String(r[26]||'').trim();
        if (!cliente || est !== 'En camino') return;
        out.push({ id:String(r[0]||'').trim(), uuid:String(r[32]||'').trim(),
          fecha:fmtFecha(r[1]), hora:fmtHora(r[2]), cliente:cliente,
          plato1:String(r[4]||''),  cant1:r[5],
          plato2:String(r[6]||''),  cant2:r[7],
          plato3:String(r[8]||''),  cant3:r[9],
          metodoPago:String(r[25]||''), estado:est,
          total:Number(r[24])||0,                              // col Y (fórmula, solo lectura)
          notaEntrega:String(r[29]||''),                       // col AD
          direccion:dirPorNombre[cliente.toLowerCase()] || '',
          telefono:telPorNombre[cliente.toLowerCase()] || '',  // col C de CLIENTES
          delivery:Number(r[31])||0 });
      });
      return jsonResponse({ ok:true, pedidos:out });
    }

    // ── Catálogo ────────────────────────────────────────────
    const platosRaw = ss.getSheetByName('BASE_PLATOS').getRange('A2:F50').getValues();
    const platos = platosRaw
      .filter(function(r){ const d = String(r[4]||'').trim().toLowerCase(); return r[0] && (d==='si'||d==='sí'); })
      .map(function(r){ return { nombre:String(r[1]||'').trim(), precio:Number(r[2])||0, categoria:String(r[3]||'').trim() }; });

    const extrasRaw = ss.getSheetByName('BASE_EXTRAS').getRange('B2:D20').getValues();
    const extras = extrasRaw
      .filter(function(r){ const d = String(r[2]||'').trim().toLowerCase(); return r[0] && (d==='si'||d==='sí'); })
      .map(function(r){ return { nombre:String(r[0]||'').trim(), precio:Number(r[1])||0 }; });

    const cfg = ss.getSheetByName('CONFIG');
    const metodosPago = cfg.getRange('B5:B6').getValues().flat()
      .map(function(v){ return String(v||'').trim(); }).filter(Boolean);
    const estados = cfg.getRange('B8:B12').getValues().flat()
      .map(function(v){ return String(v||'').trim(); }).filter(Boolean);
    const repartidores = cfg.getRange('B20:B25').getValues().flat()
      .map(function(v){ return String(v||'').trim(); }).filter(Boolean);

    const clientes = ss.getSheetByName('CLIENTES').getRange('B2:B100').getValues().flat()
      .filter(function(v){ return v && String(v).trim(); });

    return jsonResponse({ ok:true, platos:platos, extras:extras,
      metodosPago:metodosPago, estados:estados, clientes:clientes, repartidores:repartidores });

  } catch(err) {
    return jsonResponse({ ok:false, error:err.message });
  }
}

function doPost(e) {
  try {
    const params = e.parameter || {};
    const token  = params.token || params.t || '';
    if (token !== TOKEN_ESPERADO) return jsonResponse({ ok:false, error:'Token invalido' });
    const raw  = params.d || (e.postData && e.postData.contents) || '{}';
    const data = JSON.parse(raw);
    const accion = data.accion || params.accion || '';
    if (accion === 'cliente') return registrarCliente(data);
    if (accion === 'estado')  return cambiarEstadoPedido(data);
    if (accion === 'pago')    return cambiarMetodoPago(data);
    return registrarPedido(data);
  } catch(err) {
    return jsonResponse({ ok:false, error:err.message });
  }
}

// ── Cambiar estado (cocina → en camino → entregado) ──────────
function cambiarEstadoPedido(p) {
  const uuid       = String(p.uuid  || '').trim();
  const id         = String(p.id    || '').trim();
  const nuevoEstado = String(p.estado || '').trim();
  if (!nuevoEstado) return jsonResponse({ ok:false, error:'Falta el estado' });
  if (!uuid && !id) return jsonResponse({ ok:false, error:'Falta identificador del pedido' });
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('PEDIDOS');
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) { return jsonResponse({ ok:false, error:'Sistema ocupado' }); }
  try {
    const last = sh.getLastRow();
    if (last < 2) return jsonResponse({ ok:false, error:'No hay pedidos' });
    const ids   = sh.getRange(2, 1,  last-1, 1).getValues();
    const uuids = sh.getRange(2, 33, last-1, 1).getValues();
    let fila = -1;
    if (uuid) { for (var i=0; i<uuids.length; i++) { if (String(uuids[i][0]||'').trim()===uuid) { fila=i+2; break; } } }
    if (fila===-1 && id) { for (var j=0; j<ids.length; j++) { if (String(ids[j][0]||'').trim()===id) { fila=j+2; break; } } }
    if (fila===-1) return jsonResponse({ ok:false, error:'Pedido no encontrado' });
    sh.getRange(fila, 27).setValue(nuevoEstado);   // col AA
    return jsonResponse({ ok:true, fila:fila, estado:nuevoEstado });
  } finally { lock.releaseLock(); }
}

// ── Cambiar método de pago + LOG_PAGOS ───────────────────────
function cambiarMetodoPago(p) {
  const uuid       = String(p.uuid       || '').trim();
  const id         = String(p.id         || '').trim();
  const nuevoMetodo = String(p.metodoPago || '').trim();
  const repartidor  = String(p.repartidor || '').trim();
  if (!nuevoMetodo)  return jsonResponse({ ok:false, error:'Falta el método de pago' });
  if (!repartidor)   return jsonResponse({ ok:false, error:'Falta el repartidor' });
  if (!uuid && !id)  return jsonResponse({ ok:false, error:'Falta identificador del pedido' });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh = ss.getSheetByName('PEDIDOS');
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) { return jsonResponse({ ok:false, error:'Sistema ocupado' }); }
  try {
    const last = sh.getLastRow();
    if (last < 2) return jsonResponse({ ok:false, error:'No hay pedidos' });
    const ids   = sh.getRange(2, 1,  last-1, 1).getValues();
    const uuids = sh.getRange(2, 33, last-1, 1).getValues();
    let fila = -1;
    if (uuid) { for (var i=0; i<uuids.length; i++) { if (String(uuids[i][0]||'').trim()===uuid) { fila=i+2; break; } } }
    if (fila===-1 && id) { for (var j=0; j<ids.length; j++) { if (String(ids[j][0]||'').trim()===id) { fila=j+2; break; } } }
    if (fila===-1) return jsonResponse({ ok:false, error:'Pedido no encontrado' });

    // Leer fila completa (33 cols, índices 0-based desde col A)
    const row            = sh.getRange(fila, 1, 1, 33).getValues()[0];
    const pedidoId       = String(row[0]||'').trim();   // A
    const cliente        = String(row[3]||'').trim();   // D
    const total          = Number(row[24])||0;           // Y (fórmula protegida — solo lectura)
    const metodoAnterior = String(row[25]||'').trim();  // Z

    if (metodoAnterior === nuevoMetodo) {
      return jsonResponse({ ok:false, error:'El método de pago ya es ' + nuevoMetodo });
    }

    // 1. Actualizar método de pago en col Z (26, 1-indexed)
    sh.getRange(fila, 26).setValue(nuevoMetodo);

    // 2. Registrar en LOG_PAGOS (crear hoja si no existe)
    const ahora = new Date();
    var logSh = ss.getSheetByName('LOG_PAGOS');
    if (!logSh) {
      logSh = ss.insertSheet('LOG_PAGOS');
      logSh.getRange(1, 1, 1, 8).setValues([['Fecha/Hora','ID','UUID','Cliente','Repartidor','Pago anterior','Pago nuevo','Total']]);
      logSh.getRange(1, 1, 1, 8).setFontWeight('bold');
    }
    const logFila = logSh.getLastRow() + 1;
    logSh.getRange(logFila, 1, 1, 8).setValues([[ahora, pedidoId, uuid||id, cliente, repartidor, metodoAnterior, nuevoMetodo, total]]);
    logSh.getRange(logFila, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    logSh.getRange(logFila, 8).setNumberFormat('$#,##0.00');

    return jsonResponse({ ok:true, metodoAnterior:metodoAnterior, metodoNuevo:nuevoMetodo, repartidor:repartidor });
  } finally { lock.releaseLock(); }
}

// ── Captura PÚBLICA de ubicación → cola de revisión ──────────
// Endpoint público (sin token). Por seguridad SOLO hace APPEND a la hoja
// UBICACIONES_PENDIENTES, con límites de longitud y validación mínima.
// Diana revisa y aprueba a mano; nada llega a CLIENTES sin su visto bueno.
function registrarUbicacionPendiente(p) {
  function clip(v, n) {
    var s = String(v == null ? '' : v).trim().slice(0, n);
    if (/^[=+\-@]/.test(s)) s = "'" + s;   // anti formula-injection: fuerza texto literal en el Sheet
    return s;
  }
  const nombre     = clip(p.nombre, 80);
  const telefono   = clip(p.telefono, 25);
  const empresa    = clip(p.empresa, 100);    // nombre de empresa/edificio (vacío en casas)
  const direccion  = clip(p.direccion, 150);  // dirección escrita (respaldo del pin)
  const referencia = clip(p.referencia, 250);
  const tipo       = clip(p.tipo, 20);         // "Casa" u "Oficina"

  var lat = parseFloat(p.lat), lng = parseFloat(p.lng);
  var coords = '', mapsLink = '';
  if (!isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
    lat = Math.round(lat * 1e6) / 1e6;
    lng = Math.round(lng * 1e6) / 1e6;
    coords   = lat + ',' + lng;
    mapsLink = 'https://www.google.com/maps?q=' + lat + ',' + lng;
  }

  if (!nombre || !telefono)              return jsonResponse({ ok:false, error:'Falta nombre o telefono' });
  if (!coords && !direccion && !empresa) return jsonResponse({ ok:false, error:'Falta la ubicacion (pin del mapa o direccion)' });

  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) { return jsonResponse({ ok:false, error:'Sistema ocupado' }); }
  try {
    var sh = ss.getSheetByName('UBICACIONES_PENDIENTES');
    if (!sh) {
      sh = ss.insertSheet('UBICACIONES_PENDIENTES');
      sh.getRange(1, 1, 1, 10).setValues([[
        'Recibido', 'Tipo', 'Nombre', 'Telefono', 'Empresa / edificio',
        'Dirección', 'Referencia', 'Coordenadas', 'Mapa', 'Estado'
      ]]);
      sh.getRange(1, 1, 1, 10).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    const fila = sh.getLastRow() + 1;
    sh.getRange(fila, 1, 1, 10).setValues([[
      new Date(), tipo, nombre, telefono, empresa, direccion, referencia, coords, mapsLink, 'Pendiente'
    ]]);
    sh.getRange(fila, 1).setNumberFormat('dd/MM/yyyy HH:mm');
    return jsonResponse({ ok:true });
  } catch(err) {
    Logger.log('registrarUbicacionPendiente ERROR: ' + (err && err.stack ? err.stack : err));
    return jsonResponse({ ok:false, error:'No se pudo guardar' });
  } finally { lock.releaseLock(); }
}

// ── Registrar cliente ────────────────────────────────────────
function registrarCliente(p) {
  const nombre    = String(p.nombre    || '').trim();
  const telefono  = String(p.telefono  || '').trim();
  const direccion = String(p.direccion || '').trim();
  const notas     = String(p.notas     || '').trim();
  if (!nombre || !telefono || !direccion) {
    return jsonResponse({ ok:false, error:'Nombre, telefono y direccion son obligatorios' });
  }
  const telNorm = telefono.replace(/\D/g,'').slice(-8);
  const ss  = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh  = ss.getSheetByName('CLIENTES');
  const lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(e) { return jsonResponse({ ok:false, error:'Sistema ocupado' }); }
  try {
    const datos = sh.getRange('A2:F200').getValues();
    if (telNorm) {
      for (var i=0; i<datos.length; i++) {
        var t = String(datos[i][2]||'').replace(/\D/g,'').slice(-8);
        if (t && t===telNorm) {
          return jsonResponse({ ok:false, duplicado:true, motivo:'telefono', error:'Ese telefono ya esta registrado',
            cliente:{ id:String(datos[i][0]||''), nombre:String(datos[i][1]||''),
              telefono:String(datos[i][2]||''), direccion:String(datos[i][3]||''), notas:String(datos[i][5]||'') } });
        }
      }
    }
    for (var k=0; k<datos.length; k++) {
      if (String(datos[k][1]||'').trim().toLowerCase() === nombre.toLowerCase()) {
        return jsonResponse({ ok:false, duplicado:true, motivo:'nombre', error:'Cliente ya existe: ' + nombre,
          cliente:{ id:String(datos[k][0]||''), nombre:String(datos[k][1]||''),
            telefono:String(datos[k][2]||''), direccion:String(datos[k][3]||''), notas:String(datos[k][5]||'') } });
      }
    }
    const ids = datos.map(function(r){ return r[0]; }).filter(function(v){ return v; });
    let maxNum = 0;
    ids.forEach(function(id){ var m = String(id).match(/^CLI-(\d+)$/); if (m) maxNum = Math.max(maxNum, parseInt(m[1],10)); });
    const nuevoID = 'CLI-' + String(maxNum+1).padStart(3,'0');
    const fila = [nuevoID, nombre, telefono, direccion, '', notas, '', 0, 0, 'Nuevo'];
    sh.getRange(ids.length+2, 1, 1, fila.length).setValues([fila]);
    return jsonResponse({ ok:true, id:nuevoID, nombre:nombre });
  } finally { lock.releaseLock(); }
}

// ── Registrar pedido ─────────────────────────────────────────
function registrarPedido(p) {
  const ss   = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sh   = ss.getSheetByName('PEDIDOS');
  const lock = LockService.getScriptLock();
  try { lock.waitLock(15000); } catch(e) { return jsonResponse({ ok:false, error:'Sistema ocupado' }); }
  try {
    const uuid = String(p.uuid||'').trim();
    const colA = sh.getRange('A2:A1001').getValues();
    const colD = sh.getRange('D2:D1001').getValues();
    const colG = sh.getRange('AG2:AG1001').getValues();
    if (uuid) {
      for (var i=0; i<colG.length; i++) {
        if (String(colG[i][0]||'').trim()===uuid) return jsonResponse({ ok:true, duplicado:true, uuid:uuid });
      }
    }
    var maxId = 0;
    for (var i=0; i<colA.length; i++) {
      var n = parseInt(String(colA[i][0]||'').replace(/\D/g,''), 10);
      if (!isNaN(n) && n>0 && n<1000) maxId = Math.max(maxId, n);
    }
    const id = String(maxId+1).padStart(3,'0');
    var ultData = 1;
    for (var i=0; i<colD.length; i++) {
      if (String(colD[i][0]||'').trim()!=='') ultData = i+2;
    }
    const row = ultData+1;
    const now = new Date();
    function num(v){ var n = parseFloat(v); return isNaN(n) ? '' : n; }
    function w(col, value){ sh.getRange(row, col).setValue(value); }
    sh.getRange(row,1).setNumberFormat('@').setValue(id);
    var soloFecha = new Date(now.getFullYear(), now.getMonth(), now.getDate());  // fecha sin hora
    sh.getRange(row,2).setNumberFormat('dd/MM/yyyy').setValue(soloFecha);        // B: SOLO fecha (sin hora → el dashboard suma bien por fecha)
    sh.getRange(row,3).setNumberFormat('HH:mm').setValue(now);                   // C: hora
    sh.getRange(row,4,1,13).setValues([[
      String(p.cliente||'').trim(),
      String(p.plato1||''), num(p.cant1),
      String(p.plato2||''), p.plato2 ? num(p.cant2) : '',
      String(p.plato3||''), p.plato3 ? num(p.cant3) : '',
      String(p.extra1||''), p.extra1 ? num(p.cantE1) : '',
      String(p.extra2||''), p.extra2 ? num(p.cantE2) : '',
      String(p.extra3||''), p.extra3 ? num(p.cantE3) : ''
    ]]);
    w(26, String(p.metodoPago||p.pago||''));               // Z  Pago
    w(27, String(p.estado||'Preparando'));                  // AA Estado
    w(28, String(p.notaCocina||p.nota||p.obs||''));         // AB Nota cocina
    // AC (Timestamp): NO se escribe. La columna tiene una fórmula protegida
    // que lo autogenera desde B (fecha) y C (hora). Escribirla rompía el
    // guardado por ser celda protegida (perdía productos, pago y estado).
    w(30, String(p.notaEntrega||''));                       // AD Nota entrega
    w(32, num(p.delivery)||0);                              // AF Delivery
    w(33, uuid);                                            // AG UUID
    return jsonResponse({ ok:true, id:id, uuid:uuid, timestamp:now.toISOString() });
  } catch(err) {
    Logger.log('registrarPedido ERROR: ' + (err && err.stack ? err.stack : err));
    return jsonResponse({ ok:false, error:'No se pudo guardar el pedido: ' + (err && err.message ? err.message : err) });
  } finally { lock.releaseLock(); }
}

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const lark = require('@larksuiteoapi/node-sdk');

const app = express();
const PORT = process.env.PORT || 2026;

app.use(cors({ origin: process.env.ALLOWED_ORIGIN || '*' }));
app.use(express.json());
app.use(express.static(__dirname));

// ===== Page Routes =====

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ✨ Route สำหรับเปิดหน้าฟอร์มจองคิว
app.get('/booking', (_req, res) => {
  res.sendFile(path.join(__dirname, 'booking.html'));
});

// ✨ Route สำหรับเปิดหน้าจองคิว SUITCUBE (ระบบใหม่)
app.get('/queue', (_req, res) => {
  res.sendFile(path.join(__dirname, 'suitcube_booking.html'));
});

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => { 
    const ext = path.extname(file.originalname);
    const randomStr = Math.random().toString(36).substring(2, 10);
    cb(null, `${Date.now()}-${randomStr}${ext}`);
  }
});

const upload = multer({ storage });

const requiredEnv = ['LARK_APP_ID', 'LARK_APP_SECRET', 'LARK_APP_TOKEN', 'LARK_TABLE_ID'];

function checkEnv() {
  const missing = requiredEnv.filter(k => !process.env[k]);
  if (missing.length) {
    throw new Error(`ยังไม่ได้ตั้งค่า .env: ${missing.join(', ')}`);
  }
}

const larkClient = new lark.Client({
  appId: process.env.LARK_APP_ID,
  appSecret: process.env.LARK_APP_SECRET,
  domain: lark.Domain.Lark,
  loggerLevel: lark.LoggerLevel.warn
});

// ✨ เพิ่มระบบจองคิว SUITCUBE — endpoint ใหม่ POST /api/suitcube
// ใช้ larkClient ตัวเดียวกับด้านบน ไม่กระทบโค้ดเดิม (/submit-sales, /api/booking ฯลฯ) เลย
const registerSuitcubeApi = require('./suitcube-api');
registerSuitcubeApi(app, larkClient);

// ✨ resolve wiki token → real bitable app_token
let cachedAppToken = null;

async function resolveAppToken() {
  if (cachedAppToken) return cachedAppToken;

  const wikiToken = process.env.LARK_APP_TOKEN;

  try {
    const res = await larkClient.wiki.v2.space.getNode({
      params: { token: wikiToken }
    });

    if (res.data?.node?.obj_token) {
      console.log(`✅ Wiki token resolved: ${wikiToken} → ${res.data.node.obj_token}`);
      cachedAppToken = res.data.node.obj_token;
      return cachedAppToken;
    }
  } catch (err) {
    console.warn('⚠️  Cannot resolve as wiki node, using as-is:', err.message);
  }

  cachedAppToken = wikiToken;
  return cachedAppToken;
}

// ✨ ดึง schema ของ table มา cache เพื่อกรองฟิลด์ที่ไม่มีจริง
let cachedFieldSchema = null;

async function getTableFields() {
  if (cachedFieldSchema) return cachedFieldSchema;

  const appToken = await resolveAppToken();
  try {
    const res = await larkClient.bitable.appTableField.list({
      path: {
        app_token: appToken,
        table_id: process.env.LARK_TABLE_ID
      },
      params: { page_size: 100 }
    });

    const items = res.data?.items || [];
    const map = {};
    items.forEach(f => {
      map[f.field_name] = {
        type: f.type,
        ui_type: f.ui_type,
        is_primary: f.is_primary || false
      };
    });

    console.log('📋 Table schema loaded. Fields:', Object.keys(map).length);
    console.log('📋 Field names:', Object.keys(map).join(' | '));
    const primary = items.find(f => f.is_primary);
    if (primary) {
      console.log(`🔑 Primary field: "${primary.field_name}" (type=${primary.type}, ui_type=${primary.ui_type})`);
    }

    cachedFieldSchema = map;
    return map;
  } catch (err) {
    console.warn('⚠️  Cannot load table schema:', err.message);
    return {};
  }
}

// ===== Helpers =====

function numberValue(value) {
  const n = Number(String(value ?? '').replace(/,/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function boolValue(value) {
  return value === 'on' || value === true || value === 'true' || value === '1';
}

function safeJsonArray(value) {
  try {
    return value ? JSON.parse(value) : [];
  } catch {
    return [];
  }
}

function dateToTimestamp(dateStr) {
  if (!dateStr) return null;
  // YYYY-MM-DD → ตีความเป็น local midnight
  const ts = new Date(dateStr + 'T00:00:00').getTime();
  return Number.isFinite(ts) ? ts : null;
}

// ===== Upload files =====

async function uploadMediaToLarkBase(file) {
  if (!file) return null;

  const appToken = await resolveAppToken();
  const isImage = file.mimetype?.startsWith('image/');
  const parentType = isImage ? 'bitable_image' : 'bitable_file';

  console.log('📤 Uploading file:', {
    file_name: file.originalname,
    parent_type: parentType,
    size: file.size
  });

  try {
    const res = await larkClient.drive.media.uploadAll({
      data: {
        file_name: file.originalname,
        parent_type: parentType,
        parent_node: appToken,
        size: file.size,
        file: fs.createReadStream(file.path)
      }
    });

    console.log('✅ File uploaded, token:', res.file_token);
    // ลบไฟล์ temp
    fs.unlink(file.path, () => {});
    return res.file_token;
  } catch (err) {
    const detail = err.response?.data || err.message || JSON.stringify(err);
    throw new Error(`อัปโหลดไฟล์เข้า Lark ไม่สำเร็จ: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
  }
}

async function uploadFilesByField(files = []) {
  const result = {};
  for (const file of files) {
    const fileToken = await uploadMediaToLarkBase(file);
    if (!fileToken) continue;
    result[file.fieldname] = result[file.fieldname] || [];
    result[file.fieldname].push({ file_token: fileToken });
  }
  return result;
}

// ===== Build fields =====

function buildFields(body, fileMap) {
  const skuItems = safeJsonArray(body.skuItems);

  const fields = {
    'สาขา': body.branch || '',

    'QR-CODE AUTO': numberValue(body.pay_qr),
    'GHL': numberValue(body.pay_ghl),
    'เครื่องรูดบัตร TTB': numberValue(body.pay_ttb_spare),
    'We chat Alipay': numberValue(body.pay_wechat),
    'รับช่องทาง KTB': numberValue(body.pay_ktb),
    'ไทยพาณิชย์ 0198': numberValue(body.pay_scb),
    'TTB 6417': numberValue(body.pay_ttb_org),
    'เงินสด': numberValue(body.pay_cash),
    'CDS': numberValue(body.pay_CDS),
    'ยอดขายทั้งหมด': numberValue(body.totalSales),

    'เงินสดตั้งต้น': numberValue(body.cash_start),
    'เงินสดรับมา': numberValue(body.cash_received),
    'ฝากเงินสด': numberValue(body.cash_deposit),
    'เงินสดคงเหลือ': numberValue(body.cash_balance),

    'Voucher 500 คงเหลือ': numberValue(body.voucher_500),
    'Voucher 1000 คงเหลือ': numberValue(body.voucher_1000),

    'รวมรายการขายเงินสด': numberValue(body.skuTotal),
    'รายการขายเงินสด': skuItems
      .map(i => `${i.no}. SKU: ${i.sku || '-'} | Size: ${i.size || '-'} | ราคา: ${numberValue(i.price).toFixed(2)}`)
      .join('\n'),

    'หมายเหตุ': body.remarks || '',
    'ชื่อผู้บันทึก': body.recorder_name || '',

    'รับทราบนโยบายเงินสด': boolValue(body.cash_policy_ack),
    'ยืนยัน Shipment Salesforce': boolValue(body.shipment_confirmed),

    'ไฟล์สลิปฝากเงินสด': fileMap.cash_deposit_slip || [],
    'ไฟล์ภาพ Voucher': fileMap.voucher_photo || [],
    'ไฟล์แนบ GHL': fileMap.ghl_file || [],
    'ภาพถ่ายยืนยัน': fileMap.confirm_photo || [],
    'ลายเซ็น': fileMap.signature || []
  };

  // ✅ วันที่ — ชื่อฟิลด์ใน Lark Base คือ "ยอดขายวันที่"
  const dateTs = dateToTimestamp(body.sale_date);
  if (dateTs !== null) {
    fields['ยอดขายวันที่'] = dateTs;
  }

  return fields;
}

// ✨ Lark Bitable field types
const READONLY_TYPES = new Set([19, 20, 1001, 1002, 1003, 1004, 1005]);

function coerceValueByType(val, fieldType) {
  if (val === null || val === undefined) return undefined;

  switch (fieldType) {
    case 1:  // Text
    case 13: // Phone
      if (Array.isArray(val)) return val.length ? String(val.join(', ')) : undefined;
      if (typeof val === 'object') return JSON.stringify(val);
      if (val === '' || val === false) return undefined;
      return String(val);

    case 2: { // Number
      if (val === '' || val === false) return undefined;
      const n = typeof val === 'number' ? val : Number(String(val).replace(/,/g, ''));
      return Number.isFinite(n) ? n : undefined;
    }

    case 3:  // SingleSelect
      if (val === '' || val === false) return undefined;
      return String(val);

    case 4:  // MultiSelect
      if (Array.isArray(val)) return val.length ? val.map(String) : undefined;
      if (val === '' || val === false) return undefined;
      return [String(val)];

    case 5: { // DateTime
      if (val === '' || val === false) return undefined;
      const ts = typeof val === 'number' ? val : new Date(val).getTime();
      return Number.isFinite(ts) ? ts : undefined;
    }

    case 7:  // Checkbox
      if (typeof val === 'boolean') return val;
      return val === 'on' || val === 'true' || val === '1' || val === 1;

    case 15: // Hyperlink
      if (val === '' || val === false) return undefined;
      if (typeof val === 'string') return { text: val, link: val };
      return val;

    case 17: // Attachment
      if (Array.isArray(val)) return val.length ? val : undefined;
      return undefined;

    default:
      return val;
  }
}

function sanitizeFields(fields, schema) {
  const out = {};
  const skipped = [], empty = [], readonly = [], coerced = [];
  const hasSchema = Object.keys(schema).length > 0;

  for (const [key, val] of Object.entries(fields)) {
    if (hasSchema && !schema[key]) {
      skipped.push(key);
      continue;
    }

    const fieldInfo = schema[key];
    const fieldType = fieldInfo?.type;

    if (fieldType && READONLY_TYPES.has(fieldType)) {
      readonly.push(`${key}(type=${fieldType})`);
      continue;
    }

    let coercedVal = val;
    if (hasSchema && fieldType !== undefined) {
      const before = JSON.stringify(val);
      coercedVal = coerceValueByType(val, fieldType);
      const after = JSON.stringify(coercedVal);
      if (coercedVal !== undefined && before !== after) {
        coerced.push(`${key}(t${fieldType}): ${before}→${after}`);
      }
    }

    if (coercedVal === undefined || coercedVal === null || coercedVal === '') {
      empty.push(key);
      continue;
    }
    if (Array.isArray(coercedVal) && coercedVal.length === 0) {
      empty.push(key);
      continue;
    }

    out[key] = coercedVal;
  }

  if (skipped.length)  console.log('⚠️  Skipped (not in schema):', skipped.join(', '));
  if (readonly.length) console.log('⚠️  Skipped (readonly):     ', readonly.join(', '));
  if (empty.length)    console.log('⚠️  Skipped (empty):        ', empty.join(', '));
  if (coerced.length) {
    console.log('🔄 Coerced:');
    coerced.forEach(c => console.log('   ', c));
  }

  return out;
}

// ===== API Routes =====

app.get('/health', (_req, res) => {
  res.json({ ok: true, message: 'server พร้อมใช้งาน' });
});

app.get('/test-resolve', async (_req, res) => {
  try {
    const token = await resolveAppToken();
    res.json({
      ok: true,
      original: process.env.LARK_APP_TOKEN,
      resolved: token,
      isWiki: token !== process.env.LARK_APP_TOKEN
    });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ✨ ดู schema field ทั้งหมด
app.get('/test-schema', async (_req, res) => {
  try {
    cachedFieldSchema = null; // force reload
    const schema = await getTableFields();
    res.json({ ok: true, count: Object.keys(schema).length, fields: schema });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message });
  }
});

// ทดสอบ create record
app.get('/test-create', async (_req, res) => {
  try {
    const appToken = await resolveAppToken();
    const schema = await getTableFields();

    const testFields = sanitizeFields({
      'หมายเหตุ': 'TEST จาก /test-create ' + new Date().toISOString()
    }, schema);

    console.log('🧪 Test create fields:', testFields);

    const createRes = await larkClient.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: process.env.LARK_TABLE_ID
      },
      data: { fields: testFields }
    });

    console.log('Test response:', JSON.stringify(createRes, null, 2));

    if (createRes.code && createRes.code !== 0) {
      return res.status(400).json({
        ok: false,
        message: createRes.msg,
        lark_response: createRes,
        sent_fields: testFields
      });
    }

    res.json({ ok: true, response: createRes });
  } catch (err) {
    console.error('❌ Test create error:', err);
    res.status(500).json({
      ok: false,
      message: err.message,
      detail: err.response?.data || null
    });
  }
});

// ── API บันทึกยอดขาย (ระบบเดิม) ──
app.post('/submit-sales', upload.any(), async (req, res) => {
  console.log('\n========================================');
  console.log('=== SUBMIT-SALES START ===');
  console.log('========================================');

  try {
    checkEnv();

    const appToken = await resolveAppToken();
    const schema = await getTableFields();

    console.log('✅ app_token:', appToken);
    console.log('✅ table_id:', process.env.LARK_TABLE_ID);
    console.log('📁 Files received:', req.files?.length || 0);
    if (req.files?.length) {
      console.log('   Files:', req.files.map(f => `${f.fieldname}(${f.originalname})`).join(', '));
    }

    console.log('📦 Body keys received:', Object.keys(req.body).join(', '));

    // อัปโหลดไฟล์
    const fileMap = await uploadFilesByField(req.files);
    console.log('✅ Files uploaded. fileMap keys:', Object.keys(fileMap));

    // สร้าง fields
    const rawFields = buildFields(req.body, fileMap);
    console.log('📅 sale_date input:', req.body.sale_date, '→ ts:', rawFields['ยอดขายวันที่']);

    // ✨ Sanitize ตาม schema
    const fields = sanitizeFields(rawFields, schema);
    console.log('📝 Final fields count:', Object.keys(fields).length);
    console.log('📝 Final field names:', Object.keys(fields).join(', '));

    if (Object.keys(fields).length === 0) {
      throw new Error('ไม่มีข้อมูลที่จะส่ง — กรุณากรอกข้อมูลอย่างน้อย 1 ช่อง');
    }

    console.log('📨 Calling bitable.appTableRecord.create...');
    const createRes = await larkClient.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: process.env.LARK_TABLE_ID
      },
      data: { fields }
    });

    console.log('✅ CREATE RESPONSE code:', createRes.code, 'msg:', createRes.msg);

    if (createRes.code && createRes.code !== 0) {
      console.error('❌ Lark Base rejected:', createRes);
      return res.status(400).json({
        ok: false,
        message: `Lark Base error: ${createRes.msg}`,
        lark_response: createRes,
        sent_fields: fields
      });
    }

    console.log('=== SUBMIT-SALES SUCCESS ===\n');

    res.json({
      ok: true,
      record: createRes.data?.record || createRes.record
    });
  } catch (err) {
    console.error('\n❌ SUBMIT ERROR:', err.message);
    console.error('Stack:', err.stack);
    if (err.response?.data) {
      console.error('Response data:', JSON.stringify(err.response.data, null, 2));
    }
    console.error('=== SUBMIT-SALES FAILED ===\n');

    res.status(500).json({
      ok: false,
      message: err.message,
      detail: err.response?.data || null
    });
  }
});

// ── API บันทึกการจองคิว (ระบบใหม่) ──
app.post('/api/booking', async (req, res) => {
  console.log('\n========================================');
  console.log('=== BOOKING SUBMIT START ===');
  console.log('========================================');

  try {
    checkEnv();

    const { branch, service, date, time, name, phone, guestCount, note } = req.body;
    const bookingId = 'SUIT-' + Math.floor(1000 + Math.random() * 9000);

    const appToken = await resolveAppToken();
    // 💡 ถ้ามีการแยก Table ID สำหรับการจองคิวใน .env ให้ใช้ LARK_BOOKING_TABLE_ID (ถ้าไม่มีจะใช้ LARK_TABLE_ID เดิม)
    const bookingTableId = process.env.LARK_BOOKING_TABLE_ID || process.env.LARK_TABLE_ID;

    const bookingFields = {
      "Booking ID": bookingId,
      "Branch": branch || '',
      "Service": service || '',
      "Booking Date": dateToTimestamp(date),
      "Time Slot": time || '',
      "Customer Name": name || '',
      "Phone": phone || '',
      "Guest Count": Number(guestCount) || 1,
      "Note": note || '-',
      "Status": "Confirm"
    };

    console.log('📨 Sending booking to Lark Base:', bookingFields);

    const createRes = await larkClient.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: bookingTableId
      },
      data: { fields: bookingFields }
    });

    if (createRes.code && createRes.code !== 0) {
      console.error('❌ Lark Base rejected booking:', createRes);
      return res.status(400).json({
        success: false,
        message: `Lark Error: ${createRes.msg}`
      });
    }

    console.log('✅ BOOKING SUCCESS ID:', bookingId);
    res.json({ success: true, bookingId: bookingId });

  } catch (err) {
    console.error('❌ BOOKING ERROR:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
  console.log('Useful endpoints:');
  console.log(`  GET  /               — sales form page`);
  console.log(`  GET  /booking        — booking page`);
  console.log(`  GET  /queue          — SUITCUBE queue booking page`);
  console.log(`  POST /api/suitcube   — SUITCUBE queue booking API`);
  console.log(`  GET  /health         — health check`);
  console.log(`  GET  /test-resolve   — verify app token resolution`);
  console.log(`  GET  /test-schema    — list all table fields + primary key`);
  console.log(`  GET  /test-create    — try minimal create record`);
});

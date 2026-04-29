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

app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const uploadDir = path.join(__dirname, 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/[\\/:*?"<>|]/g, '_');
    cb(null, `${Date.now()}-${safeName}`);
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

// ===== Helper functions =====

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

// ✨ แปลง date string → Unix timestamp ใน milliseconds
function dateToTimestamp(dateStr) {
  if (!dateStr) return null;
  const ts = new Date(dateStr).getTime();
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
    parent_node: appToken,
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

    'ยินยอมเก็บข้อมูล': boolValue(body.privacy_consent),
    'รับทราบนโยบายเงินสด': boolValue(body.cash_policy_ack),
    'ยืนยัน Shipment Salesforce': boolValue(body.shipment_confirmed),

    'ไฟล์สลิปฝากเงินสด': fileMap.cash_deposit_slip || [],
    'ไฟล์ภาพ Voucher': fileMap.voucher_photo || [],
    'ไฟล์แนบ GHL': fileMap.ghl_file || [],
    'ภาพถ่ายยืนยัน': fileMap.confirm_photo || []
  };

  // ✨ ใส่ "วันที่ขาย" เฉพาะตอนที่แปลงเป็น timestamp ได้
  const dateTs = dateToTimestamp(body.sale_date);
  if (dateTs !== null) {
    fields['วันที่ขาย'] = dateTs;
  }

  return fields;
}

// ===== Routes =====

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

// ทดสอบ create record อย่างเดียว ไม่มี file
app.get('/test-create', async (_req, res) => {
  try {
    const appToken = await resolveAppToken();
    
    console.log('🧪 Testing create with:', {
      app_token: appToken,
      table_id: process.env.LARK_TABLE_ID
    });

    const createRes = await larkClient.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: process.env.LARK_TABLE_ID
      },
      data: {
        fields: {
          'หมายเหตุ': 'TEST จาก /test-create ' + new Date().toISOString()
        }
      }
    });

    console.log('✅ Test create response:', JSON.stringify(createRes, null, 2));
    res.json({ ok: true, response: createRes });
  } catch (err) {
    console.error('❌ Test create error:', err);
    console.error('Response data:', err.response?.data);
    res.status(500).json({
      ok: false,
      message: err.message,
      detail: err.response?.data || null
    });
  }
});

app.post('/submit-sales', upload.any(), async (req, res) => {
  console.log('\n========================================');
  console.log('=== SUBMIT-SALES START ===');
  console.log('========================================');
  
  try {
    checkEnv();

    const appToken = await resolveAppToken();
    console.log('✅ app_token:', appToken);
    console.log('✅ table_id:', process.env.LARK_TABLE_ID);
    console.log('📁 Files received:', req.files?.length || 0);
    
    const fileMap = await uploadFilesByField(req.files);
    console.log('✅ All files uploaded. fileMap keys:', Object.keys(fileMap));
    
    const fields = buildFields(req.body, fileMap);
    console.log('📝 Fields built. Keys:', Object.keys(fields).length);
    console.log('📅 sale_date input:', req.body.sale_date, '→ timestamp:', fields['วันที่ขาย']);

    console.log('📨 Calling bitable.appTableRecord.create...');
    const createRes = await larkClient.bitable.appTableRecord.create({
      path: {
        app_token: appToken,
        table_id: process.env.LARK_TABLE_ID
      },
      data: { fields }
    });

    console.log('✅✅✅ CREATE RESPONSE:');
    console.log(JSON.stringify(createRes, null, 2));

    // ✨ เช็คว่า Lark ตอบ error code มาไหม
    if (createRes.code && createRes.code !== 0) {
      console.error('❌ Lark Base rejected the data');
      console.error('=== SUBMIT-SALES FAILED ===\n');
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
      record: createRes.record
    });
  } catch (err) {
    console.error('\n❌❌❌ SUBMIT ERROR:');
    console.error('Message:', err.message);
    console.error('Stack:', err.stack);
    console.error('Response data:', JSON.stringify(err.response?.data, null, 2));
    console.error('=== SUBMIT-SALES FAILED ===\n');
    
    res.status(500).json({
      ok: false,
      message: err.message,
      detail: err.response?.data || null
    });
  }
});

app.listen(PORT, () => {
  console.log(`Server running: http://localhost:${PORT}`);
});
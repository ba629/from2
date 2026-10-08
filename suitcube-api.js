/**
 * suitcube-api.js
 * ─────────────────────────────────────────────
 * เพิ่ม endpoint เดียว POST /api/suitcube ให้ server.js เดิม
 * รับ { action, ...payload } แล้วไปอ่าน/เขียน Lark Base 3 ตาราง
 * (Branches, Services, Bookings — คนละ Base App กันตามที่ตั้งไว้)
 *
 * ใช้ Lark App "ของตัวเอง" แยกต่างหากจากแอปที่ /submit-sales ใช้อยู่เดิม
 * (จะได้ไม่ต้องไปยุ่งกับแอปเดิมที่ทำงานอยู่แล้ว เลือกได้อิสระว่าจะใช้แอปไหน)
 *
 * วิธีใช้ใน server.js เดิม (ไม่ต้องแก้โค้ดเดิมเลย แค่เพิ่ม 2 บรรทัด):
 *
 *   const registerSuitcubeApi = require('./suitcube-api');
 *   registerSuitcubeApi(app);
 *
 * ต้องมี env vars เพิ่มเติมนี้ใน .env (แยกจาก LARK_APP_ID / LARK_APP_SECRET เดิมโดยสิ้นเชิง):
 *   LARK_SUITCUBE_APP_ID=...       ← App ID ของแอปที่จะใช้กับระบบจองคิว (เช่น "น้องเสียงใส")
 *   LARK_SUITCUBE_APP_SECRET=...   ← App Secret ของแอปตัวเดียวกัน
 *   LARK_BOOKINGS_APP_TOKEN=...
 *   LARK_BOOKINGS_TABLE_ID=...
 *   LARK_BRANCHES_APP_TOKEN=...
 *   LARK_BRANCHES_TABLE_ID=...
 *   LARK_SERVICES_APP_TOKEN=...
 *   LARK_SERVICES_TABLE_ID=...
 *
 * ตั้งค่า SMS-KUB ใน .env (เก็บไว้ฝั่ง server เท่านั้น ห้ามใส่ใน HTML):
 *   SMS_KUB_API_KEY=              ← API Key จาก SMS-KUB
 *   SMS_KUB_SENDER=               ← Sender Name ที่ SMS-KUB อนุมัติแล้ว
 *   SMS_REMINDER_ENABLED=true
 *   SMS_REMINDER_INTERVAL_MS=300000
 *   SMS_REMINDER_RETRY_MINUTES=60
 *   SMS_REMINDER_MAX_ATTEMPTS=3
 *
 * ตาราง Booking ต้องมีคอลัมน์เพิ่ม:
 *   ลูกค้ารับทราบ  → ชนิด Checkbox (จำเป็น)
 *   Service ID      → ชนิด Text (ไม่บังคับ; ใช้เก็บ ID ภายใน โดยช่อง Service จะเก็บชื่อบริการ)
 *   SMS Reminder Sent            → Checkbox
 *   SMS Reminder Sent At         → Date
 *   SMS Reminder Last Attempt At → Date
 *   SMS Reminder Attempts        → Number
 *   SMS Reminder Error           → Text
 * ระบบจะพยายามสร้าง 5 คอลัมน์ SMS ให้อัตโนมัติเมื่อเปิดใช้งาน
 * (Lark App ต้องมีสิทธิ์จัดการโครงสร้าง Base)
 * ─────────────────────────────────────────────
 */

const lark = require('@larksuiteoapi/node-sdk');
const https = require('https');

module.exports = function registerSuitcubeApi(app, larkClientOverride, options = {}) {
  // ใช้ larkClient ที่ส่งเข้ามา (ถ้ามี) หรือสร้างตัวใหม่ของตัวเองจาก LARK_SUITCUBE_APP_ID/SECRET
  // ปกติแนะนำให้ "ไม่ส่ง" larkClientOverride เข้ามา เพื่อให้ระบบจองคิวใช้แอป Lark ของตัวเอง
  // แยกจากแอปที่ /submit-sales ใช้อยู่เดิมโดยสิ้นเชิง
  const larkClient = larkClientOverride || new lark.Client({
    appId: process.env.LARK_SUITCUBE_APP_ID,
    appSecret: process.env.LARK_SUITCUBE_APP_SECRET,
    domain: lark.Domain.Lark,
    loggerLevel: lark.LoggerLevel.warn,
  });

  const TABLES = {
    bookings: { appToken: process.env.LARK_BOOKINGS_APP_TOKEN, tableId: process.env.LARK_BOOKINGS_TABLE_ID },
    branches: { appToken: process.env.LARK_BRANCHES_APP_TOKEN, tableId: process.env.LARK_BRANCHES_TABLE_ID },
    services: { appToken: process.env.LARK_SERVICES_APP_TOKEN, tableId: process.env.LARK_SERVICES_TABLE_ID },
  };

  const SMS_KUB_API_URL = 'https://console.sms-kub.com/api/messages';
  const SMS_KUB_API_KEY = String(process.env.SMS_KUB_API_KEY || '').trim();
  const SMS_KUB_SENDER = String(process.env.SMS_KUB_SENDER || '').trim();
  const SMS_REMINDER_ENABLED = String(process.env.SMS_REMINDER_ENABLED || 'true').toLowerCase() !== 'false';
  const SMS_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;
  const SMS_REMINDER_INTERVAL_MS = Math.max(60 * 1000, Number(process.env.SMS_REMINDER_INTERVAL_MS) || 5 * 60 * 1000);
  const SMS_REMINDER_RETRY_MS = Math.max(5 * 60 * 1000, (Number(process.env.SMS_REMINDER_RETRY_MINUTES) || 60) * 60 * 1000);
  const SMS_REMINDER_MAX_ATTEMPTS = Math.max(1, Number(process.env.SMS_REMINDER_MAX_ATTEMPTS) || 3);

  /* ═══════════════════════════════════════════════
     แผนที่ชื่อคอลัมน์ (Field Name Mapping)
     ═══════════════════════════════════════════════
     ซ้ายมือ = ชื่อที่โค้ด/แอปใช้ | ขวามือ = ชื่อคอลัมน์จริงใน Lark Base
     ถ้าคอลัมน์ใน Lark ชื่อตรงกับโค้ดอยู่แล้ว ใส่ชื่อเดิมซ้ำได้เลย
     ถ้าตารางไม่มีคอลัมน์นั้น ให้ใส่ null → ระบบจะข้ามฟิลด์นั้นไปเลย ไม่ error
     ═══════════════════════════════════════════════ */
  const FIELD_MAP = {
    bookings: {
      code:      'Booking ID',
      branchId:  'Branch',
      serviceId: 'Service ID',       // ไม่บังคับ — ถ้ามีคอลัมน์นี้จะเก็บ ID ไว้ใช้อ้างอิงภายใน
      serviceName:'Service',         // ช่อง Service ที่ลูกค้าเห็น เก็บชื่อบริการแทน ID
      date:      'Booking Date',
      time:      'Time Slot',
      people:    'Pax',
      name:      'Customer Name',
      phone:     'Phone',
      note:      'Note',
      status:    'Status',
      acknowledged:'ลูกค้ารับทราบ', // ต้องเป็นคอลัมน์ชนิด Checkbox
      smsReminderSent:'SMS Reminder Sent',
      smsReminderSentAt:'SMS Reminder Sent At',
      smsReminderLastAttemptAt:'SMS Reminder Last Attempt At',
      smsReminderAttempts:'SMS Reminder Attempts',
      smsReminderError:'SMS Reminder Error',
      createdAt: 'Created At',   // ⚠️ ต้องสร้างคอลัมน์ชนิด Date ชื่อ "Created At" ในตาราง Bookings ก่อน
                                 //    (ถ้าตั้งชื่อคอลัมน์เป็นอย่างอื่น ให้แก้ตรงนี้ให้ตรง
                                 //     หรือถ้าไม่อยากเก็บเวลาสร้าง ให้เปลี่ยนกลับเป็น null)
    },
    branches: {
      id:'id', name:'name', nameEn:'nameEn', nameZh:'nameZh',
      district:'district', districtEn:'districtEn', districtZh:'districtZh',
      loc:'loc', locEn:'locEn', locZh:'locZh',
      parking:'parking', parkingEn:'parkingEn', parkingZh:'parkingZh',
      map:'map', area:'area', photo:'photo',
      closed:'closed', closedFrom:'closedFrom', closedTo:'closedTo', hours:'hours',
    },
    services: {
      id:'id', name:'name', nameEn:'nameEn', nameZh:'nameZh',
      desc:'desc', descEn:'descEn', descZh:'descZh',
      mins:'mins', ico:'ico',
    },
  };

  // แปลงชื่อฟิลด์ฝั่งโค้ด → ชื่อคอลัมน์จริงใน Lark + แปลงค่าให้ตรงชนิดคอลัมน์
  async function toLarkFields(tableKey, fields) {
    const out = {};
    const skipped = [];
    for (const [k, v] of Object.entries(fields)) {
      const fld = await resolveField(tableKey, k);
      if (!fld) { skipped.push(k); continue; }
      const coerced = coerceByType(v, fld.type);
      if (coerced === undefined) continue;
      out[fld.name] = coerced;
    }
    if (skipped.length) {
      console.log(`[suitcube-api] ⚠️  ตาราง ${tableKey} ไม่มีคอลัมน์: ${skipped.join(', ')} (ข้ามไป)`);
    }
    return out;
  }

  // แปลงกลับ: ชื่อคอลัมน์จริงใน Lark → ชื่อฟิลด์ฝั่งโค้ด
  // (multi-select อ่านกลับมาเป็น array → คลี่เป็นค่าเดียวให้โค้ดใช้ต่อได้)
  async function fromLarkFields(tableKey, larkFields, codeNames) {
    const out = {};
    if (!larkFields) return out;
    for (const codeName of codeNames) {
      const fld = await resolveField(tableKey, codeName);
      if (!fld) continue;
      let v = larkFields[fld.name];
      if (v === undefined) continue;
      if (Array.isArray(v) && fld.type === 4) v = v.length ? String(v[0]) : '';
      out[codeName] = v;
    }
    return out;
  }

  function checkTablesEnv() {
    if (!larkClientOverride) {
      if (!process.env.LARK_SUITCUBE_APP_ID) throw new Error('ยังไม่ได้ตั้งค่า .env: LARK_SUITCUBE_APP_ID');
      if (!process.env.LARK_SUITCUBE_APP_SECRET) throw new Error('ยังไม่ได้ตั้งค่า .env: LARK_SUITCUBE_APP_SECRET');
    }
    const missing = [];
    for (const [key, cfg] of Object.entries(TABLES)) {
      if (!cfg.appToken) missing.push(`LARK_${key.toUpperCase()}_APP_TOKEN`);
      if (!cfg.tableId) missing.push(`LARK_${key.toUpperCase()}_TABLE_ID`);
    }
    if (missing.length) {
      throw new Error(`ยังไม่ได้ตั้งค่า .env สำหรับ SUITCUBE API: ${missing.join(', ')}`);
    }
  }

  // ═══════════════════════════════════════════════
  // ตัวช่วยแปลงวันที่ (Lark เก็บ Date เป็น timestamp มิลลิวินาที)
  // ═══════════════════════════════════════════════
  // แปลงค่าที่อ่านจาก Lark ให้เป็น timestamp ตัวเลข
  // รองรับทั้ง number, ข้อความตัวเลข ("1787184000000"), และข้อความวันที่ ("2026-08-20")
  // เผื่อกรณีคอลัมน์ถูกตั้งเป็นชนิด Text แทน DateTime
  function toTimestamp(v) {
    if (v === undefined || v === null || v === '') return null;
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    const s = String(v).trim();
    if (/^\d+$/.test(s)) { const n = Number(s); return Number.isFinite(n) ? n : null; }
    const t = new Date(s).getTime();
    return Number.isFinite(t) ? t : null;
  }

  // อ่านค่า boolean แบบทนทาน (เผื่อคอลัมน์เป็น Text เก็บคำว่า "false"/"0")
  function toBool(v) {
    if (typeof v === 'boolean') return v;
    if (v === undefined || v === null) return false;
    const s = String(v).trim().toLowerCase();
    return !(s === '' || s === 'false' || s === '0' || s === 'no');
  }

  function tsToDateStr(ts) {
    const n = toTimestamp(ts);
    if (n === null) return undefined;
    // บวก 7 ชั่วโมงแล้วอ่านแบบ UTC เพื่อให้ผลคงที่เป็นวันของประเทศไทย
    // ไม่ขึ้นกับ timezone ของเครื่อง server
    const d = new Date(n + 7 * 60 * 60 * 1000);
    if (isNaN(d.getTime())) return undefined;
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0');
  }
  function dateStrToTs(s) {
    if (!s) return null;
    const ts = new Date(s + 'T00:00:00+07:00').getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  // ═══════════════════════════════════════════════
  // ตัวช่วยเรียก Lark Bitable API แบบทั่วไป (ใช้ได้ทั้ง 3 ตาราง)
  // ═══════════════════════════════════════════════

  /* ═══════════════════════════════════════════════
     จับคู่ชื่อคอลัมน์อัตโนมัติ
     ═══════════════════════════════════════════════
     อ่านชื่อคอลัมน์จริงจาก Lark มาเทียบกับชื่อที่โค้ดใช้ โดยไม่สนใจ
     ตัวพิมพ์เล็ก-ใหญ่ / เว้นวรรค / ขีดล่าง
     เช่น "Created At", "createdAt", "created_at", "CREATED AT" → ถือว่าตรงกันหมด
     ทำให้ไม่ต้องมานั่งแก้ชื่อให้ตรงเป๊ะทีละตัว
     ถ้าจับคู่อัตโนมัติไม่ได้ ค่อยไปดู FIELD_MAP ด้านบนเป็นตัวสำรอง
     ═══════════════════════════════════════════════ */
  const normalize = (s) => String(s).toLowerCase().replace(/[\s_\-]/g, '');
  const schemaCache = {}; // { tableKey: { normalizedName: { name, type } } }

  async function getFieldSchema(tableKey) {
    if (schemaCache[tableKey]) return schemaCache[tableKey];
    const { appToken, tableId } = TABLES[tableKey];
    const res = await larkClient.bitable.appTableField.list({
      path: { app_token: appToken, table_id: tableId },
      params: { page_size: 100 },
    });
    const map = {};
    (res.data?.items || []).forEach((f) => {
      map[normalize(f.field_name)] = { name: f.field_name, type: f.type };
    });
    schemaCache[tableKey] = map;
    const desc = Object.values(map).map((f) => `${f.name}(t${f.type})`).join(' | ');
    console.log(`[suitcube-api] โหลด schema ${tableKey}: ${desc}`);
    return map;
  }

  // หาข้อมูลคอลัมน์จริงใน Lark จากชื่อฟิลด์ฝั่งโค้ด → { name, type } หรือ null
  async function resolveField(tableKey, codeName) {
    const schema = await getFieldSchema(tableKey);
    if (schema[normalize(codeName)]) return schema[normalize(codeName)];
    const alias = FIELD_MAP[tableKey] && FIELD_MAP[tableKey][codeName];
    if (alias && schema[normalize(alias)]) return schema[normalize(alias)];
    return null;
  }

  async function resolveFieldName(tableKey, codeName) {
    const f = await resolveField(tableKey, codeName);
    return f ? f.name : null;
  }

  // สร้างคอลัมน์ให้เองเมื่อยังไม่มี (ต้องให้ Lark App มีสิทธิ์จัดการ Base)
  async function ensureBookingField(codeName, type) {
    const existing = await resolveField('bookings', codeName);
    if (existing) return existing;
    const { appToken, tableId } = TABLES.bookings;
    const fieldName = FIELD_MAP.bookings[codeName];
    const res = await larkClient.bitable.appTableField.create({
      path: { app_token: appToken, table_id: tableId },
      data: { field_name: fieldName, type },
    });
    if (res.code && res.code !== 0) throw new Error(`Lark create field failed: ${res.msg}`);
    delete schemaCache.bookings;
    const created = await resolveField('bookings', codeName);
    if (!created) throw new Error(`สร้างคอลัมน์ "${fieldName}" แล้ว แต่ยังอ่าน schema ไม่พบ`);
    console.log(`[suitcube-api] ✅ สร้างคอลัมน์ "${fieldName}" แล้ว`);
    return created;
  }

  async function ensureBookingAcknowledgedField() {
    return ensureBookingField('acknowledged', 7); // 7 = Checkbox
  }

  async function ensureBookingSmsReminderFields() {
    // สร้างแบบลำดับเพื่อให้ schema cache อัปเดตถูกต้องทุกคอลัมน์
    await ensureBookingField('smsReminderSent', 7);          // Checkbox
    await ensureBookingField('smsReminderSentAt', 5);        // DateTime
    await ensureBookingField('smsReminderLastAttemptAt', 5); // DateTime
    await ensureBookingField('smsReminderAttempts', 2);      // Number
    await ensureBookingField('smsReminderError', 1);         // Text
  }

  /* ═══════════════════════════════════════════════
     แปลงค่าให้ตรงกับชนิดคอลัมน์จริงใน Lark
     ═══════════════════════════════════════════════
     Lark Bitable field types: 1=Text 2=Number 3=SingleSelect 4=MultiSelect
     5=DateTime 7=Checkbox 11=User 13=Phone 15=Url 17=Attachment
     ตั้งคอลัมน์เป็นชนิดไหนก็ได้ ระบบจะแปลงค่าให้เอง
     ═══════════════════════════════════════════════ */
  function coerceByType(val, type) {
    if (val === null || val === undefined) return val;
    switch (type) {
      case 2: { // Number
        if (val === '') return null;
        const n = typeof val === 'number' ? val : Number(String(val).replace(/,/g, ''));
        return Number.isFinite(n) ? n : null;
      }
      case 4: // MultiSelect — ต้องเป็น array เสมอ
        if (Array.isArray(val)) return val.map(String);
        if (val === '' ) return [];
        return [String(val)];
      case 5: { // DateTime — ต้องเป็น timestamp (ตัวเลข)
        if (val === '' ) return null;
        const ts = typeof val === 'number' ? val : new Date(val).getTime();
        return Number.isFinite(ts) ? ts : null;
      }
      case 7: // Checkbox
        return typeof val === 'boolean' ? val : (val === 'true' || val === '1' || val === 1);
      case 15: // Url
        if (val === '' ) return null;
        return typeof val === 'string' ? { text: val, link: val } : val;
      case 17: // Attachment
        return Array.isArray(val) ? val : undefined;
      case 3:  // SingleSelect
      case 1:  // Text
      case 13: // Phone
      default:
        if (Array.isArray(val)) return val.join(', ');
        if (typeof val === 'boolean') return val ? 'true' : 'false';
        return val === '' ? '' : String(val);
    }
  }

  async function listRecords(tableKey) {
    const { appToken, tableId } = TABLES[tableKey];
    let items = [];
    let pageToken;
    do {
      const res = await larkClient.bitable.appTableRecord.list({
        path: { app_token: appToken, table_id: tableId },
        params: { page_size: 100, page_token: pageToken },
      });
      items = items.concat(res.data?.items || []);
      pageToken = res.data?.has_more ? res.data.page_token : undefined;
    } while (pageToken);
    return items;
  }

  async function findRecordByField(tableKey, fieldName, value) {
    const items = await listRecords(tableKey);
    const larkName = (await resolveFieldName(tableKey, fieldName)) || fieldName;
    return items.find((it) => it.fields?.[larkName] === value);
  }

  async function createRecord(tableKey, fields) {
    const { appToken, tableId } = TABLES[tableKey];
    const res = await larkClient.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: { fields: await toLarkFields(tableKey, fields) },
    });
    if (res.code && res.code !== 0) throw new Error(`Lark create failed (${tableKey}): ${res.msg}`);
    return res.data.record;
  }

  async function updateRecord(tableKey, recordId, fields) {
    const { appToken, tableId } = TABLES[tableKey];
    const res = await larkClient.bitable.appTableRecord.update({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
      data: { fields: await toLarkFields(tableKey, fields) },
    });
    if (res.code && res.code !== 0) throw new Error(`Lark update failed (${tableKey}): ${res.msg}`);
    return res.data.record;
  }

  async function deleteRecordById(tableKey, recordId) {
    const { appToken, tableId } = TABLES[tableKey];
    const res = await larkClient.bitable.appTableRecord.delete({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
    });
    if (res.code && res.code !== 0) throw new Error(`Lark delete failed (${tableKey}): ${res.msg}`);
  }

  // ═══════════════════════════════════════════════
  // แปลงข้อมูล record ⇄ object ที่แอปหน้าเว็บใช้
  // ═══════════════════════════════════════════════
  const BRANCH_STR_FIELDS = [
    'id', 'name', 'nameEn', 'nameZh', 'district', 'districtEn', 'districtZh',
    'loc', 'locEn', 'locZh', 'map', 'area', 'parking', 'parkingEn', 'parkingZh', 'photo',
  ];
  const SERVICE_STR_FIELDS = ['id', 'name', 'nameEn', 'nameZh', 'desc', 'descEn', 'descZh', 'ico'];
  const BOOKING_STR_FIELDS = [
    'code', 'branchId', 'serviceId', 'serviceName', 'time', 'name', 'phone', 'note', 'status',
    'smsReminderError',
  ];

  async function branchFromRecord(rec) {
    const f = await fromLarkFields('branches', rec.fields,
      [...BRANCH_STR_FIELDS, 'closed', 'hours', 'closedFrom', 'closedTo']);
    const out = {};
    BRANCH_STR_FIELDS.forEach((k) => { if (f[k] !== undefined && f[k] !== '') out[k] = f[k]; });
    out.closed = toBool(f.closed);
    if (f.hours) { try { out.hours = JSON.parse(f.hours); } catch (e) { /* ignore malformed */ } }
    const cf = tsToDateStr(f.closedFrom), ct = tsToDateStr(f.closedTo);
    if (cf) out.closedFrom = cf;
    if (ct) out.closedTo = ct;
    out._recordId = rec.record_id;
    return out;
  }

  async function serviceFromRecord(rec) {
    const f = await fromLarkFields('services', rec.fields, [...SERVICE_STR_FIELDS, 'mins']);
    const out = {};
    SERVICE_STR_FIELDS.forEach((k) => { if (f[k] !== undefined && f[k] !== '') out[k] = f[k]; });
    out.mins = Number(f.mins) || 0;
    out._recordId = rec.record_id;
    return out;
  }

  const serviceLookupKey = (value) => String(value || '').trim().toLocaleLowerCase();

  async function loadServiceLookups() {
    const records = await listRecords('services');
    const services = await Promise.all(records.map(serviceFromRecord));
    const byId = new Map();
    const byName = new Map();
    services.forEach((service) => {
      if (service.id) byId.set(String(service.id), service);
      [service.name, service.nameEn, service.nameZh].forEach((name) => {
        if (name) byName.set(serviceLookupKey(name), service);
      });
    });
    return { byId, byName };
  }

  function applyServiceLookupToBooking(out, lookups) {
    if (!lookups) return out;
    const rawId = out.serviceId ? String(out.serviceId) : '';
    const rawName = out.serviceName ? String(out.serviceName) : '';
    // รองรับทั้งข้อมูลใหม่ (Service เป็นชื่อ) และข้อมูลเก่า (Service เคยเก็บ ID)
    const service = (rawId && lookups.byId.get(rawId))
      || (rawName && lookups.byId.get(rawName))
      || (rawName && lookups.byName.get(serviceLookupKey(rawName)));
    if (service) {
      out.serviceId = service.id;
      out.serviceName = service.name || service.nameEn || service.nameZh || rawName || rawId;
    } else if (!out.serviceId && rawName) {
      // เก็บค่าเดิมไว้เป็น fallback สำหรับรายการเก่าที่บริการถูกลบไปแล้ว
      out.serviceId = rawName;
    }
    return out;
  }

  async function bookingFromRecord(rec, serviceLookups) {
    const f = await fromLarkFields('bookings', rec.fields,
      [
        ...BOOKING_STR_FIELDS, 'people', 'date', 'createdAt', 'acknowledged',
        'smsReminderSent', 'smsReminderSentAt', 'smsReminderLastAttemptAt', 'smsReminderAttempts',
      ]);
    const out = {};
    BOOKING_STR_FIELDS.forEach((k) => { if (f[k] !== undefined && f[k] !== '') out[k] = f[k]; });
    out.people = Number(f.people) || 1;
    out.date = tsToDateStr(f.date);
    out.acknowledged = toBool(f.acknowledged);
    out.smsReminderSent = toBool(f.smsReminderSent);
    out.smsReminderAttempts = Number(f.smsReminderAttempts) || 0;
    const cts = toTimestamp(f.createdAt);
    const smsSentTs = toTimestamp(f.smsReminderSentAt);
    const smsAttemptTs = toTimestamp(f.smsReminderLastAttemptAt);
    out.createdAt = cts !== null ? new Date(cts).toISOString() : undefined;
    out.smsReminderSentAt = smsSentTs !== null ? new Date(smsSentTs).toISOString() : undefined;
    out.smsReminderLastAttemptAt = smsAttemptTs !== null ? new Date(smsAttemptTs).toISOString() : undefined;
    out._recordId = rec.record_id;
    return applyServiceLookupToBooking(out, serviceLookups);
  }

  // สร้าง fields object สำหรับเขียนเข้า Lark — ใส่เฉพาะ key ที่มีอยู่จริงใน payload
  // (สำคัญ: รองรับการอัปเดตบางส่วน เช่น toggle ปิดรับจองที่ส่งมาแค่ {id, closed})
  function buildFields(payload, strFields, { hasHours, hasClosed, hasSchedule, hasMins, hasPeople, hasDate, hasStatus, hasCreatedAt, hasAcknowledged } = {}) {
    const out = {};
    strFields.forEach((k) => {
      if (payload[k] !== undefined) out[k] = payload[k] === null ? '' : String(payload[k]);
    });
    if (hasClosed && payload.closed !== undefined) out.closed = !!payload.closed;
    if (hasHours && payload.hours !== undefined) out.hours = JSON.stringify(payload.hours);
    if (hasSchedule) {
      // closedFrom/closedTo: ต้องแยกแยะ "เว้นว่างไว้ = ล้างค่า" กับ "ไม่ได้แตะ"
      // ฝั่งหน้าเว็บจะส่ง null มาชัดเจนเมื่อกด "ล้างกำหนดการ" (ดู booking.html)
      if ('closedFrom' in payload) out.closedFrom = payload.closedFrom ? dateStrToTs(payload.closedFrom) : null;
      if ('closedTo' in payload) out.closedTo = payload.closedTo ? dateStrToTs(payload.closedTo) : null;
    }
    if (hasMins && payload.mins !== undefined) out.mins = Number(payload.mins) || 0;
    if (hasPeople && payload.people !== undefined) out.people = Number(payload.people) || 1;
    if (hasDate && payload.date !== undefined) out.date = dateStrToTs(payload.date);
    if (hasStatus && payload.status !== undefined) out.status = payload.status;
    if (hasCreatedAt && payload.createdAt !== undefined) out.createdAt = new Date(payload.createdAt).getTime();
    if (hasAcknowledged && payload.acknowledged !== undefined) out.acknowledged = !!payload.acknowledged;
    return out;
  }

  function makeCode() {
    const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += s[Math.floor(Math.random() * s.length)];
    return 'SC-' + out;
  }

  // ═══════════════════════════════════════════════
  // SMS-KUB: แจ้งเตือนก่อนเวลานัด 24 ชั่วโมง
  // ═══════════════════════════════════════════════
  const TH_MONTH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

  function bookingStartTimestamp(dateStr, timeStr) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateStr || ''))) return null;
    if (!/^\d{2}:\d{2}$/.test(String(timeStr || ''))) return null;
    // ระบุ +07:00 ชัดเจน เพื่อไม่ให้เวลาคิวเลื่อนตาม timezone ของ server
    const ts = new Date(`${dateStr}T${timeStr}:00+07:00`).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  function formatThaiSmsDate(dateStr) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || ''));
    if (!m) return String(dateStr || '');
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
    const buddhistYear2 = String((year + 543) % 100).padStart(2, '0');
    return `${day} ${TH_MONTH_SHORT[month - 1] || ''} ${buddhistYear2}`.trim();
  }

  function normalizeSmsPhone(value) {
    let phone = String(value || '').replace(/[^\d+]/g, '');
    if (phone.startsWith('+66')) phone = '0' + phone.slice(3);
    else if (phone.startsWith('66') && phone.length >= 11) phone = '0' + phone.slice(2);
    phone = phone.replace(/\D/g, '');
    if (!/^0\d{8,9}$/.test(phone)) throw new Error('เบอร์โทรศัพท์ไม่ถูกต้องสำหรับส่ง SMS');
    return phone;
  }

  function buildSmsReminderMessage(booking) {
    const customerName = String(booking.name || '').replace(/\s+/g, ' ').trim();
    return `แจ้งเตือนคิวเข้ารับบริการคุณ ${customerName} วันที่ ${formatThaiSmsDate(booking.date)} เวลา ${booking.time} น. กรุณาแสดงข้อความนี้ที่หน้าร้าน`;
  }

  function maskPhone(phone) {
    const s = String(phone || '');
    return s.length > 4 ? '*'.repeat(Math.max(0, s.length - 4)) + s.slice(-4) : '****';
  }

  async function sendSmsKub(to, message) {
    if (typeof options.sendSms === 'function') {
      return options.sendSms({ to, from: SMS_KUB_SENDER, message });
    }

    const body = JSON.stringify({ to: [to], from: SMS_KUB_SENDER, message });
    const url = new URL(SMS_KUB_API_URL);
    return new Promise((resolve, reject) => {
      const req = https.request({
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body),
          key: SMS_KUB_API_KEY,
        },
      }, (response) => {
        let raw = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { raw += chunk; });
        response.on('end', () => {
          let parsed;
          try { parsed = raw ? JSON.parse(raw) : {}; } catch (err) { parsed = { raw }; }
          const status = Number(response.statusCode) || 0;
          if (status < 200 || status >= 300) {
            return reject(new Error(`SMS-KUB HTTP ${status}: ${String(parsed.message || raw || 'ไม่ทราบสาเหตุ').slice(0, 300)}`));
          }
          if (parsed && parsed.code !== undefined && Number(parsed.code) !== 200) {
            return reject(new Error(`SMS-KUB code ${parsed.code}: ${String(parsed.message || 'ส่งไม่สำเร็จ').slice(0, 300)}`));
          }
          if (parsed?.data && Number(parsed.data.total) > 0 && Number(parsed.data.send) < 1) {
            return reject(new Error(`SMS-KUB ไม่ได้ส่งข้อความ (block=${Number(parsed.data.block) || 0})`));
          }
          return resolve(parsed);
        });
      });
      req.setTimeout(15000, () => req.destroy(new Error('SMS-KUB timeout')));
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }

  let smsSweepRunning = false;

  async function runSmsReminderSweep(nowMs = Date.now()) {
    if (!SMS_REMINDER_ENABLED) return { skipped: 'disabled', checked: 0, sent: 0, failed: 0 };
    if (!SMS_KUB_API_KEY || !SMS_KUB_SENDER) return { skipped: 'not_configured', checked: 0, sent: 0, failed: 0 };
    if (smsSweepRunning) return { skipped: 'already_running', checked: 0, sent: 0, failed: 0 };

    smsSweepRunning = true;
    const summary = { checked: 0, eligible: 0, sent: 0, failed: 0 };
    try {
      checkTablesEnv();
      // ถ้าสร้างคอลัมน์ไม่ได้ หยุดก่อนส่ง เพื่อป้องกันการส่ง SMS ซ้ำโดยไม่มีสถานะบันทึก
      await ensureBookingSmsReminderFields();

      const records = await listRecords('bookings');
      const bookings = await Promise.all(records.map((rec) => bookingFromRecord(rec)));
      summary.checked = bookings.length;

      for (const booking of bookings) {
        if (booking.status !== 'active' || booking.smsReminderSent) continue;
        const appointmentMs = bookingStartTimestamp(booking.date, booking.time);
        if (appointmentMs === null) continue;
        const remainingMs = appointmentMs - nowMs;
        if (remainingMs <= 0 || remainingMs > SMS_REMINDER_LEAD_MS) continue;

        const attempts = Number(booking.smsReminderAttempts) || 0;
        if (attempts >= SMS_REMINDER_MAX_ATTEMPTS) continue;
        const lastAttemptMs = booking.smsReminderLastAttemptAt
          ? new Date(booking.smsReminderLastAttemptAt).getTime()
          : 0;
        if (lastAttemptMs && nowMs - lastAttemptMs < SMS_REMINDER_RETRY_MS) continue;

        summary.eligible += 1;
        let phone = '';
        let attemptRecorded = false;
        try {
          phone = normalizeSmsPhone(booking.phone);
          const message = buildSmsReminderMessage(booking);

          // บันทึก attempt ก่อนเรียกผู้ให้บริการ หากเขียน Lark ไม่ได้จะไม่ส่ง เพื่อกัน SMS ซ้ำ
          await updateRecord('bookings', booking._recordId, {
            smsReminderAttempts: attempts + 1,
            smsReminderLastAttemptAt: nowMs,
            smsReminderError: '',
          });
          attemptRecorded = true;

          await sendSmsKub(phone, message);
          await updateRecord('bookings', booking._recordId, {
            smsReminderSent: true,
            smsReminderSentAt: nowMs,
            smsReminderError: '',
          });
          summary.sent += 1;
          console.log(`[suitcube-api] ✅ SMS reminder ${booking.code || booking._recordId} → ${maskPhone(phone)}`);
        } catch (err) {
          summary.failed += 1;
          const reason = String(err.message || err).slice(0, 500);
          try {
            await updateRecord('bookings', booking._recordId, attemptRecorded
              ? { smsReminderError: reason }
              : {
                  smsReminderAttempts: attempts + 1,
                  smsReminderLastAttemptAt: nowMs,
                  smsReminderError: reason,
                });
          } catch (updateErr) {
            console.error(`[suitcube-api] บันทึกสถานะ SMS ไม่สำเร็จ ${booking.code || booking._recordId}:`, updateErr.message);
          }
          console.error(`[suitcube-api] SMS reminder failed ${booking.code || booking._recordId}:`, reason);
        }
      }
      return summary;
    } finally {
      smsSweepRunning = false;
    }
  }

  // ═══════════════════════════════════════════════
  // action handlers
  // ═══════════════════════════════════════════════
  const handlers = {
    async listBranches() {
      const items = await listRecords('branches');
      return { branches: await Promise.all(items.map(branchFromRecord)) };
    },

    async listServices() {
      const items = await listRecords('services');
      return { services: await Promise.all(items.map(serviceFromRecord)) };
    },

    async listBookings() {
      const [items, serviceLookups] = await Promise.all([
        listRecords('bookings'),
        loadServiceLookups(),
      ]);
      return { bookings: await Promise.all(items.map((rec) => bookingFromRecord(rec, serviceLookups))) };
    },

    async createBooking(payload) {
      const code = makeCode();
      // พยายามสร้าง Checkbox อัตโนมัติ แต่ไม่ให้การขาดสิทธิ์แก้ schema ทำให้ลูกค้าจองคิวไม่ได้
      try {
        await ensureBookingAcknowledgedField();
      } catch (err) {
        console.warn('[suitcube-api] ยังสร้างคอลัมน์ "ลูกค้ารับทราบ" ไม่ได้:', err.message);
      }
      const serviceLookups = await loadServiceLookups();
      const selectedService = serviceLookups.byId.get(String(payload.serviceId || ''))
        || serviceLookups.byName.get(serviceLookupKey(payload.serviceName));
      if (!selectedService) throw new Error('ไม่พบบริการที่เลือก: ' + (payload.serviceId || payload.serviceName || '-'));
      const serviceName = selectedService.name || selectedService.nameEn || selectedService.nameZh || selectedService.id;
      const fields = buildFields(
        { ...payload, code, serviceId: selectedService.id, serviceName, acknowledged: false },
        ['code', 'branchId', 'serviceId', 'serviceName', 'time', 'name', 'phone', 'note'],
        { hasPeople: true, hasDate: true, hasStatus: true, hasCreatedAt: true, hasAcknowledged: true }
      );
      fields.status = payload.status || 'active';
      fields.date = dateStrToTs(payload.date);
      fields.createdAt = payload.createdAt ? new Date(payload.createdAt).getTime() : Date.now();
      fields.acknowledged = false;
      const rec = await createRecord('bookings', fields);
      return { booking: await bookingFromRecord(rec, serviceLookups) };
    },

    async acknowledgeBooking(payload) {
      if (!payload.code) throw new Error('กรุณาระบุ Booking ID');
      await ensureBookingAcknowledgedField();
      const rec = await findRecordByField('bookings', 'code', payload.code);
      if (!rec) throw new Error('ไม่พบรหัสคิวนี้: ' + payload.code);
      await updateRecord('bookings', rec.record_id, { acknowledged: true });
      return { ok: true, acknowledged: true };
    },

    async cancelBooking(payload) {
      const rec = await findRecordByField('bookings', 'code', payload.code);
      if (!rec) throw new Error('ไม่พบรหัสคิวนี้: ' + payload.code);
      await updateRecord('bookings', rec.record_id, { status: 'cancelled' });
      return { ok: true };
    },

    async saveBranch(payload) {
      if (payload.id) {
        const rec = await findRecordByField('branches', 'id', payload.id);
        if (!rec) throw new Error('ไม่พบสาขา id: ' + payload.id);
        const fields = buildFields(payload, BRANCH_STR_FIELDS.filter((k) => k !== 'id'), {
          hasClosed: true, hasHours: true, hasSchedule: true,
        });
        const updated = await updateRecord('branches', rec.record_id, fields);
        // updateRecord ของ Lark คืนเฉพาะฟิลด์ที่แก้ บาง SDK คืนไม่ครบ — merge กับของเดิมให้ชัวร์
        return { branch: await branchFromRecord({ record_id: rec.record_id, fields: { ...rec.fields, ...(await toLarkFields('branches', fields)), ...(await toLarkFields('branches', { id: payload.id })) } }) };
      }
      // สร้างสาขาใหม่
      const id = 'b' + Date.now();
      const fields = buildFields({ ...payload, id }, BRANCH_STR_FIELDS, { hasClosed: true, hasHours: true, hasSchedule: true });
      fields.closed = false;
      const rec = await createRecord('branches', fields);
      return { branch: await branchFromRecord(rec) };
    },

    async saveService(payload) {
      if (payload.id) {
        const rec = await findRecordByField('services', 'id', payload.id);
        if (!rec) throw new Error('ไม่พบบริการ id: ' + payload.id);
        const fields = buildFields(payload, SERVICE_STR_FIELDS.filter((k) => k !== 'id'), { hasMins: true });
        const updated = await updateRecord('services', rec.record_id, fields);
        return { service: await serviceFromRecord({ record_id: rec.record_id, fields: { ...rec.fields, ...(await toLarkFields('services', fields)), ...(await toLarkFields('services', { id: payload.id })) } }) };
      }
      const id = 's' + Date.now();
      const fields = buildFields({ ...payload, id }, SERVICE_STR_FIELDS, { hasMins: true });
      const rec = await createRecord('services', fields);
      return { service: await serviceFromRecord(rec) };
    },

    async deleteService(payload) {
      const rec = await findRecordByField('services', 'id', payload.id);
      if (!rec) throw new Error('ไม่พบบริการ id: ' + payload.id);
      await deleteRecordById('services', rec.record_id);
      return { ok: true };
    },

    async deleteBranch(payload) {
      const rec = await findRecordByField('branches', 'id', payload.id);
      if (!rec) throw new Error('ไม่พบสาขา id: ' + payload.id);
      await deleteRecordById('branches', rec.record_id);
      return { ok: true };
    },
  };

  // ═══════════════════════════════════════════════
  // route เดียว รับ action-routed payload
  // ═══════════════════════════════════════════════
  app.post('/api/suitcube', async (req, res) => {
    try {
      checkTablesEnv();
      const { action, ...payload } = req.body || {};
      const handler = handlers[action];
      if (!handler) {
        return res.status(400).json({ error: 'unknown action: ' + action });
      }
      console.log('[suitcube-api]', action, JSON.stringify(payload).slice(0, 300));
      const result = await handler(payload);
      res.json(result);
    } catch (err) {
      console.error('[suitcube-api] error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // เปิดให้ server เรียกตรวจคิวเองได้เมื่อจำเป็น โดยไม่เปิดเป็น public endpoint
  app.locals = app.locals || {};
  app.locals.runSuitcubeSmsReminders = runSmsReminderSweep;

  if (SMS_REMINDER_ENABLED && SMS_KUB_API_KEY && SMS_KUB_SENDER && !options.disableSmsTimer) {
    if (!app.locals.suitcubeSmsReminderTimer) {
      const runSafely = () => runSmsReminderSweep().catch((err) => {
        console.error('[suitcube-api] SMS reminder sweep error:', err.message);
      });
      const firstRun = setTimeout(runSafely, 10 * 1000);
      const interval = setInterval(runSafely, SMS_REMINDER_INTERVAL_MS);
      if (typeof firstRun.unref === 'function') firstRun.unref();
      if (typeof interval.unref === 'function') interval.unref();
      app.locals.suitcubeSmsReminderTimer = { firstRun, interval };
      console.log(`[suitcube-api] ✅ SMS reminder เปิดใช้งาน (ตรวจทุก ${Math.round(SMS_REMINDER_INTERVAL_MS / 60000)} นาที)`);
    }
  } else if (!SMS_KUB_API_KEY || !SMS_KUB_SENDER) {
    console.log('[suitcube-api] SMS reminder ยังไม่ทำงาน: กรุณาใส่ SMS_KUB_API_KEY และ SMS_KUB_SENDER ใน .env แล้ว restart server');
  }

  console.log('✅ SUITCUBE API mounted at POST /api/suitcube');
};

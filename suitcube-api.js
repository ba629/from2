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
 * ─────────────────────────────────────────────
 */

const lark = require('@larksuiteoapi/node-sdk');

module.exports = function registerSuitcubeApi(app, larkClientOverride) {
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
      serviceId: 'Service',
      date:      'Booking Date',
      time:      'Time Slot',
      people:    'Pax',
      name:      'Customer Name',
      phone:     'Phone',
      note:      'Note',
      status:    'Status',
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
    const d = new Date(n);
    if (isNaN(d.getTime())) return undefined;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dateStrToTs(s) {
    if (!s) return null;
    const ts = new Date(s + 'T00:00:00').getTime();
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
  const BOOKING_STR_FIELDS = ['code', 'branchId', 'serviceId', 'time', 'name', 'phone', 'note', 'status'];

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

  async function bookingFromRecord(rec) {
    const f = await fromLarkFields('bookings', rec.fields,
      [...BOOKING_STR_FIELDS, 'people', 'date', 'createdAt']);
    const out = {};
    BOOKING_STR_FIELDS.forEach((k) => { if (f[k] !== undefined && f[k] !== '') out[k] = f[k]; });
    out.people = Number(f.people) || 1;
    out.date = tsToDateStr(f.date);
    const cts = toTimestamp(f.createdAt);
    out.createdAt = cts !== null ? new Date(cts).toISOString() : undefined;
    out._recordId = rec.record_id;
    return out;
  }

  // สร้าง fields object สำหรับเขียนเข้า Lark — ใส่เฉพาะ key ที่มีอยู่จริงใน payload
  // (สำคัญ: รองรับการอัปเดตบางส่วน เช่น toggle ปิดรับจองที่ส่งมาแค่ {id, closed})
  function buildFields(payload, strFields, { hasHours, hasClosed, hasSchedule, hasMins, hasPeople, hasDate, hasStatus, hasCreatedAt } = {}) {
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
    return out;
  }

  function makeCode() {
    const s = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let out = '';
    for (let i = 0; i < 6; i++) out += s[Math.floor(Math.random() * s.length)];
    return 'SC-' + out;
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
      const items = await listRecords('bookings');
      return { bookings: await Promise.all(items.map(bookingFromRecord)) };
    },

    async createBooking(payload) {
      const code = makeCode();
      const fields = buildFields(
        { ...payload, code },
        ['code', 'branchId', 'serviceId', 'time', 'name', 'phone', 'note'],
        { hasPeople: true, hasDate: true, hasStatus: true, hasCreatedAt: true }
      );
      fields.status = payload.status || 'active';
      fields.date = dateStrToTs(payload.date);
      fields.createdAt = payload.createdAt ? new Date(payload.createdAt).getTime() : Date.now();
      const rec = await createRecord('bookings', fields);
      return { booking: await bookingFromRecord(rec) };
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

  console.log('✅ SUITCUBE API mounted at POST /api/suitcube');
};

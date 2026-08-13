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
  function tsToDateStr(ts) {
    if (ts === undefined || ts === null) return undefined;
    const d = new Date(ts);
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
    return items.find((it) => it.fields?.[fieldName] === value);
  }

  async function createRecord(tableKey, fields) {
    const { appToken, tableId } = TABLES[tableKey];
    const res = await larkClient.bitable.appTableRecord.create({
      path: { app_token: appToken, table_id: tableId },
      data: { fields },
    });
    if (res.code && res.code !== 0) throw new Error(`Lark create failed (${tableKey}): ${res.msg}`);
    return res.data.record;
  }

  async function updateRecord(tableKey, recordId, fields) {
    const { appToken, tableId } = TABLES[tableKey];
    const res = await larkClient.bitable.appTableRecord.update({
      path: { app_token: appToken, table_id: tableId, record_id: recordId },
      data: { fields },
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

  const FIELD_ALIASES = {
    id: ['id', 'ID', 'Branch ID', 'Service ID', 'Branch Code', 'Service Code', 'branch_id', 'service_id', 'รหัส', 'รหัสสาขา', 'รหัสบริการ'],
    name: ['name', 'Name', 'Branch', 'Service', 'Branch Name', 'Service Name', 'Branch Name (TH)', 'Service Name (TH)', 'ชื่อ', 'ชื่อสาขา', 'ชื่อบริการ'],
    nameEn: ['nameEn', 'Name EN', 'English Name', 'ชื่อภาษาอังกฤษ'],
    nameZh: ['nameZh', 'Name ZH', 'Chinese Name', 'ชื่อภาษาจีน'],
    area: ['area', 'Area', 'Region', 'Zone', 'พื้นที่', 'ภูมิภาค', 'โซน', 'ประเภทสาขา'],
    district: ['district', 'District', 'เขต/อำเภอ', 'เขต', 'อำเภอ'],
    loc: ['loc', 'Location', 'Address', 'ตำแหน่ง', 'ที่อยู่'],
    map: ['map', 'Map', 'Map URL', 'Google Maps', 'ลิงก์แผนที่'],
    photo: ['photo', 'Photo', 'Image', 'รูปภาพ'],
  };

  function larkText(value) {
    if (value === undefined || value === null) return '';
    if (Array.isArray(value)) return value.map(larkText).filter(Boolean).join(' ').trim();
    if (typeof value === 'object') return larkText(value.text ?? value.name ?? value.value ?? value.label ?? value.link ?? '');
    return String(value).trim();
  }

  function fieldText(fields, key) {
    const aliases = FIELD_ALIASES[key] || [key];
    for (const name of aliases) {
      const value = larkText(fields[name]);
      if (value) return value;
    }
    return '';
  }

  function normalizeArea(value) {
    const area = larkText(value).toLowerCase().replace(/\s+/g, ' ').trim();
    if (area === 'bkk' || area.includes('bangkok') || area.includes('กรุงเทพ') || area.includes('ปริมณฑล')) return 'bkk';
    if (area === 'up' || area.includes('upcountry') || area.includes('province') || area.includes('ต่างจังหวัด')) return 'up';
    return area;
  }

  function larkBoolean(value) {
    if (typeof value === 'boolean') return value;
    const text = larkText(value).toLowerCase();
    return ['true', '1', 'yes', 'on', 'ปิด'].includes(text);
  }

  function branchFromRecord(rec) {
    const f = rec.fields || {};
    const out = {};
    BRANCH_STR_FIELDS.forEach((k) => {
      const value = fieldText(f, k);
      if (value) out[k] = value;
    });
    out.area = normalizeArea(out.area);
    out.closed = larkBoolean(f.closed ?? f.Closed ?? f['ปิดรับจอง']);
    if (Array.isArray(f.hours)) out.hours = f.hours;
    else if (f.hours) { try { out.hours = JSON.parse(larkText(f.hours)); } catch (e) { /* ignore malformed */ } }
    const cf = tsToDateStr(f.closedFrom), ct = tsToDateStr(f.closedTo);
    if (cf) out.closedFrom = cf;
    if (ct) out.closedTo = ct;
    out._recordId = rec.record_id;
    return out;
  }

  function serviceFromRecord(rec) {
    const f = rec.fields || {};
    const out = {};
    SERVICE_STR_FIELDS.forEach((k) => {
      const value = fieldText(f, k);
      if (value) out[k] = value;
    });
    out.mins = Number(f.mins) || 0;
    out._recordId = rec.record_id;
    return out;
  }

  function bookingFromRecord(rec) {
    const f = rec.fields || {};
    const out = {};
    BOOKING_STR_FIELDS.forEach((k) => { if (f[k] !== undefined && f[k] !== '') out[k] = f[k]; });
    out.people = Number(f.people) || 1;
    out.date = tsToDateStr(f.date);
    out.createdAt = f.createdAt ? new Date(f.createdAt).toISOString() : undefined;
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
      // Lark Base มักมีแถวเปล่าค้างอยู่ ห้ามส่งแถวเหล่านั้นไปแทนข้อมูลตั้งต้นของหน้าเว็บ
      const branches = items.map(branchFromRecord).filter((b) => b.id && b.name && ['bkk', 'up'].includes(b.area));
      return { branches };
    },

    async listServices() {
      const items = await listRecords('services');
      return { services: items.map(serviceFromRecord).filter((s) => s.id && s.name) };
    },

    async listBookings() {
      const items = await listRecords('bookings');
      return { bookings: items.map(bookingFromRecord).filter((b) => b.code && b.branchId && b.serviceId) };
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
      return { booking: bookingFromRecord(rec) };
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
        return { branch: branchFromRecord({ record_id: rec.record_id, fields: { ...rec.fields, ...fields, id: payload.id } }) };
      }
      // สร้างสาขาใหม่
      const id = 'b' + Date.now();
      const fields = buildFields({ ...payload, id }, BRANCH_STR_FIELDS, { hasClosed: true, hasHours: true, hasSchedule: true });
      fields.closed = false;
      const rec = await createRecord('branches', fields);
      return { branch: branchFromRecord(rec) };
    },

    async saveService(payload) {
      if (payload.id) {
        const rec = await findRecordByField('services', 'id', payload.id);
        if (!rec) throw new Error('ไม่พบบริการ id: ' + payload.id);
        const fields = buildFields(payload, SERVICE_STR_FIELDS.filter((k) => k !== 'id'), { hasMins: true });
        const updated = await updateRecord('services', rec.record_id, fields);
        return { service: serviceFromRecord({ record_id: rec.record_id, fields: { ...rec.fields, ...fields, id: payload.id } }) };
      }
      const id = 's' + Date.now();
      const fields = buildFields({ ...payload, id }, SERVICE_STR_FIELDS, { hasMins: true });
      const rec = await createRecord('services', fields);
      return { service: serviceFromRecord(rec) };
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

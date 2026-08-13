/**
 * seed-lark-data.js
 * ─────────────────────────────────────────────
 * สคริปต์ "นำเข้าทีเดียว" — เอาข้อมูล 18 สาขา + 2 บริการ (จาก seed ในแอป)
 * ไปสร้างเป็น record จริงใน Lark Base (Branches + Services)
 *
 * รันครั้งเดียวพอ ไม่ควรรันซ้ำ (จะได้ข้อมูลซ้ำ) — ถ้าเผลอรันซ้ำ ให้ไปลบ
 * record ที่ซ้ำออกเองใน Lark หรือรัน "โหมดล้างก่อนนำเข้า" (ดูด้านล่าง)
 *
 * วิธีใช้:
 *   1. ตรวจสอบว่า .env มีค่าครบ: LARK_SUITCUBE_APP_ID, LARK_SUITCUBE_APP_SECRET,
 *      LARK_BRANCHES_APP_TOKEN, LARK_BRANCHES_TABLE_ID,
 *      LARK_SERVICES_APP_TOKEN, LARK_SERVICES_TABLE_ID
 *   2. รันคำสั่ง:  node seed-lark-data.js
 *   3. (ไม่บังคับ) ถ้าอยากให้ลบแถวว่างเปล่าเดิมออกก่อนนำเข้าด้วย:
 *         node seed-lark-data.js --clean
 * ─────────────────────────────────────────────
 */

require('dotenv').config();
const lark = require('@larksuiteoapi/node-sdk');

const CLEAN_FIRST = process.argv.includes('--clean');

const larkClient = new lark.Client({
  appId: process.env.LARK_SUITCUBE_APP_ID,
  appSecret: process.env.LARK_SUITCUBE_APP_SECRET,
  domain: lark.Domain.Lark,
  loggerLevel: lark.LoggerLevel.warn,
});

const TABLES = {
  branches: { appToken: process.env.LARK_BRANCHES_APP_TOKEN, tableId: process.env.LARK_BRANCHES_TABLE_ID },
  services: { appToken: process.env.LARK_SERVICES_APP_TOKEN, tableId: process.env.LARK_SERVICES_TABLE_ID },
};

/* ═══════════════════════════════════════════════
   ข้อมูล seed — คัดลอกมาจาก suitcube_booking.html เป๊ะๆ
   ═══════════════════════════════════════════════ */
const every = (o, c) => Array.from({length:7}, () => [o, c]);

const BRANCHES_SEED = [
  // ── กรุงเทพและปริมณฑล ──
  { id:'siam', name:'สยามสแควร์วัน', nameEn:'Siam Square One', nameZh:'暹罗广场一号', area:'bkk', district:'ปทุมวัน', districtEn:'Pathumwan', districtZh:'巴吞旺',
    loc:'ชั้น 3 ข้างร้าน Starbucks', locEn:'3rd floor, next to Starbucks', locZh:'3楼，星巴克旁',
    map:'https://maps.app.goo.gl/QX4bHVw8XXoNeWbN8', hours:every('10:00','22:00') },

  { id:'t21', name:'เทอร์มินอล 21 อโศก', nameEn:'Terminal 21 Asok', nameZh:'Terminal 21 阿索克', area:'bkk', district:'วัฒนา', districtEn:'Watthana', districtZh:'瓦塔纳',
    loc:'ชั้น 2 ติดบันไดเลื่อน ฝั่ง H&M (ห้อง 2005–2006)', locEn:'2nd floor, by the escalator near H&M (units 2005–2006)', locZh:'2楼，扶梯旁，H&M 附近（2005–2006 号铺位）',
    map:'https://maps.app.goo.gl/bMxkbD9P2dg4q1ov7', hours:every('10:00','22:00') },

  { id:'sutthisan', name:'รัชดา – สุทธิสาร', nameEn:'Ratchada – Sutthisan', nameZh:'拉差达－素堤沙', area:'bkk', district:'ห้วยขวาง', districtEn:'Huai Khwang', districtZh:'惠夸',
    loc:'ติด MRT สถานีสุทธิสาร ทางออก 4', locEn:'Next to MRT Sutthisan, Exit 4', locZh:'紧邻地铁素堤沙站 4 号出口',
    map:'https://maps.app.goo.gl/qbZe7ensCuN999U29', hours:every('10:00','21:00'),
    parking:'จอดรถหน้าร้าน', parkingEn:'Parking in front of the store', parkingZh:'店前设有停车位' },

  { id:'silom', name:'สีลมคอมเพล็กซ์', nameEn:'Silom Complex', nameZh:'是隆购物中心', area:'bkk', district:'บางรัก', districtEn:'Bang Rak', districtZh:'邦叻',
    loc:'ชั้น 3 ติดบันไดเลื่อน ข้างคลินิก Smile Seasons', locEn:'3rd floor, by the escalator, next to Smile Seasons clinic', locZh:'3楼，扶梯旁，Smile Seasons 诊所旁',
    map:'https://maps.app.goo.gl/pMpLr2gGxTdovj647', hours:every('10:30','20:30') },

  { id:'rama3', name:'พระราม 3', nameEn:'Rama III', nameZh:'拉玛三世路', area:'bkk', district:'ยานนาวา', districtEn:'Yannawa', districtZh:'耶那瓦',
    loc:'หมู่บ้านอรุณพัฒน์ ถ.ยานนาวา (สาธุประดิษฐ์ตัดใหม่) ใกล้ ธ.กรุงศรีอยุธยา สำนักงานใหญ่ — เข้าหมู่บ้านแล้วเลี้ยวขวา อาคารสุดท้าย',
    locEn:'Arunphat Village, Yannawa Rd. (new Sathupradit), near Krungsri Bank HQ — turn right into the village, last building', locZh:'Arunphat 村，耶那瓦路（新沙都巴拉迪路），近京都银行总部——进村后右转，最后一栋楼',
    map:'https://maps.app.goo.gl/yRApoKM7bpdphsjw6', hours:every('10:00','20:00'),
    parking:'มีพื้นที่จอดรถหน้าร้าน', parkingEn:'Parking available in front of the store', parkingZh:'店前设有停车场' },

  { id:'circle', name:'เดอะเซอร์เคิล ราชพฤกษ์', nameEn:'The Circle Ratchapruek', nameZh:'The Circle 拉差帕鲁', area:'bkk', district:'ตลิ่งชัน', districtEn:'Taling Chan', districtZh:'塔灵春',
    loc:'ชั้น 1 โซน South Trail Walk Way ตรงข้ามร้าน MK Restaurants', locEn:'1st floor, South Trail Walk Way, opposite MK Restaurants', locZh:'1楼 South Trail 步道区，MK 餐厅对面',
    map:'https://maps.app.goo.gl/uKAvvv62UtbAu7AX7', hours:every('10:30','21:00') },

  { id:'promenade', name:'เดอะพรอมานาด รามอินทรา', nameEn:'The Promenade Ramindra', nameZh:'The Promenade 拉抿塔', area:'bkk', district:'คันนายาว', districtEn:'Khan Na Yao', districtZh:'坎那尧',
    loc:'ชั้น 1 ห้อง 1005 ใกล้บันไดทางเชื่อมไปแฟชั่นไอส์แลนด์ (ใกล้ร้านกระเป๋า only P)', locEn:'1st floor, unit 1005, near the walkway to Fashion Island (near only P bag shop)', locZh:'1楼 1005 号铺位，靠近通往 Fashion Island 的天桥（近 only P 包袋店）',
    map:'https://maps.app.goo.gl/KNZtsSBQLhGNtKiE9', hours:every('10:00','22:00') },

  { id:'bangkapi', name:'เดอะมอลล์ไลฟ์สโตร์ บางกะปิ', nameEn:'The Mall Lifestore Bangkapi', nameZh:'The Mall Lifestore 邦卡比', area:'bkk', district:'บางกะปิ', districtEn:'Bang Kapi', districtZh:'邦卡比',
    loc:'ชั้น 1 บริเวณบันไดเลื่อนโซนกลาง ตรงข้ามร้าน FOOT LOCKER', locEn:'1st floor, central escalator zone, opposite Foot Locker', locZh:'1楼中央扶梯区，Foot Locker 对面',
    map:'https://maps.app.goo.gl/FmFrAESQ8C3g7ViJ9',
    hours:[['10:00','21:30'],['10:30','21:30'],['10:30','21:30'],['10:30','21:30'],['10:30','21:30'],['10:00','22:00'],['10:00','22:00']],
    holiday:'วันหยุดนักขัตฤกษ์ 10.00 – 22.00 น.', holidayEn:'Public holidays: 10:00–22:00', holidayZh:'公共假日营业时间：10:00–22:00' },

  { id:'seacon', name:'ซีคอนสแควร์ ศรีนครินทร์', nameEn:'Seacon Square Srinakarin', nameZh:'Seacon Square 诗纳卡琳', area:'bkk', district:'ประเวศ', districtEn:'Prawet', districtZh:'巴威',
    loc:'ชั้น 2 ห้อง 2029 ใกล้ร้าน Starbucks', locEn:'2nd floor, unit 2029, near Starbucks', locZh:'2楼 2029 号铺位，星巴克附近',
    map:'https://maps.app.goo.gl/WWR92Rr8iHmnwy1K7',
    hours:[['10:00','21:00'],['10:30','21:00'],['10:30','21:00'],['10:30','21:00'],['10:30','21:00'],['10:30','21:00'],['10:00','21:00']] },

  { id:'ngamwongwan', name:'เดอะมอลล์ งามวงศ์วาน', nameEn:'The Mall Ngamwongwan', nameZh:'The Mall 岩旺湾', area:'bkk', district:'เมืองนนทบุรี', districtEn:'Mueang Nonthaburi', districtZh:'佛统他尼',
    loc:'ชั้น 1 ติดร้าน Charles & Keith ตรงข้ามร้าน Pandora', locEn:'1st floor, next to Charles & Keith, opposite Pandora', locZh:'1楼，Charles & Keith 旁，Pandora 对面',
    map:'https://maps.app.goo.gl/6qs1iTSnrthyeJU2A', hours:every('10:00','21:00'),
    holiday:'วันหยุดนักขัตฤกษ์ 10.00 – 22.00 น.', holidayEn:'Public holidays: 10:00–22:00', holidayZh:'公共假日营业时间：10:00–22:00' },

  { id:'futurepark', name:'ฟิวเจอร์พาร์ค รังสิต', nameEn:'Future Park Rangsit', nameZh:'Future Park 兰实', area:'bkk', district:'ธัญบุรี', districtEn:'Thanyaburi', districtZh:'塔尼武里',
    loc:'ชั้น G บริเวณลานน้ำพุ ใกล้ร้าน Starbucks', locEn:'Ground floor, fountain plaza, near Starbucks', locZh:'一楼喷泉广场，星巴克附近',
    map:'https://maps.app.goo.gl/AUpXdhahZvQnLsn38',
    hours:[['10:00','22:00'],['10:30','21:30'],['10:30','21:30'],['10:30','21:30'],['10:30','21:30'],['10:30','22:00'],['10:00','22:00']],
    holiday:'วันหยุดนักขัตฤกษ์ 10.00 – 22.00 น.', holidayEn:'Public holidays: 10:00–22:00', holidayZh:'公共假日营业时间：10:00–22:00' },

  { id:'megabangna', name:'เมกาบางนา', nameEn:'MegaBangna', nameZh:'Mega Bangna', area:'bkk', district:'บางพลี', districtEn:'Bang Phli', districtZh:'邦丽',
    loc:'โซน Central Department Store ชั้น 2 โซน Men Wear', locEn:'Central Department Store zone, 2nd floor, Men\'s Wear', locZh:'Central 百货区 2 楼男装区',
    map:'https://maps.app.goo.gl/JwCft8MR47ezFSAFA', hours:every('10:00','22:00') },

  { id:'centralworld', name:'เซ็นทรัลเวิลด์', nameEn:'CentralWorld', nameZh:'CentralWorld', area:'bkk', district:'ปทุมวัน', districtEn:'Pathumwan', districtZh:'巴吞旺',
    loc:'โซน Central Department Store ชั้น 5 โซน Men Wear', locEn:'Central Department Store zone, 5th floor, Men\'s Wear', locZh:'Central 百货区 5 楼男装区',
    map:'https://maps.app.goo.gl/X4iMRq2FDEwGiShy7', hours:every('10:00','21:00') },

  { id:'westgate', name:'เซ็นทรัลเวสต์เกต', nameEn:'Central Westgate', nameZh:'Central Westgate', area:'bkk', district:'บางใหญ่', districtEn:'Bang Yai', districtZh:'邦艾',
    loc:'โซน Central Department Store ชั้น 3 โซน Men Wear ตรงข้ามร้านสตาร์บัคส์', locEn:'Central Department Store zone, 3rd floor, Men\'s Wear, opposite Starbucks', locZh:'Central 百货区 3 楼男装区，星巴克对面',
    map:'https://maps.app.goo.gl/6PpyP2z2ry3FqTJfA', hours:every('10:00','22:00') },

  // ── ต่างจังหวัด ──
  { id:'onenimman', name:'วันนิมมาน เชียงใหม่', nameEn:'One Nimman Chiang Mai', nameZh:'清迈 One Nimman', area:'up', district:'เชียงใหม่', districtEn:'Chiang Mai', districtZh:'清迈',
    loc:'โครงการวันนิมมาน ชั้น 1 ซอยกลาง ตรงข้ามหอนาฬิกา (ห้อง D11) ติดร้าน MUAK ข้างร้าน Mamoris',
    locEn:'One Nimman project, 1st floor, middle lane, opposite the clock tower (unit D11), next to MUAK and Mamoris', locZh:'One Nimman 项目，1楼中巷，钟楼对面（D11 号铺位），紧邻 MUAK，Mamoris 旁',
    map:'https://maps.app.goo.gl/2YX42wSqnyfYM48p8', hours:every('11:00','22:00') },

  { id:'korat', name:'เดอะมอลล์โคราช', nameEn:'The Mall Korat', nameZh:'The Mall 呵叻', area:'up', district:'นครราชสีมา', districtEn:'Nakhon Ratchasima', districtZh:'呵叻',
    loc:'ชั้น 1 ตึกใหม่ตรงข้าม CPS CHAPS', locEn:'1st floor, new building, opposite CPS CHAPS', locZh:'1楼新楼，CPS CHAPS 对面',
    map:'https://maps.app.goo.gl/EGbX2knW4pw8cZL69', hours:every('10:00','21:00') },

  { id:'phuket', name:'บูกิส ภูเก็ต', nameEn:'Bukis Phuket', nameZh:'Bukis 普吉', area:'up', district:'ภูเก็ต', districtEn:'Phuket', districtZh:'普吉',
    loc:'โซน A ชั้น 2 Bukis Phuket', locEn:'Zone A, 2nd floor, Bukis Phuket', locZh:'A 区 2 楼 Bukis Phuket',
    map:'https://maps.app.goo.gl/p2z2WwYexjvTh5Na6', hours:every('11:00','20:00') },

  { id:'khonkaen', name:'ขอนแก่น', nameEn:'Khon Kaen', nameZh:'孔敬', area:'up', district:'ขอนแก่น', districtEn:'Khon Kaen', districtZh:'孔敬',
    loc:'ถนนเทพารักษ์', locEn:'Theparak Road', locZh:'Theparak 路',
    map:'https://maps.app.goo.gl/ctVKHbnNc1sE179M8', hours:every('10:00','20:00') },
];

const SERVICES_SEED = [
  { id:'fitting', name:'บริการเลือกชมสินค้า', nameEn:'Product Viewing Service', nameZh:'选购商品服务', desc:'เลือกชมและเลือกซื้อสินค้าหน้าร้าน', descEn:'Browse and shop for products in-store', descZh:'到店浏览及选购商品', mins:60,
    ico:'<path d="M12 3l4 2 5 3-2 3-3-1v11H8V10L5 11 3 8l5-3 4-2zM9 3.5a3 3 0 006 0"/>' },
  { id:'pickup', name:'บริการฟิตติ้งหรือรับสินค้า', nameEn:'Fitting or Pickup Service', nameZh:'试衣或取货服务', desc:'ลองฟิตติ้งหรือนัดหมายมารับสินค้าที่จองไว้', descEn:'Try on in-store, or pick up a reserved item', descZh:'到店试穿，或预约取回已订购的商品', mins:30,
    ico:'<path d="M4 8h16l-1 12H5L4 8zM8 8V6a4 4 0 018 0v2"/>' },
];

/* ═══════════════════════════════════════════════
   ตัวช่วย
   ═══════════════════════════════════════════════ */
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

async function deleteRecord(tableKey, recordId) {
  const { appToken, tableId } = TABLES[tableKey];
  await larkClient.bitable.appTableRecord.delete({
    path: { app_token: appToken, table_id: tableId, record_id: recordId },
  });
}

async function createRecord(tableKey, fields) {
  const { appToken, tableId } = TABLES[tableKey];
  const res = await larkClient.bitable.appTableRecord.create({
    path: { app_token: appToken, table_id: tableId },
    data: { fields },
  });
  if (res.code && res.code !== 0) throw new Error(res.msg);
  return res.data.record;
}

async function cleanEmptyRows(tableKey) {
  console.log(`\n🧹 กำลังเช็คแถวว่างเปล่าในตาราง ${tableKey}...`);
  const items = await listRecords(tableKey);
  const empty = items.filter((it) => !it.fields || !it.fields.id);
  if (!empty.length) {
    console.log('   ไม่มีแถวว่างเปล่า ข้ามขั้นตอนนี้');
    return;
  }
  console.log(`   พบ ${empty.length} แถวว่างเปล่า กำลังลบ...`);
  for (const rec of empty) {
    await deleteRecord(tableKey, rec.record_id);
  }
  console.log(`   ✅ ลบ ${empty.length} แถวว่างเปล่าเรียบร้อย`);
}

function branchToFields(b) {
  const f = {
    id: b.id, name: b.name, nameEn: b.nameEn, nameZh: b.nameZh,
    district: b.district, districtEn: b.districtEn, districtZh: b.districtZh,
    loc: b.loc, locEn: b.locEn, locZh: b.locZh,
    map: b.map, area: b.area,
    closed: false,
    hours: JSON.stringify(b.hours),
  };
  if (b.parking) { f.parking = b.parking; f.parkingEn = b.parkingEn; f.parkingZh = b.parkingZh; }
  return f;
}

function serviceToFields(s) {
  return {
    id: s.id, name: s.name, nameEn: s.nameEn, nameZh: s.nameZh,
    desc: s.desc, descEn: s.descEn, descZh: s.descZh,
    mins: s.mins, ico: s.ico,
  };
}

/* ═══════════════════════════════════════════════
   ทำงานจริง
   ═══════════════════════════════════════════════ */
async function main() {
  const missing = [];
  ['LARK_SUITCUBE_APP_ID', 'LARK_SUITCUBE_APP_SECRET',
   'LARK_BRANCHES_APP_TOKEN', 'LARK_BRANCHES_TABLE_ID',
   'LARK_SERVICES_APP_TOKEN', 'LARK_SERVICES_TABLE_ID'].forEach((k) => {
    if (!process.env[k]) missing.push(k);
  });
  if (missing.length) {
    console.error('❌ ยังไม่ได้ตั้งค่า .env:', missing.join(', '));
    process.exit(1);
  }

  console.log('═══════════════════════════════════════');
  console.log('  SUITCUBE — นำเข้าข้อมูล Branches + Services');
  console.log('═══════════════════════════════════════');

  if (CLEAN_FIRST) {
    await cleanEmptyRows('branches');
    await cleanEmptyRows('services');
  }

  console.log(`\n📍 กำลังนำเข้า ${BRANCHES_SEED.length} สาขา...`);
  let bOk = 0, bFail = 0;
  for (const b of BRANCHES_SEED) {
    try {
      await createRecord('branches', branchToFields(b));
      console.log(`   ✅ ${b.id} — ${b.name}`);
      bOk++;
    } catch (err) {
      console.error(`   ❌ ${b.id} ล้มเหลว: ${err.message}`);
      bFail++;
    }
  }

  console.log(`\n🛠  กำลังนำเข้า ${SERVICES_SEED.length} บริการ...`);
  let sOk = 0, sFail = 0;
  for (const s of SERVICES_SEED) {
    try {
      await createRecord('services', serviceToFields(s));
      console.log(`   ✅ ${s.id} — ${s.name}`);
      sOk++;
    } catch (err) {
      console.error(`   ❌ ${s.id} ล้มเหลว: ${err.message}`);
      sFail++;
    }
  }

  console.log('\n═══════════════════════════════════════');
  console.log(`สรุป: สาขา ${bOk}/${BRANCHES_SEED.length} สำเร็จ (${bFail} ล้มเหลว) · บริการ ${sOk}/${SERVICES_SEED.length} สำเร็จ (${sFail} ล้มเหลว)`);
  console.log('═══════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('❌ เกิดข้อผิดพลาด:', err);
  process.exit(1);
});

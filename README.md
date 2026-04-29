# แบบฟอร์มบันทึกยอดขาย → Lark Base

## วิธีใช้แบบเร็ว

```bash
npm install
cp .env.example .env
npm start
```

จากนั้นเปิด `index.html` แล้วกรอกฟอร์ม กด “บันทึกข้อมูล”

## ต้องตั้งค่า `.env`

```env
LARK_APP_ID=cli_xxxxxxxxxxxxxxxxx
LARK_APP_SECRET=xxxxxxxxxxxxxxxxxxxx
LARK_APP_TOKEN=ใส่_app_token_ของ_Base
LARK_TABLE_ID=tblTEqU4AUBwIv938
```

## Field ที่ต้องสร้างใน Lark Base

ถ้าชื่อ Field ไม่ตรง 100% API จะบันทึกไม่ผ่าน

### Number
- QR-CODE AUTO
- GHL
- เครื่องรูดบัตร TTB
- We chat Alipay
- รับช่องทาง KTB
- ไทยพาณิชย์ 0198
- TTB 6417
- เงินสด
- ยอดขายทั้งหมด
- เงินสดตั้งต้น
- เงินสดรับมา
- ฝากเงินสด
- เงินสดคงเหลือ
- Voucher 500 คงเหลือ
- Voucher 1000 คงเหลือ
- รวมรายการขายเงินสด

### Text / Multiline Text
- วันที่ขาย
- สาขา
- รายการขายเงินสด
- หมายเหตุ
- ชื่อผู้บันทึก
- ยินยอมเก็บข้อมูล
- รับทราบนโยบายเงินสด
- ยืนยัน Shipment Salesforce
- ไฟล์สลิปฝากเงินสด
- ไฟล์ภาพ Voucher
- ไฟล์แนบ GHL
- ภาพถ่ายยืนยัน

## หมายเหตุเรื่องไฟล์แนบ

เวอร์ชันนี้เก็บไฟล์จริงไว้ในโฟลเดอร์ `uploads` ของ server และบันทึกชื่อไฟล์ลง Lark Base ก่อน เพื่อให้ใช้งานได้ง่าย

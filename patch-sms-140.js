'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const SMS_MAX_LENGTH = 140;

function replaceOnce(text, from, to, label) {
  if (text.includes(to)) return text;
  if (!text.includes(from)) {
    throw new Error(`[sms-140] ไม่พบจุดที่ต้องแก้: ${label}`);
  }
  return text.replace(from, to);
}

function patchBookingHtml() {
  const file = path.join(ROOT, 'booking.html');
  let text = fs.readFileSync(file, 'utf8');
  const original = text;

  text = replaceOnce(
    text,
    "(${String(S.adminSmsTemplate||'').length}/1000)",
    "(${String(S.adminSmsTemplate||'').length}/" + SMS_MAX_LENGTH + ")",
    'ตัวนับ SMS ในฟอร์ม'
  );

  text = replaceOnce(
    text,
    'maxlength="1000"',
    'maxlength="' + SMS_MAX_LENGTH + '"',
    'maxlength ของ textarea SMS'
  );

  text = replaceOnce(
    text,
    "if (template.length > 1000){ toast('ข้อความ SMS ต้องไม่เกิน 1000 ตัวอักษร'); return; }",
    "if (template.length > " + SMS_MAX_LENGTH + "){ toast('ข้อความ SMS ต้องไม่เกิน " + SMS_MAX_LENGTH + " ตัวอักษร'); return; }",
    'validation ตอนบันทึก SMS'
  );

  text = replaceOnce(
    text,
    "if (count) count.textContent = `(${String(S.adminSmsTemplate||'').length}/1000)`;",
    "if (count) count.textContent = `(${String(S.adminSmsTemplate||'').length}/" + SMS_MAX_LENGTH + ")`;",
    'ตัวนับ SMS ตอนพิมพ์'
  );

  const oldTokenInsert = "    S.adminSmsTemplate = current.slice(0,start) + token + current.slice(end);\n    render();";
  const newTokenInsert = "    const nextTemplate = current.slice(0,start) + token + current.slice(end);\n" +
    "    if (nextTemplate.length > " + SMS_MAX_LENGTH + "){ toast('ข้อความ SMS ต้องไม่เกิน " + SMS_MAX_LENGTH + " ตัวอักษร'); return; }\n" +
    "    S.adminSmsTemplate = nextTemplate;\n" +
    "    render();";

  text = replaceOnce(
    text,
    oldTokenInsert,
    newTokenInsert,
    'validation ตอนกดตัวแปร SMS'
  );

  if (text !== original) {
    fs.writeFileSync(file, text, 'utf8');
    console.log(`[sms-140] patched booking.html (${SMS_MAX_LENGTH} chars)`);
  } else {
    console.log('[sms-140] booking.html already patched');
  }
}

function patchSmsApi() {
  const file = path.join(ROOT, 'suitcube-api.js');
  let text = fs.readFileSync(file, 'utf8');
  const original = text;

  text = replaceOnce(
    text,
    'const SMS_TEMPLATE_MAX_LENGTH = 1000;',
    'const SMS_TEMPLATE_MAX_LENGTH = ' + SMS_MAX_LENGTH + ';',
    'SMS_TEMPLATE_MAX_LENGTH ฝั่ง API'
  );

  if (text !== original) {
    fs.writeFileSync(file, text, 'utf8');
    console.log(`[sms-140] patched suitcube-api.js (${SMS_MAX_LENGTH} chars)`);
  } else {
    console.log('[sms-140] suitcube-api.js already patched');
  }
}

patchBookingHtml();
patchSmsApi();

/* SUITCUBE calendar file responder
   ทำให้ Safari/Chrome ได้รับ .ics ผ่าน URL จริงพร้อม MIME type ที่ถูกต้อง */
self.addEventListener('install', event => {
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  if (!url.pathname.endsWith('/suitcube-calendar-event.ics')) return;

  const calendarData = url.searchParams.get('data');
  const requestedName = url.searchParams.get('name') || 'suitcube-booking.ics';
  const safeName = requestedName.replace(/[^A-Za-z0-9._-]/g, '_');

  if (!calendarData){
    event.respondWith(new Response('Calendar data not found', {
      status: 400,
      headers: {'Content-Type':'text/plain;charset=utf-8', 'Cache-Control':'no-store'}
    }));
    return;
  }

  event.respondWith(new Response(calendarData, {
    status: 200,
    headers: {
      'Content-Type':'text/calendar;charset=utf-8;method=PUBLISH',
      'Content-Disposition':'inline; filename="' + safeName + '"',
      'Cache-Control':'no-store, max-age=0',
      'X-Content-Type-Options':'nosniff'
    }
  }));
});

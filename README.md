# Texnikum Test Markazi

Kitob bo'limlari bo'yicha test platformasi. Foydalanuvchi guruh yaratadi, bo'limlar va savollarni kiritadi, guruh havolasini sheriklariga yuboradi. Ular ro'yxatdan o'tib, testlarni yechadi.

## Imkoniyatlar

- Ro'yxatdan o'tish va kirish (ism, login, parol).
- Guruh yaratish. Har bir guruhning 6 belgili kodi va `sayt.uz/g/KOD` ko'rinishidagi havolasi bor.
- Bo'limlar: bir yo'la 30 tasini yozish yoki faqat sonini kiritish mumkin. Bo'limlar tartibini o'zgartirish ham mumkin.
- Har bir bo'lim uchun alohida test va barcha bo'limlardan aralash test.
- Savollarni bittalab qo'shish, tahrirlash va o'chirish.
- Excel (.xlsx, .xls, .csv) va Word (.docx) yoki .txt fayldan import. Yuklashdan oldin tekshiruv jadvali chiqadi.
- Takror savollar rad etiladi: qo'lda yozilganda, fayl ichida va bazadagilar bilan solishtirilganda. Server ham tekshiradi.
- Javob to'g'ri yoki noto'g'riligi darhol ko'rinadi, to'g'ri javob va izoh ham chiqadi.
- "Mashq" va "Imtihon" rejimlari. Savollar soni tanlanadi, savollar va variantlar aralashtiriladi.
- Natijalar bazada saqlanadi: guruh reytingi, shaxsiy tarix, 5 ballik baho, vaqt.
- "Xatolar ustida ishlash": har bir foydalanuvchining xato qilgan savollari saqlanadi va qayta beriladi.
- "Eng qiyin savollar": guruh eng ko'p xato qilgan savollar.
- Natijalarni Excelga yuklab olish va Excel shabloni.
- Guruh egasi a'zolarga ham savol qo'shishga ruxsat bera oladi.
- Tungi rejim, telefonga moslashgan dizayn, klaviatura bilan yechish (A–D, Enter).

## Kompyuterda ishga tushirish

Node.js 20 yoki undan yangi versiya kerak.

```bash
npm install
npm start
```

Brauzerda `http://localhost:3000` ni oching.

Ma'lumotlar `data/texnikum.db` faylida (SQLite) saqlanadi. Zaxira nusxa olish uchun shu faylni nusxalash kifoya.

## Internetga joylashtirish

Saytga doimiy disk kerak, aks holda baza o'chib ketadi.

### 1-variant: VPS (tavsiya etiladi)

Istalgan Linux VPS (masalan, oyiga 4–6 dollarlik) va Docker:

```bash
docker build -t texnikum-test .
docker run -d --name texnikum-test --restart unless-stopped \
  -p 80:3000 -v texnikum-data:/data -e COOKIE_SECURE=0 texnikum-test
```

Domen va HTTPS uchun oldiga Caddy yoki Nginx qo'yish mumkin. HTTPS yoqilgandan keyin `COOKIE_SECURE=1` qiling.

Caddy bilan eng oddiy usul (`/etc/caddy/Caddyfile`):

```
test.sizningdomen.uz {
  reverse_proxy localhost:3000
}
```

Bunda konteynerni `-p 3000:3000` bilan ishga tushiring.

### 2-variant: Railway yoki shunga o'xshash xizmat

1. Loyihani GitHub'ga yuklang.
2. Railway'da "Deploy from GitHub" ni tanlang. Dockerfile avtomatik topiladi.
3. "Volume" qo'shib, uni `/data` ga ulang.
4. O'zgaruvchilar: `DATA_DIR=/data`, `COOKIE_SECURE=1`.

Render'ning bepul tarifida doimiy disk yo'q, u yerda baza qayta ishga tushganda o'chib ketadi.

## Sozlamalar

| O'zgaruvchi | Ma'nosi | Standart |
|---|---|---|
| `PORT` | Server porti | `3000` |
| `DATA_DIR` | Baza fayli papkasi | `./data` |
| `COOKIE_SECURE` | Faqat HTTPS orqali kirish cookie'si (`1` yoki `0`) | `0` |

## Excel formati

| Bo'lim | Savol | A | B | C | D | Javob | Izoh |
|---|---|---|---|---|---|---|---|
| Elektr toki | Tok kuchi birligi nima? | Volt | Amper | Om | Vatt | B | |

"Javob" ustuniga harf, raqam yoki to'g'ri variant matni yoziladi. Agar javob ustuni bo'lmasa va import oynasida belgilansa, birinchi variant to'g'ri deb olinadi.

## Word formati

```
Bo'lim: Elektr toki
1. Tok kuchi birligi nima?
A) Volt
*B) Amper
C) Om
D) Vatt

2. Kuchlanish qaysi asbob bilan o'lchanadi?
A) Ampermetr
B) Voltmetr
Javob: B
```

Eski `.doc` fayllarni Word'da `.docx` qilib saqlab, keyin yuklang.

## Tuzilishi

- `server.js`: Express server, API va SQLite baza.
- `public/`: sayt sahifasi (`index.html`, `app.js`, `styles.css`).
- Excel va Word fayllari brauzerning o'zida o'qiladi, server faqat tayyor savollarni qabul qiladi.

Eslatma: mashq paytida javob darhol ko'rsatilgani uchun to'g'ri javoblar brauzerga yuboriladi. Bu o'quv mashqi uchun mo'ljallangan. Rasmiy imtihon uchun javoblarni serverda tekshiradigan alohida rejim kerak bo'ladi.

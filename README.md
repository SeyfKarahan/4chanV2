<<<<<<< HEAD
# 404 Name not Found (`/nnf/`)

Firebase (Firestore + Hosting + Cloud Functions) üzerinde çalışan, gerçek zamanlı, anonim bir mesaj akışı / imageboard.

🔗 Canlı site: https://404-nnf.web.app

## Özellikler

- **Anonim, gerçek zamanlı akış** — kimlik/kayıt gerekmez, mesajlar anında herkese yayılır (Firestore `onSnapshot`)
- **Sıralı mesaj numarası** (`#1`, `#2`, ...) — her mesaja kalıcı bir `seq` numarası atanır
- **Yanıt sistemi** — `>>123` yazarak başka bir mesaja referans verilebilir, tıklanınca o mesaja atlar; "Reply" butonuyla otomatik eklenir
- **Hover önizleme** — bir `>>123` linkinin üstüne gelince mesaj içeriği önizlemesi çıkar
- **Greentext** — `>` ile başlayan satırlar yeşil renklenir (klasik imageboard stili)
- **Sayfalama** — İlk/Son sayfa, ileri/geri, belirli bir sayfaya direkt atlama, toplam sayfa sayısı
- **Tüm sohbette arama** — mesaj metninde anlık arama (debounce'lu, taranan mesaj sayısı sınırlı)
- **İki görünüm modu** — Classic (forum tarzı, en yeni üstte) / Chat (en yeni altta, mesaj kutusu altta)
- **Açık/koyu tema**
- **Masaüstü bildirimleri** — sekme arka plandayken yeni mesajda favicon rozeti, başlık sayacı ve (izin verilirse) tarayıcı bildirimi
- **Telegram bot entegrasyonu** — yeni mesaj geldiğinde bir Telegram grubuna/kişiye bildirim gönderir (Cloud Function, `functions/index.js`)
- **Az veri kullanımı gözetilerek tasarlandı** — sayfalama, arama tarama sınırı, sekme görünürlüğüne duyarlı dinleyici gibi optimizasyonlarla Firestore okuma/yazma maliyeti düşük tutulmaya çalışıldı

## Teknoloji

- Düz HTML / CSS / JavaScript (framework yok, build adımı yok)
- Firebase Firestore (veritabanı)
- Firebase Hosting (statik barındırma)
- Firebase Cloud Functions — 2nd gen (Telegram bildirimi için)

## Kurulum

```bash
git clone https://github.com/SeyfKarahan/4chanV2.git
cd 4chanV2
npm install
cd functions && npm install && cd ..
```

`public/firebase-config.js` içine kendi Firebase proje bilgilerini gir (Firebase Console → Project settings → Web app).

`functions/.env` dosyasına Telegram bot bilgilerini gir:
```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_CHAT_ID=...
```

## Deploy

```bash
firebase deploy --only hosting:404-nnf
firebase deploy --only functions
firebase deploy --only firestore:rules
```

## Klasör yapısı

```
4chanV2/
├── public/              # site dosyaları (index.html, app.js, style.css, firebase-config.js)
├── functions/           # Telegram bildirim Cloud Function'ı
├── firestore.rules       # veritabanı güvenlik kuralları
├── firebase.json         # Firebase Hosting/Functions/Firestore ayarları
└── .firebaserc            # Firebase proje eşlemesi
```

## Notlar

- Mesajlar silinmez / düzenlenemez (`firestore.rules` bunu engelliyor) — anonim akışın doğası gereği.
- IP adresi ya da konum bilgisi loglanmıyor.
=======
# 4chanV2
>>>>>>> 2dbdca418d87f9f9145139c4380412a6cb61e44f

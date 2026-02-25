# Med Shifter - Backend Setup Guide

## Proje Yapısı

```
medshifter/
├── index.html          # Landing sayfası
├── app.html            # Ana uygulama
├── login.html          # Giriş/Kayıt sayfası
├── profile.html        # Profil ve takvim geçmişi
├── pricing.html        # Fiyatlandırma
├── support.html        # Destek
├── styles.css          # Genel stiller
├── app.js              # Uygulama JavaScript
└── server/             # Backend API
    ├── package.json
    ├── .env
    ├── prisma/
    │   └── schema.prisma
    └── src/
        ├── index.js          # Ana server
        ├── middleware/
        │   └── auth.js       # JWT middleware
        ├── routes/
        │   ├── auth.js       # Auth endpoints
        │   ├── calendars.js  # CRUD endpoints
        │   └── user.js       # Profil endpoints
        └── services/
            └── limits.js     # Plan limitleri
```

---

## Yerel Geliştirme

### 1. PostgreSQL Kurulumu

```bash
# macOS
brew install postgresql
brew services start postgresql

# Veritabanı oluştur
createdb medshifter
createuser medshifter -P  # Şifre: medshifter123
```

### 2. Backend Başlatma

```bash
cd server

# Bağımlılıkları yükle
npm install

# .env dosyasını düzenle
# DATABASE_URL="postgresql://medshifter:medshifter123@localhost:5432/medshifter?schema=public"

# Prisma migrate
npx prisma generate
npx prisma migrate dev

# Sunucuyu başlat
npm run dev
```

### 3. Frontend Başlatma

```bash
# Ana dizinde
npx http-server -p 8888
```

---

## Hostinger VPS Deployment

### 1. Sunucu Hazırlığı

```bash
# SSH bağlantısı
ssh root@your-vps-ip

# Güncellemeler
apt update && apt upgrade -y

# PostgreSQL kurulumu
apt install postgresql postgresql-contrib -y

# Node.js kurulumu
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
apt install nodejs -y

# PM2 kurulumu
npm install -g pm2

# Nginx kurulumu
apt install nginx -y
```

### 2. PostgreSQL Ayarları

```bash
# PostgreSQL'e gir
sudo -u postgres psql

# Veritabanı ve kullanıcı oluştur
CREATE USER medshifter WITH PASSWORD 'güçlü-şifre';
CREATE DATABASE medshifter OWNER medshifter;
GRANT ALL PRIVILEGES ON DATABASE medshifter TO medshifter;
\q
```

### 3. Proje Yükleme

```bash
# Dizin oluştur
mkdir -p /var/www/medshifter
cd /var/www/medshifter

# Dosyaları yükle (scp veya git ile)
scp -r * root@your-vps-ip:/var/www/medshifter/

# Backend kurulumu
cd server
npm install --production

# .env dosyasını düzenle
nano .env
# DATABASE_URL="postgresql://medshifter:güçlü-şifre@localhost:5432/medshifter"
# JWT_SECRET="çok-güçlü-rastgele-string-buraya"
# FRONTEND_URL=https://your-domain.com

# Prisma migrate
npx prisma generate
npx prisma migrate deploy

# PM2 ile başlat
pm2 start src/index.js --name medshifter-api
pm2 save
pm2 startup
```

### 4. Nginx Konfigürasyonu

```nginx
# /etc/nginx/sites-available/medshifter
server {
    listen 80;
    server_name your-domain.com;

    # Frontend static files
    location / {
        root /var/www/medshifter;
        index index.html;
        try_files $uri $uri/ /index.html;
    }

    # API proxy
    location /api {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

```bash
# Siteyi etkinleştir
ln -s /etc/nginx/sites-available/medshifter /etc/nginx/sites-enabled/
nginx -t
systemctl restart nginx
```

### 5. SSL Sertifikası (Let's Encrypt)

```bash
apt install certbot python3-certbot-nginx -y
certbot --nginx -d your-domain.com
```

---

## API Endpoints

| Method | Endpoint | Açıklama |
|--------|----------|----------|
| POST | `/api/auth/register` | Yeni kullanıcı kaydı |
| POST | `/api/auth/login` | Giriş yap |
| GET | `/api/auth/me` | Kullanıcı bilgisi |
| GET | `/api/calendars` | Takvim listesi |
| POST | `/api/calendars` | Yeni takvim |
| PUT | `/api/calendars/:id` | Takvim güncelle |
| DELETE | `/api/calendars/:id` | Takvim sil |
| GET | `/api/user/usage` | Kullanım durumu |
| PUT | `/api/user/profile` | Profil güncelle |

---

## Plan Limitleri

| Plan | Takvim/ay | Koşul | Personel | Kaydet/ay | Export/ay |
|------|-----------|-------|----------|-----------|-----------|
| FREE | 1* | 5 | 5 | 1 | 1 |
| INDIVIDUAL | 5 | 10 | 20 | 5 | 5 |
| BUSINESS | 25 | 50 | 100 | 25 | 25 |

*Free plan ömür boyu 1 takvim hakkı

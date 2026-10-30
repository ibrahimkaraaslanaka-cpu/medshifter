# admin.medshifter.app yayına alma

1. Hostinger DNS'te `admin` için VPS IPv4 adresine A kaydı oluştur; DNS çözülmesini doğrula.
2. Sunucuda güncel kodu al, Node API'yi yeniden başlat. `server/data/` yazılabilir ve web kökünden gizli kalmalı.
3. `/var/www/letsencrypt/.well-known/acme-challenge/` yolunu oluştur. Önce yalnızca `deploy/admin-nginx.conf` dosyasındaki HTTP bloğunu Nginx'e ekle; HTTPS bloğunu sertifika oluşana kadar ekleme.
4. `certbot certonly --webroot -w /var/www/letsencrypt -d admin.medshifter.app` ile sertifikayı al.
5. Tam `deploy/admin-nginx.conf` dosyasını etkinleştir; `nginx -t && systemctl reload nginx` çalıştır.
6. `https://admin.medshifter.app/login.html` üzerinden giriş, yetkisiz API erişimi, site ayarları kaydetme, fiyat güncelleme ve ana site checkout fiyatı doğrulamasını yap.

Panel ana sitede `/admin/` yolunda da çalışır. `admin.html` ve `admin-login.html` eski bağlantıları bu yola yönlendirir.

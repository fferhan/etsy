# Etsy Listing Optimizer

Etsy listinglerini çekip Claude ile SEO optimizasyonu yapan, değişiklikleri
Etsy'ye geri yazan ve Pinterest'e pin paylaşan Node.js araç seti.

**Claude'un işi:** başlık optimizasyonu, açıklama yazımı, attribute kontrolü, optimizasyon planı.
**Sizin işiniz:** tag'ler (SEO araştırmasıyla), fotoğraflar, fiyatlandırma.

> **Tag'lere bu araç dokunmaz.** Tag yazımı eRank / Marmalead gibi araçlarla arama
> hacmi ve rekabet analizi gerektiriyor — bu veri modelde yok. Araç yalnızca
> tag'lerdeki bariz sorunları (boş slot, başlıkla birebir tekrar) rapor eder.

## Kurulum

```bash
node --version          # v20 veya üzeri gerekli
npm install
cp .env.example .env    # sonra .env içini doldurun
```

### Gerekli anahtarlar

| Değişken | Nereden | Ne için |
| --- | --- | --- |
| `ETSY_API_KEY` | [Etsy Developer portalı](https://www.etsy.com/developers) | Listing okuma |
| `ETSY_ACCESS_TOKEN` | Etsy OAuth2 (`listings_r listings_w` scope) | Listing yazma (`apply.js`) |
| `ETSY_SHOP_ID` | `node scrape.js --whoami` | Mağazanızı belirtir |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) | Optimizasyon |
| `PINTEREST_ACCESS_TOKEN` | [Pinterest developers](https://developers.pinterest.com) | Pin paylaşımı |
| `PINTEREST_BOARD_ID` | `node pinterest_post.js --boards` | Hangi board'a pinlenecek |

Yalnızca optimizasyon yapacaksanız Pinterest anahtarları gerekmez; her komut
kendi ihtiyacı olan değişkenleri kontrol eder.

## Akış

```
scrape.js  ──►  optimize_all.js  ──►  apply.js  ──►  pinterest_post.js
(çek)           (Claude ile yaz)      (geri yaz)     (pin paylaş)
```

```bash
node scrape.js                    # tüm aktif listingleri data/listings.json'a çek
node optimize.js --index 0        # tek listingle dene, çıktıyı gör
node optimize_all.js              # hepsini optimize et + optimizasyon planı çıkar
node apply.js                     # kuru çalışma: ne yazılacağını göster
node apply.js --yes               # gerçekten Etsy'ye yaz
node pinterest_post.js --yes --limit 10
```

## Komutlar

### `scrape.js` — listingleri çek

```bash
node scrape.js                      # aktif listingler
node scrape.js --state draft        # taslaklar
node scrape.js --limit 20
node scrape.js --with-properties    # attribute'ları da çek (listing başına 1 istek)
node scrape.js --whoami             # ETSY_SHOP_ID'nizi bulun
```

Çekerken her listingi kurallara göre denetler; sonuç `data/listings.json` içinde
her listingin `audit` alanına yazılır.

### `scrape_new.js` — sadece yeni/değişmiş olanlar

Var olan `listings.json` ile karşılaştırır, farkı `data/new-listings.json`'a yazar.
500+ listingli mağazalarda API kotası korumak için.

```bash
node scrape_new.js
node scrape_new.js --no-merge       # listings.json'a dokunma, sadece farkı yaz
```

### `optimize.js` — tek listing

Toplu işe geçmeden önce çıktıyı görmek için. Eski/yeni başlık, açıklama,
eksik attribute'lar ve tag notlarını ekrana basar.

```bash
node optimize.js --id 1234567890
node optimize.js --index 0 --save   # sonucu optimized.json'a ekle
```

### `optimize_all.js` — toplu optimizasyon

```bash
node optimize_all.js
node optimize_all.js --concurrency 5
node optimize_all.js --limit 10 --only-flagged      # sadece kural ihlali olanlar
node optimize_all.js --input new-listings.json
node optimize_all.js --force                        # işlenmişleri yeniden işle
```

Daha önce optimize edilmiş listingleri varsayılan olarak atlar, yani yarıda kalan
iş kaldığı yerden devam eder. İki çıktı üretir:

- `data/optimized.json` — listing başına eski/yeni metin, denetim sonucu, token kullanımı
- `data/optimization-plan.md` — okunabilir plan: özet tablo, eksik attribute'lar,
  tag notları, elle kontrol gerekenler

### `apply.js` — Etsy'ye geri yaz

**Varsayılan kuru çalışmadır.** Gerçekten yazmak için `--yes` gerekir.
Tag'lere, fiyatlara ve görsellere hiçbir koşulda dokunmaz.

```bash
node apply.js                       # ne yazılacağını göster
node apply.js --yes
node apply.js --yes --id 1234567890
node apply.js --yes --limit 5
node apply.js --yes --title-only
node apply.js --yes --skip-broken=false   # kural ihlali kalanları da yaz
```

Optimizasyondan sonra hâlâ kural ihlali olan listingler varsayılan olarak atlanır —
bunlar plan dosyasında elle kontrol için işaretli. Yazılan her listingin **eski metni**
`data/applied.json` içinde saklanır, geri almak için kullanabilirsiniz.

### `pinterest_post.js` / `pin_remaining.js`

`pinterest_post.js` verilen listingleri pinler; `pin_remaining.js` yalnızca
`data/pinned.json`'da kayıtlı olmayanları pinler. Günlük/parçalı paylaşım için
ikincisini kullanın — her pin sonrası kaydeder, iş yarıda kalırsa aynı ürün
iki kez pinlenmez.

```bash
node pinterest_post.js --boards              # board ID'lerinizi listele
node pinterest_post.js --yes --limit 10
node pinterest_post.js --yes --optimized     # optimize edilmiş metinleri kullan
node pin_remaining.js                        # kaç tane kaldı
node pin_remaining.js --yes --limit 20
```

Her ikisi de varsayılan olarak kuru çalışır.

## SEO kuralları

Varsayılan kurallar `lib/rules.js` içinde (`ETSY_RULES`):

- Başlık `MAX_TITLE_LENGTH` (varsayılan 70) karakterin altında, doğal dilde
- En önemli ürün ifadesi ilk 30–40 karakterde
- Başlıkta tekrar eden kelime yok
- Açıklama `MIN_DESCRIPTION_LENGTH` (varsayılan 1000) karakter üzeri
- Birincil anahtar kelime açıklamanın ilk 160 karakterinde
- Eksik attribute'lar tespit edilip listelenir
- Tag üretilmez

Kendi SEO dokümanınız varsa varsayılanın yerine geçirin:

```bash
ETSY_RULES_FILE=./benim-kurallarim.md node optimize_all.js
```

Bu kurallar iki yerde kullanılıyor: Claude'a sistem promptu olarak gider, **ve**
`lib/rules.js:auditListing` ile hem girdi hem de modelin çıktısı programatik olarak
denetlenir. Yani model kurala uymayan bir başlık üretirse bu sessizce geçmez —
plana düşer ve `apply.js` o listingi varsayılan olarak yazmaz.

## Maliyet

Kurallar sistem promptunda sabit bir ön-ek olarak gönderilir ve 1 saat TTL ile
cache'lenir; sadece listing verisi değişir. İlk çağrıdan sonraki her listing
kuralları cache'ten okur. `optimize_all.js` çalışma sonunda toplam token ve
cache okuma miktarını basar.

Model varsayılanı `claude-opus-5`. `CLAUDE_MODEL` ile değiştirebilirsiniz.

## Test

```bash
npm test
```

Sahte bir Etsy / Pinterest / Anthropic sunucusuna karşı
`scrape → optimize_all → apply → pin` zincirini uçtan uca çalıştırır.
Gerçek API'lere istek atmaz, anahtar gerektirmez.

## Dosya düzeni

```
scrape.js           Listingleri çek
scrape_new.js       Sadece yeni/değişmiş olanları çek
optimize.js         Tek listing optimize et
optimize_all.js     Toplu optimize et + plan çıkar
apply.js            Değişiklikleri Etsy'ye geri yaz
pinterest_post.js   Pin paylaş
pin_remaining.js    Kalan pinleri paylaş
lib/
  config.js         Ortam değişkenleri ve limitler
  etsy.js           Etsy Open API v3 istemcisi (retry + rate limit)
  claude.js         Anthropic istemcisi, yapısal çıktı, eşzamanlılık havuzu
  pinterest.js      Pinterest API v5 istemcisi
  rules.js          SEO kuralları + programatik denetçi
  store.js          data/ altına atomik JSON yazma
  cli.js, log.js    Argüman ayrıştırma, çıktı
test/
  run.js            Birim + uçtan uca testler
  mock-server.js    Sahte API sunucusu
```

Tüm veriler `data/` altına yazılır ve `.gitignore` ile dışarıda tutulur.

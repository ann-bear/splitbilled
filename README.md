# SplitBilled 🧾

Split tagihan restoran & delivery dengan AI scan struk otomatis.
Pakai **Gemini API** (gratis 1500 req/hari).

## Cara dapat Gemini API Key (gratis)
1. Buka https://aistudio.google.com
2. Klik **Get API Key** → **Create API key**
3. Copy key-nya

## Deploy ke Vercel (5 menit)

### 1. Push ke GitHub
```bash
git init
git add .
git commit -m "init splitbilled"
```
Buat repo baru di github.com, lalu:
```bash
git remote add origin https://github.com/USERNAME/splitbilled.git
git push -u origin main
```

### 2. Deploy di Vercel
1. Buka https://vercel.com → **Add New Project**
2. Import repo GitHub tadi
3. Di bagian **Environment Variables**, tambahkan:
   - Key: `VITE_GEMINI_KEY`
   - Value: API key Gemini kamu
4. Klik **Deploy** ✅

## Dev lokal
```bash
npm install
echo "VITE_GEMINI_KEY=AIza..." > .env.local
npm run dev
```

## Tech Stack
- React 18 + Vite
- Google Gemini 2.0 Flash API (gratis)
- Canvas API (share as image)
- Deploy: Vercel

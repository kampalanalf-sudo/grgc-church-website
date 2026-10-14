# Gateway Revival Glory Church & Ministries (GRGC&M) — Website

Official website for **Gateway Revival Glory Church & Ministries**, Kampala, Uganda —
led by Vision Bearer **Pastor Agatha Christine Idusso** (“Mama Agatha”).
3 branches — City Church: 4th Floor, Corner House, Nakasero, Entebbe Road,
**Tema (Kikyusa–Tema)** and **Kayabwe (Masaka Road)**.

All stories, photos and testimonies are taken from the church's **12th Anniversary
magazine** (*“gateway recovered 2025 30th august.pdf”*, via Google Drive):
theme *“Not to us, O Lord…” (Psalm 115:1)*, launched 17 Aug 2013.

## Features
- ★ Main feature: **12th Anniversary Celebrations (30 Aug 2025)** with real photo gallery + lightbox
- Our Journey timeline (1989 → 2025), Vision / Mission / Goal
- Branches + City HQ banner with maps & directions
- **Word from the Vision Bearer** (real message & photo)
- **Projects**: Children's Home in Gayaza (then/now), Gospel of Actions (Shanga & Sumayah),
  Mother-to-Mother prayers, Kisenyi youth/Uncle Jonah, December gift exchange, education
- **Videos**: Sunday services & event videos (YouTube)
- **Testimonies**: 4 real testimonies with portraits + handwritten letters (zoomable)
- **Prayer requests**: form + WhatsApp prayer hotline
- **Give**: Mobile Money (MTN/Airtel), bank transfer & card checkout (demo)
- Floating **WhatsApp button** → +256 772 421 488
- Events, newsletter signup, contact footer

## Run locally
Just open `index.html` in a browser, or:
```bash
cd /home/user/iuea && python3 -m http.server 8080
# visit http://localhost:8080
```

## Customize
| Task | File |
|---|---|
| Add sermon videos (YouTube IDs) | `js/main.js` → `VIDEOS` array |
| Bank / MoMo details | `index.html` → `#give` section |
| Branch info & service times | `index.html` → `#branches` |
| Photos | `assets/images/real/` (from anniversary magazine) |
| Styling / colours | `css/styles.css` |

## Deploy
Static site — host anywhere: GitHub Pages, Netlify, Vercel, cPanel, etc.

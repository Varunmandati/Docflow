# DocFlow on Oracle Cloud — Always Free VM (24/7, $0/month)

A single Ubuntu VM runs everything: the React SPA, the Fastify API with
inline queue workers, StreamService (WebClient) and the LibreOffice/pdf2docx
conversion stack — from the root `Dockerfile` via `docker-compose.yml`.
Nothing sleeps, so upload downloads and conversion jobs keep running.

| | |
|---|---|
| **Cost** | $0 — Oracle *Always Free* resources, never billed |
| **Card** | Required at signup for verification only |
| **Machine** | `VM.Standard.A1.Flex`, 2 OCPU + 12 GB RAM (Ampere/ARM) |
| **Disk** | up to 200 GB total across all instances (free) |
| **Egress** | ~10 TB/month free |
| **Uptime** | 24/7, `restart: unless-stopped` survives reboots |

> **Why not the other free hosts?** Render suspended the account, Koyeb
> never provisioned, Hugging Face put Docker Spaces behind Pro (July 2026),
> and Fly.io's free tier is now a 7-day trial. A VM is the only route left
> that is both free and always-on.

---

## 1. Create the account

1. Go to <https://www.oracle.com/cloud/free/> → **Start for free**.
2. Use your real details and a credit/debit card (prepaid/virtual cards are
   often rejected). Nothing is charged; you get $300 of trial credit for
   30 days, and Always Free resources continue after it ends.
3. **Pick the home region carefully** — Always Free compute can only be
   created in the home region. Choose one near your users
   (e.g. **Mumbai `ap-mumbai-1`** or **Hyderabad `ap-hyderabad-1`** for India).

---

## 2. Create the VM

**Menu → Compute → Instances → Create instance**

| Setting | Value |
|---|---|
| Name | `docflow` |
| Image | **Change image → Ubuntu → Canonical Ubuntu 22.04/24.04** (aarch64) |
| Shape | **Change shape → Ampere → `VM.Standard.A1.Flex`**, `2` OCPU, `12 GB` (look for the **Always Free-eligible** badge) |
| Networking | keep the default VCN/security list it offers to create |
| Boot volume | `100` GB (image build needs ~15 GB; free allowance is 200 GB total) |
| SSH key | paste your public key — generate one with `ssh-keygen -t ed25519 -C docflow` and paste the contents of `~/.ssh/id_ed25519.pub` |

If the shape says *Out of capacity*, try another availability domain in the
same region, or another home region.

---

## 3. Open the firewall

**Menu → Networking → Virtual Cloud Networks → (your VCN) → Subnets →
Default Security List → Add ingress rules**:

| Type | Destination port | Source | Purpose |
|---|---|---|---|
| TCP | `8080` | `0.0.0.0/0` | the app |
| TCP + UDP | `6881`–`6891` | `0.0.0.0/0` | optional — inbound BinaryTransfer peers (outbound uploads work without it) |

SSH (`22`) is already open.

---

## 4. Deploy

```bash
ssh -i ~/.ssh/id_ed25519 ubuntu@<public-ip>

sudo apt-get update && sudo apt-get install -y git
git clone -b main https://github.com/Varunmandati/Docflow.git /opt/docflow

sudo bash /opt/docflow/deploy/oracle/setup.sh     # 1st run: Docker + .env template, then stops
sudo nano /opt/docflow/.env                       # fill in your secrets (see below)
sudo bash /opt/docflow/deploy/oracle/setup.sh     # 2nd run: builds the image and starts
```

The first run builds the whole image (npm + LibreOffice + pdf2docx), which
takes roughly 5–10 minutes on 2 OCPU.

### What must be filled in `.env`

Source of truth: [`.env.production.example`](.env.production.example).

| Section | Required values |
|---|---|
| 2 · Database | `DATABASE_URL`, `DATABASE_URL_WORKER`, `DATABASE_URL_DIRECT` (Neon), `RUN_MIGRATIONS_ON_START=true` |
| 5 · Email | `RESEND_API_KEY`, `EMAIL_FROM` |
| 6 · Auth | `FIREBASE_SERVICE_ACCOUNT` (single-line JSON) |
| 7 · Frontend | all six `VITE_FIREBASE_*` values — public browser identifiers |

Keep `VITE_API_BASE_URL` and `VITE_UPLOAD_SERVER_URL` **empty**: SPA and API
share one origin.

> `VITE_*` values are baked in at **build** time. After changing them,
> re-run `sudo bash deploy/oracle/setup.sh` (it rebuilds), not just a restart.

---

## 5. Verify

```bash
curl -s http://127.0.0.1:8080/health      # {"status":"ok",...}
docker compose -f /opt/docflow/docker-compose.yml ps
docker compose -f /opt/docflow/docker-compose.yml logs -f
```

Then open `http://<public-ip>:8080`:

- [ ] SPA loads (deep links like `/login` work — Fastify serves `index.html`)
- [ ] OTP email arrives (Resend)
- [ ] a Word/PDF/image converts and downloads
- [ ] adding a upload streams (and `/api/uploads` answers, not `502`)

---

## 6. Day-2 operations

```bash
cd /opt/docflow
sudo bash deploy/oracle/setup.sh   # git pull + rebuild + restart (deploys updates)
docker compose ps                  # status
docker compose logs -f             # logs
docker compose restart             # restart
docker compose down                # stop
```

`restart: unless-stopped` keeps the stack up across VM reboots.

**If the VM is tight on memory** (it shouldn't be at 12 GB): set
`STREAM_ENABLED=false` in `.env` to drop StreamService, or raise
`NODE_OPTIONS=--max-old-space-size=768` for faster conversions.

---

## 7. Keep it free

- Only ever pick resources badged **Always Free-eligible** (shape
  `VM.Standard.A1.Flex` ≤ 2 OCPU/12 GB total, or `VM.Standard.E2.1.Micro`).
- Never accept a paid/committed shape; the bill should always read **$0** —
  check **Billing → Cost Analysis** once after setup.
- Upgrading the account to Pay As You Go is optional and keeps Always Free
  free, but anything above the Always Free allowance then starts billing.
- Oracle may treat accounts idle for 30+ days as abandoned — sign into the
  console every few weeks.
- The VM itself is used continuously by the running service.

---

## 8. HTTPS (optional)

Plain `http://<ip>:8080` is fine for OTP email login. **Google popup
sign-in requires a secure context (HTTPS)** — either point a domain at the VM
behind a free reverse proxy, or use a quick Cloudflare Tunnel while testing:

```bash
docker run --rm --network host cloudflare/cloudflared \
  tunnel --url http://127.0.0.1:8080
```

It prints a temporary `https://…trycloudflare.com` URL.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| `setup.sh` stops asking to edit `.env` | expected on the first run — placeholders still present |
| Port 8080 unreachable from outside | missing ingress rule in the Default Security List (§3) |
| Container restarts / unhealthy | `docker compose logs --tail=200` — usually a bad `DATABASE_URL` |
| Builds run out of memory | raise the shape to 2 OCPU/12 GB (§2); `npm ci` needs the headroom |
| Uploads show no peers | outbound works regardless; open `6881-6891` for inbound peers |
| Oracle says out of capacity | different AD, or a different home region |

**Sign-up or capacity failed?** Alternatives with a card:
AWS Free Tier `t4g.micro` (12 months), Azure `B1s` (12 months), or run the
same `docker compose` on your own PC behind a Cloudflare Tunnel.

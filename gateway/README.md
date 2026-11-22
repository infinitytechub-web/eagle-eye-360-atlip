# ATLIP CCTV Gateway

Runs **inside the camera network** (a small server at the command centre or on a Hostinger VPS with a VPN to the
camera VLAN). It is the only component that ever talks to cameras.

```
IP cameras ──RTSP/TCP──► ATLIP gateway (Node + FFmpeg) ──HTTPS (Caddy)──► browsers (CCTV Surveillance Centre)
                           │  • AES-256-GCM vault: RTSP URLs & passwords
                           │  • ticketed HLS (5-min, camera-bound, HMAC)
                           │  • server-side AI (YOLO11 + ATLIP state CNN)
                           │  • health monitor → camera status & alerts
                           └──► Supabase (as least-privilege "gateway" account)
```

## What it guarantees
| Concern | How |
|---|---|
| Camera credentials | Stored only in `data/vault.enc` (AES-256-GCM, key in `.env`). Never sent to Supabase or browsers; masked in logs. |
| Who may watch | Viewer's Supabase session is verified; profile must be **active** with a CCTV role (Super/System Admin, Supervisor, Analyst, Operator, Support Officer). Auditors and service accounts cannot view live video. |
| Stream links | 5-minute HMAC tickets bound to user + camera, carried in the URL instead of the login token. Forged, expired or cross-camera tickets are refused. |
| Oversight | Every live view creates a `cctv_sessions` row (user, camera, start, last activity) and an audit entry, visible to administrators, supervisors and auditors. |
| Blast radius | The gateway's Supabase account (role `gateway`) can only update **health fields of its own cameras**, post `gateway` detections for them, set the observed state of their intersections, and write sessions/camera audit entries. It cannot rename cameras, change settings, post messages, raise tickets, chat, edit branding or escalate its role (enforced by RLS + triggers; tested). |
| Network exposure | Binds to 127.0.0.1; only `/health` and `/v1/*` are published through Caddy with automatic HTTPS. CORS allows only the platform origin. Ticket issuance is rate-limited. |

## Verified (22 Nov 2026, sandbox with a dashcam clip as the camera source)
- 15/15 API security tests (no login, wrong role, service account, unassigned camera, forged ticket, cross-camera ticket, file traversal, CORS, renewal).
- 12/12 least-privilege tests for the gateway account.
- Live 720p playback in the CCTV Centre with ~1 s buffer; ticket renewal; AI overlay.
- Server-side AI ~110 ms/frame (2 CPU threads) → about 8 cameras at 1 fps per 2-core host; verified RED/GREEN changes written to the event log and intersection state.
- Not tested here: a physical RTSP camera (the RTSP input path uses standard FFmpeg options — `-rtsp_transport tcp`).

## Install (Docker — recommended)
Requirements: Linux host with Docker, reachable to the cameras, a DNS name (e.g. `gw-accra.infinitytechub.com`) pointing to it with ports 80/443 open.

1. **In the platform** (Super Administrator):
   - System Administration → *Create user account* → role **CCTV Gateway (service account)**, e.g. `gw-accra-01@gateway.atlip.local`. Copy the temporary password.
   - CCTV Surveillance Centre → *Register a gateway*: ID `gw-accra-01`, URL `https://gw-accra.infinitytechub.com`, link the service account.
2. **On the gateway host:**
   ```bash
   git clone https://github.com/infinitytechub-web/eagle-eye-360-atlip.git && cd eagle-eye-360-atlip
   cp gateway/.env.example gateway/.env && chmod 600 gateway/.env
   docker run --rm -v "$PWD/gateway:/g" -w /g node:22-slim node src/cli.js keygen   # paste output into gateway/.env
   # edit gateway/.env: GATEWAY_ID, GATEWAY_DOMAIN, GATEWAY_ACCOUNT_EMAIL/PASSWORD
   docker compose -f gateway/docker-compose.yml --env-file gateway/.env up -d --build
   ```
3. **Add cameras** (entered interactively so passwords stay out of shell history):
   ```bash
   docker compose -f gateway/docker-compose.yml exec gateway node src/cli.js add CAM-01
   docker compose -f gateway/docker-compose.yml exec gateway node src/cli.js test CAM-01
   ```
   Camera IDs must match the platform. Then in CCTV Surveillance Centre assign each camera to the gateway and tick **Live** (and **AI**).
4. **CSP:** the web app allows gateways under `https://*.infinitytechub.com`. If you use another domain, add it to
   `connect-src` and `media-src` in `public/.htaccess` and redeploy.

### Without Docker (Ubuntu)
```bash
sudo apt install -y ffmpeg nodejs npm
sudo useradd --system atlip && sudo mkdir -p /opt/atlip-gateway && sudo cp -r gateway/* /opt/atlip-gateway/
sudo cp public/models/atlip-detector-yolo11n.onnx public/models/atlip-state-v2.onnx /opt/atlip-gateway/models/
cd /opt/atlip-gateway && sudo npm ci --omit=dev && sudo chown -R atlip /opt/atlip-gateway
sudo cp deploy/atlip-gateway.service /etc/systemd/system/ && sudo systemctl enable --now atlip-gateway
```
Put Caddy (or nginx) in front for HTTPS using `deploy/Caddyfile`.

## Camera settings for best results
- H.264, 720p–1080p, **I-frame (keyframe) interval 1–2 s** — live latency is roughly 2–3 segments; video is passed through without re-encoding for RTSP sources (`--transcode` forces re-encoding, e.g. for H.265 cameras).
- Use a dedicated read-only camera user for the gateway. Keep cameras on an isolated VLAN with no internet access.

## Operations
- Logs are JSON lines on stdout (`docker compose logs -f gateway`); credentials and tokens are never logged.
- Status: CCTV Surveillance Centre → Gateways (heartbeat every 30 s; offline after 2 min without one).
- Rotating secrets: new `GATEWAY_TICKET_SECRET` invalidates outstanding tickets only. Changing `GATEWAY_VAULT_KEY` requires re-adding camera sources.
- Back up `data/vault.enc` **and** the vault key separately.

## Legal
Live CCTV processing of road users is personal-data processing. Operate under the Data Protection Act, 2012 (Act 843),
with the necessary authorisations from road/property authorities; keep viewing restricted to authorised roles and review
the session log regularly. ATLIP observes signals only — it never connects to traffic-light control systems.

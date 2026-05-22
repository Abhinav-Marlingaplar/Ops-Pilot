# OpsPilot — Cloud-Native CI/CD Platform

A full-stack CI/CD automation platform built from scratch. Push code to GitHub and watch it automatically clone, test, build a Docker image, and report results through a live dashboard.

## Demo

**Landing Page → GitHub Login → Live Dashboard → Real-time Build Logs**

- Connect any GitHub repo from the dashboard
- Every push to the default branch triggers a build automatically
- Watch logs stream line by line in real time via Socket.IO
- Pipeline stage tracker (Clone → Install → Test → Docker → Complete)

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite, Socket.IO client |
| Backend | Node.js, Express, Socket.IO |
| Database | PostgreSQL |
| Queue | RabbitMQ |
| Auth | GitHub OAuth 2.0, session cookies |
| CI Worker | Node.js (git, npm, Docker CLI) |
| Containers | Docker, Docker Compose |
| Orchestration | Kubernetes (Minikube / k3s) |
| Autoscaling | Kubernetes HPA (1→5 worker pods) |

---

## Architecture

```
GitHub Push
    │
    ▼
POST /webhook/github  (HMAC-SHA256 verified)
    │
    ▼
Express Backend  ──→  PostgreSQL (build record)
    │
    ▼
RabbitMQ queue
    │
    ▼
Worker Service
    ├── git clone
    ├── npm install
    ├── npm test
    └── docker build
    │
    ▼
Socket.IO  ──→  React Dashboard (live logs)
```

---

## Quick Start

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- A GitHub OAuth App ([create one here](https://github.com/settings/developers))

### 1. Clone and install

```bash
git clone https://github.com/Abhinav-Marlingaplar/cicd-platform.git
cd cicd-platform

npm install --prefix backend
npm install --prefix worker
npm install --prefix frontend
```

### 2. Configure environment

```bash
cp backend/.env.example backend/.env
cp worker/.env.example worker/.env
cp frontend/.env.example frontend/.env
```

Fill in `backend/.env` with your GitHub OAuth credentials and generated secrets. See `.env.example` for all required variables.

### 3. Start infrastructure

```bash
docker start cicd-postgres cicd-rabbitmq
# or first time:
docker run -d --name cicd-postgres -e POSTGRES_USER=cicd_user -e POSTGRES_PASSWORD=cicd_pass -e POSTGRES_DB=cicd_db -p 5432:5432 postgres:15
docker run -d --name cicd-rabbitmq -p 5672:5672 -p 15672:15672 rabbitmq:3-management
```

### 4. Start the platform

```bash
# Terminal 1
cd backend && npm run dev

# Terminal 2
cd worker && npm run dev

# Terminal 3
cd frontend && npm run dev
```

Open [http://localhost:5173](http://localhost:5173)

### 5. Trigger a build manually

```bash
curl -X POST http://localhost:3000/webhook \
  -H "Content-Type: application/json" \
  -H "Cookie: cicd_session=<your-session-cookie>" \
  -d '{"repository":"https://github.com/expressjs/express","branch":"master","commit":"HEAD"}'
```

---

## Kubernetes Deployment (Minikube)

```bash
minikube start --memory=1800mb --cpus=2
./scripts/build-images.sh
./scripts/deploy.sh

# Get dashboard URL
minikube service backend-nodeport -n cicd --url
```

---

## Project Structure

```
cicd-platform/
├── backend/          # Express API + Socket.IO + OAuth
├── worker/           # RabbitMQ consumer + pipeline runner
├── frontend/         # React dashboard + landing page
├── k8s/              # Kubernetes manifests (11 files)
├── scripts/          # build-images.sh, deploy.sh, teardown.sh
└── docker-compose.yml
```

---

## Features by Phase

- **Weeks 1-4** — Core pipeline, worker, dashboard, Kubernetes, HPA autoscaling
- **Phase 1** — GitHub OAuth, multi-user auth, session management
- **Phase 2** — Repository connection, automatic webhook registration, HMAC verification
- **Phase 3** *(in progress)* — Worker isolation, Oracle Cloud VM, k3s
- **Phase 4** *(planned)* — Docker push to GHCR, auto-deploy to k3s
- **Phase 5** *(planned)* — Public deployment (Vercel + Render + Neon + CloudAMQP)

---

Built by Abhinav Marlingaplar
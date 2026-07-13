# BertCRM

Development workspace for BertCRM.

## Stack

- Frontend: React + Vite + TypeScript
- Backend: NestJS + TypeScript
- Database: Prisma ORM + SQLite
- Package manager: npm workspaces

## Getting started

```bash
npm install
npm run prisma:generate
npm run dev
```

Frontend runs at http://localhost:5173.
Backend API runs at http://localhost:3000/api.

## Useful scripts

```bash
npm run dev
npm run dev:frontend
npm run dev:backend
npm run build
npm run lint
npm run test
npm run prisma:generate
npm run prisma:migrate
npm run prisma:deploy
npm run prisma:studio
```

## Project layout

```text
frontend/  React application powered by Vite
backend/   NestJS API application
```

The SQLite database defaults to `backend/prisma/dev.db`. Set `DATABASE_URL`
in `backend/.env` only when you need to override that path.

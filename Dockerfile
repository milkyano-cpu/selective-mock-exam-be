# ================= BUILDER =================
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npx prisma generate
RUN npm run build

RUN npm prune --omit=dev

# ================= DEVELOPMENT =================
FROM node:20-alpine AS development

RUN apk add --no-cache dumb-init

WORKDIR /app

COPY package*.json ./
RUN npm ci

ENV NODE_ENV=development
EXPOSE 3001

ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "dev"]

# ================= PRODUCTION =================
FROM node:20-alpine AS production

RUN apk add --no-cache dumb-init && \
    addgroup -S nodejs && adduser -S nodejs -G nodejs

WORKDIR /app

COPY --chown=nodejs:nodejs --from=builder /app/package.json ./

COPY --chown=nodejs:nodejs --from=builder /app/node_modules ./node_modules

COPY --chown=nodejs:nodejs --from=builder /app/dist ./dist
COPY --chown=nodejs:nodejs --from=builder /app/prisma ./prisma

USER nodejs

ENV NODE_ENV=production
EXPOSE 3001

HEALTHCHECK CMD node -e "const http=require('http');const req=http.get('http://localhost:3001/health',res=>process.exit(res.statusCode===200?0:1));req.on('error',()=>process.exit(1));"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/server.js"]
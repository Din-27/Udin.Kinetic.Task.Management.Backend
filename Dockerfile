# Stage 1: Build & Dependencies
FROM node:24-alpine AS builder
WORKDIR /app

# Install dependencies lebih cepat via lockfile
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Copy seluruh source code dan build
COPY . .
RUN npm run build

# Stage 2: Production Runtime
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Install hanya dependencies production
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --only=production && npm cache clean --force

# Copy hasil generate Prisma & hasil build dari stage 1
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/dist ./dist

# Non-root user untuk keamanan
USER node

EXPOSE 5000
CMD ["node", "dist/index.js"]
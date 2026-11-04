# Stage 1: Build & Dependencies
FROM node:24-alpine AS builder
WORKDIR /app

# Pasang pustaka sistem agar prisma generate dapat mendeteksi engine
RUN apk add --no-cache openssl libc6-compat

COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci

# Generate client dan build aplikasi
RUN npx prisma generate
COPY . .
RUN npm run build

# Stage 2: Production Runtime
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Wajib pasang di stage runtime karena stage runner adalah image Alpine yang bersih
RUN apk add --no-cache openssl libc6-compat

# Install hanya dependencies production
COPY package*.json ./
COPY prisma ./prisma/
RUN npm ci --omit=dev && npm cache clean --force

# Generate ulang Prisma Client di environment production
RUN npx prisma generate

# Copy hasil build dari stage builder
COPY --from=builder /app/dist ./dist

# Non-root user
USER node

EXPOSE 5000
CMD ["node", "dist/index.js"]
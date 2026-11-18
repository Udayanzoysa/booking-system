FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY next.config.ts tsconfig.json postcss.config.mjs ./
COPY public ./public
COPY app ./app
COPY components ./components
COPY lib ./lib

ARG NEXT_PUBLIC_BOOKING_API_ORIGIN=http://localhost:3000
ARG NEXT_PUBLIC_TECHWING_QUICK_DEMO=0
ARG NEXT_PUBLIC_CUSTOMER_TENANT_SLUG=
ARG NEXT_PUBLIC_CUSTOMER_BRANCH_ID=
ENV NEXT_PUBLIC_BOOKING_API_ORIGIN=${NEXT_PUBLIC_BOOKING_API_ORIGIN}
ENV NEXT_PUBLIC_TECHWING_QUICK_DEMO=${NEXT_PUBLIC_TECHWING_QUICK_DEMO}
ENV NEXT_PUBLIC_CUSTOMER_TENANT_SLUG=${NEXT_PUBLIC_CUSTOMER_TENANT_SLUG}
ENV NEXT_PUBLIC_CUSTOMER_BRANCH_ID=${NEXT_PUBLIC_CUSTOMER_BRANCH_ID}
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

FROM node:22-bookworm-slim AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3001
ENV HOSTNAME=0.0.0.0

COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3001

CMD ["npx", "next", "start", "-H", "0.0.0.0", "-p", "3001"]

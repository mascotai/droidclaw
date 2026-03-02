FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json ./
RUN bun install && bun add nodemailer

COPY . .
ENV DATABASE_URL="postgresql://placeholder:placeholder@localhost:5432/placeholder"
RUN bun run build

FROM oven/bun:1

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json .
COPY --from=builder /app/node_modules ./node_modules

EXPOSE 3000
ENV PORT=3000
CMD ["bun", "build/index.js"]

# ================================
# Dockerfile for WhatsApp Export System
# Optimized for low-memory environments (Koyeb free tier ~512MB)
# ================================

FROM node:20-slim

# Install Chromium and its dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    fonts-liberation \
    libappindicator3-1 \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils \
    wget \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# Set Chromium path as environment variable
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV CHROME_PATH=/usr/bin/chromium

# Set Node.js memory limit
ENV NODE_OPTIONS="--max-old-space-size=256"

WORKDIR /app

# Copy package files first (better Docker cache)
COPY package.json package-lock.json ./

# Install production dependencies only
RUN npm ci --omit=dev

# Copy application code
COPY server.js ./
COPY public/ ./public/

# Expose the port
EXPOSE 8000

# Start the application
CMD ["node", "server.js"]

# Build Frontend
FROM node:18-bullseye AS frontend-build
WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Build Backend
FROM node:18-bullseye AS backend-build
WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
RUN npm run build

# Production Image
FROM node:18-bullseye
WORKDIR /app

# Install Chromium and dependencies for Puppeteer/whatsapp-web.js
RUN apt-get update \
    && apt-get install -y wget gnupg \
    && wget -q -O - https://dl-ssl.google.com/linux/linux_signing_key.pub | apt-key add - \
    && sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google.list' \
    && apt-get update \
    && apt-get install -y google-chrome-stable fonts-ipafont-gothic fonts-wqy-zenhei fonts-thai-tlwg fonts-kacst fonts-freefont-ttf libxss1 \
      --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Copy Frontend Build
COPY --from=frontend-build /app/frontend/dist ./frontend/dist

# Copy Backend Build and dependencies
WORKDIR /app/backend
COPY --from=backend-build /app/backend/dist ./dist
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Create uploads directory (will be mounted as volume in production)
RUN mkdir -p uploads

# Set Puppeteer executable path for whatsapp-web.js
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome-stable

# Expose port
EXPOSE 3000

# Start server
CMD ["node", "dist/index.js"]

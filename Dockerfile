FROM node:18-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
# Added express-rate-limit
RUN npm init -y && \
    npm install express better-sqlite3 cors ioredis express-rate-limit

# Copy source
COPY server.js .

# Create data directory
RUN mkdir -p data

EXPOSE 3000

CMD ["node", "server.js"]

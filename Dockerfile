# ==========================================
# Stage 1: Build the React Frontend
# ==========================================
FROM node:20-alpine AS frontend-build
WORKDIR /app/frontend

# Copy package files and install dependencies
COPY frontend/package*.json ./
RUN npm install

# Copy frontend source and build (compiles to /app/frontend/dist)
COPY frontend/ ./
RUN npm run build

# ==========================================
# Stage 2: Setup the Express Backend & Serve
# ==========================================
FROM node:20-alpine
WORKDIR /app/backend

# Copy backend package files and install production dependencies
COPY backend/package*.json ./
RUN npm install --production

# Copy the backend source code
COPY backend/ ./

# Copy the built React files from Stage 1 into the exact path server.js expects
COPY --from=frontend-build /app/frontend/dist /app/frontend/dist

# Ensure the local data directory exists and is writable for the JSON store
RUN mkdir -p data && chmod 777 data

# Expose the backend port
EXPOSE 5000

# Start the Node.js Express server
CMD ["node", "src/server.js"]
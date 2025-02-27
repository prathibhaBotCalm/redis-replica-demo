# FROM node:18-alpine

# # for deps
# RUN apk add --no-cache git python3 make g++

# WORKDIR /app
# COPY . /app

# RUN yarn install
# RUN yarn build

# EXPOSE 3000
# CMD ["yarn", "start"]

# Stage 1: Build the application
FROM node:18-alpine AS builder

# Install dependencies required for building (e.g., for native modules)
RUN apk add --no-cache git python3 make g++

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock first to leverage Docker layer caching
COPY package.json yarn.lock ./

# Install dependencies
RUN yarn install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Build the Next.js application
RUN yarn build

# Stage 2: Create the production image
FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy only the necessary files from the builder stage
COPY --from=builder /app/package.json /app/yarn.lock ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public

# Set environment variables for production
ENV NODE_ENV=production

# Expose the application port
EXPOSE 3000

# Command to run the application
CMD ["yarn", "start"]
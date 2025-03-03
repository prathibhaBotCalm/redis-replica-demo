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

# Set working directory
WORKDIR /app

# Copy package.json and yarn.lock
COPY package.json yarn.lock ./

# Install dependencies (including dev dependencies for building)
RUN yarn install --frozen-lockfile

# Copy the rest of the application code
COPY . .

# Build the Next.js app
RUN yarn build

# Stage 2: Serve the application
FROM node:18-alpine AS runner

# Set working directory
WORKDIR /app

# Copy only necessary files from the builder stage
COPY --from=builder /app/package.json /app/yarn.lock ./
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/node_modules ./node_modules

# Expose the port
EXPOSE 3000

# Command to run the application
CMD ["yarn", "start"]
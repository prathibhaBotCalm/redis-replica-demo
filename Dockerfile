# # Base stage: Install dependencies
# FROM node:18-alpine AS base

# # Install necessary build dependencies
# RUN apk add --no-cache git python3 make g++

# # Set the working directory inside the container
# WORKDIR /app

# # Copy package.json and yarn.lock first to leverage Docker's caching
# COPY package.json yarn.lock ./

# # Install dependencies (without unnecessary dev dependencies for production later)
# RUN yarn install --frozen-lockfile

# # Copy the rest of the application code
# COPY . .

# # --------------------------------------------------------
# # Development Stage
# # --------------------------------------------------------
# FROM base AS development

# # Install additional development dependencies
# RUN yarn install --frozen-lockfile

# # Expose the application's port
# EXPOSE 3000

# # Start the application in development mode
# CMD ["yarn", "dev"]

# # --------------------------------------------------------
# # Build Stage
# # --------------------------------------------------------
# FROM base AS build

# # Build the application
# RUN yarn build

# # --------------------------------------------------------
# # Production Stage (final image)
# # --------------------------------------------------------
# FROM node:18-alpine AS production

# # Set the working directory inside the container
# WORKDIR /app

# # Copy only necessary files from the build stage
# COPY --from=build /app/.next ./.next
# COPY --from=build /app/public ./public
# COPY --from=build /app/node_modules ./node_modules
# COPY --from=build /app/package.json ./package.json

# # Set environment variable for production
# ENV NODE_ENV=production

# # Expose the application's port
# EXPOSE 3000

# # Start the application in production mode
# CMD ["yarn", "start"]

FROM node:18-alpine

# for deps
RUN apk add --no-cache git python3 make g++

WORKDIR /app
COPY . /app

RUN yarn i
RUN yarn build

EXPOSE 3000
CMD ["yarn", "start"]
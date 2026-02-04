FROM node:20

# Create app directory
WORKDIR /usr/app

# Install app dependencies
# A wildcard is used to ensure both package.json AND package-lock.json are copied
# where available (npm@5+)
COPY package*.json ./

RUN npm install

# Copy Prisma schema and migrations directory
COPY prisma ./prisma/

# Generate Prisma Client
RUN npx prisma generate

# Bundle app source
COPY . .

# Apply migrations before build
# migrate deploy applies pending migrations without creating new ones (production-safe)
# This requires DATABASE_URL to be available at build time via build args or env
ARG DATABASE_URL
RUN if [ -n "$DATABASE_URL" ]; then npx prisma migrate deploy; else echo "Skipping migrations - DATABASE_URL not provided at build time"; fi

# Build the application
RUN npm run build

# Make migration script executable
RUN chmod +x ./scripts/migrate-and-start.sh

WORKDIR /usr/app

EXPOSE 3000

# Run migrations and start the app
# migrate deploy applies pending migrations in production
CMD ["./scripts/migrate-and-start.sh"]
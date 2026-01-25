FROM node:16

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

# Build the application
RUN npm run build

# Make migration script executable
RUN chmod +x ./scripts/migrate-and-start.sh

WORKDIR /usr/app

EXPOSE 3000

# Run migrations and start the app
# migrate deploy applies pending migrations in production
CMD ["./scripts/migrate-and-start.sh"]